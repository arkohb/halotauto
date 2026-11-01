#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════
#  HALO PERFORMANCE JOURNAL · E2E API test suite (Phase 4, spec §8)
#  Runs the REAL flows against the running dev server:
#    register → verify e-mail → sign in → seed demo → verify math →
#    filters/pagination → note save → export → report/insights →
#    prev-period comparison → cleanup → regression on existing APIs
#  Leaves the test account with a CLEAN journal (demo rows removed).
# ══════════════════════════════════════════════════════════════════════════
set -u
BASE="http://localhost:3000"
JAR="/tmp/halo-e2e-cookies.txt"
rm -f "$JAR"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  ✓ $1"; }
bad() { FAIL=$((FAIL+1)); echo "  ✗ $1"; }
check() { # check <label> <expected> <actual>
  if [ "$2" = "$3" ]; then ok "$1 ($3)"; else bad "$1 — expected $2, got $3"; fi
}

echo "── 1 · register ──────────────────────────────────────────────"
EMAIL="journal-e2e-$(date +%s)@halo-test.local"
REG=$(curl -s -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' -d "{
  \"fullName\":\"Journal E2E\",\"email\":\"$EMAIL\",\"username\":\"je2e$(date +%s)\",
  \"password\":\"Halo-E2E-Pass!42\",\"confirmPassword\":\"Halo-E2E-Pass!42\",
  \"country\":\"Ghana\",\"acceptTerms\":true,\"acceptLicense\":true}")
check "register ok" "true" "$(echo "$REG" | jq -r .ok)"

echo "── 2 · verify e-mail (token from DB, real endpoint) ──────────"
TOKEN=$(node -e "
const {PrismaClient}=require('/home/z/my-project/node_modules/@prisma/client');
const db=new PrismaClient();
db.user.findFirst({where:{email:'$EMAIL'},select:{verifyToken:true}}).then(u=>{console.log(u?.verifyToken??'');return db.\$disconnect();});")
V_CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/auth/verify-email?token=$TOKEN")
[ "$V_CODE" = "200" ] || [ "$V_CODE" = "302" ] && ok "verify-email accepted (HTTP $V_CODE)" || bad "verify-email unexpected HTTP $V_CODE"

echo "── 3 · sign in ───────────────────────────────────────────────"
LOGIN=$(curl -s -c "$JAR" -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"identifier\":\"$EMAIL\",\"password\":\"Halo-E2E-Pass!42\",\"remember\":true}")
check "login ok" "true" "$(echo "$LOGIN" | jq -r .ok)"
ME=$(curl -s -b "$JAR" "$BASE/api/auth/me")
check "session recognized" "true" "$(echo "$ME" | jq -r .authenticated)"

echo "── 4 · seed labeled demo dataset ─────────────────────────────"
SEED=$(curl -s -b "$JAR" -X POST "$BASE/api/journal/demo" -H 'Content-Type: application/json' -d '{"action":"seed","count":78}')
check "demo seed ok" "true" "$(echo "$SEED" | jq -r .ok)"
echo "    $(echo "$SEED" | jq -c .result)"

echo "── 5 · stats + independent math verification ─────────────────"
curl -s -b "$JAR" "$BASE/api/journal/stats?period=all" > /tmp/halo-e2e-stats.json
S30=$(curl -s -b "$JAR" "$BASE/api/journal/stats?period=30d")
node /home/z/my-project/scripts/journal-e2e-verify.mjs "$JAR"
PREV30=$(echo "$S30" | jq -r '.prev.totalTrades // 0')
[ "${PREV30:-0}" -gt 0 ] && ok "previous-period window has data ($PREV30 trades)" || bad "30d window should have a populated previous period"

echo "── 6 · list / pagination / search / filters ──────────────────"
L1=$(curl -s -b "$JAR" "$BASE/api/journal?page=1&pageSize=25&period=all")
check "page 1 size" "25" "$(echo "$L1" | jq '.trades | length')"
L2=$(curl -s -b "$JAR" "$BASE/api/journal?page=2&pageSize=25&period=all")
P1=$(echo "$L1" | jq -r '.trades[0].id'); P2=$(echo "$L2" | jq -r '.trades[0].id')
[ -n "$P1" ] && [ "$P1" != "$P2" ] && ok "page 2 disjoint from page 1" || bad "page 2 overlaps page 1"
TOTAL=$(echo "$L1" | jq -r .total)
SYM=$(echo "$L1" | jq -r '.meta.symbols[0] // empty')
[ -n "$SYM" ] && FSYM=$SYM || FSYM="XAUUSD"
LF=$(curl -s -b "$JAR" "$BASE/api/journal?period=all&symbol=$FSYM&pageSize=200")
check "symbol filter ($FSYM) consistent" "true" "$(echo "$LF" | jq -e --arg s "$FSYM" '.trades | all(.symbol == $s)' >/dev/null && echo true)"
LS=$(curl -s -b "$JAR" "$BASE/api/journal?period=all&q=demo&pageSize=200")
echo "    search 'demo' → $(echo "$LS" | jq -r .total) of $TOTAL rows"

echo "── 7 · period filter really scopes the window ────────────────"
ALL_T=$(jq -r .core.totalTrades /tmp/halo-e2e-stats.json)
T30=$(echo "$S30" | jq -r .core.totalTrades)
[ "$T30" -le "$ALL_T" ] && ok "30d trades ($T30) ≤ all-time ($ALL_T)" || bad "30d window larger than all-time"

echo "── 8 · note save (PATCH) round-trip ──────────────────────────"
TID=$(echo "$L1" | jq -r '.trades[0].id')
P=$(curl -s -b "$JAR" -X PATCH "$BASE/api/journal/trades/$TID" -H 'Content-Type: application/json' \
  -d '{"notes":"E2E test note — kept honest.","tags":["followed_plan"],"review":{"reasonEntry":"e2e","rating":4}}')
check "patch ok" "true" "$(echo "$P" | jq -r .ok)"
check "note persisted" "E2E test note — kept honest." "$(echo "$P" | jq -r .trade.notes)"
GV=$(curl -s -b "$JAR" "$BASE/api/journal?period=all&pageSize=200")
check "note readable from list" "true" "$(echo "$GV" | jq -e --arg id "$TID" '.trades[] | select(.id==$id) | .notes=="E2E test note — kept honest."' >/dev/null && echo true)"

echo "── 9 · export CSV of the same filter ─────────────────────────"
curl -s -b "$JAR" "$BASE/api/journal/export?period=all" -o /tmp/halo-e2e-export.csv
HEAD=$(head -1 /tmp/halo-e2e-export.csv)
ROWS=$(node -e "
const fs=require('fs');const t=fs.readFileSync('/tmp/halo-e2e-export.csv','utf8');
let inQ=false,recs=0;for(let i=0;i<t.length;i++){const ch=t[i];if(ch==='\"'){if(inQ&&t[i+1]==='\"')i++;else inQ=!inQ;}else if(ch==='\n'&&!inQ)recs++;}
if(t.trimEnd().length>0)recs++;console.log(recs-1);")
echo "    header: $HEAD"
[ "${ROWS:-0}" -eq "$TOTAL" ] && ok "export records = journal total ($ROWS)" || bad "export records $ROWS ≠ total $TOTAL"

echo "── 10 · report + insights ────────────────────────────────────"
R=$(curl -s -b "$JAR" "$BASE/api/journal/report?period=all")
check "report ok" "true" "$(echo "$R" | jq -r .ok)"
I=$(curl -s -b "$JAR" "$BASE/api/journal/insights?period=all&q=$(printf 'What is my best instrument?' | jq -sRr @uri)")
check "insights ok" "true" "$(echo "$I" | jq -r .ok)"
echo "    answer: $(echo "$I" | jq -r '.answer // ""' | head -c 120)"

echo "── 11 · privacy — unauthenticated journal access blocked ─────"
check "no-cookie list → 401" "401" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/journal?period=all")"
check "no-cookie export → 401" "401" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/journal/export?period=all")"

echo "── 12 · cleanup demo rows (leave a clean test journal) ───────"
C=$(curl -s -b "$JAR" -X POST "$BASE/api/journal/demo" -H 'Content-Type: application/json' -d '{"action":"clear"}')
check "clear ok" "true" "$(echo "$C" | jq -r .ok)"
check "journal empty after clear" "0" "$(echo "$C" | jq -r .remaining)"

echo "── 13 · regression — existing surfaces still intact ──────────"
check "bot/state (auth) 200" "200" "$(curl -s -b "$JAR" -o /dev/null -w '%{http_code}' "$BASE/api/bot/state")"
check "trades (auth) 200" "200" "$(curl -s -b "$JAR" -o /dev/null -w '%{http_code}' "$BASE/api/trades")"
check "strategies (auth) 200" "200" "$(curl -s -b "$JAR" -o /dev/null -w '%{http_code}' "$BASE/api/strategies")"
check "intel/news (auth) 200" "200" "$(curl -s -b "$JAR" -o /dev/null -w '%{http_code}' "$BASE/api/intel/news")"
check "auth/me 200" "200" "$(curl -s -b "$JAR" -o /dev/null -w '%{http_code}' "$BASE/api/auth/me")"

echo ""
echo "══════════════════════════════════════════════════════════════"
echo "  RESULT: $PASS passed · $FAIL failed"
echo "══════════════════════════════════════════════════════════════"
[ $FAIL -eq 0 ]
