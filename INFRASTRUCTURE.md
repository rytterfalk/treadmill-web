# Infrastruktur - Treadmill Web

## Översikt

```
┌─────────────────────────────────────────────────────────────────┐
│                         INTERNET                                │
│                            │                                    │
│                            ▼                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │           Pi5 - powerserver (192.168.1.72)              │   │
│  │                                                          │   │
│  │   nginx (reverse proxy)                                  │   │
│  │     └── 7min.rytterfalk.com → Pi3:4000                  │   │
│  │                                                          │   │
│  │   Bengt (watcher.py) - Telegram bot för notifieringar   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                            │                                    │
│                            ▼                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │           Pi3 - treadmill (192.168.1.235)               │   │
│  │                                                          │   │
│  │   7min-appen (Node.js) - port 4000                      │   │
│  │     └── ~/treadmill-web/7min/                           │   │
│  │     └── Databas: 7min/server/data/app.db                │   │
│  │                                                          │   │
│  │   Lena (lena.py) - AI Telegram bot                      │   │
│  │     └── ~/treadmill-web/lena.py                         │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Pi3 - treadmill (192.168.1.235)

### 7min-appen

**Starta/deploya:**
```bash
cd ~/treadmill-web
./scripts/deploy.sh --pull --restart
```

**Manuell start (dev):**
```bash
cd ~/treadmill-web/7min
npm run start -- -p 4000
```

**Service:**
```bash
sudo systemctl status 7min.service
sudo systemctl restart 7min.service
sudo journalctl -u 7min.service -n 50
```

### Lena (Telegram AI-bot)

**Starta manuellt:**
```bash
cd ~/treadmill-web
source venv/bin/activate
python lena.py
```

**Som service:**
```bash
systemctl --user status lena
systemctl --user restart lena
journalctl --user -u lena -f
```

**Installera/uppdatera:**
```bash
./lena-setup.sh
```

**Miljövariabler (.env):**
- `LENA_TELEGRAM_TOKEN` - Lenas Telegram bot token
- `OPENAI_API_KEY` - OpenAI API-nyckel
- `TARGET_CHAT_ID` - Telegram chat ID

## Pi5 - powerserver (192.168.1.72)

### Nginx

**Status:**
```bash
sudo systemctl status nginx
sudo tail -50 /var/log/nginx/error.log
```

**Konfig:**
```bash
sudo cat /etc/nginx/sites-enabled/default
sudo nginx -t  # Testa config
sudo systemctl reload nginx
```

### Bengt (watcher.py)

Kör på Pi5 och skickar notifieringar om träning.

## Vanliga problem

### 502 Bad Gateway

**Orsak:** 7min-appen kör inte på Pi3.

**Lösning:**
```bash
# På Pi3:
cd ~/treadmill-web
./scripts/deploy.sh --restart
```

### Node.js version mismatch

**Fel:** `NODE_MODULE_VERSION 115... requires NODE_MODULE_VERSION 127`

**Lösning:**
```bash
cd ~/treadmill-web/7min
npm rebuild better-sqlite3
npm run start -- -p 4000
```

### Lena svarar inte

**Kolla om hon kör:**
```bash
ps aux | grep lena
```

**Kolla loggar:**
```bash
journalctl --user -u lena -n 50
# eller kör manuellt:
cd ~/treadmill-web && source venv/bin/activate && python lena.py
```

**Telegram konflikt (två instanser):**
```bash
pkill -f lena.py
python lena.py
```

### Lena: Markdown parse error

Om Lena visar "typing" men inget svar - troligen Markdown-fel.
Koden har try/except som faller tillbaka till vanlig text.

## Databas

**Plats:** `~/treadmill-web/7min/server/data/app.db`

**Viktiga tabeller:**
- `workout_sessions` - Träningspass (session_type, duration_sec, etc)
- `progressive_program_days` - Armhävningar i `result_json`
- `circuit_sessions` - Circuit-träning

**Armhävningar finns i:**
```sql
SELECT result_json FROM progressive_program_days 
WHERE result_json IS NOT NULL LIMIT 3;
-- Struktur: {"sets":[{"actual_reps":21},{"actual_reps":21},...]}
```

## SSH

```bash
# Från Mac till Pi5:
ssh carlrytterfalk@192.168.1.72

# Från Pi5 till Pi3:
ssh carlrytterfalk@192.168.1.235
# eller:
ssh treadmill
```

## Tokens (håll hemliga!)

- `TELEGRAM_TOKEN` - Bengt (watcher.py på Pi5)
- `LENA_TELEGRAM_TOKEN` - Lena (lena.py på Pi3)
- `OPENAI_API_KEY` - OpenAI för Lena

