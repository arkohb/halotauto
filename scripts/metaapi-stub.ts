// ════════════════════════════════════════════════════════════════════════
//  METAAPI STUB · local wire-compatible MetaApi cloud simulator
//  Purpose: E2E-test HALO's zero-manual MT login flow inside sandboxes
//  whose egress to the real MetaApi cloud is blocked. Implements exactly
//  the endpoints metaapi-core.ts calls (management + trading client API).
//  Run:  bun scripts/metaapi-stub.ts [port=4311]
// ════════════════════════════════════════════════════════════════════════

const PORT = Number(process.argv[2] ?? 4311);

interface StubAccount {
  id: string;
  login: string;
  password: string;
  server: string;
  platform: string;
  state: string;
  connectionStatus: string;
  region: string;
}

const accounts = new Map<string, StubAccount>();
let seq = 90010;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const unauthorized = () =>
  json(
    {
      id: Math.floor(Math.random() * 1e6),
      error: "UnauthorizedError",
      message: "Failed to authorize user due to invalid auth-token header (stub)",
    },
    401
  );

const AUTH_OK = (req: Request) => {
  const t = req.headers.get("auth-token") ?? "";
  return t.startsWith("eyJ"); // any JWT-shaped token is accepted by the stub
};

const body = async (req: Request) => {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const server = Bun.serve({
  port: PORT,
  idleTimeout: 120,
  async fetch(req) {
    const url = new URL(req.url);
    const p = url.pathname;
    const m = req.method;

    // ── management API ────────────────────────────────────────────────
    if (p === "/users/current/accounts" && m === "POST") {
      if (!AUTH_OK(req)) return unauthorized();
      const b = await body(req);
      const id = `stub${seq++}acc${Math.floor(Math.random() * 1e6)}`;
      accounts.set(id, {
        id,
        login: String(b.login ?? ""),
        password: String(b.password ?? ""),
        server: String(b.server ?? ""),
        platform: String(b.platform ?? "mt5"),
        state: "CREATED",
        connectionStatus: "DISCONNECTED",
        region: String(b.region ?? "new-york"),
      });
      return json({ id, region: accounts.get(id)!.region }, 201);
    }

    if (p === "/users/current/accounts" && m === "GET") {
      if (!AUTH_OK(req)) return unauthorized();
      return json([...accounts.values()].map((a) => ({ _id: a.id, ...a, password: undefined })));
    }

    let mm = p.match(/^\/users\/current\/accounts\/([^/]+)\/deploy$/);
    if (mm && m === "POST") {
      if (!AUTH_OK(req)) return unauthorized();
      const a = accounts.get(mm[1]);
      if (!a) return json({ statusCode: 404, message: "Account not found" }, 404);
      a.state = "DEPLOYED";
      a.connectionStatus = "CONNECTED";
      return new Response(null, { status: 204 });
    }

    mm = p.match(/^\/users\/current\/accounts\/([^/]+)$/);
    if (mm && m === "GET") {
      if (!AUTH_OK(req)) return unauthorized();
      const a = accounts.get(mm[1]);
      if (!a) return json({ statusCode: 404, message: "Account not found" }, 404);
      return json({ _id: a.id, ...a, password: undefined });
    }

    // ── trading (client) API ──────────────────────────────────────────
    mm = p.match(/^\/users\/current\/accounts\/([^/]+)\/account-information$/);
    if (mm && m === "GET") {
      if (!AUTH_OK(req)) return unauthorized();
      const a = accounts.get(mm[1]);
      if (!a) return json({ statusCode: 404, message: "Account not found" }, 404);
      return json({
        broker: "Stub Markets International",
        currency: "USD",
        accountNumber: 51234567,
        balance: 10250.75,
        equity: 10310.4,
        margin: 12.3,
        freeMargin: 10298.1,
        leverage: 500,
        server: a.server,
        platform: a.platform,
        state: a.state,
        status: "CONNECTED",
      });
    }

    mm = p.match(/^\/users\/current\/accounts\/([^/]+)\/positions$/);
    if (mm && m === "GET") {
      if (!AUTH_OK(req)) return unauthorized();
      return json([]);
    }

    mm = p.match(/^\/users\/current\/accounts\/([^/]+)\/symbols\/([^/]+)\/specification$/);
    if (mm && m === "GET") {
      if (!AUTH_OK(req)) return unauthorized();
      const sym = decodeURIComponent(mm[2]);
      return json({
        symbol: sym,
        contractSize: sym.includes("XAU") ? 100 : 100000,
        digits: sym.includes("XAU") ? 2 : 5,
        volumeMin: 0.01,
        volumeStep: 0.01,
        volumeMax: 100,
      });
    }

    mm = p.match(/^\/users\/current\/accounts\/([^/]+)\/orders$/);
    if (mm && m === "POST") {
      if (!AUTH_OK(req)) return unauthorized();
      const b = await body(req);
      const oid = String(900000000 + Math.floor(Math.random() * 9e7));
      console.log(
        `[stub] ORDER ${b.actionType} ${b.symbol} vol=${b.volume} sl=${b.stopLoss} tp=${b.takeProfit} → ${oid}`
      );
      return json({ orderId: oid, positionId: String(Math.floor(Math.random() * 1e7)) }, 201);
    }

    mm = p.match(/^\/users\/current\/accounts\/([^/]+)\/positions\/([^/]+)$/);
    if (mm && m === "DELETE") {
      if (!AUTH_OK(req)) return unauthorized();
      console.log(`[stub] CLOSE position ${mm[2]}`);
      return json({ goodTillDate: null, positionId: mm[2] });
    }

    return json({ statusCode: 404, message: `stub: no route ${m} ${p}` }, 404);
  },
});

console.log(`[metaapi-stub] listening on http://127.0.0.1:${PORT}`);
