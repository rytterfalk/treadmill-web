#!/bin/bash
# Lena Setup Script för Raspberry Pi 3
# Bengts lillasyster 🦞
# Körs från ~/treadmill-web/

set -e

DIR="$HOME/treadmill-web"
cd "$DIR"

echo "🦞 Installerar Lena i $DIR..."

# Skapa venv om den inte finns
if [ ! -d venv ]; then
    echo "📦 Skapar Python venv..."
    python3 -m venv venv
fi

source venv/bin/activate

# Installera dependencies (lägger till openai om det saknas)
echo "📦 Installerar paket..."
pip install --upgrade pip
pip install python-telegram-bot==20.6 python-dotenv openai aiosqlite

# Lägg till Lena-variabler i .env om de saknas
if ! grep -q "LENA_TELEGRAM_TOKEN" .env 2>/dev/null; then
    echo "" >> .env
    echo "# === LENA ===" >> .env
    echo "LENA_TELEGRAM_TOKEN=" >> .env
    echo "OPENAI_API_KEY=" >> .env
    echo "📝 Lade till LENA_TELEGRAM_TOKEN och OPENAI_API_KEY i .env"
fi

# Skapa systemd service
echo "⚙️ Skapar systemd service..."
mkdir -p ~/.config/systemd/user

cat > ~/.config/systemd/user/lena.service << EOF
[Unit]
Description=Lena - AI Assistant (Bengts lillasyster)
After=network.target

[Service]
Type=simple
WorkingDirectory=$DIR
ExecStart=$DIR/venv/bin/python $DIR/lena.py
Restart=on-failure
RestartSec=30
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload

echo ""
echo "✅ Lena är installerad!"
echo ""
echo "📋 Nästa steg:"
echo "1. Skapa Telegram-bot för Lena via @BotFather"
echo ""
echo "2. Redigera $DIR/.env och fyll i:"
echo "   LENA_TELEGRAM_TOKEN=<från BotFather>"
echo "   OPENAI_API_KEY=<din nyckel>"
echo ""
echo "3. Starta Lena:"
echo "   systemctl --user enable --now lena"
echo ""
echo "4. Se loggar:"
echo "   journalctl --user -u lena -f"
echo ""
echo "🦞 Lycka till med Lena!"

