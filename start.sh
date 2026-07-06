#!/bin/bash
cd "$(dirname "$0")"
PORT="${PORT:-8765}"

echo ""
echo "GlobalVest is starting on port $PORT"
echo ""
echo "  User site:   http://localhost:$PORT/index.html"
echo "  Sign in:     http://localhost:$PORT/login.html"
echo ""
echo "  Admin portal: http://localhost:$PORT/admin.html (direct URL — not linked on user site)"
echo "               admin@globalvest.com / admin123"
echo ""

if [ ! -f email.config.json ]; then
  cp email.config.example.json email.config.json
  echo "  Email: created email.config.json — edit it with your SMTP credentials."
  echo "        (Gmail: use an App Password at https://myaccount.google.com/apppasswords)"
  echo ""
elif grep -q "your-email@gmail.com" email.config.json 2>/dev/null; then
  echo "  Email: email.config.json still has placeholder values — edit before real emails send."
  echo ""
else
  echo "  Email: configured (deposit & withdrawal notifications enabled)."
  echo ""
fi

echo "  Backup: run ./backup.sh before moving to a new host."
echo ""
echo "Press Ctrl+C to stop."
echo ""

ruby server.rb
