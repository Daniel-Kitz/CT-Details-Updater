# ChurchTools SongStats

Eigenständig betreibbare Web-App für die Suche nach verwendeten Liedern in
ChurchTools-Event-Agenden.

## Schnellstart mit Portainer

Das fertige Multi-Arch-Image wird auf GitHub Container Registry veröffentlicht:

```text
ghcr.io/daniel-kitz/ct-details-updater-songstats:latest
```

Paket-Seite:
[GitHub Container Registry – SongStats](https://github.com/Daniel-Kitz/CT-Details-Updater/pkgs/container/ct-details-updater-songstats)

1. In Portainer **Stacks → Add stack → Web editor** öffnen.
2. Den Inhalt von [`compose.yaml`](compose.yaml) einfügen.
3. Unter **Environment variables** diese drei Werte anlegen:
   - `CHURCHTOOLS_BASE_URL`: z. B. `https://deine-gemeinde.church.tools`
   - `CHURCHTOOLS_LOGIN_TOKEN`: Login-Token eines technischen ChurchTools-Benutzers
   - `SESSION_SECRET`: Ausgabe von `openssl rand -hex 32`
4. Hinter einem HTTPS-Reverse-Proxy `COOKIE_SECURE=true` verwenden. Für einen
   direkten HTTP-Test über Port 5175 auf `false` setzen.
5. Stack deployen und `http://SERVER:5175` öffnen.

Portainer legt das Volume `songstats-data` automatisch an. Es enthält nur den
vorberechneten Song-Index, keine Passwörter oder Session-Cookies.

Nach dem ersten GitHub-Publish muss das GHCR-Paket einmal in GitHub unter
**Packages → Package settings → Change visibility → Public** öffentlich
geschaltet werden, damit Portainer das Image ohne Registry-Zugang laden kann.

## Monatlicher Cache

SongStats erstellt einen vollständigen Index für:

- die letzten sechs Monate
- ausschließlich Sonntage
- alle Songs aus den lesbaren Event-Agenden

Der Index wird beim ersten Start erstellt, persistent unter
`/data/songstats-cache.json` gespeichert und jeweils zum Monatswechsel
automatisch erneuert. Der interne Scheduler prüft stündlich, ob ein neuer Monat
begonnen hat. Dadurch ist kein separater cron-Container notwendig.

Sechs-Monats-Suchen mit dem Filter „Nur Sonntage“ werden aus diesem Index
beantwortet. Andere Zeiträume oder Wochentage werden weiterhin live geladen und
kurz im jeweiligen Benutzer-Login zwischengespeichert.

Der technische Benutzer hinter `CHURCHTOOLS_LOGIN_TOKEN` benötigt Leserechte
auf die auszuwertenden Events und Agenden. Der gemeinsame Cache enthält genau
die Daten, die dieser Benutzer lesen darf. Zugriff auf SongStats selbst erhalten
weiterhin nur Personen, die sich mit einem gültigen ChurchTools-Login anmelden.

## Aktualisieren

Bei jedem Push auf `main`, der SongStats oder den gemeinsamen Code ändert,
publiziert GitHub Actions ein neues `latest`-Image für AMD64 und ARM64. In
Portainer genügt anschließend **Pull and redeploy**. Optional kann ein
Registry-Webhook oder Watchtower Updates automatisieren.

## Lokal als Container testen

Vom Repository-Stamm aus:

```bash
docker build -f songstats/Dockerfile -t churchtools-songstats .
docker run --rm \
  -p 5175:5175 \
  -v songstats-data:/data \
  --env-file songstats/.env \
  -e MONTHLY_CACHE_FILE=/data/songstats-cache.json \
  churchtools-songstats
```

Healthcheck:

```text
GET /healthz
```
