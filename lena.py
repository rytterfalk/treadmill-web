#!/usr/bin/env python3
"""
Lena - Bengts lillasyster 🦞
En lättvikts AI-assistent för Pi3 som använder OpenAI API.
"""
import os
import json
import asyncio
import logging
import subprocess
from datetime import datetime
from dotenv import load_dotenv
from telegram import Update
from telegram.ext import ApplicationBuilder, ContextTypes, CommandHandler, MessageHandler, filters
from openai import AsyncOpenAI

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
TOKEN = os.getenv("LENA_TELEGRAM_TOKEN")
OPENAI_KEY = os.getenv("OPENAI_API_KEY")
ALLOWED_CHAT_ID = os.getenv("TARGET_CHAT_ID")  # Samma som Bengt
MEMORY_FILE = os.path.expanduser("~/.lena-memory.json")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("lena")

client = AsyncOpenAI(api_key=OPENAI_KEY)

SYSTEM_PROMPT = """Du är Lena, en hjälpsam AI-assistent som bor på en Raspberry Pi 3.
Du är lillasyster till Bengt som bor på Pi5 och håller koll på träning.

Du kan:
- Svara på frågor och hjälpa till med uppgifter
- Köra shell-kommandon på Pi3 (om användaren ber dig)
- Hjälpa med kod och scripts

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
    
    # Ladda minne och bygg konversation
    memory = load_memory()
    
    # Håll bara senaste 20 meddelanden för att spara minne
    recent = memory.get("conversations", [])[-20:]
    
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages.extend(recent)
    messages.append({"role": "user", "content": user_text})
    
    # Kolla om användaren vill köra ett kommando
    if user_text.lower().startswith("kör ") or user_text.lower().startswith("run "):
        cmd = user_text[4:].strip()
        await update.message.reply_text(f"🔧 Kör: `{cmd}`", parse_mode="Markdown")
        output = run_command(cmd)
        await update.message.reply_text(f"```\n{output}\n```", parse_mode="Markdown")
        return
    
    # Skicka till AI
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

