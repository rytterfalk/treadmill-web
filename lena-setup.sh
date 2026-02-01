#!/bin/bash
# Lena Setup Script för Raspberry Pi 3
# Bengts lillasyster 🦞

set -e

echo "🦞 Installerar Lena på Pi3..."

# Skapa katalog
mkdir -p ~/lena
cd ~/lena

# Skapa virtual environment
echo "📦 Skapar Python venv..."
python3 -m venv venv
source venv/bin/activate

# Installera dependencies
echo "📦 Installerar paket..."
pip install --upgrade pip
pip install python-telegram-bot==20.6 python-dotenv openai

# Skapa .env-fil om den inte finns
if [ ! -f .env ]; then
    cat > .env << 'EOF'
# Lenas Telegram Bot Token (från @BotFather)
LENA_TELEGRAM_TOKEN=

# OpenAI API-nyckel
OPENAI_API_KEY=

# Ditt chat ID (samma som för Bengt)
TARGET_CHAT_ID=
EOF
    echo "📝 Skapade .env - fyll i dina nycklar!"
fi

# Kopiera lena.py om den finns i samma katalog
if [ -f ~/lena.py ]; then
    cp ~/lena.py ~/lena/lena.py
    echo "✅ Kopierade lena.py"
fi

# Skapa systemd service
echo "⚙️ Skapar systemd service..."
mkdir -p ~/.config/systemd/user

cat > ~/.config/systemd/user/lena.service << 'EOF'
[Unit]
Description=Lena - AI Assistant (Bengts lillasyster)
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/pi/lena
ExecStart=/home/pi/lena/venv/bin/python /home/pi/lena/lena.py
Restart=on-failure
RestartSec=30
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=default.target
EOF

# Uppdatera sökvägar om användaren inte är "pi"
USER=$(whoami)
if [ "$USER" != "pi" ]; then
    sed -i "s|/home/pi|/home/$USER|g" ~/.config/systemd/user/lena.service
fi

systemctl --user daemon-reload

echo ""
echo "✅ Lena är installerad!"
echo ""
echo "📋 Nästa steg:"
echo "1. Redigera ~/lena/.env och fyll i:"
echo "   - LENA_TELEGRAM_TOKEN (från @BotFather)"
echo "   - OPENAI_API_KEY"
echo "   - TARGET_CHAT_ID (ditt chat-id)"
echo ""
echo "2. Kopiera lena.py till ~/lena/"
echo ""
echo "3. Starta Lena:"
echo "   systemctl --user enable --now lena"
echo ""
echo "4. Se loggar:"
echo "   journalctl --user -u lena -f"
echo ""
echo "🦞 Lycka till med Lena!"

