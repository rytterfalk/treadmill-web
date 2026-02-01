#!/usr/bin/env python3
"""
Lena - Bengts lillasyster 🦞
En smart AI-assistent för Pi3 med bildstöd och function calling.
"""
import os
import json
import asyncio
import logging
import subprocess
import uuid
import base64
import aiosqlite
import httpx
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

SYSTEM_PROMPT = """Du är Lena, en hjälpsam AI-assistent som bor på en Raspberry Pi 3.
Du är lillasyster till Bengt som bor på Pi5 och håller koll på träning.

Du har tillgång till verktyg (functions) som du kan använda:
- log_run: Logga ett löppass till databasen
- show_workouts: Visa senaste träningspassen
- run_shell_command: Köra shell-kommandon på Pi3

När användaren skickar en bild på ett träningspass, analysera bilden och använd log_run för att spara det.
Fråga om bekräftelse innan du loggar om du är osäker på värdena.

Var koncis och trevlig. Svara på svenska om användaren skriver svenska."""

# OpenAI function definitions
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "log_run",
            "description": "Logga ett löppass till träningsdatabasen",
            "parameters": {
                "type": "object",
                "properties": {
                    "distance_km": {
                        "type": "number",
                        "description": "Distans i kilometer, t.ex. 5.2"
                    },
                    "duration_minutes": {
                        "type": "number",
                        "description": "Total tid i minuter, t.ex. 27.5 för 27:30"
                    },
                    "notes": {
                        "type": "string",
                        "description": "Valfria anteckningar om passet"
                    }
                },
                "required": ["distance_km", "duration_minutes"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "show_workouts",
            "description": "Visa senaste träningspassen från databasen",
            "parameters": {
                "type": "object",
                "properties": {
                    "limit": {
                        "type": "integer",
                        "description": "Antal pass att visa (default 5)"
                    }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "run_shell_command",
            "description": "Kör ett shell-kommando på Raspberry Pi 3",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "Kommandot att köra, t.ex. 'ls -la' eller 'uptime'"
                    }
                },
                "required": ["command"]
            }
        }
    }
]


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


async def log_run(distance_km: float, duration_minutes: float, notes: str = "") -> str:
    """Logga ett löppass till workout_sessions."""
    run_id = str(uuid.uuid4())
    duration_sec = int(duration_minutes * 60)
    now = datetime.now()
    started_at = (now - timedelta(seconds=duration_sec)).isoformat()
    ended_at = now.isoformat()

    # Beräkna tempo
    pace_sec = duration_sec / distance_km
    pace_min = int(pace_sec // 60)
    pace_s = int(pace_sec % 60)
    pace_str = f"{pace_min}:{pace_s:02d}"

    run_json = {
        "distance_km": distance_km,
        "pace_min_per_km": pace_str
    }

    async with aiosqlite.connect(DBPATH) as db:
        await db.execute(
            """INSERT INTO workout_sessions
               (id, user_id, session_type, started_at, ended_at, duration_sec,
                source, treadmill_state_json, notes)
               VALUES (?, 1, 'run', ?, ?, ?, 'ai', ?, ?)""",
            (run_id, started_at, ended_at, duration_sec,
             json.dumps(run_json), notes or f"Löpning {distance_km}km")
        )
        await db.commit()

    mins = duration_sec // 60
    secs = duration_sec % 60
    return (f"🏃 Löppass sparat!\n"
            f"📏 Distans: {distance_km} km\n"
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


async def execute_function(name: str, args: dict) -> str:
    """Kör en function och returnera resultatet."""
    if name == "log_run":
        return await log_run(
            distance_km=args.get("distance_km"),
            duration_minutes=args.get("duration_minutes"),
            notes=args.get("notes", "")
        )
    elif name == "show_workouts":
        return await get_recent_workouts(args.get("limit", 5))
    elif name == "run_shell_command":
        cmd = args.get("command", "")
        return f"🔧 Kör: {cmd}\n\n```\n{run_command(cmd)}\n```"
    else:
        return f"❌ Okänd funktion: {name}"


async def chat_with_tools(messages: list) -> str:
    """Skicka till OpenAI med function calling."""
    try:
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            tools=TOOLS,
            tool_choice="auto",
            max_tokens=1000,
            temperature=0.7,
        )

        msg = response.choices[0].message

        # Om AI:n vill anropa en funktion
        if msg.tool_calls:
            results = []
            for tool_call in msg.tool_calls:
                func_name = tool_call.function.name
                func_args = json.loads(tool_call.function.arguments)
                logger.info(f"Calling function: {func_name} with {func_args}")
                result = await execute_function(func_name, func_args)
                results.append(result)

            # Returnera funktionsresultaten
            return "\n\n".join(results)

        # Annars returnera textsvaret
        return msg.content or ""

    except Exception as e:
        logger.exception("OpenAI error")
        return f"❌ Kunde inte nå OpenAI: {e}"


async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Hantera textmeddelanden."""
    chat_id = str(update.effective_chat.id)
    if ALLOWED_CHAT_ID and chat_id != ALLOWED_CHAT_ID:
        await update.message.reply_text("🚫 Du har inte tillgång till Lena.")
        return

    user_text = update.message.text or ""

    # Ladda minne
    memory = load_memory()
    recent = memory.get("conversations", [])[-10:]  # Färre för att spara tokens

    # Bygg meddelanden
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages.extend(recent)
    messages.append({"role": "user", "content": user_text})

    await update.message.chat.send_action("typing")
    response = await chat_with_tools(messages)

    # Spara i minnet
    recent.append({"role": "user", "content": user_text})
    recent.append({"role": "assistant", "content": response})
    memory["conversations"] = recent[-10:]
    memory["last_interaction"] = datetime.now().isoformat()
    save_memory(memory)

    await update.message.reply_text(response, parse_mode="Markdown")


async def handle_photo(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Hantera bilder - t.ex. skärmdumpar av träningspass."""
    chat_id = str(update.effective_chat.id)
    if ALLOWED_CHAT_ID and chat_id != ALLOWED_CHAT_ID:
        await update.message.reply_text("🚫 Du har inte tillgång till Lena.")
        return

    await update.message.chat.send_action("typing")

    # Hämta bilden
    photo = update.message.photo[-1]  # Största versionen
    file = await context.bot.get_file(photo.file_id)

    # Ladda ner bilden
    async with httpx.AsyncClient() as http:
        img_response = await http.get(file.file_path)
        img_data = base64.b64encode(img_response.content).decode("utf-8")

    # Skapa meddelande med bild
    caption = update.message.caption or "Vad ser du på bilden?"

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": caption},
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{img_data}"}}
            ]
        }
    ]

    response = await chat_with_tools(messages)
    await update.message.reply_text(response, parse_mode="Markdown")


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "Hej! Jag är Lena 🦞\n\n"
        "Jag är Bengts lillasyster och bor på Pi3.\n\n"
        "Jag kan:\n"
        "• Logga träningspass (skicka en bild eller beskriv passet)\n"
        "• Visa träningshistorik\n"
        "• Köra shell-kommandon\n"
        "• Svara på frågor\n\n"
        "Skicka en skärmdump från din träningsapp så loggar jag den! 📱"
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
    app.add_handler(MessageHandler(filters.PHOTO, handle_photo))

    logger.info("🦞 Lena startar med bildstöd och function calling...")
    app.run_polling()


if __name__ == "__main__":
    main()

