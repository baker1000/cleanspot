# Google Play release

Everything needed for the Play Console, in the order the console asks for it. App ID (fixed,
never change): **`store.thinktools.cleanspot`**. Nothing here has been submitted yet.

## 1. Build the release bundle

1. Production backend in `.env.local` (`npm run cloud:frontend-env -- --force` against the
   production project; **never** the demo project, **never** `VITE_DEMO_MODE=true` — see
   README "Demo mode"). The `VITE_*` values are baked into the app.
2. Bump the version: `npm version patch` (or `minor` / `major`). `versionName` and `versionCode`
   come from `package.json` (`1.2.3` → `10203`); every upload needs a higher code.
3. `npm run android:aab` → `android/app/build/outputs/bundle/release/app-release.aab`, signed
   with the upload key (`android/cleanspot-upload.jks` + `android/keystore.properties`, both
   git-ignored; **back them up** outside this computer).
4. In the Play Console, use **Play App Signing** (default): Google keeps the app signing key; the
   upload key can be reset through Play support if it is lost.

## 2. Store listing

Character limits: title 30, short description 80, full description 4000.
Category: **Maps & Navigation** (alternative: Tools). Contact e-mail: the operator's address.
Privacy policy URL: `https://<website>/datenschutz` (the app's own page; must be reachable
without signing in). Website: `https://<website>/`.

### Deutsch (de-DE, Standardsprache)

**Titel** (23): `CleanSpot – Müll melden`

**Kurzbeschreibung** (78): `Wilden Müll mit Foto und Standort melden – und gemeinsam die Umgebung säubern.`

**Vollständige Beschreibung:**

```
Wilder Müll am Waldrand, Sperrmüll an der Straße, Bauschutt am Feldweg? Mit CleanSpot melden Sie ihn in unter einer Minute – und sehen, wann er beseitigt ist.

SO FUNKTIONIERT ES
• Melden: Foto aufnehmen, der Standort wird automatisch übernommen (und lässt sich korrigieren), Art und Menge wählen, fertig. Ohne Konto möglich.
• Karte: Alle Meldungen in Ihrer Nähe, farbig nach Status – gemeldet, bestätigt, in Arbeit, beseitigt. Farben sind farbenblind-sicher und nie das einzige Merkmal.
• Aufräumen: Freiwillige übernehmen eine Meldung („Ich räume das auf“) und laden ein Nachher-Foto hoch – direkt vor Ort, der Standort wird geprüft.
• Säcke zur Abholung: Nach dem Aufräumen „X Säcke hier abgestellt“ melden. Die Kommune bekommt daraus eine optimierte Abholroute.
• Gefahrstoffe: Batterien, Chemikalien, Asbest oder Spritzen werden mit „Nicht anfassen“ gekennzeichnet und gehen direkt an die Kommune.

FÜR KOMMUNEN
Kommunen erhalten Meldungen aus ihrem Gebiet automatisch, mit eigenen Mitarbeiterkonten, Abholrouten und Statistik. Ohne teilnehmende Kommune kümmert sich die Gemeinschaft.

DATENSCHUTZ
• Keine Werbung, kein Tracking, keine Analyse-Tools, keine Cookies.
• Standort- und Kameradaten (EXIF) werden vor dem Hochladen aus den Fotos entfernt.
• Fotos werden erst nach Prüfung öffentlich.
• Daten jederzeit im Profil herunterladen oder das Konto löschen.
• Server in der EU.

WEITERE MERKMALE
• Funktioniert auch offline: Meldungen werden gespeichert und automatisch gesendet.
• Doppelte Meldungen werden erkannt.
• Deutsch, Englisch, Arabisch, Französisch, Türkisch, Ukrainisch.
• Barrierearm: Bildschirmleser, Tastatur, große Schaltflächen.

CleanSpot ist Open Source (AGPL-3.0).
```

### English (en-US)

**Title** (25): `CleanSpot – Report litter`

**Short description** (75): `Report illegal waste dumps with photo and location – and clean up together.`

**Full description:**

```
Rubbish dumped at the edge of the woods, bulky waste by the road, rubble on a field path? With CleanSpot you report it in under a minute – and see when it has been cleared.

HOW IT WORKS
• Report: take a photo, the location is filled in automatically (and can be corrected), choose type and amount, done. No account needed.
• Map: all reports near you, coloured by status – reported, confirmed, in progress, cleared. The colours are colour-blind safe and never the only cue.
• Clean up: volunteers take on a report ("I'll clear this") and upload an after-photo on the spot; the location is checked.
• Bags for pickup: after a clean-up, report "X bags placed here". The municipality gets an optimised pickup route.
• Hazardous waste: batteries, chemicals, asbestos or needles are marked "Do not touch" and go straight to the municipality.

FOR MUNICIPALITIES
Municipalities automatically receive the reports from their area, with their own staff accounts, pickup routes and statistics. Where no municipality takes part, the community takes care of it.

PRIVACY
• No ads, no tracking, no analytics, no cookies.
• Location and camera data (EXIF) are removed from photos before upload.
• Photos become public only after review.
• Download your data or delete your account at any time in your profile.
• Servers in the EU.

MORE
• Works offline: reports are saved and sent automatically.
• Detects duplicate reports.
• German, English, Arabic, French, Turkish, Ukrainian.
• Accessible: screen readers, keyboard, large touch targets.

CleanSpot is open source (AGPL-3.0).
```

### العربية (ar)

**العنوان** (28): `CleanSpot – بلّغ عن النفايات`

**الوصف المختصر** (67): `أبلغ عن النفايات الملقاة عشوائياً بصورة وموقع، ونظّفوا محيطكم معاً.`

**الوصف الكامل:**

```
نفايات ملقاة عند طرف الغابة، أثاث قديم على جانب الطريق، أنقاض بناء على طريق زراعي؟ مع CleanSpot تبلّغ عنها في أقل من دقيقة، وترى متى أُزيلت.

كيف يعمل
• الإبلاغ: التقط صورة، ويُحدَّد الموقع تلقائياً (ويمكن تعديله)، اختر النوع والكمية، وانتهى. دون حاجة إلى حساب.
• الخريطة: جميع البلاغات القريبة منك، ملوّنة حسب الحالة: مُبلَّغ عنه، مؤكَّد، قيد التنظيف، أُزيل. الألوان مناسبة لعمى الألوان وليست العلامة الوحيدة أبداً.
• التنظيف: يتولّى المتطوعون بلاغاً («سأنظّف هذا») ويرفعون صورة بعد التنظيف في المكان نفسه، ويُتحقَّق من الموقع.
• أكياس للجمع: بعد التنظيف أبلغ بأنك «وضعت هنا X أكياس»، فتحصل البلدية على مسار جمع محسَّن.
• المواد الخطرة: البطاريات والمواد الكيميائية والأسبستوس والإبر تُعلَّم بعبارة «لا تلمس» وتُحال مباشرة إلى البلدية.

للبلديات
تصل إلى البلديات تلقائياً البلاغات الواقعة في نطاقها، مع حسابات خاصة لموظفيها ومسارات للجمع وإحصاءات. وحيث لا تشارك أي بلدية، يتولّى المجتمع الأمر.

الخصوصية
• لا إعلانات ولا تتبّع ولا أدوات تحليل ولا ملفات تعريف الارتباط.
• تُزال بيانات الموقع والكاميرا (EXIF) من الصور قبل رفعها.
• لا تُنشر الصور إلا بعد مراجعتها.
• يمكنك تنزيل بياناتك أو حذف حسابك في أي وقت من ملفك الشخصي.
• الخوادم داخل الاتحاد الأوروبي.

المزيد
• يعمل دون اتصال: تُحفظ البلاغات وتُرسل تلقائياً.
• يكتشف البلاغات المكرّرة.
• الألمانية والإنجليزية والعربية والفرنسية والتركية والأوكرانية، مع دعم كامل للكتابة من اليمين إلى اليسار.
• سهل الوصول: قارئات الشاشة ولوحة المفاتيح وأزرار كبيرة.

CleanSpot مفتوح المصدر (AGPL-3.0).
```

The listing texts in English and especially Arabic should be read by a native speaker before
publishing (see RELEASE_CHECKLIST.md).

### Graphics (to create)

- App icon 512 × 512 PNG: render from `public/icons/icon.svg` (`npm run icons` makes the app
  icons; export a 512 px version for the console).
- Feature graphic 1024 × 500.
- Phone screenshots (2–8, at least 1080 px on the short side recommended): map with reports,
  report form, report detail with timeline, pickup route, profile with data export. Take them
  from the demo project (realistic data), but **not** with the demo notice visible, or say in
  the screenshot that it shows demo data.

## 3. App content (Policy → App content)

| Question                            | Answer                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Privacy policy                      | `https://<website>/datenschutz`                                                                                                                                                                                                                                                                                                                                             |
| Ads                                 | No ads                                                                                                                                                                                                                                                                                                                                                                      |
| App access                          | Most features work without an account. For staff features, give reviewers a **test staff account** of a test municipality in the production project (not a demo-mode build), with instructions: "Profile → sign in → Pickup route".                                                                                                                                         |
| Content rating (IARC questionnaire) | Category "Utility / productivity / communication / other". User-generated content: **yes** (photos, comments; reviewed before they are public, users can be blocked). No violence, no gambling, no purchases. Location sharing: users share the location of a waste report, not their own live location. Expected rating: USK 0 / PEGI 3, possibly "users interact" notice. |
| Target audience                     | **16 and older** (DSGVO Art. 8: in Germany consent for online services from 16). Not designed for children; not in the "Designed for Families" programme.                                                                                                                                                                                                                   |
| News app                            | No                                                                                                                                                                                                                                                                                                                                                                          |
| Government app                      | No — unless a municipality publishes it under its own developer account.                                                                                                                                                                                                                                                                                                    |
| Financial features, health, VPN     | None                                                                                                                                                                                                                                                                                                                                                                        |
| Data safety                         | see section 4                                                                                                                                                                                                                                                                                                                                                               |

## 4. Data safety form

General answers:

| Question                                                              | Answer                                                                                                                                                                                                       |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Does your app collect or share any of the required user data types?   | **Yes**                                                                                                                                                                                                      |
| Is all of the user data collected by your app encrypted in transit?   | **Yes** (HTTPS/TLS only)                                                                                                                                                                                     |
| Do you provide a way for users to request that their data is deleted? | **Yes** — in the app (Profile → Delete account) and on the website; deletion URL for the form: `https://<website>/app/profile` (works in any browser; the privacy policy explains it, section "Ihre Rechte") |
| Independent security review                                           | No                                                                                                                                                                                                           |

Data types (all **collected**, **not shared**, **not processed ephemerally**):

| Data type                                       | Collected for                         | Optional?                                                                               | Linked to user?                                                       | Notes                                                              |
| ----------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Location → **Precise location**                 | App functionality                     | Required to report (the report's location); after-photo and bag locations for clean-ups | Yes (linked to the account or anonymous account that made the report) | Only while the app is used (foreground); no background location    |
| Photos and videos → **Photos**                  | App functionality                     | Required to report (1–3 photos); after-photo for clean-ups                              | Yes                                                                   | EXIF metadata removed on the device; public only after review      |
| Personal info → **Email address**               | Account management                    | Optional (anonymous use without e-mail)                                                 | Yes                                                                   | Never shown to others                                              |
| Personal info → **User IDs**                    | App functionality, account management | Required (an anonymous account is created on the first report)                          | Yes                                                                   | Random id, no device id                                            |
| App activity → **Other user-generated content** | App functionality                     | Optional (comment on a report, max 500 characters)                                      | Yes                                                                   | Public only when the report is published; deleted with the account |

Not collected: name (the app has no field for it), financial info, health, messages, contacts, calendar, files, audio, web history,
app interactions/analytics, crash logs (no crash reporting SDK), device or other IDs (no
advertising id).

Notes for the person filling in the form:

- **Sharing:** Google does not count transfers to service providers acting on your behalf
  (Supabase as hosting/database processor) as sharing. Map tiles (OpenFreeMap) and place search
  (Nominatim, OpenStreetMap Foundation) receive the device's IP address and, for search, the
  search text; this is described in the privacy policy, section 8. If the operator uses other
  providers, update both.
- **Public reports:** the location, approved photos and published comments of a report are
  visible to everyone in the app — by the purpose of the app, and stated in the listing and the
  privacy policy.
- Re-check this form whenever a feature adds data (push notifications in Milestone 2 add an FCM
  token: Device or other IDs).

## 5. Closed testing (required before production)

New **personal** developer accounts (created after 13 Nov 2023) must run a closed test with
**at least 12 testers who stay opted in for 14 days in a row** before they can apply for
production access. Organisation accounts are exempt.

1. Play Console → Testing → **Closed testing** → create a track (e.g. "Pilot"), upload the AAB.
2. Testers: create a Google Group or an e-mail list with **15–20 people** (some drop out; the
   count is of testers opted in on each of the 14 days). Good candidates: people from the
   municipality, local clean-up groups, friends and family with Android phones.
3. Send them the opt-in link; each tester must **accept**, then install from Play (not via APK).
4. Keep all of them opted in for **14 continuous days**. Ask them to really use the app
   (report, confirm, clear), since Google asks about the testing in the production application.
5. Collect feedback (an e-mail address or a form) and ship at least one update during the test.
6. After 14 days: Dashboard → **Apply for production**. Answer the questions about the test
   (how testers were recruited, what feedback changed). Review takes up to about 7 days.

Tester instructions (to send, German):

```
Hallo! Danke, dass du CleanSpot testest.
1. Öffne den Einladungslink und tippe auf „Tester werden“.
2. Installiere CleanSpot aus dem Play Store (Link auf derselben Seite).
3. Bitte bleib 14 Tage lang Tester und lass die App installiert.
4. Probier aus: Müll melden (gern auch Testmeldungen mit „Test“ im Kommentar), Meldungen bestätigen, eine Meldung übernehmen und aufräumen.
5. Rückmeldungen und Fehler an: <E-Mail-Adresse>
Hinweis: Testmeldungen sind für alle sichtbar. Bitte keine Personen oder Autokennzeichen fotografieren.
```

## 6. Before each production release

- [ ] `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e` pass; `npm run verify:remote`
      passes on the verify project after a new migration.
- [ ] Migrations pushed to the production project; maintenance job set up there.
- [ ] Version bumped; AAB built against the production backend with demo mode **off**.
- [ ] Release notes in de, en, ar.
- [ ] Data safety form still correct.
