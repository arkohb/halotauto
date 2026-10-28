# Worklog

---
Task ID: 1
Agent: main (Z.ai)
Task: Turn the HALO 3-Candle Equal Level [3EL] PineScript v1.1 indicator into an autotrader PWA with full strategy settings and EA trading bot

Work Log:
- Initialized fullstack environment (Next.js 16 + App Router scaffold), verified Binance/Bybit/OKX/Coinbase reachability
- Installed lightweight-charts v5; pushed Prisma schema (Trade, BotConfig) to SQLite
- Ported the PineScript to TypeScript 1:1 in src/lib/halo/engine.ts:
  ① C1/C2 formation (ATR body filter, pair gap tolerance, too-close replacement, per-side cap, expiry)
  ② C3 trigger (break + equal-level + back-inside + min wick + optional wick-inside, instant intrabar vs bar-close modes)
  ③ Trade module (3 SL modes: fixed points / C3 wick+buffer / ATR; R-multiple TP; same-bar SL+TP counts as SL)
  ④ Stats (wins/losses, TP/SL pips, net, burned/skipped/crowded counters)
- Market data service (src/lib/market.ts): Binance→Bybit→OKX→Coinbase fallback chain + deterministic built-in simulator, incremental cache with in-flight dedup + deep-fetch for warmups
- EA bot service (src/lib/bot.ts): server singleton, 2s tick loop, warm-up over 600 bars, instant-mode trial-run on engine clone (Pine rollback semantics, commit only on fire/exit), paper trades persisted to DB, config persisted in BotConfig
- API routes: /api/market/candles, /api/bot/state, /api/bot/config, /api/bot/control, /api/trades, /api/backtest
- UI (navy/gold HALO theme): sticky header with symbol/TF selects + feed badge + PWA install, status banner, lightweight-charts panel (C1/C2 level lines, C3 fire arrows, TP/SL result markers, ENTRY/SL/TP price lines), trade card, fresh levels table, dashboard mirroring the Pine table, EA bot panel, trade history, backtester with equity curve
- PWA: manifest.webmanifest, sw.js (cache-first statics, network-first navigation, API passthrough), generated icons via sharp (192/512/maskable/apple)
- Browser verification (agent-browser): desktop + mobile render, symbol switching, settings apply, EA start/stop, backtest run, PWA assets 200
- Fixed during verification: chart stale-data on symbol switch (always-setData), server cache poisoning from small warm requests (deep fetch + inflight dedup), settings draft reset by state polls (dirty-flag pattern)

Stage Summary:
- Deliverable: runnable Next.js PWA at / (port 3000) — HALO 3EL Autotrader with EA paper-trading bot
- Key files: src/lib/halo/{types,engine,ui-helpers}.ts, src/lib/{market,market-symbols,bot}.ts, src/components/halo/*, src/app/api/**, public/{manifest.webmanifest,sw.js,icons}
- Verified: lint clean, no runtime errors, all interactive flows work in browser
