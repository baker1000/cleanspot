# CleanSpot

Open-Source-App zum Melden und Beseitigen von wildem Müll. Bürgerinnen und Bürger melden Müll mit
Foto und Standort, die Meldungen erscheinen auf einer Karte, Freiwillige oder Mitarbeitende der
Kommune räumen auf. Gedacht als Angebot an einen Landkreis **und** als freie öffentliche App, die
auch ohne Kommune funktioniert.

**[English version: README.md](README.md)**

## Was CleanSpot kann

- **Melden in unter einer Minute:** 1–3 Fotos (auf dem Gerät verkleinert, EXIF-Daten entfernt),
  automatischer Standort mit verschiebbarer Markierung, Kategorie, Größe, optionaler Kommentar.
  Ohne Konto möglich (anonyme Anmeldung). Funktioniert offline: Meldungen werden gespeichert und
  später gesendet.
- **Karte:** Meldungen farbig nach Status (Okabe-Ito, farbenblind-sicher, nie nur Farbe), Filter,
  Ortssuche, Gruppierung, Listenansicht für Tastatur und Bildschirmleser.
- **Aufräumen:** Meldungen bestätigen, „Ich räume das auf“, Nachher-Foto innerhalb von 50 m;
  Gefahrstoffe (Batterien, Chemikalien, Asbest, Spritzen) zeigen „Nicht anfassen“ und gehen nur an
  Mitarbeitende der Kommune.
- **Säcke zur Abholung:** Freiwillige melden „X Säcke hier abgestellt“; Mitarbeitende erhalten eine
  optimierte Abholroute für den Tag.
- **Mandantenfähig:** Eine Installation bedient mehrere Kommunen (jede mit eigenem Gebiet,
  eigenen Mitarbeitenden und Einstellungen) und die Öffentlichkeit; Meldungen werden nach Ort
  zugeordnet.
- **DSGVO:** kein Tracking, keine Cookies, Hosting in der EU oder auf eigenen Servern,
  Datenexport und Kontolöschung in der App, Fotos erst nach Prüfung öffentlich.
- **Plattformen:** Website + installierbare Web-App (PWA), Android-App (Capacitor, bereit für
  Google Play), iOS vorbereitet. Deutsch (Standard), Englisch, Arabisch (von rechts nach links),
  Französisch, Türkisch, Ukrainisch. Ziel Barrierefreiheit: WCAG 2.1 AA / BITV 2.0.

**Stand:** Meilenstein 1 (MVP) ist fertig und getestet; Meilenstein 2 (Admin-Dashboard,
Aufräumaktionen, Benachrichtigungen, Moderations-Warteschlange, Open311, Brennpunkte, …) ist noch
nicht begonnen. [ROADMAP.md](ROADMAP.md) beschreibt jeden Schritt mit Tests und bekannten
Einschränkungen.

| Dokument                                           | Inhalt                                                                       |
| -------------------------------------------------- | ---------------------------------------------------------------------------- |
| [ARCHITECTURE.md](ARCHITECTURE.md)                 | Datenmodell, Rollen, RLS-Regeln, Offline-Sync, Tests (Englisch)              |
| [deploy/docker/README.md](deploy/docker/README.md) | Betrieb auf eigenen Servern mit Docker (Englisch)                            |
| [PLAY_STORE.md](PLAY_STORE.md)                     | Google Play: Store-Texte (de/en/ar), Datensicherheit, geschlossener Test     |
| [IOS_LATER.md](IOS_LATER.md)                       | Offene Schritte für den App Store                                            |
| [PITCH.md](PITCH.md)                               | Vorstellung für die Kommune                                                  |
| [docs/PHOTO_BLURRING.md](docs/PHOTO_BLURRING.md)   | Wie Gesichter und Kennzeichen automatisch unkenntlich gemacht werden könnten |
| [VERIFY_ON_SUPABASE.md](VERIFY_ON_SUPABASE.md)     | Ergebnisse der Tests gegen echtes Supabase                                   |
| [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md)       | Was vor einer öffentlichen Freigabe erledigt sein muss                       |

## Schnellstart (lokale Entwicklung)

Voraussetzung: Node.js ≥ 22.

```bash
npm install
npm test          # Unit- und Datenbanktests (PGlite, ohne Docker)
npm run dev       # http://127.0.0.1:5173 – ohne Backend nur Startseite und Karte
```

Als Backend entweder ein Supabase-Cloud-Projekt (nächster Abschnitt) mit
`npm run cloud:frontend-env` oder eine lokale Supabase-Umgebung mit Docker (`npm run db:start`,
dann `.env.example` nach `.env.local` kopieren und die Werte aus `npx supabase status` eintragen).

## Bereitstellung

### A. Supabase Cloud (EU)

1. Unter <https://supabase.com> ein Projekt in **Central EU (Frankfurt)** anlegen.
2. `supabase-cloud.env.example` nach `.env.supabase-cloud` kopieren (wird nicht eingecheckt) und
   ausfüllen; die Vorlage beschreibt, wo jeder Wert im Dashboard steht. `npm run cloud:status`
   prüft die Werte, ohne sie anzuzeigen.
3. `npm run cloud:link`, `npm run cloud:push:dry`, `npm run cloud:push` – spielt alle Migrationen
   ein (Schema, Funktionen, RLS, Foto-Speicher, Job für abgelaufene Übernahmen).
4. `npm run cloud:auth-config -- --apply` – schaltet anonyme Anmeldungen ein (30 pro Stunde und
   IP-Adresse). Im Dashboard unter **Authentication → URL Configuration** die **Site URL** auf die
   Adresse der App setzen und SMTP einrichten (siehe Abschnitt „Email (SMTP)“ in der
   [englischen README](README.md#email-smtp)).
5. `npm run cloud:maintenance` – richtet die Wartungsfunktion (Edge Function) ein und plant sie
   stündlich.
6. Eine Kommune anlegen, mit Gebietsgrenze und Mitarbeitenden: SQL in
   [deploy/docker/README.md, Schritt 4](deploy/docker/README.md#4-municipality-staff-settings)
   (dieselben Befehle funktionieren im SQL-Editor der Cloud).
7. Web-App: `npm run cloud:frontend-env` schreibt `.env.local` (nur öffentliche Werte), dann
   `npm run build` und den Ordner `dist/` bei einem Hoster in der EU ablegen. Für jeden Pfad
   `index.html` ausliefern, `sw.js` und `manifest.webmanifest` mit `Cache-Control: no-cache`
   (vollständiges Beispiel: `deploy/docker/nginx.conf`).
8. Vor dem öffentlichen Start: [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) (Rechtstexte,
   Übersetzungen, Prüfung der Produktionsumgebung).

### B. Eigene Server mit Docker

Die offizielle Docker-Umgebung von Supabase plus ein Container für die Web-App:
[deploy/docker/README.md](deploy/docker/README.md). Beschrieben, aber **noch nicht vollständig
getestet**.

## Android-App

Voraussetzungen: **JDK 21** (`JAVA_HOME`) und das Android SDK (`ANDROID_HOME`).

- `npm run android:apk` – Debug-APK in `android/app/build/outputs/apk/debug/`
  (installieren mit `adb install -r …`).
- `npm run android:aab` – signiertes Release-Bundle für Google Play in
  `android/app/build/outputs/bundle/release/app-release.aab`.
- Die `VITE_*`-Werte aus `.env.local` werden in die App eingebaut: für eine Veröffentlichung die
  Produktionswerte verwenden, **nie** den Demo-Modus.
- **Version** aus `package.json` (`1.2.3` → versionCode `10203`); vor jedem Upload
  `npm version patch`.
- **Signatur:** `npm run android:keystore` erzeugt den Upload-Schlüssel
  `android/cleanspot-upload.jks` und `android/keystore.properties` (beide nicht eingecheckt,
  Passwort wird nie angezeigt). **Beide Dateien sichern.** Mit Play App Signing verwaltet Google
  den eigentlichen App-Signaturschlüssel.
- App-ID (fest, nie ändern): `store.thinktools.cleanspot`.
- Alles für Google Play: [PLAY_STORE.md](PLAY_STORE.md).

## Demo-Modus

Für Vorführungen und zum Ausprobieren aller Rollen – **nur auf einem eigenen Demo-Projekt**: Die
Demo-Konten teilen sich ein Passwort, und ein Build im Demo-Modus enthält es.

- `npm run demo -- seed --yes` legt die Demo-Kommune **„Landkreis Harburg (Demo)“** (grobe
  Umrisslinie, nicht die amtliche Grenze), 32 Meldungen rund um Hamburg und im Landkreis Harburg in
  allen Status, 7 Sack-Abholungen (5 offen) und je ein Konto pro Rolle an: Bürgerin, Freiwilliger,
  Organisatorin, Mitarbeiter und Admin der Kommune, Super-Admin
  (`<rolle>@demo.cleanspot.invalid`). Das Passwort liegt in `demo-login.local` (nicht eingecheckt).
- `npm run demo:frontend-env` richtet die App auf das Demo-Projekt aus und schaltet den
  Demo-Modus ein: Jede Seite weist auf erfundene Daten hin, im Profil gibt es eine Anmeldung per
  Fingertipp für jede Rolle.
- `npm run demo -- remove` entfernt Demo-Daten und -Konten wieder.
- Details: [README.md, „Demo mode“](README.md#demo-mode).

## Entwicklung und Tests

| Befehl                              | Zweck                                                                                                 |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `npm test`                          | Unit-, Komponenten- und Datenbanktests (Vitest, PGlite)                                               |
| `npm run test:e2e`                  | Playwright-Tests der Hauptabläufe inkl. Barrierefreiheit (einmalig `npx playwright install chromium`) |
| `npm run lint`, `npm run typecheck` | ESLint, TypeScript                                                                                    |
| `npm run verify:remote`             | Datenbank- und API-Tests gegen ein **leeres** Supabase-Projekt                                        |

Code, Kommentare und technische Dokumentation sind auf Englisch; Texte der App liegen für alle
sechs Sprachen in `src/i18n/locales/`.

## Lizenz

[AGPL-3.0](LICENSE)
