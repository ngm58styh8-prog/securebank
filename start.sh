#!/bin/bash
cd "$(dirname "$0")"
PORT=8765

echo ""
echo "SecureBank is starting on port $PORT"
echo ""
echo "  User login:  http://localhost:$PORT/index.html"
echo "  Admin login: http://localhost:$PORT/admin.html"
echo "               admin@securebank.com / admin123"
echo ""
echo "Press Ctrl+C to stop."
echo ""

ruby -run -e httpd . -p "$PORT"
