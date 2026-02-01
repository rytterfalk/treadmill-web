#!/usr/bin/env python3
"""
Telegram bot "Bengt" för träningsloggning.
Stödjer:
- Löpkommandon: "löpning 5.2km 28:30 45m 152bpm"
- Status: "status", "db", "senaste"
"""
import os
import re
import json
import uuid
import asyncio
import aiosqlite
import logging
from datetime import datetime, timedelta
from dotenv import load_dotenv
from telegram import Update
from telegram.ext import ApplicationBuilder, ContextTypes, CommandHandler, MessageHandler, filters

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
TOKEN = os.getenv("TELEGRAM_TOKEN")
DBPATH = os.getenv("TREADMILL_DB", os.path.expanduser("~/treadmill-web/7min/server/data/app.db"))
MEMORY_DIR = os.path.expanduser("~/treadmill-bot/memory")
os.makedirs(MEMORY_DIR, exist_ok=True)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("treadmill-bot")

# Regex patterns för löpkommando
RUN_TRIGGERS = re.compile(r'^(löpning|löp|spring|run|running)\b', re.IGNORECASE)
DISTANCE_PATTERN = re.compile(r'(\d+[.,]\d+|\d+)\s*k?m?\b')
TIME_PATTERN = re.compile(r'(\d+):(\d{2})(?::(\d{2}))?')
ELEVATION_PATTERN = re.compile(r'(\d+)\s*m(?!in|:)')  # m but not "min" or time
HR_PATTERN = re.compile(r'(\d+)\s*(?:bpm|puls|hr)\b', re.IGNORECASE)


def parse_run_command(text):
    """Parse löpkommando. Returnerar dict med värden eller None om ej löpkommando."""
    if not RUN_TRIGGERS.match(text.strip()):
        return None
    
    result = {"distance_km": None, "duration_sec": None, "elevation_m": None, "avg_hr": None}
    
    # Ta bort triggern från texten för enklare parsing
    clean = RUN_TRIGGERS.sub('', text).strip()
    
    # Distans (första talet med eventuellt decimal)
    dist_match = DISTANCE_PATTERN.search(clean)
    if dist_match:
        dist_str = dist_match.group(1).replace(',', '.')
        result["distance_km"] = float(dist_str)
    
    # Tid (MM:SS eller HH:MM:SS)
    time_match = TIME_PATTERN.search(clean)
    if time_match:
        if time_match.group(3):  # HH:MM:SS
            hours = int(time_match.group(1))
            mins = int(time_match.group(2))
            secs = int(time_match.group(3))
        else:  # MM:SS
            hours = 0
            mins = int(time_match.group(1))
            secs = int(time_match.group(2))
        result["duration_sec"] = hours * 3600 + mins * 60 + secs
    
    # Höjdmeter (siffra följt av m, men inte "min")
    elev_match = ELEVATION_PATTERN.search(clean)
    if elev_match:
        result["elevation_m"] = int(elev_match.group(1))
    
    # Puls
    hr_match = HR_PATTERN.search(clean)
    if hr_match:
        result["avg_hr"] = int(hr_match.group(1))
    
    # Kräv minst distans och tid
    if result["distance_km"] and result["duration_sec"]:
        return result
    return None


async def save_run_to_db(data):
    """Spara löppass till workout_sessions. Returnerar sammanfattning."""
    run_id = str(uuid.uuid4())
    now = datetime.now()
    started_at = (now - timedelta(seconds=data["duration_sec"])).isoformat()
    ended_at = now.isoformat()
    
    # Beräkna pace
    pace_sec_per_km = data["duration_sec"] / data["distance_km"]
    pace_min = int(pace_sec_per_km // 60)
    pace_sec = int(pace_sec_per_km % 60)
    pace_str = f"{pace_min}:{pace_sec:02d}"
    
    run_json = {
        "distance_km": data["distance_km"],
        "avg_pace_min_per_km": pace_str,
    }
    if data["elevation_m"]:
        run_json["elevation_m"] = data["elevation_m"]
    if data["avg_hr"]:
        run_json["avg_hr_bpm"] = data["avg_hr"]
    
    async with aiosqlite.connect(DBPATH) as db:
        await db.execute(
            """INSERT INTO workout_sessions 
               (id, user_id, session_type, started_at, ended_at, duration_sec, 
                source, treadmill_state_json, notes)
               VALUES (?, 1, 'run', ?, ?, ?, 'manual', ?, ?)""",
            (run_id, started_at, ended_at, data["duration_sec"],
             json.dumps(run_json), f"Löpning {data['distance_km']}km")
        )
        await db.commit()
    
    # Bygg bekräftelsemeddelande
    mins = data["duration_sec"] // 60
    secs = data["duration_sec"] % 60
    msg = f"🏃 Löppass sparat!\n"
    msg += f"📏 Distans: {data['distance_km']} km\n"
    msg += f"⏱️ Tid: {mins}:{secs:02d}\n"
    msg += f"⚡ Tempo: {pace_str} min/km\n"
    if data["elevation_m"]:
        msg += f"⛰️ Höjdmeter: {data['elevation_m']} m\n"
    if data["avg_hr"]:
        msg += f"❤️ Puls: {data['avg_hr']} bpm\n"
    return msg


async def log_response(user, text):
    date = datetime.utcnow().date().isoformat()
    path = os.path.join(MEMORY_DIR, f"{date}.md")
    ts = datetime.utcnow().isoformat()
    entry = f"- {ts} UTC — {user}: {text}\n"
    with open(path, "a", encoding="utf-8") as f:
        f.write(entry)


async def last_training_summary():
    if not os.path.exists(DBPATH):
        return "Ingen träningsdatabas hittades."
    try:
        async with aiosqlite.connect(DBPATH) as db:
            async with db.execute(
                """SELECT session_type, started_at, duration_sec, treadmill_state_json 
                   FROM workout_sessions ORDER BY COALESCE(started_at, created_at) DESC LIMIT 1"""
            ) as cur:
                row = await cur.fetchone()
                if not row:
                    return "Inga pass registrerade."
                stype, started, dur, tjson = row
                return f"Senaste: {stype} @ {started}, {(dur or 0)//60} min"
    except Exception as e:
        logger.exception("DB error")
        return f"Fel: {e}"


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "Hej! Jag är Bengt 🤖\n\n"
        "Logga löppass: löpning 5.2km 28:30 45m 152bpm\n"
        "Se status: skriv 'status'"
    )


async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user.username or update.effective_user.first_name or str(update.effective_user.id)
    text = update.message.text or ""
    await log_response(user, text)
    
    # Kolla om det är ett löpkommando
    run_data = parse_run_command(text)
    if run_data:
        try:
            msg = await save_run_to_db(run_data)
            await update.message.reply_text(msg)
        except Exception as e:
            logger.exception("Failed to save run")
            await update.message.reply_text(f"Kunde inte spara: {e}")
        return
    
    # Status-kommandon
    if text.lower().strip() in ("status", "db", "senaste"):
        summary = await last_training_summary()
        await update.message.reply_text(summary)
    else:
        await update.message.reply_text("Tack — loggat! 📝")


def main():
    app = ApplicationBuilder().token(TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(MessageHandler(filters.TEXT & (~filters.COMMAND), handle_message))
    logger.info("Starting Bengt...")
    app.run_polling()


if __name__ == "__main__":
    main()

