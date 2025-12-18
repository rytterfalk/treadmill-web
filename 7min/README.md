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
