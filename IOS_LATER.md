# iOS — prepared, not published

The iOS app shares the web code with Android (Capacitor 8). The Xcode project is in `ios/` and
is kept in sync with `npm run android:sync` (which runs `cap sync` for both platforms). It has not
been built or run yet: that needs a Mac.

## What is already done

- Capacitor iOS platform added (`ios/App`, Swift Package Manager, no CocoaPods).
- Same plugins as Android: camera, geolocation, filesystem, share, splash screen, app.
- `Info.plist` permission texts (German, the development region is `de`):
  `NSCameraUsageDescription`, `NSLocationWhenInUseUsageDescription`,
  `NSPhotoLibraryUsageDescription`, `NSPhotoLibraryAddUsageDescription`.
  Translations for en, ar, fr, tr, uk are in `ios/App/App/<lang>.lproj/InfoPlist.strings`.
- App icon (1024 × 1024, full bleed; iOS rounds the corners) and splash images, rendered by
  `npm run icons` from the same drawing as Android and the PWA.
- No Android-only APIs in the web code: native features go through `src/lib/native.ts`
  (Capacitor plugins that exist on both platforms). The service worker is not used in the native
  apps.

## Remaining steps for an App Store release

1. **Mac with Xcode** (current version), Apple Developer Program membership (99 €/year — a paid
   service; ask before signing up).
2. `npm ci && npm run android:sync`, then `npx cap open ios`.
3. **Localised permission texts:** in Xcode, add the languages (Project → Info → Localizations:
   English, Arabic, French, Turkish, Ukrainian) and add the existing `InfoPlist.strings` files to
   the App target (they are on disk but not yet referenced in `project.pbxproj`).
4. **Signing:** set the team and bundle id `store.thinktools.cleanspot` (Signing & Capabilities).
5. **Version:** set `MARKETING_VERSION` to the `package.json` version and increase
   `CURRENT_PROJECT_VERSION` for every upload (Android does this automatically from
   `package.json`; iOS does not yet).
6. **Push notifications (Milestone 2):** iOS has no Info.plist usage text for notifications (the
   permission dialog is a fixed system text), so there is nothing to add there; ask for permission
   in the app only after explaining why (e.g. "tell me when my report is cleared"). Add the Push
   Notifications capability and an APNs key;
   `@capacitor/push-notifications` then works with FCM (via APNs) or APNs directly.
7. **Test on a device:** camera (`Take photo` opens the system camera), location permission
   dialog, data export through the share sheet, safe areas (notch, home indicator), RTL in
   Arabic, offline queue (reports sent when the app is opened again).
8. **App Store Connect:** app privacy answers (same data as the Google Play Data Safety form in
   `PLAY_STORE.md`), privacy policy URL (`/datenschutz` on the website), screenshots, listing
   texts in German, English and Arabic.
9. **Review notes:** anonymous reporting is possible without an account; give the reviewer a test
   account for the staff features.

## Known differences to check on iOS

- Background Sync does not exist in iOS WebViews: reports made offline are sent the next time the
  app is open (same as Android).
- `navigator.storage` limits in WKWebView can be lower than on Android; the offline queue keeps
  photos in IndexedDB.
