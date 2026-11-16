#!/bin/zsh
# ════════════════════════════════════════════════════════════════════════
#  set-database-url · save the Neon connection string as the App Hosting
#  DATABASE_URL secret, cleanly.
#
#  Reads the clipboard AFTER you press Enter, keeps only the FIRST
#  postgresql:// address (Neon's Connect window can copy two), removes
#  channel_binding (Prisma's schema engine can reject it), checks the
#  shape, saves it with the Firebase CLI and clears the clipboard.
#  The address itself is never printed.
#
#  Usage (from the HALO folder):  zsh scripts/deploy/set-database-url.zsh
# ════════════════════════════════════════════════════════════════════════

cd "$(dirname "$0")/../.." || exit 1

echo ""
echo "1) Copy your Neon connection string now (Neon → Connect, pooling OFF)."
read "?2) Then come back here and press Enter… "

raw=$(pbpaste)
# first postgres URL in the clipboard text (stops at quotes / whitespace)
url=$(printf %s "$raw" | grep -oE "postgres(ql)?://[^\"'[:space:]]+" | head -1)
# two addresses glued together → keep the part before the second one
second=$(printf %s "${url:1}" | grep -bo "postgres" | head -1 | cut -d: -f1)
if [[ -n "$second" ]]; then url="${url:0:$((second + 1))}"; fi
# drop channel_binding in any position
url="${url//&channel_binding=require/}"
url="${url//\?channel_binding=require&/?}"
url="${url//\?channel_binding=require/}"
unset raw

if [[ "$url" != postgres*://*@*/* ]]; then
  echo "✗ That doesn't look like a Neon address — nothing was saved. Copy it again and re-run."
  exit 1
fi
if [[ "$url" != *sslmode=require* ]]; then
  if [[ "$url" == *\?* ]]; then url="${url}&sslmode=require"; else url="${url}?sslmode=require"; fi
fi

pooled="no"; [[ "$url" == *-pooler* ]] && pooled="yes"
echo "✓ Found 1 address · ${#url} characters · pooled host: ${pooled}"
if [[ "$pooled" == "yes" ]]; then
  echo "  ⚠ This is the POOLED address. In Neon → Connect, turn Connection pooling OFF, copy again and re-run."
  exit 1
fi

firebase apphosting:secrets:set DATABASE_URL --data-file <(printf %s "$url")
rc=$?
unset url
pbcopy < /dev/null   # clear the clipboard
exit $rc
