# HALO Bridge EA: free MT5 connection

HALO sends orders to **your own MetaTrader 5**. There's no MetaApi and no fees.
The EA polls HALO about every 0.5 s, places orders in MT5, and reports the results back.
Orders only flow while MT5 is open with the EA attached. During testing it's **demo accounts only**: HALO and the EA both refuse a real-money account.

## 1. Pairing key
Make a random key of 24+ characters with your password manager's generator and save it there.

## 2. In HALO
Go to **Brokers & MT5 → MT5 · HALO Bridge EA (free) → CONNECT**, paste the pairing key and save. Don't press GO LIVE.

## 3. In MetaTrader 5 (Mac)
1. Install MetaTrader 5 for macOS (metatrader5.com) and log in to the **demo** account (File → Login to Trade Account).
2. **File → Open Data Folder**, open `MQL5/Experts`, and copy `HALO_Bridge.mq5` into it.
3. **Tools → MetaQuotes Language Editor**, open `HALO_Bridge.mq5`, and press **Compile** (F7). It should report 0 errors.
4. **Tools → Options → Expert Advisors**: tick **Allow algorithmic trading** and **Allow WebRequest for listed URL**, then add `http://127.0.0.1:3000`.
5. Drag **HALO_Bridge** from Navigator → Expert Advisors onto any chart. In **Inputs**, set:
   - `HaloUrl` = `http://127.0.0.1:3000`
   - `PairingKey` = your key
6. Switch on **Algo Trading** in the toolbar. The Experts tab should show `HALO Bridge started → … (demo)`.

If MT5 can't reach `127.0.0.1` (an Alert about WebRequest, or no "started" line in HALO), use a public HTTPS address for HALO instead, such as a Cloudflare tunnel or your staging URL. Add it under WebRequest and set it as `HaloUrl`.

## 4. Check
Press **TEST** on the account card in HALO. It shows the demo login, balance and server.

## Inputs
| Input | Default | Meaning |
|---|---|---|
| `MaxLots` | 1.0 | Hard cap per order |
| `Magic` | 303033 | Tag on HALO orders. Close and modify only touch positions with this tag |
| `SymbolSuffix` | blank | e.g. `m` when gold is `XAUUSDm`. Blank auto-detects |
| `DeviationPts` | 50 | Max slippage in points |
| `DemoOnly` | true | Refuse to trade a real account |
