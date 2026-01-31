#!/usr/bin/env bash
set -e
DIR="$HOME/treadmill-bot"
ENV_FILE="$DIR/.env"
VENV="$DIR/venv"
mkdir -p "$DIR"
cd "$DIR"

# 1) Install system deps
sudo apt update
sudo apt install -y python3 python3-venv python3-pip sqlite3

# 2) Create venv and install python libs
python3 -m venv "$VENV"
source "$VENV/bin/activate"
pip install --upgrade pip
pip install python-dotenv python-telegram-bot==20.6 aiosqlite

# 3) Write example .env if not exists
if [ ! -f "$ENV_FILE" ]; then
cat > "$ENV_FILE" <<EOF
# Sätt din token här:
TELEGRAM_TOKEN=

# Sätt ditt chat id här (se instruktion nedan)
TARGET_CHAT_ID=

# Path to sqlite DB (relativ to ~/treadmill-web eller absolut)
TREADMILL_DB=$HOME/treadmill-web/treadmill.db
EOF
echo "Wrote example .env to $ENV_FILE — fyll i TELEGRAM_TOKEN & TARGET_CHAT_ID innan test."
fi

# 4) Create bot.py

cat > bot.py <<'PY'
#!/usr/bin/env python3
import os, asyncio, aiosqlite, logging
from datetime import datetime
from dotenv import load_dotenv
from telegram import Update
from telegram.ext import ApplicationBuilder, ContextTypes, CommandHandler, MessageHandler, filters

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
TOKEN = os.getenv("TELEGRAM_TOKEN")
DBPATH = os.getenv("TREADMILL_DB", os.path.expanduser("~/treadmill-web/treadmill.db"))
MEMORY_DIR = os.path.expanduser("~/treadmill-bot/memory")
os.makedirs(MEMORY_DIR, exist_ok=True)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("treadmill-bot")

async def log_response(user, text):
    date = datetime.utcnow().date().isoformat()
    path = os.path.join(MEMORY_DIR, f"{date}.md")
    ts = datetime.utcnow().isoformat()
    entry = f"- {ts} UTC — {user}: {text}\n"
    with open(path, "a", encoding="utf-8") as f:
        f.write(entry)
    logger.info("Logged response to %s", path)

async def last_training_summary():
    # Anpassa SQL efter din schema — här ett enkelt exempel
    if not os.path.exists(DBPATH):
        return "Ingen träningsdatabas hittades."
    try:
        async with aiosqlite.connect(DBPATH) as db:
            # Ändra tabell/kolumn-namn efter din DB
            # Försök hitta senaste passets datum och typ
            async with db.execute("SELECT datetime, duration, distance FROM sessions ORDER BY datetime DESC LIMIT 1") as cur:
                row = await cur.fetchone()
                if not row:
                    return "Inga pass registrerade i databasen."
                dt, duration, distance = row
                return f"Sista pass: {dt}, duration={duration}, distance={distance}"
    except Exception as e:
        logger.exception("DB read error")
        return f"Fel vid läsning av DB: {e}"

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("Hej! Jag loggar dina träningssvar här. Svara på mina påminnelser så sparar jag dem.")

async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user.username or update.effective_user.first_name or str(update.effective_user.id)
    text = update.message.text or ""
    await log_response(user, text)
    # Valfritt: om användaren skriver "status" svara med DB-summary
    if text.lower().strip() in ("status", "db", "senaste"):
        summary = await last_training_summary()
        await update.message.reply_text(summary)
    else:
        await update.message.reply_text("Tack — jag har loggat svaret.")

def main():
    app = ApplicationBuilder().token(TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(MessageHandler(filters.TEXT & (~filters.COMMAND), handle_message))
    logger.info("Starting polling...")
    app.run_polling()

if __name__ == "__main__":
    main()
PY

# 5) Create send_prompt.py

cat > send_prompt.py <<'PY'
#!/usr/bin/env python3
import os, random, asyncio
from dotenv import load_dotenv
from telegram import Bot
from datetime import datetime

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
TOKEN = os.getenv("TELEGRAM_TOKEN")
CHAT = os.getenv("TARGET_CHAT_ID")

if not TOKEN or not CHAT:
    print("Missing TELEGRAM_TOKEN or TARGET_CHAT_ID in .env")
    raise SystemExit(1)

bot = Bot(token=TOKEN)
prompts = [
    "Tränade du idag? (ja/nej)",
    "Hur gick träningen idag? En kort rad räcker 🙂",
    "Småcheck: blev det något träningspass idag?",
    "Dagsrapport: rörde du på dig i dag?",
    "Kort fråga: tränade du något idag eller blev det vila?"
]

# Variera lite beroende på dag/time
now = datetime.now()
msg = random.choice(prompts)

async def send():
    await bot.send_message(chat_id=CHAT, text=msg)
    print("Sent:", msg)

asyncio.run(send())
PY

chmod +x bot.py send_prompt.py

# 6) Create systemd unit
UNIT_PATH="$HOME/.config/systemd/user/treadmill-bot.service"
mkdir -p "$(dirname "$UNIT_PATH")"
cat > "$UNIT_PATH" <<'UNIT'
[Unit]
Description=Treadmill Telegram poller (user service)
After=network.target

[Service]
Type=simple
WorkingDirectory=%h/treadmill-bot
ExecStart=%h/treadmill-bot/venv/bin/python %h/treadmill-bot/bot.py
Restart=on-failure
EnvironmentFile=%h/treadmill-bot/.env

[Install]
WantedBy=default.target
UNIT

# 7) Enable user systemd service
systemctl --user daemon-reload
systemctl --user enable --now treadmill-bot.service

# 8) Install crontab entries (two times daily at 11:00 and 20:00)
CRON="0 11 * * * $VENV/bin/python $DIR/send_prompt.py >/dev/null 2>&1\n0 20 * * * $VENV/bin/python $DIR/send_prompt.py >/dev/null 2>&1\n"
( crontab -l 2>/dev/null || true; echo -e "$CRON" ) | crontab -

echo "Setup klar. Fyll i .env (TELEGRAM_TOKEN & TARGET_CHAT_ID), starta om systemd user-tjänsten om ändringar."
echo "Kör 'journalctl --user -u treadmill-bot.service -f' för logs."