// ══════════════════════════════════════════════════════════════════════════
//  HALO BRANDED 404 — "SIGNAL LOST"
//
//  Rendered for any unmatched route (signed-in users; the proxy gate
//  redirects signed-out visitors to /login before this can appear).
//  Standalone server component — no data fetching, no client hooks, so it
//  can never interfere with the dashboard or the journal feature.
//  Styling mirrors the deep-navy command centre defined in globals.css
//  (--hx-* tokens) so it reads as part of the product, not a default error.
// ══════════════════════════════════════════════════════════════════════════

import Link from "next/link";

export const metadata = {
  title: "Signal Lost · HALO 3EL Autotrader",
};

export default function NotFound() {
  return (
    <main
      className="halo-scroll relative flex min-h-screen items-center justify-center overflow-hidden px-6"
      style={{ background: "#020b1a" }}
      aria-label="Page not found"
    >
      {/* ambient corner glows — same recipe as the app body base */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(90rem 48rem at 85% -10%, rgba(23,88,190,0.14), transparent 60%), radial-gradient(70rem 42rem at 8% 112%, rgba(14,74,158,0.16), transparent 62%)",
        }}
      />
      {/* faint telemetry grid */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(19,56,106,0.16) 1px, transparent 1px), linear-gradient(90deg, rgba(19,56,106,0.16) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage: "radial-gradient(60rem 40rem at 50% 40%, black, transparent 75%)",
          WebkitMaskImage: "radial-gradient(60rem 40rem at 50% 40%, black, transparent 75%)",
        }}
      />

      <div className="relative z-10 flex max-w-xl flex-col items-center text-center">
        {/* radar ring + 404 mark */}
        <div className="relative mb-8 flex h-40 w-40 items-center justify-center">
          <div
            aria-hidden
            className="absolute inset-0 rounded-full"
            style={{ border: "1px solid rgba(46,204,255,0.18)" }}
          />
          <div
            aria-hidden
            className="absolute inset-4 rounded-full"
            style={{
              border: "1px dashed rgba(233,185,78,0.28)",
              animation: "halo-404-spin 24s linear infinite",
            }}
          />
          <div
            aria-hidden
            className="absolute inset-0 rounded-full"
            style={{
              background:
                "radial-gradient(closest-side, rgba(46,204,255,0.10), transparent 72%)",
            }}
          />
          <span
            className="relative select-none text-5xl font-semibold tracking-tight"
            style={{
              color: "#e9b94e",
              textShadow: "0 0 26px rgba(233,185,78,0.45), 0 0 60px rgba(233,185,78,0.18)",
            }}
          >
            404
          </span>
        </div>

        {/* eyebrow */}
        <p
          className="mb-3 text-[11px] font-semibold uppercase"
          style={{ letterSpacing: "0.32em", color: "#2eccff" }}
        >
          Signal Lost
        </p>

        <h1
          className="text-balance text-2xl font-semibold sm:text-3xl"
          style={{ color: "#eaf3ff", letterSpacing: "0.01em" }}
        >
          This page could not be found
        </h1>

        <p
          className="mt-4 max-w-md text-sm leading-relaxed"
          style={{ color: "#8aa2c2" }}
        >
          The route you requested is outside the HALO 3EL Autotrader command
          centre. Your trading engine, open positions and protective SL/TP
          management are unaffected — this is a navigation dead-end only.
        </p>

        {/* actions */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/"
            className="inline-flex h-11 items-center justify-center rounded-md px-6 text-sm font-semibold transition-transform hover:-translate-y-px"
            style={{
              color: "#04122a",
              background: "linear-gradient(180deg, #4fd8ff, #2eccff)",
              boxShadow:
                "0 0 0 1px rgba(46,204,255,0.55), 0 8px 24px rgba(46,204,255,0.25)",
            }}
          >
            Return to Terminal
          </Link>
          <Link
            href="/login"
            className="inline-flex h-11 items-center justify-center rounded-md px-6 text-sm font-semibold transition-colors"
            style={{
              color: "#e9b94e",
              border: "1px solid rgba(233,185,78,0.45)",
              background: "rgba(233,185,78,0.06)",
            }}
          >
            Sign In
          </Link>
        </div>

        {/* footer attribution — mirrors the sidebar */}
        <p
          className="mt-12 text-[10px] uppercase"
          style={{ letterSpacing: "0.28em", color: "#51678a" }}
        >
          HALO 3EL Autotrader · Performance Command Centre
        </p>
      </div>

      {/* keyframes are page-local and prefixed — cannot collide with app styles */}
      <style>{`
        @keyframes halo-404-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </main>
  );
}
