#!/bin/bash
cd "$(dirname "$0")"
PORT="${PORT:-8765}"

echo ""
echo "SecureBank is starting on port $PORT"
echo ""
echo "  User login:  http://localhost:$PORT/index.html"
echo "  Admin login: http://localhost:$PORT/admin.html"
echo "               admin@securebank.com / admin123"
echo ""

if [ ! -f email.config.json ]; then
  echo "  Email: copy email.config.example.json to email.config.json to send real deposit emails."
  echo ""
fi

echo "Press Ctrl+C to stop."
echo ""

ruby server.rb
