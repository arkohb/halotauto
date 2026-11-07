// ════════════════════════════════════════════════════════════════════════
//  METAAPI CORE · server-only platform layer (zero-manual-api edition)
//
//  The MetaApi cloud API is BUILT INTO HALO. Traders never add API keys:
//  they paste their MT4/MT5 login · password · server and this module
//  provisions + deploys + trades the account with the platform key that
//  comes from the METAAPI_TOKEN server secret (never stored in source).
//
//  Wire format per official metaapi.cloud SDK v29 (agiliumtrade-ai):
//    · auth header ........ "auth-token: <jwt>"   (NOT auth-auth0)
//    · management base .... CURRENT PRODUCTION HOST FIRST:
//        https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai
//      (api.metaapi.cloud's vhost is decommissioned — it serves a k8s
//      default fake cert + nginx 404 for everyone; ln.ln.ai kept as a
//      fallback for new-platform accounts)
//    · create account ..... POST  /users/current/accounts
//    · deploy ............. POST  /users/current/accounts/:id/deploy
//    · account entity ..... GET   /users/current/accounts/:id
//                            → { _id, state, connectionStatus, region … }
//    · trading (client) ... https://mt-client-api-v1.{region}.agiliumtrade.ai
//        GET    /users/current/accounts/:id/account-information
//        GET    /users/current/accounts/:id/positions
//        POST   /users/current/accounts/:id/orders
//        DELETE /users/current/accounts/:id/positions/:positionId
//        GET    /users/current/accounts/:id/symbols/:sym/specification
//
//  TLS: every MetaApi call uses full certificate validation (chain AND
//  hostname). The live provisioning and client hosts pass strict checks
//  (verified 2026-11-02). The legacy api.metaapi.cloud host serves a
//  self-signed certificate — with strict TLS it simply fails and the next
//  domain is tried, so the auth token is never sent to it.
//
//  Env knobs (all optional — the defaults are production-correct):
//    METAAPI_TOKEN ........ platform key (required for MT4/MT5 via MetaApi)
//    METAAPI_DOMAIN ....... management domain (default auto: metaapi.cloud,
//                           then ln.ln.ai)
//    METAAPI_CLIENT_BASE .. full trading-API base override (stub/CI tests)
//    METAAPI_MGMT_BASE .... full management-API base override (stub/CI tests)
//    METAAPI_PROXY ........ HTTP(S) proxy URL for hosts whose egress firewall
//                           blocks MetaApi (also accepts HALO_EGRESS_PROXY /
//                           HTTPS_PROXY). All MetaApi traffic tunnels through
//                           it via CONNECT — the escape hatch for locked-down
//                           hosting (sandbox/PaaS egress allow-lists).
//  EGRESS NOTE: some sandboxed hosts hijack non-allow-listed domains at the
//  DNS/TLS layer (k8s default-backend fake certificate "O=Acme Co"). No code
//  can bypass that — the host itself answers instead of MetaApi. Detection:
//  friendlyMetaApiError spots the hijack and tells the operator exactly what
//  to set. With a working proxy the integration runs unmodified.
// ════════════════════════════════════════════════════════════════════════

import { jfetch, num } from "./types";

export const METAAPI_MAGIC = 300311;

/** platform key — server secret METAAPI_TOKEN only (never in source) */
export function platformToken(): string {
  return String(process.env.METAAPI_TOKEN ?? "").trim();
}

/** does a JWT-shaped platform key exist AND decode with a future exp? */
export function platformKeyStatus(): {
  present: boolean;
  jwtValid: boolean;
  expiresAt: number | null;
  source: "env" | "baked" | "none";
} {
  const t = platformToken();
  if (!t) return { present: false, jwtValid: false, expiresAt: null, source: "none" };
  const source = String(process.env.METAAPI_TOKEN ?? "").trim() ? "env" : "baked";
  const parts = t.split(".");
  if (parts.length !== 3) return { present: true, jwtValid: false, expiresAt: null, source };
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as { exp?: number };
    const exp = Number(payload.exp ?? 0) || null;
    return { present: true, jwtValid: !exp || exp * 1000 > Date.now(), expiresAt: exp ? exp * 1000 : null, source };
  } catch {
    return { present: true, jwtValid: false, expiresAt: null, source };
  }
}

// ── domain handling · production mgmt host first, legacy + new platform next ──

const DEFAULT_MGMT_BASES = [
  "https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai", // current production management API
  "https://api.metaapi.cloud", // legacy — vhost decommissioned, kept as fallback
  "https://api.ln.ln.ai", // new-platform fallback
];

function mgmtBases(): string[] {
  const override = String(process.env.METAAPI_MGMT_BASE ?? "").trim();
  if (override) return override.split(",").map((b) => b.replace(/\/$/, ""));
  const forced = String(process.env.METAAPI_DOMAIN ?? "").trim();
  if (forced) return [forced.startsWith("http") ? forced.replace(/\/$/, "") : `https://api.${forced}`];
  return DEFAULT_MGMT_BASES;
}

/** client-API host candidates: forced domain first, then the alternates.
 *  Accounts provisioned on the new platform live under ln.ln.ai while
 *  classic ones live under agiliumtrade.ai — we try both automatically. */
function clientBases(region: string): string[] {
  const override = String(process.env.METAAPI_CLIENT_BASE ?? "").trim();
  if (override) return [override.replace(/\/$/, "")];
  const forced = String(process.env.METAAPI_DOMAIN ?? "").trim();
  const domains = forced ? [forced] : ["agiliumtrade.ai", "ln.ln.ai"];
  return domains.map((d) => `https://mt-client-api-v1.${region || "new-york"}.${d}`);
}

// per-account resolved client base (avoids retrying dead hosts on every call)
const resolvedClientBase = new Map<string, string>();

/** run a client-API GET/POST against the working host for this account */
async function clientCall<T>(
  accountId: string,
  region: string,
  path: string,
  init: MFetchInit = {},
  token?: string
): Promise<T> {
  const key = `${accountId}:${region}`;
  const cached = resolvedClientBase.get(key);
  const bases = cached ? [cached] : clientBases(region);
  let lastErr: unknown = null;
  let firstHttpErr: unknown = null;
  for (const base of bases) {
    try {
      const res = await mFetch<T>(`${base}/users/current/accounts/${encodeURIComponent(accountId)}${path}`, {
        ...init,
        token: init.token ?? token,
      });
      resolvedClientBase.set(key, base);
      return res;
    } catch (e) {
      lastErr = e;
      const msg = errChain(e);
      // 401/valid-auth errors are host-independent — don't retry other hosts
      if (/invalid auth-token|UnauthorizedError/i.test(msg)) throw e;
      // remember the first real HTTP answer — it explains the actual problem
      // (e.g. "account is not connected to broker yet") better than a dead
      // fallback host's timeout that would otherwise mask it
      if (/HTTP \d{3}/.test(msg) && !firstHttpErr) firstHttpErr = e;
      // 404 on a REAL endpoint shape may mean wrong-region/wrong-domain host
      if (/HTTP 404/.test(msg) && /not found|is not found/i.test(msg)) continue;
      if (/HTTP 4|HTTP 5/i.test(msg)) continue;
      continue;
    }
  }
  throw firstHttpErr ?? lastErr;
}

// ── egress-proxy escape hatch ──────────────────────────────────────────
// Locked-down hosts (sandbox / PaaS egress allow-lists) hijack MetaApi
// domains at the TLS layer — only a proxy that CAN reach MetaApi fixes
// that. Set METAAPI_PROXY=http(s)://host:port (HALO_EGRESS_PROXY and the
// standard HTTPS_PROXY are also honoured) and every MetaApi call tunnels
// through CONNECT automatically. TLS stays end-to-end and fully verified.

export function proxyUri(): string {
  return (
    String(process.env.METAAPI_PROXY ?? "").trim() ||
    String(process.env.HALO_EGRESS_PROXY ?? "").trim() ||
    String(process.env.HTTPS_PROXY ?? process.env.https_proxy ?? "").trim()
  );
}

let proxyAgent: unknown = null;
async function egressDispatcher(): Promise<unknown> {
  const uri = proxyUri();
  if (!uri) return undefined; // direct: Node's default, strictly verified TLS
  if (proxyAgent === null) {
    try {
      const undici = (await import("undici")) as {
        ProxyAgent: new (o: object) => unknown;
      };
      proxyAgent = new undici.ProxyAgent({ uri });
    } catch {
      proxyAgent = false; // undici unavailable — plain fetch fallback
    }
  }
  return proxyAgent || undefined;
}

/** full error message including the fetch cause chain (Node hides TLS errors in e.cause) */
export function errChain(e: unknown): string {
  const parts: string[] = [];
  let cur: unknown = e;
  for (let i = 0; cur && i < 6; i++) {
    const m = String((cur as Error).message ?? cur);
    if (m) parts.push(m);
    cur = (cur as Error).cause;
  }
  return parts.join(" | ") || String(e);
}

export interface MFetchInit {
  method?: string;
  body?: unknown;
  token?: string;
  timeoutMs?: number;
}

/** MetaApi JSON request: strictly verified TLS (optionally via the egress
 *  proxy) + auth-token header. Returns HTTP-level errors untouched so
 *  callers can distinguish 4xx/5xx. */
export async function mFetch<T = Record<string, unknown>>(url: string, init: MFetchInit = {}): Promise<T> {
  const token = init.token ?? platformToken();
  if (!token) throw new Error("MetaApi is not configured — set the METAAPI_TOKEN server secret.");
  const headers: Record<string, string> = {
    "auth-token": token,
    "Content-Type": "application/json",
  };
  const method = init.method ?? "GET";
  const body = init.body !== undefined ? JSON.stringify(init.body) : undefined;
  const dispatcher = await egressDispatcher();
  const doFetch = (extra?: Record<string, unknown>) =>
    jfetch(url, { method, headers, body, ...(extra ?? {}) }, init.timeoutMs ?? 20000);

  return (await doFetch(dispatcher ? { dispatcher } : undefined)) as T;
}

/** map raw MetaApi/network errors to trader-actionable messages */
export function friendlyMetaApiError(e: unknown, ctx = ""): string {
  const msg = errChain(e);
  if (/invalid auth-token/i.test(msg))
    return "MetaApi rejected the platform token (invalid or revoked). Paste a fresh token from app.metaapi.cloud under ADVANCED → TOKEN OVERRIDE, or ask the operator to update the METAAPI_TOKEN secret.";
  if (/ACCOUNT_UNAUTHORIZED|auth.*reject|login.*password/i.test(msg) || (ctx === "deploy" && /DEPLOY_FAILED/i.test(msg)))
    return "Your MT login, password or server was rejected by the broker — open your MT4/MT5 terminal and double-check all three (use the MASTER password, not the investor password).";
  if (/HTTP 404/.test(msg) && ctx === "account")
    return "MetaApi does not know this account id — it may have been deleted on app.metaapi.cloud.";
  if (/HTTP 402|Payment Required|billing|quota|top up|high reliability/i.test(msg))
    return "MetaApi refused to create or start the cloud MT connection until the MetaApi account (the token owner's) has funds. Open app.metaapi.cloud → Billing, add the minimum top-up, then press CONNECT again — HALO reuses the cloud account if MetaApi kept one, otherwise it creates it then.";
  if (/HTTP 429|rate limit/i.test(msg))
    return "MetaApi rate limit hit — wait ~30 seconds and press TEST again.";
  if (/is not connected to broker yet|does not match the account region/i.test(msg))
    return "The cloud server for this MT account is not connected to the broker yet — the deployment is still starting or it failed. Press TEST again in a minute; if it keeps failing, press CONNECT once more (HALO redeploys the existing connection automatically) and check the master password.";
  // egress firewall hijack signature: the host answers with a k8s default
  // backend / fake ingress cert instead of MetaApi — nothing code-side can
  // reach the real API without a proxy or a different host
  if (/default backend|Fake Certificate|Kubernetes Ingress/i.test(msg))
    return "This host's egress firewall is intercepting MetaApi traffic — the connection is answered by the host's own proxy (k8s default backend) instead of MetaApi cloud. Fix: set METAAPI_PROXY=http(s)://host:port to a proxy that can reach MetaApi (HALO_EGRESS_PROXY / HTTPS_PROXY also honoured), or deploy HALO on a host with open internet egress, then press CONNECT again. Your MT credentials and the cloud connection stay saved.";
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|Unable to connect|abort|Connect Timeout/i.test(msg))
    return "MetaApi cloud could not be reached from this server — the host network is blocking the connection (TLS/egress firewall). Fix: set METAAPI_PROXY=http(s)://host:port to a proxy that can reach MetaApi, or run HALO on a host with open internet egress (METAAPI_MGMT_BASE / METAAPI_CLIENT_BASE relay overrides also work), then press CONNECT again.";
  return msg;
}

/** live reachability check for the UI badge — any HTTP answer (incl. 401) means reachable */
export async function mgmtReachable(token?: string): Promise<{ ok: boolean; httpSeen: boolean }> {
  for (const base of mgmtBases()) {
    try {
      await mFetch(`${base}/users/current/accounts`, { timeoutMs: 9000, token });
      return { ok: true, httpSeen: true };
    } catch (e) {
      if (/HTTP \d{3}/.test(errChain(e))) return { ok: true, httpSeen: true };
    }
  }
  return { ok: false, httpSeen: false };
}

// ── management API (provisioning) ────────────────────────────────────────

export interface MtAccountEntity {
  _id?: string;
  id?: string;
  login?: string;
  server?: string;
  platform?: string;
  name?: string;
  region?: string;
  state?: string;
  connectionStatus?: string;
  magic?: number;
}

/** POST /accounts then POST /deploy then poll the account entity (bounded). */
export async function provisionMtAccount(opts: {
  login: string;
  password: string;
  server: string;
  platform: "mt4" | "mt5";
  name?: string;
  region?: string;
  token?: string;
  pollMs?: number;
}): Promise<{ accountId: string; region: string; state: string; connected: boolean; deployed: boolean; reused?: boolean }> {
  const { login, password, server, platform, name, region, token, pollMs = 42000 } = opts;
  const body: Record<string, unknown> = {
    login,
    password,
    server,
    platform,
    name: name || `HALO 3EL · ${server}`,
    magic: METAAPI_MAGIC,
  };
  if (region) body.region = region;

  const mgmt = () => mgmtBases()[0];

  // ── 0) REUSE an existing cloud account for the same login+server ──
  // Creating a duplicate hits MetaApi's free-tier top-up wall; the account
  // from a previous attempt can be deployed / repaired instead.
  try {
    const list = await mFetch<MtAccountEntity[]>(`${mgmt()}/users/current/accounts`, { token, timeoutMs: 15000 });
    const match = (Array.isArray(list) ? list : []).find(
      (a) =>
        String(a.login ?? "") === login &&
        String(a.server ?? "") === server &&
        (!a.platform || String(a.platform).toLowerCase().includes(platform))
    );
    const reuseId = String(match?._id ?? match?.id ?? "");
    if (reuseId) {
      const reuseRegion = String(match?.region ?? region ?? "new-york");
      let state = String(match?.state ?? "");
      // credentials repair: after a failed deploy the stored password is suspect —
      // refresh it with what the trader just typed, then redeploy
      if (state === "DEPLOY_FAILED" && password) {
        await mFetch(`${mgmt()}/users/current/accounts/${encodeURIComponent(reuseId)}`, {
          method: "PUT",
          body: { login, password, server, platform, name: name || match?.name || `HALO 3EL · ${server}` },
          token,
          timeoutMs: 15000,
        }).catch(() => {}); // best-effort — deploy below decides the outcome
      }
      const deployPath = state === "DEPLOYED" ? "redeploy" : "deploy";
      let reuseDeployErr: unknown = null;
      try {
        await mFetch(`${mgmt()}/users/current/accounts/${encodeURIComponent(reuseId)}/${deployPath}`, {
          method: "POST",
          body: {},
          token,
          timeoutMs: 25000,
        });
      } catch (e) {
        reuseDeployErr = e;
      }
      // hard blocks (billing top-up, validation) surface immediately —
      // polling an UNDEPLOYED account would only waste a minute and mask them
      const rdMsg = reuseDeployErr ? errChain(reuseDeployErr) : "";
      if (reuseDeployErr && /HTTP 4\d\d/.test(rdMsg) && !/HTTP 409|already deployed/i.test(rdMsg)) {
        throw reuseDeployErr;
      }
      let connected = false;
      let deployed = false;
      const deadline = Date.now() + pollMs;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 4000));
        try {
          const acct = await mFetch<MtAccountEntity>(
            `${mgmt()}/users/current/accounts/${encodeURIComponent(reuseId)}`,
            { token, timeoutMs: 15000 }
          );
          state = String(acct.state ?? "");
          connected = acct.connectionStatus === "CONNECTED";
          if (state === "DEPLOYED") {
            deployed = true;
            break;
          }
          if (state === "DEPLOY_FAILED") break;
        } catch {
          // transient poll errors — keep polling
        }
      }
      return { accountId: reuseId, region: reuseRegion, state, connected, deployed, reused: true };
    }
  } catch {
    // listing failed (network/quota) — fall through to the create path
  }

  let created: { id?: string; _id?: string; region?: string } | null = null;
  let lastErr: Error | null = null;
  for (const base of mgmtBases()) {
    try {
      created = await mFetch<{ id?: string; _id?: string; region?: string }>(`${base}/users/current/accounts`, {
        method: "POST",
        body,
        token,
        timeoutMs: 25000,
      });
      if (created?.id || created?._id) break; // this base works — stick with it
    } catch (e) {
      lastErr = e as Error;
      const msg = errChain(e);
      // credential-shaped failures should not silently retry the next domain
      if (!/HTTP 5|fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|Unable to connect|404|first certificate|unable to verify|Connect Timeout/i.test(msg))
        throw new Error(friendlyMetaApiError(e));
    }
  }
  const accountId = String(created?.id ?? created?._id ?? "");
  if (!accountId) throw new Error(friendlyMetaApiError(lastErr ?? new Error("MetaApi did not return an account id")));

  const acctRegion = String(created?.region ?? region ?? "new-york");

  // remember which management base accepted us for subsequent polls
  const workingBase = String(process.env.METAAPI_MGMT_BASE ?? "").trim()
    ? mgmtBases()[0]
    : await pickWorkingBase(token);

  // deploy (POST per official SDK) — capture hard blocks (e.g. billing top-up)
  let deployed = false;
  let connected = false;
  let state = "CREATED";
  let deployErr: unknown = null;
  try {
    await mFetch(`${workingBase}/users/current/accounts/${encodeURIComponent(accountId)}/deploy`, {
      method: "POST",
      body: {},
      token,
      timeoutMs: 25000,
    });
  } catch (e) {
    const msg = errChain(e);
    if (!/already deployed|409/i.test(msg)) deployErr = e;
  }
  const cMsg = deployErr ? errChain(deployErr) : "";
  if (deployErr && /HTTP 4\d\d/.test(cMsg) && !/HTTP 409|already deployed/i.test(cMsg)) {
    throw deployErr; // e.g. MetaApi billing top-up requirement — show it to the trader
  }

  // poll the account entity until DEPLOYED / connected or budget exhausted
  const deadline = Date.now() + pollMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 4000));
    try {
      const acct = await mFetch<MtAccountEntity>(
        `${workingBase}/users/current/accounts/${encodeURIComponent(accountId)}`,
        { token, timeoutMs: 15000 }
      );
      state = String(acct.state ?? "");
      connected = acct.connectionStatus === "CONNECTED";
      if (state === "DEPLOYED") {
        deployed = true;
        break;
      }
      if (state === "DEPLOY_FAILED") break;
    } catch {
      // transient poll errors — keep polling
    }
  }
  return { accountId, region: acctRegion, state, connected, deployed };
}

async function pickWorkingBase(token?: string): Promise<string> {
  const bases = mgmtBases();
  if (bases.length === 1) return bases[0];
  for (const base of bases) {
    try {
      await mFetch(`${base}/users/current/accounts`, { token, timeoutMs: 8000 });
      return base;
    } catch {
      // try next domain
    }
  }
  return bases[0];
}

/** read one account entity from the management API (state/region/replicas) */
export async function getMtAccountEntity(accountId: string, token?: string): Promise<MtAccountEntity | null> {
  const base = String(process.env.METAAPI_MGMT_BASE ?? "").trim() ? mgmtBases()[0] : await pickWorkingBase(token);
  try {
    return await mFetch<MtAccountEntity>(`${base}/users/current/accounts/${encodeURIComponent(accountId)}`, {
      token,
      timeoutMs: 15000,
    });
  } catch {
    return null;
  }
}

// ── trading (client) API ────────────────────────────────────────────────

export interface MtAccountInformation {
  broker?: string;
  currency?: string;
  accountNumber?: number;
  balance?: number;
  equity?: number;
  margin?: number;
  freeMargin?: number;
  marginLevel?: number;
  leverage?: number;
  server?: string;
  platform?: string;
  status?: string;
  state?: string;
}

export async function mtAccountInformation(
  accountId: string,
  region: string,
  token?: string
): Promise<MtAccountInformation> {
  return clientCall<MtAccountInformation>(accountId, region, "/account-information", { timeoutMs: 20000 }, token);
}

export async function mtPositions(accountId: string, region: string, token?: string): Promise<Record<string, unknown>[]> {
  const j = await clientCall<Record<string, unknown>[]>(accountId, region, "/positions", { timeoutMs: 20000 }, token);
  return Array.isArray(j) ? j : [];
}

/** history orders in a time window (each carries the clientId it was sent with) */
export async function mtHistoryOrders(accountId: string, region: string, startIso: string, endIso: string, token?: string): Promise<Record<string, unknown>[]> {
  const j = await clientCall<Record<string, unknown>[] | { historyOrders?: Record<string, unknown>[] }>(
    accountId,
    region,
    `/history-orders/time/${encodeURIComponent(startIso)}/${encodeURIComponent(endIso)}`,
    { timeoutMs: 20000 },
    token
  );
  return Array.isArray(j) ? j : (j.historyOrders ?? []);
}

export async function mtSymbolSpec(
  accountId: string,
  region: string,
  symbol: string,
  token?: string
): Promise<{ contractSize: number; digits: number; volumeMin: number; volumeStep: number }> {
  try {
    const j = await clientCall<Record<string, unknown>>(
      accountId,
      region,
      `/symbols/${encodeURIComponent(symbol)}/specification`,
      { timeoutMs: 20000 },
      token
    );
    return {
      contractSize: num(j.contractSize, 100000) || 100000,
      digits: Math.round(num(j.digits, 2)),
      volumeMin: num(j.volumeMin, 0.01) || 0.01,
      volumeStep: num(j.volumeStep, 0.01) || 0.01,
    };
  } catch {
    return { contractSize: 100000, digits: 2, volumeMin: 0.01, volumeStep: 0.01 };
  }
}

export interface MtOrderResult {
  orderId?: string;
  numericOrderId?: string;
  errorCode?: string;
  description?: string;
  positionId?: string;
}

export async function mtMarketOrder(
  accountId: string,
  region: string,
  order: {
    side: -1 | 1;
    symbol: string;
    volume: number;
    stopLoss?: number;
    takeProfit?: number;
    comment?: string;
    clientId?: string;
  },
  token?: string
): Promise<MtOrderResult> {
  const body: Record<string, unknown> = {
    actionType: order.side === -1 ? "ORDER_TYPE_SELL" : "ORDER_TYPE_BUY",
    symbol: order.symbol,
    volume: order.volume,
    comment: (order.comment ?? "HALO3EL").slice(0, 26),
    clientId: (order.clientId || `halo3el-${Date.now()}`).slice(0, 30),
  };
  if (order.stopLoss && isFinite(order.stopLoss) && order.stopLoss > 0) body.stopLoss = order.stopLoss;
  if (order.takeProfit && isFinite(order.takeProfit) && order.takeProfit > 0) body.takeProfit = order.takeProfit;
  return clientCall<MtOrderResult>(accountId, region, "/orders", { method: "POST", body, timeoutMs: 25000 }, token);
}

export async function mtClosePosition(
  accountId: string,
  region: string,
  positionId: string,
  token?: string
): Promise<MtOrderResult> {
  return clientCall<MtOrderResult>(
    accountId,
    region,
    `/positions/${encodeURIComponent(positionId)}`,
    { method: "DELETE", body: {}, timeoutMs: 25000 },
    token
  );
}

// ── pending orders + SL/TP modification (MetaApi client REST) ──────────
// GET    /users/current/accounts/:id/orders            → resting orders
// DELETE /users/current/accounts/:id/orders/:orderId   → cancel resting order
// PATCH  /users/current/accounts/:id/orders/:orderId   → amend resting order
// PATCH  /users/current/accounts/:id/positions/:posId  → amend open position SL/TP

export async function mtOrders(accountId: string, region: string, token?: string): Promise<Record<string, unknown>[]> {
  const j = await clientCall<Record<string, unknown>[]>(accountId, region, "/orders", { timeoutMs: 20000 }, token);
  return Array.isArray(j) ? j : [];
}

export async function mtCancelOrder(
  accountId: string,
  region: string,
  orderId: string,
  token?: string
): Promise<MtOrderResult> {
  return clientCall<MtOrderResult>(
    accountId,
    region,
    `/orders/${encodeURIComponent(orderId)}`,
    { method: "DELETE", body: {}, timeoutMs: 25000 },
    token
  );
}

/** current bid/ask for a broker symbol */
export async function mtCurrentPrice(
  accountId: string,
  region: string,
  symbol: string,
  token?: string
): Promise<{ bid?: number; ask?: number; time?: string }> {
  return clientCall<{ bid?: number; ask?: number; time?: string }>(
    accountId,
    region,
    `/symbols/${encodeURIComponent(symbol)}/current-price`,
    { timeoutMs: 10000 },
    token
  );
}

/** close PART of an open position (MetaApi trade action POSITION_PARTIAL) */
export async function mtClosePositionPartially(
  accountId: string,
  region: string,
  positionId: string,
  volume: number,
  token?: string
): Promise<MtOrderResult> {
  return clientCall<MtOrderResult>(
    accountId,
    region,
    "/orders",
    { method: "POST", body: { actionType: "POSITION_PARTIAL", positionId, volume, comment: "HALO EDGE partial" }, timeoutMs: 25000 },
    token
  );
}

/** amend SL/TP on an open position (pass 0 to clear a level) */
export async function mtModifyPosition(
  accountId: string,
  region: string,
  positionId: string,
  patch: { sl?: number | null; tp?: number | null },
  token?: string
): Promise<MtOrderResult> {
  const body: Record<string, unknown> = {};
  if (patch.sl !== undefined) body.stopLoss = patch.sl ?? 0;
  if (patch.tp !== undefined) body.takeProfit = patch.tp ?? 0;
  return clientCall<MtOrderResult>(
    accountId,
    region,
    `/positions/${encodeURIComponent(positionId)}`,
    { method: "PATCH", body, timeoutMs: 25000 },
    token
  );
}

// ══════════════════════════════════════════════════════════════════════════
//  HISTORY (READ-ONLY) · closed-trade history for the Performance Journal
//
//  MetaApi client REST (official SDK v29 wire shape):
//    GET /users/current/accounts/:id/history/time          → { time }  newest
//      history record time — the "already synchronized up to" marker
//    GET /users/current/accounts/:id/history/deals/{time}?range=Nd
//      → { deals: MtHistoryDeal[], bars: [...] }  deals NEWER than `time`
//      (`range` caps the look-back window, default 1d, e.g. "7d", "30d")
//
//  These helpers ONLY READ. They never place, modify or close anything and
//  are consumed exclusively by the journal sync (lib/journal/mt5-sync.ts).
// ══════════════════════════════════════════════════════════════════════════

export interface MtHistoryDeal {
  id: string;
  orderId?: string;
  type?: string; // DEAL_TYPE_BUY | DEAL_TYPE_SELL | DEAL_TYPE_BALANCE | …
  entry?: string; // DEAL_ENTRY_IN | OUT | INOUT | OUT_BY
  symbol?: string;
  volume?: number;
  positionId?: string;
  profit?: number;
  swap?: number;
  commission?: number;
  fee?: number;
  time?: string; // ISO instant
  price?: number;
  sl?: number;
  tp?: number;
  comment?: string;
  magic?: number;
  balance?: number; // balance-operations deals only
}

export async function mtHistoryTime(
  accountId: string,
  region: string,
  token?: string
): Promise<{ time?: string }> {
  return clientCall<{ time?: string }>(
    accountId,
    region,
    "/history/time",
    { timeoutMs: 20000 },
    token
  );
}

/** deals newer than `startTimeIso` within `rangeDays` (max 30 per wire spec) */
export async function mtHistoryDeals(
  accountId: string,
  region: string,
  startTimeIso: string,
  rangeDays = 30,
  token?: string
): Promise<{ deals: MtHistoryDeal[] }> {
  const safeRange = Math.min(30, Math.max(1, Math.round(rangeDays)));
  const j = await clientCall<{ deals?: MtHistoryDeal[] }>(
    accountId,
    region,
    `/history/deals/${encodeURIComponent(startTimeIso)}?range=${safeRange}d`,
    { timeoutMs: 30000 },
    token
  );
  return { deals: Array.isArray(j.deals) ? j.deals : [] };
}
