// Photo preparation before upload: decode, apply the EXIF orientation, scale down, re-encode.
//
// Re-encoding through a canvas drops ALL metadata (EXIF incl. GPS position, camera serial,
// timestamps; XMP; IPTC), because a canvas holds pixels only. `findMetadata` double-checks the
// result, so a browser quirk can never upload a photo with the original metadata.

/** Long edge in pixels. Enough to recognise waste; keeps uploads around 150–400 kB. */
export const MAX_EDGE = 1600;
/** Storage bucket limit (report-photos: 5 MiB). */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const WEBP_QUALITY = 0.8;
const JPEG_QUALITY = 0.82;

export type PhotoErrorReason = 'unsupported' | 'too_large' | 'metadata';

export class PhotoError extends Error {
  constructor(public readonly reason: PhotoErrorReason) {
    super(`Photo could not be prepared: ${reason}`);
    this.name = 'PhotoError';
  }
}

export interface PreparedPhoto {
  blob: Blob;
  /** File extension for the storage path (the DB accepts webp and jpg). */
  ext: 'webp' | 'jpg';
  width: number;
  height: number;
}

/** Scales (w, h) so the long edge is at most `max`; never scales up. */
export function fitWithin(width: number, height: number, max = MAX_EDGE) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length));

/**
 * Names the metadata blocks found in a JPEG or WebP file ([] = none). JPEG: APP1 (EXIF/XMP) and
 * APP13 (IPTC) segments. WebP: EXIF and XMP chunks.
 */
export function findMetadata(bytes: Uint8Array): string[] {
  const found: string[] = [];
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 4 <= bytes.length && bytes[i] === 0xff) {
      const marker = bytes[i + 1]!;
      if (marker === 0xda || marker === 0xd9) break; // start of scan / end of image
      const length = (bytes[i + 2]! << 8) | bytes[i + 3]!;
      if (marker === 0xe1) {
        found.push(ascii(bytes, i + 4, 4) === 'Exif' ? 'EXIF' : 'XMP');
      } else if (marker === 0xed) {
        found.push('IPTC');
      }
      i += 2 + length;
    }
    return found;
  }
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    let i = 12;
    while (i + 8 <= bytes.length) {
      const id = ascii(bytes, i, 4);
      const size =
        bytes[i + 4]! | (bytes[i + 5]! << 8) | (bytes[i + 6]! << 16) | (bytes[i + 7]! << 24);
      if (id === 'EXIF' || id === 'XMP ') found.push(id.trim());
      i += 8 + size + (size % 2);
    }
    return found;
  }
  return found;
}

/** Browser primitives, injectable for unit tests. */
export interface PhotoCodec {
  /** Decodes with the EXIF orientation applied. */
  decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number }>;
  /** Draws at the given size and encodes; resolves with whatever type the browser produced. */
  encode(
    source: CanvasImageSource,
    width: number,
    height: number,
    type: string,
    quality: number,
  ): Promise<Blob>;
}

export const browserCodec: PhotoCodec = {
  async decode(file) {
    try {
      // 'from-image' applies the EXIF orientation, so portrait photos stay upright.
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height };
    } catch {
      // e.g. HEIC on browsers that cannot decode it.
      throw new PhotoError('unsupported');
    }
  },
  encode(source, width, height, type, quality) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return Promise.reject(new PhotoError('unsupported'));
    ctx.drawImage(source, 0, 0, width, height);
    return new Promise((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new PhotoError('unsupported'))),
        type,
        quality,
      ),
    );
  },
};

/** Decodes, scales to MAX_EDGE, re-encodes as WebP (JPEG where WebP encoding is missing). */
export async function preparePhoto(
  file: Blob,
  codec: PhotoCodec = browserCodec,
): Promise<PreparedPhoto> {
  const decoded = await codec.decode(file);
  const { width, height } = fitWithin(decoded.width, decoded.height);
  try {
    let blob = await codec.encode(decoded.source, width, height, 'image/webp', WEBP_QUALITY);
    let ext: PreparedPhoto['ext'] = 'webp';
    // Browsers without a WebP encoder (older Safari) silently return PNG instead.
    if (blob.type !== 'image/webp') {
      blob = await codec.encode(decoded.source, width, height, 'image/jpeg', JPEG_QUALITY);
      ext = 'jpg';
      if (blob.type !== 'image/jpeg') throw new PhotoError('unsupported');
    }
    if (blob.size > MAX_UPLOAD_BYTES) throw new PhotoError('too_large');
    if (findMetadata(new Uint8Array(await blob.arrayBuffer())).length) {
      throw new PhotoError('metadata');
    }
    return { blob, ext, width, height };
  } finally {
    if ('close' in decoded.source && typeof decoded.source.close === 'function') {
      decoded.source.close();
    }
  }
}
