# Task UI-d — Work Record (brokers / alerts / settings / ea-attach / fx / voice + /api/alerts/test bug fix)

Agent: UI-d · Date: 2026-10-29 · Project: /home/z/my-project (HALO 3EL Autotrader, Next.js 16 App Router)

## Scope compliance
Only these files were created/modified — nothing else touched:
- src/components/halo/brokers-panel.tsx (rewritten, visual-only)
- src/components/halo/alerts-panel.tsx (rewritten, visual-only + minimal honest-test handling)
- src/components/halo/settings-panel.tsx (rewritten, visual-only)
- src/components/halo/ea-attach.tsx (rewritten, visual-only)
- src/components/halo/fx-settings-card.tsx (token confirmation pass)
- src/components/halo/voice-settings-card.tsx (chrome/tokens only, gentle)
- src/app/api/alerts/test/route.ts (NEW — bug fix)

## 1. /api/alerts/test bug fix — investigation findings
- `alerts-panel.tsx` POSTs `{ channel }` to `/api/alerts/test`, but `src/app/api/alerts/` only had
  `settings/` (GET masked settings, PUT save) and `log/` (GET AlertLog rows) → every TEST button 404'd.
- `src/lib/alerts.ts` already ships the exact server machinery, exported and unused by any route:
  `testAlert(channel: "telegram"|"email"|"push"|"all")` → really calls `sendTelegram` (Telegram Bot API
  HTTP), `sendEmail` (nodemailer SMTP), `sendPush` (web-push + real VAPID keys from the DB), logs each
  attempt to `AlertLog`, and returns honest per-channel `{ ok, error?, sent? }` — including failures like
  "email not configured" / "no devices subscribed". Nothing needed to be reinvented.
- Existing route conventions matched: `export const dynamic = "force-dynamic"`, try/catch →
  `NextResponse.json({ ok:false, error: (e as Error).message }, { status: 500 })`, no auth anywhere.
- NEW route `POST /api/alerts/test`: parses body tolerantly (empty/invalid body → "all"), validates the
  channel against the whitelist, calls `testAlert(channel)`, returns `{ ok: true, result }` where `result`
  is the shared `DispatchResult`. **No invented results** — a channel that isn't configured or fails
  mid-send reports ok:false with the real error text.
- Panel shape match: the panel already reads `j.result.{telegram,email,push}` — identical to
  `DispatchResult`, so no shape conversion was needed. Only MINIMAL panel hardening was added to keep
  results honest: if the response has no `result` (e.g. HTTP 500 error body), the button now toasts
  "TEST FAILED" with the server error / `HTTP <status>` instead of the old vacuous-success path
  (empty `res` → `every()` = true → "TEST ALERTS DELIVERED"), plus a catch for network throws.
  Nothing else in the fetch handling changed.

### Actual verification (dev server)
`curl -s -X POST http://localhost:3000/api/alerts/test` →
```json
{"ok":true,"result":{"telegram":{"ok":false,"error":"HTTP 401 {\"ok\":false,\"error_code\":401,\"description\":\"Unauthorized\"}"},"email":{"ok":false,"error":"email not configured"},"push":{"ok":false,"error":"no devices subscribed","sent":0}}}
```
HTTP 200 (was 404 before the fix). Telegram genuinely attempted api.telegram.org and got 401 because the
dev DB token is a placeholder — proof results are real, not faked. `{"channel":"push"}` → only the push
result. New `kind:"test"` rows appear in `/api/alerts/log` (shared dispatcher logging).
Browser E2E: clicked SEND TEST on the Telegram card → toast surfaces
`Telegram: HTTP 401 {"ok":false,...,"Unauthorized"}` — honest per-channel result in the UI.

## 2. brokers-panel.tsx (heaviest file)
- PanelCard chrome: header strip (Landmark, accent cyan, exec-mode chip in `right`), MT4/MT5 login card
  (KeyRound, accent gold, cloud-health Pill + "recommended" Badge in `right`), connected accounts
  (Wallet, accent green, title keeps live count), broker directory (Building2, accent cyan, search input
  in `right`), all-platforms catalog (LayoutGrid, accent cyan).
- Loading dashed box → `<StateFrame state="loading" title="Loading broker connections…" />` (copy kept).
- Border logic preserved exactly: `isExecTarget ? C.red : b.active ? C.gold : C.line` on account tiles.
- Token migration: **zero raw hex literals remain** (verified by grep). Inline styles use C/A tokens
  (`A.gold(0.4)`, `A.red(0.6)`…); Tailwind classes reference the `--hx-*` CSS mirror of C
  (`text-[var(--hx-txt)]`, `border-[var(--hx-line2)]`, `hover:border-[var(--hx-gold)]`,
  `bg-[var(--hx-card2)]`…). Gold solid buttons → `bg-primary text-primary-foreground hover:bg-[var(--hx-gold-hi)]`;
  red dialog action hover `#FF4D5B` (no token) → `hover:brightness-110`; darker-red regen hover → `hover:brightness-90`.
- Cloud pill now uses the unified `Pill` (tone ok/gold, pulse when healthy) — all five state texts kept verbatim.
- KEPT byte-for-byte: all state/handlers (load/test/setActive/goLive/switchToPaper/remove/pickFirm),
  MT login form + advanced MetaApi block + datalist, all notify texts, TESTING…/ARMING… labels,
  dialogs (route-to-broker confirm, remove confirm, add-broker dialog with per-platform creds +
  symbol-map JSON validation), every badge text, all aria-labels, `BrokerRow` export, `CATALOG_KINDS`.
- Mobile: directory search input `w-36 sm:w-56` so the PanelCard header fits narrow screens.

## 3. alerts-panel.tsx
- Hand-rolled `Card` helper removed → PanelCard: TELEGRAM (Send, accent cyan), EMAIL·SMTP (Mail, gold),
  BROWSER PUSH (BellRing, teal), EVENT MATRIX (ListChecks, warn), DELIVERY LOG (History, default accent —
  PanelCard has no muted tone; title kept).
- `h-40 animate-pulse` loading box → `<StateFrame state="loading" title="Loading alert settings" />`.
- "No alerts yet…" → `<StateFrame state="empty" title="No alerts yet" hint="Run a test or wait for a signal." />`
  (full variant so the copy survives; compact variant drops hints).
- Event-matrix switches, masked InputRow behavior, SAVE/TEST buttons, push-subscribe flow: untouched logic.
- test(): minimal honest-handling branch + catch (see §1). Token migration same `--hx-*` approach.

## 4. settings-panel.tsx
- One PanelCard (SlidersHorizontal icon, accent gold) containing the existing shadcn Accordion with all
  three sections ①②③, preset chips, every Pine NumRow/Select/Switch and the APPLY SETTINGS flow verbatim.
- "PineScript v1.1 port" label moved into PanelCard `right`. Gold section headers → `text-[var(--hx-gold)]`.
- All hex classes → `--hx-*` vars. Draft/dirty/save logic byte-identical.

## 5. ea-attach.tsx
- Outer hand-rolled section → PanelCard (Puzzle icon, accent gold); original section aria-label
  "Attach EA to TradingView chart" preserved by keeping a wrapping `<section aria-label=…>` (PanelCard
  renders its own title aria-label; the original label is kept on the outer landmark).
- ARMED·LIVE pinging pill / SIM ROUTING·PAPER pill + WEBHOOK FIRES counter now in PanelCard `right`.
- Auto-attach status logic, attach/detach button, status mini-row, webhook bridge details (copy Pine EA /
  copy URL / test fire / secret readouts / regen dialog), all aria-labels and states: untouched.
- All rgba/hex → A()/C tokens + `--hx-*` classes.

## 6. fx-settings-card.tsx
- Already PanelCard; rgba hexes → A.cyan/A.gold + `${C.navy}99`; text hexes → `--hx-*` vars. Logic untouched.

## 7. voice-settings-card.tsx (gentle)
- Outer card aligned to PanelCard visuals ONLY: border C.panelLine, background
  `linear-gradient(180deg, ${C.panel}, ${C.deep})`, exact PanelCard boxShadow string copied from panel.tsx.
- Every Row, switch, input, slider, select, button, aria-label ("Enable HALO voice", "Enable wake word",
  "Automatic spoken welcome", "Voice volume", "Speaking rate", "Voice selection", "Wake phrase",
  "Preferred name") preserved. micChip rgba → A.red/A.warn/A.green + C.warn. `accent-[#4FD8FF]` →
  `accent-[var(--hx-cyan)]`. One-off #5D6B85 (placeholder/footnote) → `--hx-label` (nearest token).

## Deliberately untouched
- All fetch endpoints/flows (MetaApi login/activate/go-live, /api/bot/config, /api/webhook/tv/*,
  /api/push, /api/alerts/settings PUT), poll intervals, notify signatures, `BrokerRow`/component exports.
- alerts-panel InputRow's always-"text" input type oddity (pre-existing, behavior-ish — left alone).
- Pre-existing unused `DialogTrigger` import in brokers-panel (was already unused before this task).
- Pre-existing tsc errors in scripts/ and skills/ folders (out of scope, unrelated).
- `toneClasses()` in ui-helpers still contains literal rgba/hex — that file is NOT in my assigned set.

## Verification (actual output)
1. `bunx eslint <all 7 files>` → clean (exit 0, no output).
2. `bunx tsc --noEmit | grep -E "brokers-panel|alerts-panel|settings-panel|ea-attach|fx-settings|voice-settings|api/alerts/test"` → empty.
   (Full tsc shows only pre-existing scripts/, skills/ errors.)
3. `curl -s -X POST http://localhost:3000/api/alerts/test | head -c 400` → JSON 200 shown in §1 (not 404).
4. Runtime browser check (agent-browser): BROKERS / ALERTS / SETTINGS views + terminal all render with
   PanelCard chrome, connected-account tiles (TEST / SET ACTIVE / REMOVE), SEND TEST toast shows real
   Telegram 401 result; zero page errors; zero console errors. Served dev CSS confirmed the `--hx-*`
   var utilities compile (incl. color-mix opacity forms like `border-[var(--hx-line-inner)]/60`).
