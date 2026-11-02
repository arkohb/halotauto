// ══════════════════════════════════════════════════════════════════════════
//  LOGIN-FIRST GATE · the app always opens on the login dashboard
//
//  Migrated from middleware.ts → proxy.ts (Next.js 16 convention — the
//  "middleware" file name is deprecated; behaviour is 1:1 identical).
//
//  COMMERCIAL MODE (default — the platform is a sold product):
//   · unauthenticated page navigation → redirected to /login?next=… so the
//     app ALWAYS opens on the login dashboard (server-side, before any
//     dashboard HTML/JS is served).
//   · unauthenticated data-API call    → 401 JSON (no HTML redirect), so
//     client fetches fail loudly instead of following to a login page.
//   · public surfaces stay reachable: sign-in, registration, password
//     recovery, the pricing page, e-mail verification links and the
//     payment/TV webhooks (server-to-server, no browser session).
//
//  OWNER MODE (HALO_COMMERCE=off) → pass-through; legacy local behaviour.
//  The default is code-level ON so a lost/reset .env can never silently
//  re-open the app.
//
//  The cookie-presence check here is the fast outer ring only; every
//  sensitive endpoint still re-validates the session and license
//  server-side (requireUser / requireAdmin / requireLicensed). Nothing in
//  this file touches open MT5 positions or protective SL/TP management.
// ══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "halo_session";

/** Pages a signed-out visitor may open. */
const PUBLIC_PAGES = new Set([
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/pricing",
]);

/** API prefixes that must stay reachable without a browser session. */
const PUBLIC_API_PREFIXES = [
  "/api/auth/",              // login / register / verify-email / forgot / reset / logout / me
  "/api/commerce/webhook/",  // Paystack & Flutterwave server-to-server webhooks
  "/api/webhook/",           // TradingView webhook (secret-authenticated upstream)
  "/api/commerce/plans",     // public pricing data for the /pricing page
  "/api/health",             // hosting health check + secret-gated keep-alive tick
  "/api/csp-report",         // browser CSP violation reports (no cookies sent)
];

// ── CONTENT SECURITY POLICY (pages only) ─────────────────────────────────
// Per-request nonce: Next.js reads it from this header and stamps it on its
// own scripts; 'strict-dynamic' then lets those trusted scripts load what
// they need (the TradingView loader is injected by our own bundle). Only
// the origins the browser really uses are listed:
//   · TradingView  — chart widget script + its iframe
//   · Binance      — live trade/kline websocket
//   · Deriv        — live tick websocket (synthetics / FX / metals)
// HALO_CSP=report → Content-Security-Policy-Report-Only (testing);
// anything else  → enforced.
function buildCsp(nonce: string): string {
  const dev = process.env.NODE_ENV !== "production";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://s3.tradingview.com${dev ? " 'unsafe-eval'" : ""}`,
    // React SSR emits style="" attributes and Tailwind/Next inject <style>;
    // inline styles cannot execute code
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' wss://stream.binance.com:9443 wss://ws.derivws.com${dev ? " ws://localhost:*" : ""}`,
    "frame-src https://s.tradingview.com https://www.tradingview.com",
    "media-src 'self' blob: data:",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "report-uri /api/csp-report",
  ].join("; ");
}

/** pass the request on, attaching the nonce + CSP to page responses */
function nextWithCsp(req: NextRequest): NextResponse {
  if (req.nextUrl.pathname.startsWith("/api/")) return NextResponse.next();
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce);
  const header = process.env.HALO_CSP === "report" ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy";
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set(header, csp);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set(header, csp);
  return res;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** no Origin header (non-browser caller) or an Origin matching the host the request was sent to */
function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function proxy(req: NextRequest) {
  if (process.env.HALO_COMMERCE === "off") return nextWithCsp(req);

  const { pathname, search } = req.nextUrl;
  const hasSession = () => !!req.cookies.get(SESSION_COOKIE)?.value;

  if (pathname.startsWith("/api/")) {
    // CSRF backstop (on top of the SameSite=Lax session cookie): a browser
    // request that changes state must come from this site. Server-to-server
    // callers (payment + TradingView webhooks) send no Origin header.
    if (!SAFE_METHODS.has(req.method) && !sameOrigin(req)) {
      return NextResponse.json({ ok: false, error: "Cross-site request refused.", code: "BAD_ORIGIN" }, { status: 403 });
    }
    if (hasSession()) return NextResponse.next();
    if (PUBLIC_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))) {
      return NextResponse.next();
    }
    return NextResponse.json(
      { ok: false, error: "Sign in to continue.", code: "UNAUTHENTICATED" },
      { status: 401 },
    );
  }

  if (hasSession()) return nextWithCsp(req);
  if (PUBLIC_PAGES.has(pathname)) return nextWithCsp(req);

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // skip static assets and the service worker; everything else is gated
  matcher: [
    "/((?!_next/static|_next/image|_next/webpack-hmr|icons/|logo.svg|sw.js|manifest.webmanifest|robots.txt|favicon).*)",
  ],
};
