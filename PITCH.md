# CleanSpot – wilden Müll melden, beseitigen, abholen

**Ein Vorschlag für den Landkreis Harburg**

---

## Das Problem

- **Wilder Müll ist teuer.** Sperrmüll am Waldrand, Bauschutt am Feldweg, Müllsäcke an Parkplätzen:
  Jede Fundstelle kostet Personal für Suche, Anfahrt und Entsorgung – und je länger der Müll
  liegt, desto mehr kommt dazu.
- **Meldungen kommen unstrukturiert an.** Per Telefon, E-Mail oder Formular, oft ohne genauen Ort,
  ohne Foto, mehrfach für dieselbe Stelle. Das Nacharbeiten kostet Zeit.
- **Engagement verpufft.** Viele Bürgerinnen und Bürger, Vereine und Schulklassen würden
  mithelfen. Aber wer räumt was auf, und wer holt die gefüllten Säcke danach ab?
- **Gefahrstoffe** (Batterien, Chemikalien, Asbest, Spritzen) dürfen nicht von Freiwilligen
  angefasst werden, landen aber in denselben Meldewegen.

## Die Lösung: CleanSpot

Eine App für Bürgerinnen und Bürger **und** ein Werkzeug für die Verwaltung – auf dem Smartphone
(Android, im Browser als installierbare Web-App) und am Arbeitsplatz.

**Für Bürgerinnen und Bürger**

- **Melden in unter einer Minute:** Foto, der Standort wird automatisch übernommen und lässt
  sich korrigieren, Art und Menge auswählen – fertig. Ohne Konto möglich.
- **Karte** mit allen Meldungen und ihrem Status (gemeldet, bestätigt, in Arbeit, beseitigt), in
  farbenblind-sicheren Farben, die nie das einzige Merkmal sind.
- **Doppelmeldungen** werden erkannt: Liegt im Umkreis von 30 m schon eine offene Meldung, weist
  die App darauf hin.
- **Funktioniert auch ohne Netz:** Meldungen werden gespeichert und später automatisch gesendet –
  wichtig im ländlichen Raum.

**Für Freiwillige**

- Eine Meldung übernehmen („Ich räume das auf“) und ein **Nachher-Foto** hochladen. Das Foto muss
  **innerhalb von 50 m** der Fundstelle aufgenommen werden; Ort und Zeit werden gespeichert.
- Danach **„X Säcke hier abgestellt“** melden – mit Foto und Ort, z. B. an der nächsten Straße.

**Für den Landkreis**

- **Meldungen aus dem eigenen Gebiet kommen automatisch an** – über die Kreisgrenze als Fläche
  hinterlegt. Mehrere Kommunen können dieselbe Installation nutzen, jede sieht nur ihr Gebiet.
- **Abholroute für den Tag:** Alle gemeldeten Säcke als optimierte Route, mit Navigation zu jedem
  Halt und „Abgeholt“ / „Nicht vorgefunden“.
- **Gefahrstoffe** werden mit „Nicht anfassen“ gekennzeichnet, können von Freiwilligen nicht
  übernommen werden und gehen direkt an die Mitarbeitenden des Landkreises.
- **Geschätzte Menge** in kg pro Meldung (aus Größe bzw. Anzahl der Säcke) für die Statistik.

## Was es heute schon gibt – und was noch kommt

Ehrlich und vollständig:

| Fertig und getestet (Meilenstein 1)                         | In Planung (Meilenstein 2)                                                                     |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Melden mit 1–3 Fotos, Standort, Kategorie, Größe, Kommentar | Admin-Dashboard für die Verwaltung (Tabelle + Karte, Status ändern, zuweisen, interne Notizen) |
| Karte mit Filtern, Ortssuche, Gruppierung                   | Statistik (offen/beseitigt, Dauer bis zur Beseitigung, nach Kategorie), Export CSV/GeoJSON     |
| Offline-Warteschlange                                       | Aufräumaktionen für Gruppen                                                                    |
| Bestätigen, Übernehmen, Nachher-Foto (50-m-Prüfung)         | Benachrichtigungen per E-Mail und Push                                                         |
| Säcke melden, Abholroute für Mitarbeitende                  | Moderations-Warteschlange, Sperren von Nutzern                                                 |
| Gefahrstoff-Regeln                                          | Brennpunkt-Erkennung („3 Meldungen in 90 Tagen“) mit Maßnahmenvorschlag, Heatmap               |
| Fotos erst nach Prüfung öffentlich                          | Schnittstelle nach Open311-Standard                                                            |
| Daten herunterladen, Konto löschen (DSGVO)                  | Hinweis auf die Sperrmüll-Anmeldung des Landkreises                                            |
| 6 Sprachen (inkl. Arabisch, Ukrainisch, Türkisch)           | Leichte Sprache, Ehrenamts-Nachweis als PDF                                                    |
| Android-App (bereit für Google Play), Web-App               | iOS-App (vorbereitet, noch nicht veröffentlicht)                                               |

Eine **Demo** mit realistischen Beispieldaten aus dem Landkreis Harburg und Hamburg und Konten
für jede Rolle (Bürgerin, Freiwilliger, Mitarbeiter, Admin) steht bereit.

## Kosten

- **Die Software ist kostenlos** und Open Source (Lizenz AGPL-3.0). Keine Lizenzgebühren, keine
  Abhängigkeit von einem Anbieter: Der Quellcode ist offen, jede Kommune kann ihn prüfen und
  weiterentwickeln lassen.
- **Betrieb**, zwei Möglichkeiten:
  1. **In der Cloud** bei Supabase mit Servern in Frankfurt (EU). Für einen Pilotbetrieb reicht
     der kostenlose Tarif in der Regel aus; für den Regelbetrieb liegt ein bezahlter Tarif bei
     etwa 25 US-Dollar im Monat plus Nutzung (Stand der Anbieterpreise – vor einer Entscheidung
     aktuell prüfen).
  2. **Auf eigenen Servern** des Landkreises oder eines kommunalen IT-Dienstleisters (Docker),
     ganz ohne externen Anbieter für Daten und Fotos.
- **Kartendaten** von OpenStreetMap, ohne Google und ohne Gebühren; für viele Nutzer kann ein
  eigener Karten- und Suchserver betrieben werden.
- **Eigener Aufwand:** eine verantwortliche Stelle für Meldungen, Prüfung der Rechtstexte,
  Bekanntmachung bei den Bürgerinnen und Bürgern.

## Datenschutz

- **Datensparsam:** Für eine Meldung braucht es kein Konto, keinen Namen, keine E-Mail-Adresse.
- **Kein Tracking**, keine Werbung, keine Analyse-Werkzeuge, keine Cookies.
- **Fotos:** Standort- und Kameradaten (EXIF) werden schon auf dem Gerät entfernt. Fotos werden
  erst nach Prüfung öffentlich – **Gesichter und Kennzeichen werden nie veröffentlicht**: Sie
  werden bei der Prüfung abgelehnt (eine automatische Unkenntlichmachung ist vorbereitet und
  dokumentiert).
- **Rechte der Nutzer** direkt in der App: Daten herunterladen, Konto löschen (Fotos und Kommentare
  werden gelöscht; die Meldung selbst bleibt anonym erhalten, weil der Müll noch dort liegen kann).
- **Hosting in der EU** (Frankfurt) oder auf eigenen Servern.
- **Rechte auf Datenbankebene:** Wer was sehen und ändern darf, wird in der Datenbank selbst
  durchgesetzt, nicht nur in der App. Die Regeln sind automatisiert getestet, auch auf der echten
  Cloud-Umgebung.
- **Barrierefreiheit** nach WCAG 2.1 AA / BITV 2.0 als Ziel; automatische Prüfungen laufen bei
  jeder Änderung mit.
- Vorlagen für Impressum, Datenschutzerklärung und Nutzungsbedingungen liegen bei; sie **müssen
  vor dem Start von einer Juristin oder einem Juristen geprüft** und an den Landkreis als
  Verantwortlichen angepasst werden.

## So starten wir einen Pilot

1. **Kennenlernen (1 Termin):** Vorführung mit den Demo-Daten, Fragen klären: Welche Stelle
   bearbeitet Meldungen? Wer holt Säcke ab?
2. **Einrichten (ca. 1–2 Wochen):** Gebietsgrenze hinterlegen, Konten für Mitarbeitende anlegen,
   Einstellungen festlegen (z. B. ob Freiwillige aufräumen dürfen, Umkreis für die Prüfung des
   Nachher-Fotos, Link zur Sperrmüll-Anmeldung). Rechtstexte prüfen und anpassen.
3. **Pilotgebiet (3 Monate):** eine Gemeinde oder Samtgemeinde, z. B. zusammen mit einer
   Aufräumaktion, einer Schule oder einem Verein. Bekanntmachung über Presse, Website und Aushänge.
4. **Auswertung:** Anzahl der Meldungen, Zeit bis zur Beseitigung, gesammelte Menge, Rückmeldungen
   der Mitarbeitenden und der Bürgerinnen und Bürger. Danach gemeinsam entscheiden: Ausweitung auf
   den ganzen Landkreis, Betrieb in der Cloud oder auf eigenen Servern, welche Funktionen aus
   Meilenstein 2 zuerst kommen.

**Auch wenn der Landkreis nicht teilnimmt,** bleibt CleanSpot als freie, öffentliche App nutzbar:
Dann kümmert sich die Gemeinschaft um die Meldungen. Mit dem Landkreis wird daraus ein
abgestimmter Ablauf von der Meldung bis zur Abholung.

---

**Kontakt:** [[Name, E-Mail-Adresse, Telefon]] · Quellcode: [[Link zum Repository]] · Demo: [[Link]]
