# 7min träningsportal

En enkel fullstack-prototyp för att köra egna 7-minuterspass på en Raspberry Pi med SQLite. Inkluderar:

- API (Express + SQLite) med konto, utrustning och sparade pass
- Passbyggare med moment, tid, vila och antal varv
- Timer med ljudsignal vid halvtid och sista 5 sekunderna
- Sparar sessioner och visar senaste pass

## Kom igång

```bash
npm install
cd client && npm install
cd ..
npm run dev
```

- API körs på port `4000`.
- Frontend (Vite/React) körs på `http://localhost:5173` och proxar `/api` till backend.

## Deploy (server)

För en robust deploy-rutin (install/migrate/build i rätt ordning) finns ett script i repo-root:

```bash
cd ~/treadmill-web
bash scripts/deploy.sh --pull --restart
```

Scriptet kör `npm install` och `npm run migrate` bara när det behövs, bygger clienten och restartar tjänsterna om du anger `--restart`.

## Backup (DB + uploads)

För att undvika att förlora historik/media finns ett backup-script som håller exakt tre snapshots:
- `pre-pull` (tas automatiskt av deploy-scriptet innan `git pull`)
- `daily` (en fil som skrivs över dagligen)
- `weekly` (en fil som skrivs över veckovis)

Manuell körning:

```bash
bash scripts/backup.sh --kind daily
bash scripts/backup.sh --kind weekly
```

För automatisk körning kan du lägga in två cron-rader (som samma användare som äger DB-filen):

```cron
0 3 * * *  cd ~/treadmill-web && bash scripts/backup.sh --kind daily >/dev/null 2>&1
0 4 * * 0  cd ~/treadmill-web && bash scripts/backup.sh --kind weekly >/dev/null 2>&1
```

Backuper sparas i `/var/backups/7min` om det är skrivbart, annars `~/7min-backups`. Du kan styra det med `BACKUP_DIR=/path`.

## Rekommendation: flytta DB + uploads utanför repo

För att undvika att `git pull`/deploy råkar skriva över SQLite-filen eller uploads bör de ligga utanför git-worktree.

1) Skapa målmappar:

```bash
sudo mkdir -p /var/lib/7min/uploads
sudo chown -R "$USER":"$USER" /var/lib/7min
```

2) Flytta nuvarande data (om den finns):

```bash
mv -n ~/treadmill-web/7min/server/data/app.db /var/lib/7min/app.db || true
mv -n ~/treadmill-web/7min/server/uploads/* /var/lib/7min/uploads/ 2>/dev/null || true
```

3) Lägg in paths i `~/treadmill-web/7min/.env` (filen ska inte committas):

```env
DB_PATH=/var/lib/7min/app.db
UPLOAD_DIR=/var/lib/7min/uploads
```

4) Koppla in `.env` i din systemd service (rekommenderat via drop-in):

```bash
sudo mkdir -p /etc/systemd/system/7min.service.d
sudo cp -f ~/treadmill-web/scripts/systemd/7min.service.d/override.conf /etc/systemd/system/7min.service.d/override.conf
sudo nano /etc/systemd/system/7min.service.d/override.conf
```

I filen: aktivera `EnvironmentFile=...` och peka på `~/treadmill-web/7min/.env`.

5) Reload + restart:

```bash
sudo systemctl daemon-reload
sudo systemctl restart 7min.service
```

Efter detta använder både servern och deploy/backup-scripts samma `DB_PATH`/`UPLOAD_DIR`.

## Miljövariabler

Skapa vid behov en `.env` i rotmappen:

```
PORT=4000
CLIENT_ORIGIN=http://localhost:5173
JWT_SECRET=byt-det-här
DB_PATH=server/data/app.db
```

## Struktur

- `server/` – Express-API, SQLite-schema och seedad klassisk 7-minuters workout.
- `client/` – Vite + React UI med top-menyn, timer, passbibliotek, utrustning och byggare.

## Nästa steg

- Lägg till riktiga rekommendationer för progressiv träning (t.ex. pull-up stegar)
- Stöd för att duplicera/uppdatera befintliga pass och dela mellan konton
- Ljudfiler istället för enkla Web Audio-ping
