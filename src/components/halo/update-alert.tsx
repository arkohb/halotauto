"use client";

// ══════════════════════════════════════════════════════════════════════════
//  UPDATE ALERT · "new version deployed — reload to apply"
//
//  An open dashboard (or installed PWA) keeps running the JS bundle it was
//  loaded with, even after the server has been restarted with new code —
//  the service worker's skipWaiting activates the new shell but old chunks
//  live until a reload. This component closes that gap:
//
//   1. VERSION POLL  — probes GET /api/version at mount, then every 60 s
//      and immediately on focus / tab-visible / network-online. The server
//      answers with an opaque id bound to its process boot, so any deploy
//      restart changes it and every open dashboard raises the alert.
//   2. SW UPDATEFOUND — production only: when the service worker finds a
//      newer worker (e.g. a sw.js-only change that never restarts the
//      server) the alert is raised as well.
//
//  The alert is a floating bottom-centre pill (bottom-right is occupied by
//  the robot assistant + JARVIS console; the header must stay unobstructed)
//  with a Reload-now action; it stays until reloaded or dismissed for that
//  specific version, and re-arms itself if yet another version lands.
//  Detection failures (offline, 401 when signed out) stay silent.
// ══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { RefreshCw, X } from "lucide-react";
import { A, C } from "@/lib/halo/ui-helpers";
import { useToast } from "@/hooks/use-toast";

const POLL_MS = 60_000;

interface VersionRes {
  ok: boolean;
  version: string;
  deployedAt?: string;
}

async function fetchVersion(): Promise<VersionRes | null> {
  try {
    const r = await fetch("/api/version", { cache: "no-store" });
    if (!r.ok) return null; // 401 while signed out (commercial gate) — stay quiet
    const j = (await r.json()) as VersionRes;
    return j?.ok && typeof j.version === "string" ? j : null;
  } catch {
    return null; // offline / mid-restart — stay quiet, retry next tick
  }
}

export function UpdateAlert() {
  const { toast } = useToast();
  const [updateKey, setUpdateKey] = useState<string | null>(null);
  const [deployedLabel, setDeployedLabel] = useState<string | null>(null);
  const baseline = useRef<string | null>(null); // version this tab was loaded with
  const dismissed = useRef<string | null>(null); // update key the user dismissed
  const announced = useRef<string | null>(null); // update key already toasted

  const deployTime = useCallback((iso?: string) => {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return `${d.toLocaleTimeString("en-GB", { hour12: false, timeZone: "UTC" })} UTC`;
  }, []);

  const raise = useCallback(
    (key: string, deployed: string | null) => {
      if (dismissed.current === key) return; // user already dismissed this one
      setUpdateKey(key);
      setDeployedLabel(deployed);
      if (announced.current !== key) {
        announced.current = key;
        toast({
          title: "Update available",
          description: "A new HALO version was deployed — reload to apply it.",
        });
      }
    },
    [toast],
  );

  const check = useCallback(async () => {
    const v = await fetchVersion();
    if (!v) return;
    if (!baseline.current) {
      baseline.current = v.version; // first probe → the version this tab runs
      return;
    }
    if (v.version === baseline.current) return;
    // server is running a different build than this tab was loaded with
    raise(v.version, deployTime(v.deployedAt));
  }, [raise, deployTime]);

  // ── channel 1 · deployment version polling ──────────────────────────────
  useEffect(() => {
    // first probe deferred a tick (same pattern as the header UTC clock) so
    // the effect body itself never setState-synchronously
    const first = setTimeout(() => void check(), 0);
    const id = setInterval(() => void check(), POLL_MS);
    const wake = () => void check();
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    return () => {
      clearTimeout(first);
      clearInterval(id);
      window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    };
  }, [check]);

  // ── channel 2 · service worker update detection (production installs) ──
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    let attaching: ServiceWorker | null = null;
    const onState = () => {
      // sw.js installs with skipWaiting → activating/activated means a newer
      // app shell exists than the JS this tab is running
      raise("service-worker", null);
    };
    navigator.serviceWorker
      .getRegistration()
      .then((reg) => {
        if (!reg) return;
        if (reg.installing) {
          attaching = reg.installing;
          attaching.addEventListener("statechange", onState);
        }
        reg.addEventListener("updatefound", () => {
          attaching?.removeEventListener("statechange", onState);
          if (reg.installing) {
            attaching = reg.installing;
            attaching.addEventListener("statechange", onState);
          }
        });
      })
      .catch(() => {});
    return () => attaching?.removeEventListener("statechange", onState);
  }, [raise]);

  const dismiss = useCallback(() => {
    if (updateKey) dismissed.current = updateKey;
    setUpdateKey(null);
  }, [updateKey]);

  return (
    <AnimatePresence>
      {updateKey && (
        <motion.div
          key="halo-update-alert"
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.96 }}
          transition={{ type: "spring", stiffness: 320, damping: 26 }}
          className="pointer-events-none fixed inset-x-0 bottom-4 z-[300] flex justify-center px-4"
        >
          <div
            role="alert"
            aria-live="polite"
            className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl border px-4 py-3 shadow-2xl backdrop-blur-md"
            style={{
              background: "rgba(2,11,26,0.94)",
              borderColor: A.cyan(0.5),
              boxShadow: `0 0 28px ${A.cyan(0.22)}, 0 14px 34px rgba(0,0,0,0.55)`,
            }}
          >
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span
                className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
                style={{ background: C.cyan }}
              />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: C.cyan }} />
            </span>

            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold tracking-wide" style={{ color: C.txt }}>
                New version available
              </div>
              <div className="truncate text-[11px]" style={{ color: C.muted }}>
                Reload to apply the latest update
                {deployedLabel ? ` · deployed ${deployedLabel}` : ""}.
              </div>
            </div>

            <button
              onClick={() => window.location.reload()}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-xs font-bold transition-colors hover:brightness-110"
              style={{ background: A.cyan(0.16), borderColor: A.cyan(0.55), color: C.cyan }}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Reload now
            </button>

            <button
              onClick={dismiss}
              aria-label="Dismiss update alert"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-white/5"
              style={{ color: C.muted }}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
