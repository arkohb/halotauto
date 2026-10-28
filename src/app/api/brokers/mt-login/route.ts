import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { testBrokerAccount } from "@/lib/brokers/service";
import { jfetch } from "@/lib/brokers/types";
import { sendAlert } from "@/lib/alerts";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

// ════════════════════════════════════════════════════════════════════════
//  MT4 / MT5 DIRECT LOGIN · ZERO-MANUAL-API EDITION
//  Every broker API already ships inside HALO. The user pastes ONLY their
//  broker MT credentials (login · password · server) and HALO provisions
//  the MetaApi cloud bridge automatically — no API keys to add, nothing to
//  wire up. The platform key is resolved from the server environment:
//    token = body token (Advanced override)  →  env METAAPI_TOKEN
//  Flow:
//    1) POST /users/current/accounts   (login + password + server + platform)
//    2) PUT  /users/current/accounts/:id/deploy
//    3) poll state until DEPLOYED (bounded)
//    4) save BrokerAccount(kind=metaapi) + auto TEST
//  Afterwards "GO LIVE" routes every EA C3 fire to that MT account.
// ════════════════════════════════════════════════════════════════════════

const BASE = "https://api.metaapi.cloud";

/** the platform key baked into this deployment (traders never touch it) */
function platformToken(): string {
  return String(process.env.METAAPI_TOKEN ?? "").trim();
}

interface Body {
  token?: string; // MetaApi account token (app.metaapi.cloud)
  accountId?: string; // direct mode — skip provisioning
  platform?: string; // "mt4" | "mt5"
  login?: string; // MT account number
  password?: string; // MT master password
  server?: string; // broker server name, e.g. ICMarketsSC-MT5
  label?: string;
}

const hdr = (token: string): Record<string, string> => ({
  "auth-auth0": token,
  "Content-Type": "application/json",
});

interface AccountSpec {
  id?: string;
  _id?: string;
  state?: string;
}

/** map undici network failures to an actionable message */
function friendly(e: unknown): Error {
  const msg = (e as Error).message ?? String(e);
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|network/i.test(msg)) {
    return new Error(
      "Could not reach api.metaapi.cloud from this server — check network egress. MetaApi itself is up; get your free token at app.metaapi.cloud."
    );
  }
  return e as Error;
}

// ── platform-key status for the UI badge ─────────────────────────────
export async function GET() {
  const baked = !!platformToken();
  return NextResponse.json({ ok: true, platformKey: baked });
}

export async function POST(req: Request) {
  try {
    const b = (await req.json()) as Body;
    // zero-manual-api: the deployment's own platform key, or an Advanced override
    const token = String(b.token ?? "").trim() || platformToken();
    const platform = b.platform === "mt4" ? "mt4" : "mt5";
    if (!token)
      return NextResponse.json(
        {
          ok: false,
          error:
            "This HALO deployment has no built-in MT platform key yet. The operator sets METAAPI_TOKEN once on the server (free at app.metaapi.cloud) — or paste your own MetaApi token under ADVANCED below. Your MT login details alone cannot reach the cloud bridge without it.",
        },
        { status: 400 }
      );

    const login = String(b.login ?? "").trim();
    const password = String(b.password ?? "");
    const server = String(b.server ?? "").trim();
    const directId = String(b.accountId ?? "").trim();

    if (!directId && (!login || !password || !server)) {
      return NextResponse.json(
        { ok: false, error: "Your MT login, password and server are all required — exactly as shown in your MT4/MT5 terminal." },
        { status: 400 }
      );
    }

    let accountId = directId;
    let provisioned = false;

    if (!accountId) {
      // ── 1) provision the account in MetaApi cloud ──
      const created = (await jfetch(`${BASE}/users/current/accounts`, {
        method: "POST",
        headers: hdr(token),
        body: JSON.stringify({
          login,
          password,
          server,
          platform,
          name: b.label?.trim() || `HALO 3EL · ${server}`,
          magic: 300311,
        }),
      })) as AccountSpec;
      accountId = String(created.id ?? created._id ?? "");
      if (!accountId) throw new Error("MetaApi did not return an account id — check the token");

      // ── 2) deploy the connection ──
      await jfetch(`${BASE}/users/current/accounts/${encodeURIComponent(accountId)}/deploy`, {
        method: "PUT",
        headers: hdr(token),
        body: JSON.stringify({}),
      }).catch(() => {});

      // ── 3) poll state (bounded ~30s; deployment can finish later) ──
      let deployed = false;
      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        try {
          const st = (await jfetch(`${BASE}/users/current/accounts/${encodeURIComponent(accountId)}`, {
            headers: hdr(token),
          })) as AccountSpec;
          if (st.state === "DEPLOYED") {
            deployed = true;
            break;
          }
          if (st.state === "FAILED") {
            throw new Error(
              `MetaApi deployment FAILED — verify the MT ${platform.toUpperCase()} login, password and server name "${server}"`
            );
          }
        } catch (e) {
          if ((e as Error).message.includes("FAILED")) throw e;
          // transient poll error — keep waiting
        }
      }
      provisioned = true;
      if (!deployed) {
        // still replicating — keep the account and let TEST retry it
        void sendAlert({
          kind: "broker",
          title: "HALO 3EL · MT ACCOUNT DEPLOYING",
          body: `${server} · ${login} is still deploying on MetaApi. Run TEST again in a minute.`,
        });
      }
    }

    // ── 4) persist as a broker account ──
    const label =
      b.label?.trim() ||
      (login && server ? `${server} · ${login}` : `MetaApi · ${accountId.slice(-6)}`);
    const credsJson = JSON.stringify(
      directId && !login
        ? { token, accountId }
        : { token, accountId, login, server, platform }
    );
    const row = await db.brokerAccount.create({
      data: { kind: "metaapi", label, credsJson },
    });

    void sendAlert({
      kind: "broker",
      title: "HALO 3EL · MT ACCOUNT ADDED",
      body: `${label} (${platform.toUpperCase()}${directId && !login ? " · existing MetaApi account" : " · auto-provisioned"}) — TEST runs now, then press GO LIVE.`,
    });

    // ── 5) auto test ──
    const t = await testBrokerAccount(row.id);

    return NextResponse.json({
      ok: true,
      id: row.id,
      accountId,
      provisioned,
      status: t.status ?? "untested",
      statusMsg: t.statusMsg ?? "",
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: friendly(e).message }, { status: 400 });
  }
}
