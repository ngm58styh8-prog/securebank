#!/bin/bash
# Back up GlobalVest data for migration to a new host.
cd "$(dirname "$0")"

STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="backups/globalvest-${STAMP}"
mkdir -p "$DEST" data

if [ -f data/accounts.json ]; then
  cp data/accounts.json "$DEST/accounts.json"
else
  echo "{}" > "$DEST/accounts.json"
fi

if [ -f data/admin.json ]; then
  cp data/admin.json "$DEST/admin.json"
fi

if [ -f email.config.json ]; then
  cp email.config.json "$DEST/email.config.json"
fi

cat > "$DEST/manifest.json" <<EOF
{
  "app": "GlobalVest",
  "created": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "hostname": "$(hostname 2>/dev/null || echo unknown)",
  "files": {
    "accounts": "accounts.json",
    "admin": "admin.json",
    "email": "email.config.json"
  }
}
EOF

echo ""
echo "GlobalVest backup complete"
echo "  Location: $DEST"
echo "  Files:"
ls -1 "$DEST" | sed 's/^/    /'
echo ""
echo "Copy this folder to the new host, then run:"
echo "  ./restore.sh $DEST"
echo ""
