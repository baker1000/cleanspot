import { describe, expect, it, vi } from 'vitest';
import {
  findMetadata,
  fitWithin,
  MAX_UPLOAD_BYTES,
  PhotoError,
  preparePhoto,
  type PhotoCodec,
} from './photo';

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(
    parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)),
  );

/** JPEG segment: FF marker, 2-byte length (incl. itself), payload. */
const segment = (marker: number, payload: string) => [
  0xff,
  marker,
  (payload.length + 2) >> 8,
  (payload.length + 2) & 0xff,
  ...[...payload].map((c) => c.charCodeAt(0)),
];
const SOI = [0xff, 0xd8];
const SOS = [0xff, 0xda, 0x00, 0x02];

/** WebP chunk: 4-char id, little-endian size, payload, pad byte for odd sizes. */
const chunk = (id: string, payload: string) => [
  ...[...id].map((c) => c.charCodeAt(0)),
  payload.length & 0xff,
  (payload.length >> 8) & 0xff,
  0,
  0,
  ...[...payload].map((c) => c.charCodeAt(0)),
  ...(payload.length % 2 ? [0] : []),
];

describe('fitWithin', () => {
  it('scales the long edge down to 1600 px and keeps the aspect ratio', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1200, height: 1600 });
  });
  it('never scales up', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

describe('findMetadata', () => {
  it('finds EXIF, XMP and IPTC in JPEG', () => {
    const jpeg = bytes(
      SOI,
      segment(0xe0, 'JFIF\0'),
      segment(0xe1, 'Exif\0\0MM'),
      segment(0xe1, 'http://ns.adobe.com/xap/1.0/\0'),
      segment(0xed, 'Photoshop 3.0\0'),
      SOS,
    );
    expect(findMetadata(jpeg)).toEqual(['EXIF', 'XMP', 'IPTC']);
  });

  it('reports a clean JPEG as clean, ignoring bytes after start-of-scan', () => {
    const jpeg = bytes(SOI, segment(0xe0, 'JFIF\0'), SOS, segment(0xe1, 'Exif\0\0'));
    expect(findMetadata(jpeg)).toEqual([]);
  });

  it('finds EXIF and XMP chunks in WebP, handling odd chunk sizes', () => {
    const body = [...chunk('VP8X', 'abcdefghij'), ...chunk('EXIF', 'odd'), ...chunk('XMP ', 'x')];
    const webp = bytes('RIFF', [0, 0, 0, 0], 'WEBP', body);
    expect(findMetadata(webp)).toEqual(['EXIF', 'XMP']);
    expect(findMetadata(bytes('RIFF', [0, 0, 0, 0], 'WEBP', chunk('VP8 ', 'pix')))).toEqual([]);
  });
});

describe('preparePhoto', () => {
  const cleanWebp = new Blob([bytes('RIFF', [0, 0, 0, 0], 'WEBP', chunk('VP8 ', 'pixels'))], {
    type: 'image/webp',
  });
  const cleanJpeg = new Blob([bytes(SOI, segment(0xe0, 'JFIF\0'), SOS)], { type: 'image/jpeg' });

  function codec(results: Blob[]) {
    const source = { close: vi.fn() } as unknown as ImageBitmap;
    return {
      source,
      codec: {
        decode: vi.fn(async () => ({ source, width: 4000, height: 3000 })),
        encode: vi.fn(async () => results.shift()!),
      } satisfies PhotoCodec,
    };
  }

  it('encodes WebP at 1600 px and releases the bitmap', async () => {
    const { codec: c, source } = codec([cleanWebp]);
    const photo = await preparePhoto(new Blob(['x']), c);
    expect(photo).toEqual({ blob: cleanWebp, ext: 'webp', width: 1600, height: 1200 });
    expect(c.encode).toHaveBeenCalledWith(source, 1600, 1200, 'image/webp', 0.8);
    expect((source as unknown as { close: () => void }).close).toHaveBeenCalled();
  });

  it('falls back to JPEG when the browser cannot encode WebP', async () => {
    const png = new Blob(['png'], { type: 'image/png' });
    const { codec: c } = codec([png, cleanJpeg]);
    const photo = await preparePhoto(new Blob(['x']), c);
    expect(photo.ext).toBe('jpg');
    expect(c.encode).toHaveBeenLastCalledWith(expect.anything(), 1600, 1200, 'image/jpeg', 0.82);
  });

  it('refuses a result that still carries metadata', async () => {
    const leaky = new Blob([bytes(SOI, segment(0xe1, 'Exif\0\0GPS'), SOS)], {
      type: 'image/jpeg',
    });
    const { codec: c } = codec([new Blob(['png'], { type: 'image/png' }), leaky]);
    await expect(preparePhoto(new Blob(['x']), c)).rejects.toEqual(new PhotoError('metadata'));
  });

  it('refuses results above the bucket limit', async () => {
    const huge = new Blob([new Uint8Array(MAX_UPLOAD_BYTES + 1)], { type: 'image/webp' });
    const { codec: c } = codec([huge]);
    await expect(preparePhoto(new Blob(['x']), c)).rejects.toEqual(new PhotoError('too_large'));
  });
});
