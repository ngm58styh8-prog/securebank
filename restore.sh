#!/bin/bash
# Restore GlobalVest data from a backup folder (see backup.sh).
cd "$(dirname "$0")"

SRC="${1:-}"
if [ -z "$SRC" ] || [ ! -d "$SRC" ]; then
  echo "Usage: ./restore.sh backups/globalvest-YYYYMMDD-HHMMSS"
  echo ""
  echo "Available backups:"
  ls -1d backups/globalvest-* 2>/dev/null | sed 's/^/  /' || echo "  (none yet — run ./backup.sh first)"
  exit 1
fi

mkdir -p data

if [ -f "$SRC/accounts.json" ]; then
  cp "$SRC/accounts.json" data/accounts.json
  echo "Restored data/accounts.json"
else
  echo "Warning: no accounts.json in backup"
fi

if [ -f "$SRC/admin.json" ]; then
  cp "$SRC/admin.json" data/admin.json
  echo "Restored data/admin.json"
fi

if [ -f "$SRC/email.config.json" ]; then
  cp "$SRC/email.config.json" email.config.json
  echo "Restored email.config.json"
fi

echo ""
echo "Restore complete from: $SRC"
echo "Start the app on the new host: ./start.sh"
echo "Then open http://localhost:8765/admin.html — users load from the server registry."
echo ""
