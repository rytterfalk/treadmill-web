#!/usr/bin/env python3
"""
Lena - Bengts lillasyster 🦞
En lättvikts AI-assistent för Pi3 som använder OpenAI API.
Med databasåtkomst för träningsloggning!
"""
import os
import json
import asyncio
import logging
import subprocess
import uuid
import re
import aiosqlite
from datetime import datetime, timedelta
from dotenv import load_dotenv
from telegram import Update
from telegram.ext import ApplicationBuilder, ContextTypes, CommandHandler, MessageHandler, filters
from openai import AsyncOpenAI

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
TOKEN = os.getenv("LENA_TELEGRAM_TOKEN")
OPENAI_KEY = os.getenv("OPENAI_API_KEY")
ALLOWED_CHAT_ID = os.getenv("TARGET_CHAT_ID")
DBPATH = os.getenv("TREADMILL_DB", os.path.expanduser("~/treadmill-web/7min/server/data/app.db"))
MEMORY_FILE = os.path.expanduser("~/.lena-memory.json")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("lena")

client = AsyncOpenAI(api_key=OPENAI_KEY)

# Regex för att parsa löpkommandon
RUN_PATTERN = re.compile(r'(?:löpning|löp|spring|run|running)\s+(\d+[.,]?\d*)\s*k?m?\s+(\d+):(\d{2})(?::(\d{2}))?', re.IGNORECASE)
DISTANCE_PATTERN = re.compile(r'(\d+[.,]\d+|\d+)\s*k?m?\b')
TIME_PATTERN = re.compile(r'(\d+):(\d{2})(?::(\d{2}))?')

SYSTEM_PROMPT = """Du är Lena, en hjälpsam AI-assistent som bor på en Raspberry Pi 3.
Du är lillasyster till Bengt som bor på Pi5 och håller koll på träning.

Du kan:
- Svara på frågor och hjälpa till med uppgifter
- Köra shell-kommandon på Pi3 (skriv "kör <kommando>")
- Hjälpa med kod och scripts
- Logga löppass till databasen (skriv t.ex. "löpning 5km 25:00")
- Visa träningshistorik (skriv "visa pass" eller "senaste träning")

Var koncis och trevlig. Svara på svenska om användaren skriver svenska.
Om du kör kommandon, visa alltid vad du kör och resultatet."""


def load_memory():
    try:
        with open(MEMORY_FILE, "r") as f:
            return json.load(f)
    except Exception:
        return {"conversations": []}


def save_memory(mem):
    with open(MEMORY_FILE, "w") as f:
        json.dump(mem, f, indent=2)


def run_command(cmd: str, timeout: int = 30) -> str:
    """Kör ett shell-kommando och returnera output."""
    try:
        result = subprocess.run(
            cmd, shell=True, capture_output=True, text=True, timeout=timeout
        )
        output = result.stdout + result.stderr
        return output.strip()[:2000] or "(ingen output)"
    except subprocess.TimeoutExpired:
        return "⏱️ Kommandot tog för lång tid (timeout)"
    except Exception as e:
        return f"❌ Fel: {e}"


def parse_run_command(text: str):
    """Parsa löpkommando och returnera data eller None."""
    match = RUN_PATTERN.search(text)
    if not match:
        return None

    distance = float(match.group(1).replace(",", "."))
    minutes = int(match.group(2))
    seconds = int(match.group(3))
    hours = int(match.group(4)) if match.group(4) else 0

    duration_sec = hours * 3600 + minutes * 60 + seconds
    return {"distance_km": distance, "duration_sec": duration_sec}


async def save_run_to_db(data: dict) -> str:
    """Spara löppass till workout_sessions."""
    run_id = str(uuid.uuid4())
    now = datetime.now()
    started_at = (now - timedelta(seconds=data["duration_sec"])).isoformat()
    ended_at = now.isoformat()

    # Beräkna tempo
    pace_sec = data["duration_sec"] / data["distance_km"]
    pace_min = int(pace_sec // 60)
    pace_s = int(pace_sec % 60)
    pace_str = f"{pace_min}:{pace_s:02d}"

    run_json = {
        "distance_km": data["distance_km"],
        "pace_min_per_km": pace_str
    }

    async with aiosqlite.connect(DBPATH) as db:
        await db.execute(
            """INSERT INTO workout_sessions
               (id, user_id, session_type, started_at, ended_at, duration_sec,
                source, treadmill_state_json, notes)
               VALUES (?, 1, 'run', ?, ?, ?, 'ai', ?, ?)""",
            (run_id, started_at, ended_at, data["duration_sec"],
             json.dumps(run_json), f"Löpning {data['distance_km']}km")
        )
        await db.commit()

    mins = data["duration_sec"] // 60
    secs = data["duration_sec"] % 60
    return (f"🏃 Löppass sparat!\n"
            f"📏 Distans: {data['distance_km']} km\n"
            f"⏱️ Tid: {mins}:{secs:02d}\n"
            f"⚡ Tempo: {pace_str} min/km")


async def get_recent_workouts(limit: int = 5) -> str:
    """Hämta senaste träningspassen."""
    if not os.path.exists(DBPATH):
        return "❌ Ingen träningsdatabas hittades."

    try:
        async with aiosqlite.connect(DBPATH) as db:
            async with db.execute(
                """SELECT session_type, started_at, duration_sec, treadmill_state_json, notes
                   FROM workout_sessions
                   ORDER BY COALESCE(started_at, created_at) DESC
                   LIMIT ?""", (limit,)
            ) as cur:
                rows = await cur.fetchall()
                if not rows:
                    return "Inga pass registrerade ännu."

                result = "📋 **Senaste pass:**\n\n"
                for row in rows:
                    stype, started, dur, tjson, notes = row
                    date_str = started[:10] if started else "?"
                    dur_min = (dur or 0) // 60

                    # Försök parsa extra info
                    extra = ""
                    if tjson:
                        try:
                            data = json.loads(tjson)
                            if "distance_km" in data:
                                extra = f" - {data['distance_km']}km"
                        except:
                            pass

                    result += f"• {date_str}: {stype} ({dur_min} min){extra}\n"

                return result
    except Exception as e:
        logger.exception("DB error")
        return f"❌ Fel vid läsning: {e}"


async def chat_with_ai(messages: list) -> str:
    """Skicka meddelanden till OpenAI och få svar."""
    try:
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            max_tokens=1000,
            temperature=0.7,
        )
        return response.choices[0].message.content
    except Exception as e:
        logger.exception("OpenAI error")
        return f"❌ Kunde inte nå OpenAI: {e}"


async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    # Säkerhetskoll - bara tillåt rätt chat
    chat_id = str(update.effective_chat.id)
    if ALLOWED_CHAT_ID and chat_id != ALLOWED_CHAT_ID:
        await update.message.reply_text("🚫 Du har inte tillgång till Lena.")
        return

    user_text = update.message.text or ""
    user_name = update.effective_user.first_name or "du"
    lower_text = user_text.lower()

    # 1. Kolla om det är ett löpkommando
    run_data = parse_run_command(user_text)
    if run_data:
        try:
            await update.message.chat.send_action("typing")
            msg = await save_run_to_db(run_data)
            await update.message.reply_text(msg)
        except Exception as e:
            logger.exception("Failed to save run")
            await update.message.reply_text(f"❌ Kunde inte spara: {e}")
        return

    # 2. Visa träningshistorik
    if any(x in lower_text for x in ["visa pass", "senaste pass", "senaste träning", "träningshistorik", "mina pass"]):
        await update.message.chat.send_action("typing")
        result = await get_recent_workouts(5)
        await update.message.reply_text(result, parse_mode="Markdown")
        return

    # 3. Kör shell-kommando
    if lower_text.startswith("kör ") or lower_text.startswith("run "):
        cmd = user_text[4:].strip()
        await update.message.reply_text(f"🔧 Kör: `{cmd}`", parse_mode="Markdown")
        output = run_command(cmd)
        await update.message.reply_text(f"```\n{output}\n```", parse_mode="Markdown")
        return

    # 4. Skicka till AI för allt annat
    memory = load_memory()
    recent = memory.get("conversations", [])[-20:]

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages.extend(recent)
    messages.append({"role": "user", "content": user_text})

    await update.message.chat.send_action("typing")
    response = await chat_with_ai(messages)

    # Spara i minnet
    recent.append({"role": "user", "content": user_text})
    recent.append({"role": "assistant", "content": response})
    memory["conversations"] = recent[-20:]
    memory["last_interaction"] = datetime.now().isoformat()
    save_memory(memory)

    await update.message.reply_text(response)


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "Hej! Jag är Lena 🦞\n\n"
        "Jag är Bengts lillasyster och bor på Pi3.\n"
        "Ställ frågor eller be mig köra kommandon!\n\n"
        "Tips: Skriv 'kör <kommando>' för att köra shell-kommandon."
    )


async def clear_memory(update: Update, context: ContextTypes.DEFAULT_TYPE):
    save_memory({"conversations": []})
    await update.message.reply_text("🧹 Minnet rensat!")


def main():
    if not TOKEN:
        print("❌ LENA_TELEGRAM_TOKEN saknas i .env")
        return
    if not OPENAI_KEY:
        print("❌ OPENAI_API_KEY saknas i .env")
        return
    
    app = ApplicationBuilder().token(TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("clear", clear_memory))
    app.add_handler(MessageHandler(filters.TEXT & (~filters.COMMAND), handle_message))
    
    logger.info("🦞 Lena startar...")
    app.run_polling()


if __name__ == "__main__":
    main()

