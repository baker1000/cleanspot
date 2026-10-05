# Automated blurring of faces and licence plates (not built yet)

**Today:** no photo becomes public before a person has looked at it. Staff (or, in the public
area, the operator) approve or reject each photo (`moderate_photo`); a photo with a recognisable
face or licence plate is **rejected**. Photos are also published automatically after
`auto_approve_confirmations` community confirmations (default 3). For the public area that is the
weak point: confirmations say "the waste is there", not "the photo is clean". Automated blurring
would close that gap and save staff time. This document describes how to add it.

## Requirements

1. **The original never becomes public.** Only a blurred copy may be shown to anyone other than
   the uploader and the tenant's staff.
2. **No data leaves the installation:** no cloud vision APIs (Google, AWS, Azure). They are paid,
   send photos to a third party and need a data processing agreement. Detection runs on the
   device or on the CleanSpot server.
3. **Fails closed:** if detection is unavailable or unsure, the photo waits for a human.
4. Detection may miss things: blurring **reduces** manual review, it does not replace it for
   hazardous or flagged reports.

## Where it fits in the current code

| Step                      | Today                                                                                                 | With blurring                                                                    |
| ------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Client prepares the photo | `src/features/report/photo.ts`: scale to 1600 px, apply orientation, drop EXIF, WebP                  | optional first pass on the device (below)                                        |
| Upload                    | `report-photos/<uid>/<uuid>.webp`, private bucket                                                     | unchanged (original)                                                             |
| Attach                    | `add_report_photo` / `submit_cleanup` / `report_bags` → `report_photos` row, `moderation = 'pending'` | new column `blur_status` (`pending`, `done`, `failed`), `public_path`            |
| Who can read              | `can_read_photo(path)`: uploader, staff, or approved + public report                                  | public viewers get **only** `public_path`; originals for uploader and staff only |
| Publish                   | `moderate_photo` or N confirmations                                                                   | auto-publish by confirmations only when `blur_status = 'done'`                   |

## Option A: on the device (first pass)

- Run a small face detector in the browser / WebView before upload, e.g. **MediaPipe Face
  Detection** (Apache-2.0, WASM + WebGL, about 1–2 MB model) and blur the boxes on the canvas in
  `photo.ts` before encoding.
- Pros: the server never receives the unblurred face; works offline.
- Cons: larger app, slower on cheap phones; no good small, permissively licensed
  **licence-plate** model for the browser; a modified client can skip it. So it cannot be the
  only safeguard.

## Option B: on the server (recommended)

A small worker next to Supabase, triggered for every new photo:

1. **Trigger:** a database webhook (`pg_net`) or the existing hourly maintenance pattern, but
   every minute, picks `report_photos` with `blur_status = 'pending'`.
2. **Worker** (container, CPU is enough for a municipality's volume): downloads the original
   through the Storage API with the service role, detects faces and plates, blurs them
   (strong Gaussian blur or pixelation with a margin around each box), uploads
   `<uid>/<uuid>.public.webp`, and sets `blur_status = 'done'`, `public_path`.
   Candidate building blocks:
   - faces: [deface](https://github.com/ORB-HD/deface) (CenterFace model) or YuNet from the
     OpenCV model zoo. Both are published under permissive licences; confirm the current
     licence of code and model before use;
   - licence plates: a YOLO-based plate detector trained on European plates. Check the licence
     of model **and** weights: Ultralytics YOLO is AGPL-3.0, which fits CleanSpot's own licence;
     many published plate weights have unclear licences — ask before using them (project rule).
3. **Errors** (`failed`): the photo stays pending for manual review; staff see "automatic
   blurring failed".
4. **Moderation view:** staff see the blurred version and can open the original; approving
   publishes only the blurred version.

## Database changes (sketch)

```sql
alter table public.report_photos
  add column blur_status text not null default 'pending'
    check (blur_status in ('pending', 'done', 'failed', 'not_needed')),
  add column public_path text unique;

-- report_photos_public exposes public_path instead of storage_path; can_read_photo allows the
-- original only for the uploader and the tenant's staff; publish_report (auto-approval by
-- confirmations) requires blur_status = 'done'.
```

A new migration must also cover the existing photos (`blur_status = 'not_needed'` for photos
that were already approved by a person) and the data export/deletion functions (both files).

## Tests to add

- DB (PGlite + `verify:remote`): public views never return an original path; auto-publish waits
  for `done`; deleting an account deletes both files.
- Worker: fixtures with faces and German plates (own photos or freely licensed ones), including
  small/far, side views and night; measure misses before relying on it.
- E2E: a reported photo shows up blurred for a visitor and unblurred for staff.

## Effort

Server worker with faces and plates, schema change, moderation view: about 1–2 weeks, plus the
choice and evaluation of the plate model. Device-side face blurring as an extra: a few days.
