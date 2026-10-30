#!/bin/bash
# audit-routes.sh · comprehensive commercial route sweep
# classifies every page + data API: signed-out (307/401 expected) and authed (200 expected)
# flags anything that is 5xx or an unexpected redirect
BASE="http://localhost:3000"
JAR="/tmp/audit-jar.txt"
EMAIL="${HALO_E2E_EMAIL:?}"
PASS="${HALO_E2E_PASSWORD:?}"
FLAGGED=()

classify() { # label expected_codes actual_code
  local label="$1" expected="$2" actual="$3"
  if [[ ",$expected," == *",$actual,"* ]]; then
    printf "  ok   %-58s %s\n" "$label" "$actual"
  else
    printf "  ✗✗   %-58s %s (expected %s)\n" "$label" "$actual" "$expected"
    FLAGGED+=("$label → $actual")
  fi
}

code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }

echo "═══ 1. PAGES signed-out (expect 307 → login, or 200 for public) ═══"
for p in / /account /admin /checkout /activate; do
  c=$(code "$BASE$p"); r=$(curl -s -o /dev/null -w "%{redirect_url}" "$BASE$p")
  classify "page$p (anon)" "307" "$c"
  [[ "$r" == *"/login?next="* ]] || { FLAGGED+=("page$p redirect target wrong: $r"); printf "      ✗✗ bad redirect target: %s\n" "$r"; }
done
for p in /login /register /forgot-password /reset-password /pricing; do
  c=$(code "$BASE$p"); classify "page$p (public)" "200" "$c"
done

echo "═══ 2. APIs signed-out (expect 401 JSON or public 200) ═══"
for a in /api/bot/state /api/trades /api/account /api/scanner /api/license /api/license/devices /api/brokers /api/admin/stats /api/admin/users /api/admin/plans /api/admin/licenses /api/admin/transactions /api/admin/audit /api/admin/admins /api/strategies /api/halo/profile /api/alerts/settings /api/alerts/log /api/push; do
  c=$(code "$BASE$a"); classify "api$a (anon)" "401" "$c"
done
for a in /api/auth/me /api/commerce/plans; do
  c=$(code "$BASE$a"); classify "api$a (public)" "200" "$c"
done

echo "═══ 3. login as admin ═══"
login=$(curl -s -c "$JAR" -H "Content-Type: application/json" -d "{\"identifier\":\"$EMAIL\",\"password\":\"$PASS\",\"remember\":true}" "$BASE/api/auth/login")
echo "$login" | rg -q '"ok":true' && echo "  ok   admin login" || { FLAGGED+=("admin login failed"); echo "  ✗✗ admin login failed: $(echo "$login" | head -c 150)"; }

echo "═══ 4. PAGES authed (expect 200) ═══"
for p in / /account /admin /checkout /activate /login /pricing; do
  c=$(code -b "$JAR" "$BASE$p"); classify "page$p (authed)" "200" "$c"
done

echo "═══ 5. DATA APIs authed (expect 200) ═══"
for a in /api/auth/me /api/bot/state /api/trades /api/account /api/scanner /api/license /api/license/devices /api/brokers /api/strategies /api/halo/profile /api/alerts/settings /api/alerts/log /api/push /api/commerce/plans "/api/market/candles?symbol=XAUUSD&tf=1h" "/api/intel/quote?symbol=XAUUSD" "/api/intel/news?source=bloomberg" "/api/intel/calendar" "/api/admin/stats" /api/admin/users /api/admin/plans /api/admin/licenses /api/admin/transactions /api/admin/audit /api/admin/admins /api/admin/settings; do
  c=$(code -b "$JAR" "$BASE$a"); classify "api$a (authed)" "200" "$c"
done

echo "═══ 6. body sanity (admin/stats + commerce/plans + auth/me) ═══"
curl -s -b "$JAR" "$BASE/api/admin/stats" | head -c 200; echo
curl -s -b "$JAR" "$BASE/api/auth/me" | rg -o '"mode":"[a-z]+"' | head -1

echo ""
if [ ${#FLAGGED[@]} -eq 0 ]; then echo "═══ SWEEP CLEAN — no unexpected statuses ═══"; else echo "═══ FLAGGED (${#FLAGGED[@]}) ═══"; printf '  %s\n' "${FLAGGED[@]}"; fi
