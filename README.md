# ChurchTools Details Updater

Eine ChurchTools-Erweiterung, mit der Gemeindemitglieder ihre persönlichen
Daten regelmäßig prüfen und bestätigen. Ein separater Reminder-Dienst sendet
eine E-Mail, wenn die letzte Prüfung länger als das konfigurierte Intervall
(standardmäßig sechs Monate) zurückliegt.

## Funktionsumfang

- Deutsche, mobiloptimierte Oberfläche „Meine Daten prüfen“
- Bestätigung unveränderter Daten mit einem Klick
- Bearbeitung konfigurierbarer Kontaktfelder direkt über die ChurchTools API
- Admin-Oberfläche für Intervall, Felder, Personenkreis und E-Mail-Vorlage
- Liste überfälliger Personen mit CSV-Export
- Einmalig ausführbarer Node-Reminder-Job für cron, systemd timer oder
  Kubernetes CronJob
- SMTP-Versand mit Dry-Run, Wiederholungsabstand und maximaler Anzahl
  Erinnerungen

ChurchTools stellt für Erweiterungen keinen globalen Hook beim Login oder beim
Öffnen der App bereit. Deshalb führt die Erinnerung per E-Mail direkt zum
Erweiterungsmodul. Die Erweiterung selbst erscheint als normaler Menüpunkt.

## Projektstruktur

```text
extension/  Vue-3-Erweiterung mit main- und admin-Einstieg
server/     Reminder-Job für Node 22 und Docker
songstats/  Eigenständige Website (Fastify + Vue 3) für Song-Nutzungsstatistiken
shared/     Gemeinsame Typen, Defaults und Fälligkeitslogik
```

## Voraussetzungen in ChurchTools

1. Eine aktuelle ChurchTools-Version mit **Administration → Erweiterungen** und
   den REST-Endpunkten unter `/api/custommodules`.
2. Ein benutzerdefiniertes Personenfeld:
   - Bezeichnung: `Daten bestätigt am`
   - Datenbank-Key/Spalte: `dataVerifiedAt`
   - Typ: Datum
   - Sicherheitsstufe: 1
3. Benutzer dürfen ihr eigenes Profil bis zur Sicherheitsstufe der ausgewählten
   Felder bearbeiten. Andernfalls zeigt die Erweiterung die Daten nur an und
   verweist auf das Gemeindebüro.
4. Ein technischer ChurchTools-Benutzer für den Reminder-Job. Er benötigt:
   - Leserechte auf die eingeschlossenen Personen und Felder
   - Leserechte für das Custom Module und seine Kategorien
   - Schreibrechte für Datenwerte in der Kategorie `reminders`
5. Einen SMTP-Zugang.

Das Feld `dataVerifiedAt` ist die maßgebliche Bestätigung. Ist es noch leer,
verwendet die Anwendung einmalig `lastEditedDate` bzw. `meta.modifiedDate` als
Fallback, damit kürzlich bearbeitete Personen nicht sofort erinnert werden.

## Lokale Entwicklung

Benötigt wird Node.js 22 oder neuer.

```bash
npm install
cp extension/.env.example extension/.env
npm run dev:extension
```

In `extension/.env` die eigene ChurchTools-URL eintragen. Für lokale
Entwicklung können Benutzername und Passwort gesetzt werden. Diese Datei wird
nicht eingecheckt. Vite leitet `/api` standardmäßig an diese URL weiter, sodass
keine Drittanbieter-Cookies nötig sind. Für einen direkten API-Zugriff kann
stattdessen CORS unter **System-Einstellungen → Integrationen → API** für den
lokalen Ursprung freigegeben werden.

Qualitätsprüfungen und Build:

```bash
npm run check
npm run build
```

## Erweiterung bauen und installieren

```bash
npm run deploy
```

Das ZIP liegt danach unter `extension/releases/`. Es enthält ausschließlich den
gebauten `dist/`-Ordner und wird unter **Administration → Erweiterungen →
Erweiterung hochladen** installiert. Der Extension-Key lautet
`ct-details-updater`.

Nach der Installation:

1. Das Admin-Extension-Point öffnen.
2. Das vollständige Ziel des Moduls eintragen, voraussichtlich
   `https://deine-gemeinde.church.tools/ccm/ct-details-updater`.
3. Einstellungen einmal speichern. Dadurch entstehen die KV-Kategorien
   `settings` und `reminders`.
4. Den Link im Browser und in der ChurchTools-App testen. Falls die App das
   Modul nicht direkt öffnen kann, die Web-URL verwenden.

Die genaue Deep-Link-Route ist versionsabhängig und muss auf der Zielinstanz
verifiziert werden.

## Reminder-Dienst konfigurieren

```bash
cp server/.env.example server/.env
```

Pflichtwerte:

- `CHURCHTOOLS_BASE_URL`: Basis-URL ohne `/api`
- `CHURCHTOOLS_LOGIN_TOKEN`: Login-Token des technischen Benutzers
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`
- optional `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE`

Der Login-Token wird gemäß ChurchTools-Dokumentation als
`Authorization: Login <token>` übertragen. Modul- und Kategorie-IDs erkennt der
Job über den Extension-Key. Die drei `CHURCHTOOLS_*_ID`-Werte sind nur nötig,
wenn die automatische Erkennung nicht genutzt werden soll.

Zuerst immer trocken ausführen:

```bash
DRY_RUN=true npm run build
DRY_RUN=true npm run server
```

Der Dry-Run sendet keine E-Mails und schreibt keine Versandstände. Danach
`DRY_RUN=false` in `server/.env` setzen.

Der Prozess führt genau einen Lauf aus und beendet sich anschließend. Beispiel
für einen täglichen cron-Eintrag um 07:15 Uhr:

```cron
15 7 * * * cd /opt/ct-details-updater && /usr/bin/npm run server >> /var/log/ct-details-updater.log 2>&1
```

Alternativ als Container:

```bash
docker build -f server/Dockerfile -t ct-details-updater .
docker run --rm --env-file server/.env ct-details-updater
```

Die Ausgabe besteht aus strukturierten JSON-Zeilen. Bei einzelnen
Versandfehlern läuft der Job weiter und beendet sich anschließend mit Exit-Code
1.

## Song-Statistik-Website (`songstats`)

Eine separate, eigenständig gehostete Website. Nutzer:innen melden sich mit
ihrem eigenen ChurchTools-Konto an und suchen nach einem Songnamen. Angezeigt
werden Trefferzahl und alle Vorkommen (Datum, Event, Kalender, Arrangement) im
gewählten Zeitraum – standardmäßig die letzten drei Monate, wahlweise 1, 6 oder
12 Monate sowie ein frei wählbarer Zeitraum. Standardmäßig werden nur Sonntage
berücksichtigt.

Die Site besteht aus einem schlanken Fastify-Backend und einer Vue-3-SPA. Das
Backend proxyt den ChurchTools-Login, hält den Session-Cookie ausschließlich
serverseitig und baut auf Anfrage einen Song-Nutzungsindex aus den Endpunkten
`/api/events` und `/api/events/{id}/agenda` auf. Passwörter werden nie
gespeichert. Der Index wird pro Sitzung und Zeitraum 15 Minuten zwischen­
gespeichert. Zusätzlich wird der Sechs-Monats-Index für Sonntage mit einem
technischen Benutzer monatlich vorberechnet und persistent gespeichert. Dieser
gemeinsame Index enthält die Events, die der technische Benutzer sehen darf.

### Lokale Entwicklung

```bash
cp songstats/.env.example songstats/.env
npm run dev:songstats
```

In `songstats/.env` mindestens `CHURCHTOOLS_BASE_URL` (ohne `/api`) und ein
mindestens 32 Zeichen langes `SESSION_SECRET` setzen. In HTTP-Dev-Umgebungen
zusätzlich `COOKIE_SECURE=false`. Der Dev-Server startet das Fastify-Backend
sowie Vite parallel; Vite leitet `/api` und `/auth` an das Backend weiter.
Für den monatlichen Cache außerdem `CHURCHTOOLS_LOGIN_TOKEN` setzen.

### Produktion / Container

```bash
npm run build -w @ct-details-updater/shared
npm run build -w @ct-details-updater/songstats
CHURCHTOOLS_BASE_URL=https://deine-gemeinde.church.tools \
SESSION_SECRET=... \
npm run songstats
```

Das fertige Image wird über GitHub Container Registry veröffentlicht:

```text
ghcr.io/daniel-kitz/ct-details-updater-songstats:latest
```

Der Container serviert Backend und SPA auf demselben Port (Default `5175`) und
speichert den Monatscache in einem Docker-Volume. Eine vollständige
Portainer-Anleitung und ein fertiger Stack stehen in
[`songstats/README.md`](songstats/README.md) und
[`songstats/compose.yaml`](songstats/compose.yaml).

## Datenschutz und Betrieb

- Personendaten werden nicht in einer externen Datenbank dupliziert.
- In der Custom-Module-Kategorie `reminders` liegen nur Person-ID,
  Versandzeitpunkt, Zähler und der zum Versand bekannte Bestätigungszeitpunkt.
- SMTP- und ChurchTools-Zugangsdaten gehören ausschließlich in Secret Stores
  oder `.env`-Dateien außerhalb der Versionsverwaltung.
- Das native ChurchTools-Einwilligungsbanner wird nicht verändert.
