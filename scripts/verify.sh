#!/bin/bash
# HALO 3EL · one-shot verification: boot dev server, exercise every new API, report
cd /home/z/my-project

# 1) boot
if ! curl -s -o /dev/null --max-time 3 http://localhost:3000/ 2>/dev/null; then
  nohup bun run dev > /dev/null 2>&1 &
  for i in $(seq 1 40); do
    sleep 3
    code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ --max-time 5 2>/dev/null)
    [ "$code" = "200" ] && break
  done
fi
echo "boot: $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/ --max-time 10)"

# 2) GET endpoints
for ep in brokers alerts/settings alerts/log scanner push bot/state trades "market/candles?symbol=BTCUSDT&tf=5m&limit=30"; do
  printf "GET  /api/%-46s %s\n" "$ep" "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:3000/api/$ep" --max-time 30)"
done

# 3) broker lifecycle on a dummy OANDA account (test will fail with HTTP error → status:'error', route ok)
BID=$(curl -s -X POST http://localhost:3000/api/brokers -H 'Content-Type: application/json' \
  -d '{"kind":"oanda","label":"QA Dummy","creds":{"apiToken":"dummy-token-123","accountId":"101-004-0000000-001","environment":"practice"}}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
echo "POST /api/brokers (create)            → id=$BID"
printf "PATCH test                            %s\n" "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "http://localhost:3000/api/brokers/$BID" -H 'Content-Type: application/json' -d '{"action":"test"}')"
curl -s "http://localhost:3000/api/brokers" | python3 -c "import sys,json;d=json.load(sys.stdin);b=d['brokers'][0];print('     status after test:',b['status'],'|',b['statusMsg'][:60],'| masked token:',b['masked'].get('apiToken'))"
printf "PATCH activate                        %s\n" "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "http://localhost:3000/api/brokers/$BID" -H 'Content-Type: application/json' -d '{"action":"activate"}')"
printf "PATCH update (masked merge)           %s\n" "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "http://localhost:3000/api/brokers/$BID" -H 'Content-Type: application/json' -d '{"action":"update","label":"QA Dummy 2"}')"

# 4) live-exec guard: switching to live without valid broker must be rejected
curl -s -X POST http://localhost:3000/api/bot/config -H 'Content-Type: application/json' \
  -d '{"exec":{"executionMode":"live","brokerAccountId":"'"$BID"'"}}' | python3 -c "import sys,json;d=json.load(sys.stdin);print('exec→live (untested broker):','REJECTED' if not d.get('ok') else 'ALLOWED', '|', str(d.get('error',''))[:60])"

# 5) scanner lifecycle
printf "POST scanner add BTCUSDT/5m           %s\n" "$(curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:3000/api/scanner -H 'Content-Type: application/json' -d '{"action":"add","symbol":"BTCUSDT","tf":"5m","autoTrade":true}')"
printf "POST scanner add PAXGUSDT/15m         %s\n" "$(curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:3000/api/scanner -H 'Content-Type: application/json' -d '{"action":"add","symbol":"PAXGUSDT","tf":"15m","autoTrade":false}')"
printf "POST scanner scan                     %s\n" "$(curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:3000/api/scanner -H 'Content-Type: application/json' -d '{"action":"scan"}')"
sleep 6
curl -s http://localhost:3000/api/scanner | python3 -c "
import sys,json
d=json.load(sys.stdin)
print('     scanner rows:',len(d['rows']),'| enabled:',d['enabledCount'],'| auto:',d['autoTradeCount'])
for r in d['rows']:
    print('      -',r['symbol'],r['tf'],r['status'],'px',r['price'],'S/B',r['freshSell'],'/',r['freshBuy'],r['source'])"

# 6) alerts settings + test
printf "PUT  alerts/settings                  %s\n" "$(curl -s -o /dev/null -w '%{http_code}' -X PUT http://localhost:3000/api/alerts/settings -H 'Content-Type: application/json' -d '{"telegramEnabled":true,"telegramBotToken":"••••","telegramChatId":"812345678","emailEnabled":false,"events":{"fire":true,"win":true,"loss":true,"scanner":true,"broker":true,"status":false}}')"
curl -s http://localhost:3000/api/alerts/settings | python3 -c "import sys,json;s=json.load(sys.stdin)['settings'];print('     saved: chatId',s['telegramChatId'],'| token kept masked:',s['telegramBotToken'],'| pushEnabled',s['pushEnabled'],'| vapid len',len(s.get('vapidPublicKey','')))"
curl -s -X POST http://localhost:3000/api/alerts/test -H 'Content-Type: application/json' -d '{"channel":"telegram"}' | python3 -c "import sys,json;r=json.load(sys.stdin)['result']['telegram'];print('     telegram test:',r['ok'],str(r.get('error',''))[:70])"
curl -s -X POST http://localhost:3000/api/alerts/test -H 'Content-Type: application/json' -d '{"channel":"push"}' | python3 -c "import sys,json;r=json.load(sys.stdin)['result']['push'];print('     push test: ok',r['ok'],'|',str(r.get('error',''))[:60])"
printf "GET  alerts/log                       %s\n" "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/alerts/log)"

# 7) bot control close (no trade → expect 400 with message)
printf "POST bot/control close (flat)         %s\n" "$(curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:3000/api/bot/control -H 'Content-Type: application/json' -d '{"action":"close"}')"

# 8) back to paper + cleanup QA broker + scanner rows
printf "exec→paper                            %s\n" "$(curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:3000/api/bot/config -H 'Content-Type: application/json' -d '{"exec":{"executionMode":"paper"}}')"
printf "DELETE broker                         %s\n" "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "http://localhost:3000/api/brokers/$BID")"
IDS=$(curl -s http://localhost:3000/api/scanner | python3 -c "import sys,json;print(' '.join(r['id'] for r in json.load(sys.stdin)['rows']))")
for id in $IDS; do curl -s -o /dev/null -X POST http://localhost:3000/api/scanner -H 'Content-Type: application/json' -d "{\"action\":\"remove\",\"id\":\"$id\"}"; done
echo "cleanup: scanner rows removed"

# 9) page + PWA assets
for path in / /manifest.webmanifest /sw.js /icons/icon-192.png; do
  printf "GET  %-24s %s\n" "$path" "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:3000$path" --max-time 20)"
done

echo "=== verification done ==="
