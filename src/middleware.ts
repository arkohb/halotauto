// ══════════════════════════════════════════════════════════════════════════
//  LOGIN-FIRST GATE · the app always opens on the login dashboard
//
//  OWNER MODE (HALO_COMMERCE unset) → pass-through; dev/E2E/owner behave
//  exactly as before (no gate).
//
//  COMMERCIAL MODE (HALO_COMMERCE=on):
//   · unauthenticated page navigation → redirected to /login?next=… so the
//     app ALWAYS opens on the login dashboard (server-side, before any
//     dashboard HTML/JS is served).
//   · unauthenticated data-API call    → 401 JSON (no HTML redirect), so
//     client fetches fail loudly instead of following to a login page.
//   · public surfaces stay reachable: sign-in, registration, password
//     recovery, the pricing page, e-mail verification links and the
//     payment/TV webhooks (server-to-server, no browser session).
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
];

export function middleware(req: NextRequest) {
  if (process.env.HALO_COMMERCE !== "on") return NextResponse.next();

  const { pathname, search } = req.nextUrl;
  const hasSession = () => !!req.cookies.get(SESSION_COOKIE)?.value;

  if (pathname.startsWith("/api/")) {
    if (hasSession()) return NextResponse.next();
    if (PUBLIC_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))) {
      return NextResponse.next();
    }
    return NextResponse.json(
      { ok: false, error: "Sign in to continue.", code: "UNAUTHENTICATED" },
      { status: 401 },
    );
  }

  if (hasSession()) return NextResponse.next();
  if (PUBLIC_PAGES.has(pathname)) return NextResponse.next();

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
