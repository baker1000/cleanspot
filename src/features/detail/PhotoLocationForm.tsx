import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CameraIcon } from '@/components/icons';
import { Alert } from '@/components/ui/Alert';
import { CameraInput } from '@/components/ui/CameraInput';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { distanceMeters } from '@/features/map/reports';
import type { DraftPhoto } from '@/features/report/api';
import { PhotoError, preparePhoto, type PreparedPhoto } from '@/features/report/photo';
import { LocateFailure, locateOnce, type Position } from '@/lib/geolocation';
import { uuid } from '@/lib/uuid';

type Locating =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'done'; position: Position }
  | { kind: 'failed'; reason: 'denied' | 'unavailable' };

interface Picked {
  id: string;
  prepared: PreparedPhoto;
  url: string;
  takenAt: string;
}

export interface PhotoAtLocation {
  photo: DraftPhoto;
  lng: number;
  lat: number;
  accuracyM: number | null;
  /** When the photo was taken (ISO). */
  takenAt: string;
}

/**
 * A photo plus the location of the moment it was taken, checked against a radius around the
 * report before sending (the server checks again). Used for the after-photo (cleanup) and the
 * photo of bags left for pickup. Browsers cannot prove a photo came from the camera, so the
 * location (not the file) is what is verified.
 *
 * Texts come from `${texts}.title|hint|take|retake|preview|tooFar|submit|submitting`; the
 * location messages are shared (reportDetail.cleanup.*).
 */
export function PhotoLocationForm({
  texts,
  target,
  radiusM,
  busy,
  canSubmit = true,
  children,
  onSubmit,
  prepare = preparePhoto,
  locate = locateOnce,
}: {
  texts: 'reportDetail.cleanup' | 'reportDetail.bags';
  /** The report location the distance is measured to. */
  target: { lng: number; lat: number };
  radiusM: number;
  busy: boolean;
  /** Extra fields (e.g. the number of bags) must be valid too. */
  canSubmit?: boolean;
  children?: ReactNode;
  onSubmit(input: PhotoAtLocation): void;
  prepare?: (file: Blob) => Promise<PreparedPhoto>;
  locate?: () => Promise<Position>;
}) {
  const { t } = useTranslation();
  const headingId = useId();
  const hintId = useId();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [locating, setLocating] = useState<Locating>({ kind: 'idle' });

  // Free the preview URL when it is replaced or the form goes away.
  const previewUrl = useRef<string | null>(null);
  useEffect(() => () => void (previewUrl.current && URL.revokeObjectURL(previewUrl.current)), []);

  async function findMe() {
    setLocating({ kind: 'busy' });
    try {
      setLocating({ kind: 'done', position: await locate() });
    } catch (err) {
      setLocating({
        kind: 'failed',
        reason: err instanceof LocateFailure ? err.reason : 'unavailable',
      });
    }
  }

  async function onPhoto(file: Blob) {
    const takenAt = new Date().toISOString();
    setPhotoError(null);
    setPreparing(true);
    // Location and photo processing run in parallel; the position belongs to this moment.
    void findMe();
    try {
      const prepared = await prepare(file);
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = URL.createObjectURL(prepared.blob);
      setPicked({ id: uuid(), prepared, url: previewUrl.current, takenAt });
    } catch (err) {
      setPhotoError(
        t(`report.photos.errors.${err instanceof PhotoError ? err.reason : 'unsupported'}`),
      );
    } finally {
      setPreparing(false);
    }
  }

  const position = locating.kind === 'done' ? locating.position : null;
  const distance = position ? Math.round(distanceMeters(position, target)) : null;
  const tooFar = distance !== null && distance > radiusM;
  const ready = picked && position && !tooFar && canSubmit;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h3 id={headingId} className="text-lg font-semibold">
        {t(`${texts}.title`)}
      </h3>
      <p id={hintId} className="text-sm text-slate-700">
        {t(`${texts}.hint`, { radius: radiusM })}
      </p>

      {children}

      {picked && (
        <img
          src={picked.url}
          alt={t(`${texts}.preview`)}
          className="max-h-64 w-full max-w-sm rounded-lg border border-slate-300 object-cover"
        />
      )}

      {preparing ? (
        <Spinner label={t('report.photos.processing')} />
      ) : (
        <CameraInput
          className="inline-flex min-h-11 w-fit cursor-pointer items-center gap-2 rounded-lg border border-slate-400 bg-white px-4 py-2 font-semibold text-slate-900 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-700 hover:bg-slate-100"
          describedBy={hintId}
          onPhoto={(photo) => void onPhoto(photo)}
          onError={() => setPhotoError(t('report.photos.errors.camera'))}
        >
          <CameraIcon />
          {t(picked ? `${texts}.retake` : `${texts}.take`)}
        </CameraInput>
      )}
      {photoError && <Alert tone="error">{photoError}</Alert>}

      {locating.kind === 'busy' && <Spinner label={t('reportDetail.cleanup.locating')} />}
      {locating.kind === 'failed' && (
        <Alert tone="error">{t(`reportDetail.cleanup.location.${locating.reason}`)}</Alert>
      )}
      {distance !== null && (
        <Alert tone={tooFar ? 'warning' : 'info'}>
          <p>{t('reportDetail.cleanup.distance', { meters: distance })}</p>
          {tooFar && <p>{t(`${texts}.tooFar`, { radius: radiusM })}</p>}
        </Alert>
      )}
      {picked && (locating.kind === 'failed' || tooFar) && (
        <Button variant="secondary" onClick={() => void findMe()} className="w-fit">
          {t('reportDetail.cleanup.relocate')}
        </Button>
      )}

      {picked && (
        <Button
          loading={busy}
          disabled={!ready}
          onClick={() =>
            ready &&
            onSubmit({
              photo: { id: picked.id, blob: picked.prepared.blob, ext: picked.prepared.ext },
              lng: position.lng,
              lat: position.lat,
              accuracyM: position.accuracy,
              takenAt: picked.takenAt,
            })
          }
        >
          {busy ? t(`${texts}.submitting`) : t(`${texts}.submit`)}
        </Button>
      )}
    </section>
  );
}
