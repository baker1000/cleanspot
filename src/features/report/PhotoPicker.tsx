import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { CameraIcon, CloseIcon, ImageIcon } from '@/components/icons';
import { Alert } from '@/components/ui/Alert';
import { Spinner } from '@/components/ui/Spinner';
import { uuid } from '@/lib/uuid';
import { MAX_PHOTOS, type DraftPhoto } from './api';
import { PhotoError, preparePhoto, type PhotoErrorReason, type PreparedPhoto } from './photo';

export interface PickedPhoto extends DraftPhoto {
  /** Object URL of the prepared (metadata-free) image for the preview. */
  url: string;
}

const pickButton =
  'inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-400 bg-white px-4 py-2 font-semibold text-slate-900 hover:bg-slate-100 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-700';

/**
 * Up to MAX_PHOTOS photos. Every photo is re-encoded on the device (preparePhoto) before it is
 * shown or uploaded, so the original file with its metadata never leaves the device.
 */
export function PhotoPicker({
  id,
  photos,
  onChange,
  error,
  prepare = preparePhoto,
}: {
  id: string;
  photos: PickedPhoto[];
  onChange(photos: PickedPhoto[]): void;
  error?: string;
  prepare?: (file: Blob) => Promise<PreparedPhoto>;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [photoError, setPhotoError] = useState<PhotoErrorReason | null>(null);
  const chooseRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const errorId = useId();
  const latest = useRef(photos);
  useEffect(() => {
    latest.current = photos;
  });
  // Free the preview URLs when the form goes away.
  useEffect(() => () => latest.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  const remaining = MAX_PHOTOS - photos.length;

  async function onFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])].slice(0, remaining);
    e.target.value = ''; // allow picking the same file again
    if (!files.length) return;
    setBusy(true);
    setPhotoError(null);
    const added: PickedPhoto[] = [];
    for (const file of files) {
      try {
        const prepared = await prepare(file);
        added.push({
          id: uuid(),
          blob: prepared.blob,
          ext: prepared.ext,
          url: URL.createObjectURL(prepared.blob),
        });
      } catch (err) {
        setPhotoError(err instanceof PhotoError ? err.reason : 'unsupported');
      }
    }
    setBusy(false);
    if (added.length) onChange([...latest.current, ...added]);
  }

  function remove(photo: PickedPhoto) {
    URL.revokeObjectURL(photo.url);
    onChange(photos.filter((p) => p.id !== photo.id));
    chooseRef.current?.focus();
  }

  return (
    <fieldset
      id={id}
      tabIndex={-1}
      aria-describedby={[hintId, error ? errorId : ''].filter(Boolean).join(' ')}
      className="flex flex-col gap-2 focus:outline-none"
    >
      <legend className="mb-1 text-lg font-semibold">{t('report.photos.legend')}</legend>
      <p id={hintId} className="text-sm text-slate-700">
        {t('report.photos.hint', { max: MAX_PHOTOS })}
      </p>
      {error && (
        <p id={errorId} className="text-sm font-medium text-red-800">
          {error}
        </p>
      )}

      {photos.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {photos.map((p, i) => (
            <li key={p.id} className="relative">
              <img
                src={p.url}
                alt={t('report.photos.alt', { number: i + 1 })}
                className="size-24 rounded-lg border border-slate-300 object-cover"
              />
              <button
                type="button"
                onClick={() => remove(p)}
                aria-label={t('report.photos.remove', { number: i + 1 })}
                className="absolute -end-2 -top-2 inline-flex size-11 items-center justify-center rounded-full border border-slate-400 bg-white text-slate-900 shadow hover:bg-slate-100"
              >
                <CloseIcon />
              </button>
            </li>
          ))}
        </ul>
      )}

      {busy ? (
        <Spinner label={t('report.photos.processing')} />
      ) : remaining > 0 ? (
        <div className="flex flex-wrap gap-2">
          <label className={pickButton}>
            <CameraIcon />
            {t('report.photos.take')}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={onFiles}
              className="sr-only"
            />
          </label>
          <label className={pickButton}>
            <ImageIcon />
            {t('report.photos.choose')}
            <input
              ref={chooseRef}
              type="file"
              accept="image/*"
              multiple
              onChange={onFiles}
              className="sr-only"
            />
          </label>
        </div>
      ) : (
        <p className="text-sm text-slate-700">{t('report.photos.limit', { max: MAX_PHOTOS })}</p>
      )}
      {photoError && <Alert tone="error">{t(`report.photos.errors.${photoError}`)}</Alert>}
    </fieldset>
  );
}
