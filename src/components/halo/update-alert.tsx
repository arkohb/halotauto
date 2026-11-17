"use client";

// ══════════════════════════════════════════════════════════════════════════
//  UPDATE ALERT · "new HALO version — reload to apply"
//
//  Shown ONLY for an official release: the server's release (package.json
//  "version", GET /api/version) is NEWER than the release this page was
//  built with (NEXT_PUBLIC_HALO_RELEASE). Routine deploys, server restarts,
//  cold starts, the several instances Firebase runs side by side and
//  service-worker refreshes never raise it.
//
//  Publishing an official update = bump "version" in package.json
//  (e.g. 0.2.1 → 0.2.2) and deploy.
//
//  Probes at mount, every 60 s and on focus / tab-visible / online. A
//  dismissal is remembered per release, so it never nags again for that
//  release. Detection failures (offline, 401 when signed out) stay silent.
//
//  The alert is a floating bottom-centre pill (bottom-right is occupied by
//  the robot assistant + JARVIS console; the header must stay unobstructed).
// ══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { RefreshCw, X } from "lucide-react";
import { A, C } from "@/lib/halo/ui-helpers";
import { useToast } from "@/hooks/use-toast";

const POLL_MS = 60_000;
const OWN_RELEASE = process.env.NEXT_PUBLIC_HALO_RELEASE ?? "0.0.0"; // baked in at build
const DISMISS_KEY = "halo.update.dismissed";

interface VersionRes {
  ok: boolean;
  version: string;
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

/** true when release a is newer than b ("0.2.10" > "0.2.9") */
export function newerRelease(a: string, b: string): boolean {
  const pa = a.split(".").map((x) => parseInt(x, 10) || 0);
  const pb = b.split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

export function UpdateAlert() {
  const { toast } = useToast();
  const [release, setRelease] = useState<string | null>(null); // newer official release, when one is out
  const dismissed = useRef<string | null>(null); // release the user dismissed
  const announced = useRef<string | null>(null); // release already toasted

  const raise = useCallback(
    (next: string) => {
      if (dismissed.current === null) dismissed.current = readDismissed();
      if (dismissed.current === next) return; // already dismissed for this release
      setRelease(next);
      if (announced.current !== next) {
        announced.current = next;
        toast({
          title: "Update available",
          description: `HALO ${next} is out — reload to apply it.`,
        });
      }
    },
    [toast],
  );

  const check = useCallback(async () => {
    const v = await fetchVersion();
    if (!v) return;
    // only an official release newer than the one this page runs
    if (newerRelease(v.version, OWN_RELEASE)) raise(v.version);
  }, [raise]);

  useEffect(() => {
    // first probe deferred a tick so the effect body never setStates synchronously
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

  const dismiss = useCallback(() => {
    if (release) {
      dismissed.current = release;
      try {
        localStorage.setItem(DISMISS_KEY, release);
      } catch {
        // storage blocked — dismissed for this session only
      }
    }
    setRelease(null);
  }, [release]);

  return (
    <AnimatePresence>
      {release && (
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
                HALO {release} available
              </div>
              <div className="truncate text-[11px]" style={{ color: C.muted }}>
                Official update · reload to apply it.
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
