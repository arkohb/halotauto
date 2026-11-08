//+------------------------------------------------------------------+
//|  HALO_Bridge.mq5 · HALO 3EL Autotrader order bridge for MT5      |
//|                                                                  |
//|  Polls HALO every PollMs over HTTPS/HTTP (WebRequest), executes  |
//|  the commands it receives (open / close / modify / positions /   |
//|  quote / ping / lookup) in THIS terminal and reports the results |
//|  back. Every order carries HALO's order id as its MT5 comment so  |
//|  HALO can reconcile an unconfirmed order by reference.           |
//|  Price feed (v1.20): streams this broker's bid/ask for the        |
//|  symbols HALO watches on every poll, and answers "history" with  |
//|  candles from this terminal — times converted to UTC.            |
//|                                                                  |
//|  Setup:                                                          |
//|   1. Copy this file to MQL5/Experts (File → Open Data Folder),   |
//|      then compile it in MetaEditor (F7).                         |
//|   2. Tools → Options → Expert Advisors: tick "Allow WebRequest   |
//|      for listed URL" and add your HALO address (HaloUrl below).  |
//|   3. Attach the EA to any one chart, set PairingKey (the same    |
//|      key you saved in HALO → Brokers & MT5), enable Algo Trading.|
//|                                                                  |
//|  Safety: DEMO accounts only unless DemoOnly is switched off;     |
//|  every order is capped at MaxLots; close/modify only touch       |
//|  positions carrying this EA's magic number.                      |
//+------------------------------------------------------------------+
#property copyright "HALO 3EL Autotrader"
#property version   "1.20"

#include <Trade\Trade.mqh>

input string HaloUrl      = "http://127.0.0.1:3000"; // HALO address (no trailing slash)
input string PairingKey   = "";                      // same key as in HALO (24+ characters)
input int    PollMs       = 500;                     // poll interval, milliseconds
input long   Magic        = 303033;                  // magic number on HALO orders
input double MaxLots      = 1.0;                     // hard cap per order
input int    DeviationPts = 50;                      // max slippage, points
input string SymbolSuffix = "";                      // e.g. "m" if gold is XAUUSDm (auto-detected when blank)
input bool   DemoOnly     = true;                    // refuse to trade a real account

CTrade   g_trade;
string   g_results[];       // JSON result objects waiting to be reported
string   g_doneIds[];       // recently executed open ids (never execute twice)
string   g_doneJson[];
bool     g_warnedUrl = false;
datetime g_lastOkLog = 0;
string   g_watchHalo[];   // HALO symbol names HALO asked to stream
string   g_watchMt5[];    // resolved MT5 names (e.g. XAUUSDm)

//+------------------------------------------------------------------+
int OnInit()
  {
   if(StringLen(PairingKey) < 24)
     {
      Alert("HALO Bridge: PairingKey must be at least 24 characters — use the same key as in HALO.");
      return(INIT_PARAMETERS_INCORRECT);
     }
   g_trade.SetExpertMagicNumber(Magic);
   g_trade.SetDeviationInPoints(DeviationPts);
   EventSetMillisecondTimer(MathMax(200, PollMs));
   Print("HALO Bridge started → ", HaloUrl, " · account ", AccountInfoInteger(ACCOUNT_LOGIN), " (", AccountMode(), ")");
   return(INIT_SUCCEEDED);
  }

void OnDeinit(const int reason) { EventKillTimer(); }

//+------------------------------------------------------------------+
string AccountMode()
  {
   long m = AccountInfoInteger(ACCOUNT_TRADE_MODE);
   if(m == ACCOUNT_TRADE_MODE_DEMO)    return("demo");
   if(m == ACCOUNT_TRADE_MODE_CONTEST) return("contest");
   return("real");
  }

string J(string s)   // JSON string literal
  {
   StringReplace(s, "\\", "\\\\");
   StringReplace(s, "\"", "\\\"");
   StringReplace(s, "\n", " ");
   StringReplace(s, "\r", " ");
   StringReplace(s, "\t", " ");
   return("\"" + s + "\"");
  }

string D(double v, int digits = 8) { return(DoubleToString(v, digits)); }

void PushResult(string json)
  {
   int n = ArraySize(g_results);
   ArrayResize(g_results, n + 1);
   g_results[n] = json;
  }

string Fail(string id, string err) { return("{\"id\":" + J(id) + ",\"ok\":false,\"error\":" + J(err) + "}"); }

//+------------------------------------------------------------------+
//| symbol resolution: exact → +suffix → first symbol starting with  |
//+------------------------------------------------------------------+
string ResolveSymbol(string name)
  {
   if(name == "") return("");
   if(SymbolSelect(name, true)) return(name);
   if(SymbolSuffix != "" && SymbolSelect(name + SymbolSuffix, true)) return(name + SymbolSuffix);
   int total = SymbolsTotal(false);
   for(int i = 0; i < total; i++)
     {
      string s = SymbolName(i, false);
      if(StringFind(s, name) == 0 && StringLen(s) <= StringLen(name) + 4)
        {
         if(SymbolSelect(s, true)) return(s);
        }
     }
   return("");
  }

double NormLots(string sym, double lots)
  {
   double step = SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP);
   double vmin = SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN);
   double vmax = MathMin(SymbolInfoDouble(sym, SYMBOL_VOLUME_MAX), MaxLots);
   if(step <= 0) step = 0.01;
   lots = MathFloor(lots / step + 1e-9) * step;
   if(lots > vmax) lots = MathFloor(vmax / step + 1e-9) * step;
   if(lots < vmin) return(0);
   int dg = (int)MathMax(0, MathCeil(-MathLog10(step) - 1e-9));
   return(NormalizeDouble(lots, dg));
  }

//+------------------------------------------------------------------+
//| commands                                                         |
//+------------------------------------------------------------------+
string DoOpen(string id, string symIn, int side, double sl, double tp, string mode,
              double size, double pct, double riskDist, string comment)
  {
   for(int i = 0; i < ArraySize(g_doneIds); i++)
      if(g_doneIds[i] == id) return(g_doneJson[i]);   // already executed — resend the same result

   if(DemoOnly && AccountMode() != "demo") return(Fail(id, "EA DemoOnly: this MT5 account is not a demo account"));
   if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) || !MQLInfoInteger(MQL_TRADE_ALLOWED))
      return(Fail(id, "Algo Trading is switched off in MT5"));
   string sym = ResolveSymbol(symIn);
   if(sym == "") return(Fail(id, "symbol not found in MT5: " + symIn));

   double lots = 0;
   if(mode == "percent")
     {
      double tickSize  = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_SIZE);
      double tickValue = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_VALUE_LOSS);
      if(tickValue <= 0) tickValue = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_VALUE);
      if(tickSize <= 0 || tickValue <= 0 || riskDist <= 0 || pct <= 0) return(Fail(id, "cannot size by % risk (tick data or SL distance missing)"));
      double riskMoney  = AccountInfoDouble(ACCOUNT_EQUITY) * pct / 100.0;
      double lossPerLot = riskDist / tickSize * tickValue;
      lots = riskMoney / lossPerLot;
     }
   else lots = size;
   lots = NormLots(sym, lots);
   if(lots <= 0) return(Fail(id, "order size below the broker's minimum lot"));

   int dg = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   sl = sl > 0 ? NormalizeDouble(sl, dg) : 0;
   tp = tp > 0 ? NormalizeDouble(tp, dg) : 0;
   g_trade.SetTypeFillingBySymbol(sym);
   // HALO's order id as the MT5 comment: the position and its deals carry it,
   // so an unconfirmed order can be looked up by reference ("lookup")
   string cm = StringSubstr(id, 0, 31);

   bool sent = side == 1 ? g_trade.Buy(lots, sym, 0, sl, tp, cm) : g_trade.Sell(lots, sym, 0, sl, tp, cm);
   uint rc = g_trade.ResultRetcode();
   string json;
   if(sent && (rc == TRADE_RETCODE_DONE || rc == TRADE_RETCODE_PLACED || rc == TRADE_RETCODE_DONE_PARTIAL))
     {
      ulong ticket = g_trade.ResultOrder();
      json = "{\"id\":" + J(id) + ",\"ok\":true,\"orderId\":" + J(IntegerToString((long)ticket)) +
             ",\"price\":" + D(g_trade.ResultPrice()) + ",\"volume\":" + D(g_trade.ResultVolume(), 4) + "}";
      Print("HALO Bridge: ", side == 1 ? "BUY " : "SELL ", D(lots, 2), " ", sym, " @ ", D(g_trade.ResultPrice(), dg), " SL ", D(sl, dg), " TP ", D(tp, dg));
     }
   else
      json = Fail(id, "MT5 " + IntegerToString((int)rc) + ": " + g_trade.ResultRetcodeDescription());

   int n = ArraySize(g_doneIds);
   if(n >= 50) { ArrayRemove(g_doneIds, 0, 1); ArrayRemove(g_doneJson, 0, 1); n--; }
   ArrayResize(g_doneIds, n + 1);
   ArrayResize(g_doneJson, n + 1);
   g_doneIds[n] = id;
   g_doneJson[n] = json;
   return(json);
  }

string DoClose(string id, string symIn, int side)
  {
   string sym = symIn == "" ? "" : ResolveSymbol(symIn);
   if(symIn != "" && sym == "") return(Fail(id, "symbol not found in MT5: " + symIn));
   int closed = 0, failed = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0 || PositionGetInteger(POSITION_MAGIC) != Magic) continue;
      if(sym != "" && PositionGetString(POSITION_SYMBOL) != sym) continue;
      int ps = PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? 1 : -1;
      if(side != 0 && ps != side) continue;
      if(g_trade.PositionClose(t)) closed++; else failed++;
     }
   if(failed > 0) return(Fail(id, "could not close " + IntegerToString(failed) + " position(s): " + g_trade.ResultRetcodeDescription()));
   return("{\"id\":" + J(id) + ",\"ok\":true,\"volume\":" + IntegerToString(closed) + "}");
  }

string DoModify(string id, string ticketStr, string slStr, string tpStr)
  {
   ulong t = (ulong)StringToInteger(ticketStr);
   if(t == 0 || !PositionSelectByTicket(t)) return(Fail(id, "position not found: " + ticketStr));
   if(PositionGetInteger(POSITION_MAGIC) != Magic) return(Fail(id, "position was not opened by HALO"));
   string sym = PositionGetString(POSITION_SYMBOL);
   int dg = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   double sl = slStr == "" ? PositionGetDouble(POSITION_SL) : NormalizeDouble(StringToDouble(slStr), dg);
   double tp = tpStr == "" ? PositionGetDouble(POSITION_TP) : NormalizeDouble(StringToDouble(tpStr), dg);
   if(!g_trade.PositionModify(t, sl, tp)) return(Fail(id, "MT5: " + g_trade.ResultRetcodeDescription()));
   return("{\"id\":" + J(id) + ",\"ok\":true}");
  }

string DoPositions(string id, string symIn)
  {
   string sym = symIn == "" ? "" : ResolveSymbol(symIn);
   string arr = "";
   for(int i = 0; i < PositionsTotal(); i++)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0) continue;
      string ps = PositionGetString(POSITION_SYMBOL);
      if(symIn != "" && ps != sym) continue;
      int dg = (int)SymbolInfoInteger(ps, SYMBOL_DIGITS);
      if(arr != "") arr += ",";
      arr += "{\"id\":" + J(IntegerToString((long)t)) +
             ",\"symbol\":" + J(ps) +
             ",\"side\":" + (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? "1" : "-1") +
             ",\"volume\":" + D(PositionGetDouble(POSITION_VOLUME), 4) +
             ",\"entryPrice\":" + D(PositionGetDouble(POSITION_PRICE_OPEN), dg) +
             ",\"sl\":" + D(PositionGetDouble(POSITION_SL), dg) +
             ",\"tp\":" + D(PositionGetDouble(POSITION_TP), dg) +
             ",\"currentPrice\":" + D(PositionGetDouble(POSITION_PRICE_CURRENT), dg) +
             ",\"profit\":" + D(PositionGetDouble(POSITION_PROFIT), 2) +
             ",\"swap\":" + D(PositionGetDouble(POSITION_SWAP), 2) +
             ",\"openTime\":" + IntegerToString((long)PositionGetInteger(POSITION_TIME_MSC)) +
             ",\"comment\":" + J(PositionGetString(POSITION_COMMENT)) +
             ",\"ea\":" + (PositionGetInteger(POSITION_MAGIC) == Magic ? "true" : "false") + "}";
     }
   return("{\"id\":" + J(id) + ",\"ok\":true,\"positions\":[" + arr + "]}");
  }

string DoQuote(string id, string symIn)
  {
   string sym = ResolveSymbol(symIn);
   if(sym == "") return(Fail(id, "symbol not found in MT5: " + symIn));
   MqlTick tk;
   if(!SymbolInfoTick(sym, tk) || tk.bid <= 0) return(Fail(id, "no tick for " + sym));
   int dg = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   // tick time is broker server time; report the moment we read it (UTC ms)
   long nowMs = (long)TimeGMT() * 1000;
   return("{\"id\":" + J(id) + ",\"ok\":true,\"bid\":" + D(tk.bid, dg) + ",\"ask\":" + D(tk.ask, dg) +
          ",\"time\":" + IntegerToString(nowMs) + "}");
  }

// is `c` this order id? (some brokers append to comments, so match the prefix)
bool CommentIs(string c, string id) { return(StringLen(id) > 0 && StringFind(c, id) == 0); }

string DoLookup(string id, string orderId)
  {
   for(int i = 0; i < PositionsTotal(); i++)
     {
      ulong t = PositionGetTicket(i);
      if(t != 0 && CommentIs(PositionGetString(POSITION_COMMENT), orderId))
         return("{\"id\":" + J(id) + ",\"ok\":true,\"status\":\"open\",\"orderId\":" + J(IntegerToString((long)t)) + ",\"detail\":" + J("position is open") + "}");
     }
   if(HistorySelect(TimeCurrent() - 14 * 86400, TimeCurrent() + 86400))
     {
      for(int i = HistoryDealsTotal() - 1; i >= 0; i--)
        {
         ulong d = HistoryDealGetTicket(i);
         if(d == 0 || HistoryDealGetInteger(d, DEAL_ENTRY) != DEAL_ENTRY_IN) continue;
         if(CommentIs(HistoryDealGetString(d, DEAL_COMMENT), orderId))
            return("{\"id\":" + J(id) + ",\"ok\":true,\"status\":\"closed\",\"orderId\":" + J(IntegerToString((long)HistoryDealGetInteger(d, DEAL_POSITION_ID))) + ",\"detail\":" + J("filled; position already closed") + "}");
        }
     }
   for(int i = 0; i < ArraySize(g_doneIds); i++)
      if(g_doneIds[i] == orderId && StringFind(g_doneJson[i], "\"ok\":false") >= 0)
         return("{\"id\":" + J(id) + ",\"ok\":true,\"status\":\"absent\",\"detail\":" + J("the EA tried it and MT5 rejected it") + "}");
   return("{\"id\":" + J(id) + ",\"ok\":true,\"status\":\"absent\",\"detail\":" + J("no position or deal with this order id in the last 14 days") + "}");
  }

// broker server time → UTC (whole hours; TimeGMT comes from this PC's clock)
long ServerOffsetSec() { return((long)MathRound((double)(TimeTradeServer() - TimeGMT()) / 3600.0) * 3600); }

ENUM_TIMEFRAMES TfOf(string tf)
  {
   if(tf == "1m")  return(PERIOD_M1);
   if(tf == "3m")  return(PERIOD_M3);
   if(tf == "5m")  return(PERIOD_M5);
   if(tf == "15m") return(PERIOD_M15);
   if(tf == "30m") return(PERIOD_M30);
   if(tf == "1h")  return(PERIOD_H1);
   if(tf == "2h")  return(PERIOD_H2);
   if(tf == "4h")  return(PERIOD_H4);
   if(tf == "1d")  return(PERIOD_D1);
   return(PERIOD_CURRENT);
  }

string DoWatch(string id, string symIn)
  {
   for(int i = 0; i < ArraySize(g_watchHalo); i++)
      if(g_watchHalo[i] == symIn) return("{\"id\":" + J(id) + ",\"ok\":true}");
   string sym = ResolveSymbol(symIn);
   if(sym == "") return(Fail(id, "symbol not found in MT5: " + symIn));
   int n = ArraySize(g_watchHalo);
   if(n >= 8) { ArrayRemove(g_watchHalo, 0, 1); ArrayRemove(g_watchMt5, 0, 1); n--; }
   ArrayResize(g_watchHalo, n + 1);
   ArrayResize(g_watchMt5, n + 1);
   g_watchHalo[n] = symIn;
   g_watchMt5[n] = sym;
   return("{\"id\":" + J(id) + ",\"ok\":true,\"detail\":" + J("streaming " + sym) + "}");
  }

string DoHistory(string id, string symIn, string tf, int count)
  {
   string sym = ResolveSymbol(symIn);
   if(sym == "") return(Fail(id, "symbol not found in MT5: " + symIn));
   ENUM_TIMEFRAMES p = TfOf(tf);
   if(p == PERIOD_CURRENT) return(Fail(id, "unsupported timeframe " + tf));
   count = MathMax(2, MathMin(count, 1500));
   MqlRates r[];
   ArraySetAsSeries(r, false);
   int got = CopyRates(sym, p, 0, count, r);
   if(got <= 0) return(Fail(id, "no history for " + sym + " " + tf + " (" + IntegerToString(GetLastError()) + ")"));
   long off = ServerOffsetSec();
   int dg = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   string bars = "";
   for(int i = 0; i < got; i++)
     {
      if(i > 0) bars += ",";
      bars += "[" + IntegerToString(((long)r[i].time - off) * 1000) + "," + D(r[i].open, dg) + "," + D(r[i].high, dg) + "," + D(r[i].low, dg) + "," + D(r[i].close, dg) + "]";
     }
   return("{\"id\":" + J(id) + ",\"ok\":true,\"detail\":" + J(sym) + ",\"bars\":[" + bars + "]}");
  }

string TicksJson()
  {
   long offMs = ServerOffsetSec() * 1000;
   string out = "";
   for(int i = 0; i < ArraySize(g_watchMt5); i++)
     {
      MqlTick tk;
      if(!SymbolInfoTick(g_watchMt5[i], tk) || tk.bid <= 0) continue;
      int dg = (int)SymbolInfoInteger(g_watchMt5[i], SYMBOL_DIGITS);
      if(out != "") out += ",";
      out += "{\"s\":" + J(g_watchHalo[i]) + ",\"b\":" + D(tk.bid, dg) + ",\"a\":" + D(tk.ask, dg) + ",\"t\":" + IntegerToString((long)tk.time_msc - offMs) + "}";
     }
   return(out);
  }

void Execute(string line)
  {
   string f[];
   if(StringSplit(line, '\t', f) < 12) return;
   string id = f[0], action = f[1];
   string json;
   if(action == "open")           json = DoOpen(id, f[2], (int)StringToInteger(f[3]), StringToDouble(f[4]), StringToDouble(f[5]),
                                                f[6], StringToDouble(f[7]), StringToDouble(f[8]), StringToDouble(f[9]), f[11]);
   else if(action == "close")     json = DoClose(id, f[2], (int)StringToInteger(f[3]));
   else if(action == "modify")    json = DoModify(id, f[10], f[4], f[5]);
   else if(action == "positions") json = DoPositions(id, f[2]);
   else if(action == "quote")     json = DoQuote(id, f[2]);
   else if(action == "lookup")    json = DoLookup(id, f[10]);
   else if(action == "watch")     json = DoWatch(id, f[2]);
   else if(action == "history")   json = DoHistory(id, f[2], f[6], (int)StringToInteger(f[7]));
   else if(action == "ping")      json = "{\"id\":" + J(id) + ",\"ok\":true}";
   else                           json = Fail(id, "unknown action " + action);
   PushResult(json);
  }

//+------------------------------------------------------------------+
string AccountJson()
  {
   return("{\"login\":" + J(IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN))) +
          ",\"server\":" + J(AccountInfoString(ACCOUNT_SERVER)) +
          ",\"company\":" + J(AccountInfoString(ACCOUNT_COMPANY)) +
          ",\"currency\":" + J(AccountInfoString(ACCOUNT_CURRENCY)) +
          ",\"balance\":" + D(AccountInfoDouble(ACCOUNT_BALANCE), 2) +
          ",\"equity\":" + D(AccountInfoDouble(ACCOUNT_EQUITY), 2) +
          ",\"margin\":" + D(AccountInfoDouble(ACCOUNT_MARGIN), 2) +
          ",\"freeMargin\":" + D(AccountInfoDouble(ACCOUNT_MARGIN_FREE), 2) +
          ",\"leverage\":" + IntegerToString(AccountInfoInteger(ACCOUNT_LEVERAGE)) +
          ",\"mode\":" + J(AccountMode()) + "}");
  }

void OnTimer()
  {
   string res = "";
   int n = ArraySize(g_results);
   for(int i = 0; i < n; i++) res += (i > 0 ? "," : "") + g_results[i];
   string body = "{\"account\":" + AccountJson() + ",\"results\":[" + res + "],\"ticks\":[" + TicksJson() + "]}";

   char data[], result[];
   string respHeaders;
   int len = StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8);
   if(len > 0) ArrayResize(data, len - 1);   // drop the trailing \0
   string headers = "Content-Type: application/json\r\nX-HALO-EA-KEY: " + PairingKey + "\r\n";

   ResetLastError();
   int code = WebRequest("POST", HaloUrl + "/api/bridge/mt5", headers, 3000, data, result, respHeaders);
   if(code == -1)
     {
      int err = GetLastError();
      if(err == 4014 && !g_warnedUrl)
        {
         g_warnedUrl = true;
         Alert("HALO Bridge: add ", HaloUrl, " under Tools → Options → Expert Advisors → Allow WebRequest for listed URL.");
        }
      return;   // results stay queued and go out on the next successful poll
     }
   if(code != 200)
     {
      if(TimeCurrent() - g_lastOkLog > 30) { Print("HALO Bridge: HALO answered HTTP ", code); g_lastOkLog = TimeCurrent(); }
      return;
     }
   ArrayResize(g_results, 0);   // delivered

   string text = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   string lines[];
   int k = StringSplit(text, '\n', lines);
   for(int i = 0; i < k; i++)
      if(StringLen(lines[i]) > 0) Execute(lines[i]);
  }
//+------------------------------------------------------------------+
