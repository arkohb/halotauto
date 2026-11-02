import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { testBrokerAccount } from "@/lib/brokers/service";
import { friendlyMetaApiError, mgmtReachable, platformKeyStatus, provisionMtAccount } from "@/lib/brokers/metaapi-core";
import { sendAlert } from "@/lib/alerts";
import { guardTrading } from "@/lib/api-guard";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

// ════════════════════════════════════════════════════════════════════════
//  MT4 / MT5 DIRECT LOGIN · ZERO-MANUAL-API EDITION
//  Every broker API already ships inside HALO. The user pastes ONLY their
//  broker MT credentials (login · password · server) and HALO provisions
//  the MetaApi cloud bridge automatically — no API keys to add, nothing to
//  wire up. The platform key is baked into the deployment:
//    token = body token (Advanced override) → env METAAPI_TOKEN (server secret; no built-in fallback)
//  Flow (per official MetaApi wire format):
//    1) POST /users/current/accounts          (login+password+server+platform)
//    2) POST /users/current/accounts/:id/deploy
//    3) poll account entity until DEPLOYED / CONNECTED (bounded ~40s)
//    4) save BrokerAccount(kind=metaapi) → auto TEST → auto ACTIVATE
//  Afterwards GO LIVE routes every EA C3 fire to that MT account.
// ════════════════════════════════════════════════════════════════════════

interface Body {
  token?: string; // MetaApi token override (Advanced) — platform key used when empty
  accountId?: string; // direct mode — skip provisioning
  region?: string; // optional region hint, default new-york
  platform?: string; // "mt4" | "mt5"
  login?: string; // MT account number
  password?: string; // MT master password
  server?: string; // broker server name, e.g. ICMarketsSC-MT5
  label?: string;
}

// ── platform-key + cloud-reachability status for the UI badge ────────
export async function GET() {
  const deny = await guardTrading();
  if (deny) return deny;
  const st = platformKeyStatus();
  const cloud = st.present ? await mgmtReachable() : { ok: false, httpSeen: false };
  return NextResponse.json({
    ok: true,
    platformKey: st.present,
    jwtValid: st.jwtValid,
    tokenSource: st.source,
    expiresAt: st.expiresAt,
    reachable: cloud.ok,
    checkedAt: new Date().toISOString(),
  });
}

export async function POST(req: Request) {
  const deny = await guardTrading();
  if (deny) return deny;
  try {
    const b = (await req.json()) as Body;
    // zero-manual-api: the deployment's own platform key, or an Advanced override
    const token = String(b.token ?? "").trim() || undefined;
    const platform = b.platform === "mt4" ? "mt4" : "mt5";

    const key = platformKeyStatus();
    if (!key.present) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "This HALO deployment has no built-in MT platform key. The operator sets METAAPI_TOKEN once on the server (free at app.metaapi.cloud) — or paste your own MetaApi token under ADVANCED below. Your MT login details alone cannot reach the cloud bridge without it.",
        },
        { status: 400 }
      );
    }

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
    let region = String(b.region ?? "").trim() || "new-york";
    let provisioned = false;
    let connected = false;
    let reused = false;

    if (!accountId) {
      // ── 1+2+3) provision → deploy → poll, all inside metaapi-core ──
      const r = await provisionMtAccount({
        login,
        password,
        server,
        platform,
        name: b.label?.trim() || `HALO 3EL · ${server}`,
        region: b.region,
        token,
      });
      accountId = r.accountId;
      region = r.region || region;
      provisioned = true;
      connected = r.connected;
      reused = Boolean(r.reused);

      if (r.state === "DEPLOY_FAILED") {
        throw new Error(
          `MetaApi deployment FAILED — verify the MT ${platform.toUpperCase()} login, password and server name "${server}". ${friendlyMetaApiError(new Error("ACCOUNT_UNAUTHORIZED"))}`
        );
      }
      if (!r.deployed) {
        // still replicating — keep the account and let TEST retry it
        void sendAlert({
          kind: "broker",
          title: "HALO 3EL · MT ACCOUNT DEPLOYING",
          body: `${server} · ${login} is still deploying on MetaApi. Run TEST again in a minute.`,
        });
      }
    }

    // ── 4) persist as a broker account (token only stored when overridden) ──
    const label =
      b.label?.trim() ||
      (login && server ? `${server} · ${login}` : `MetaApi · ${accountId.slice(-6)}`);
    const credsJson = JSON.stringify(
      directId && !login
        ? { ...(token ? { token } : {}), accountId, region }
        : { ...(token ? { token } : {}), accountId, region, login, server, platform }
    );
    const row = await db.brokerAccount.create({
      data: { kind: "metaapi", label, credsJson },
    });

    void sendAlert({
      kind: "broker",
      title: "HALO 3EL · MT ACCOUNT ADDED",
      body: `${label} (${platform.toUpperCase()}${reused ? " · existing connection redeployed" : directId && !login ? " · existing MetaApi account" : " · auto-provisioned"}${connected ? " · connected" : ""}) — TEST runs now, then press GO LIVE.`,
    });

    // ── 5) auto test ──
    const t = await testBrokerAccount(row.id);

    // ── 6) auto-activate on success (zero-step ready for GO LIVE) ──
    let autoActivated = false;
    if (t.status === "ok") {
      await db.brokerAccount.updateMany({ data: { active: false } });
      await db.brokerAccount.update({ where: { id: row.id }, data: { active: true } });
      autoActivated = true;
      void sendAlert({
        kind: "broker",
        title: "HALO 3EL · MT ACCOUNT ACTIVE",
        body: `${label} passed the connection test and is now the active live-routing account. Press GO LIVE (or arm the switch on the card) to route EA orders.`,
      });
    }

    return NextResponse.json({
      ok: true,
      id: row.id,
      accountId,
      region,
      provisioned,
      reused,
      connected,
      autoActivated,
      status: t.status ?? "untested",
      statusMsg: t.statusMsg ?? "",
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: friendlyMetaApiError(e) }, { status: 400 });
  }
}
