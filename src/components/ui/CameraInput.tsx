import type { ChangeEvent, ReactNode } from 'react';
import { isNative, takeNativePhoto } from '@/lib/native';

/**
 * "Take a photo": a camera file input in the browser, the system camera in the native app (the
 * gallery is never offered there). Calls `onPhoto` with the picture, or `onError` if the camera
 * cannot be used. Looks the same in both cases.
 */
export function CameraInput({
  className,
  describedBy,
  children,
  onPhoto,
  onError,
  native = isNative(),
}: {
  className: string;
  describedBy?: string;
  children: ReactNode;
  onPhoto(photo: Blob): void;
  onError(): void;
  /** For tests. */
  native?: boolean;
}) {
  if (native) {
    return (
      <button
        type="button"
        aria-describedby={describedBy}
        className={className}
        onClick={() =>
          void takeNativePhoto().then(
            (photo) => photo && onPhoto(photo),
            () => onError(),
          )
        }
      >
        {children}
      </button>
    );
  }

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow taking the same picture again
    if (file) onPhoto(file);
  };
  return (
    <label className={className}>
      {children}
      <input
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onChange}
        aria-describedby={describedBy}
        className="sr-only"
      />
    </label>
  );
}
