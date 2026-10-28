"use client";

// ════════════════════════════════════════════════════════════════════════
//  TRADINGVIEW ADVANCED CHART · embeddable widget, HALO dark theme
//  Syncs with the app symbol/timeframe; if the external script cannot
//  load (offline / blocked), reports back so the panel can fall back
//  to the built-in HALO engine chart.
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";
import { tvInterval, tvSymbolOf } from "@/lib/market-symbols";

interface TradingViewConfig {
  autosize?: boolean;
  symbol?: string;
  interval?: string;
  timezone?: string;
  theme?: string;
  style?: string;
  locale?: string;
  backgroundColor?: string;
  gridColor?: string;
  hide_side_toolbar?: boolean;
  hide_top_toolbar?: boolean;
  allow_symbol_change?: boolean;
  save_image?: boolean;
  withdateranges?: boolean;
  details?: boolean;
  studies?: string[];
  container_id?: string;
}

declare global {
  interface Window {
    TradingView?: {
      widget: new (cfg: TradingViewConfig) => unknown;
    };
  }
}

const TV_SCRIPT = "https://s3.tradingview.com/tv.js";
const SCRIPT_ID = "tradingview-tv-js";

function loadTvScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") return reject(new Error("no window"));
    if (window.TradingView) return resolve();
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("tv.js failed")), { once: true });
      return;
    }
    const s = document.createElement("script");
    s.id = SCRIPT_ID;
    s.src = TV_SCRIPT;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("tv.js failed"));
    document.head.appendChild(s);
  });
}

interface Props {
  symbol: string;
  tf: string;
  height: string;
  /** fired when TradingView cannot load — panel should fall back */
  onUnavailable?: (reason: string) => void;
}

export function TvChart({ symbol, tf, height, onUnavailable }: Props) {
  const holderRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const cbRef = useRef(onUnavailable);
  useEffect(() => {
    cbRef.current = onUnavailable;
  }, [onUnavailable]);

  useEffect(() => {
    let cancelled = false;
    let failTimer: ReturnType<typeof setTimeout> | null = null;

    const mount = async () => {
      try {
        await loadTvScript();
        if (cancelled || !holderRef.current) return;
        const holder = holderRef.current;
        holder.innerHTML = "";
        const inner = document.createElement("div");
        inner.id = `tv_chart_${symbol}_${tf.replace(/[^a-z0-9]/gi, "")}`;
        inner.style.height = "100%";
        inner.style.width = "100%";
        holder.appendChild(inner);

        new window.TradingView!.widget({
          autosize: true,
          symbol: tvSymbolOf(symbol),
          interval: tvInterval(tf),
          timezone: "Etc/UTC",
          theme: "dark",
          style: "1",
          locale: "en",
          backgroundColor: "#0B1426",
          gridColor: "rgba(28, 42, 71, 0.55)",
          hide_side_toolbar: false,
          // the EA is auto-attached to this chart — HALO's own overlay is the
          // single control surface, so the TV top toolbar (symbol/intervals)
          // is hidden: chart symbol & interval can never drift from the EA.
          hide_top_toolbar: true,
          allow_symbol_change: false,
          save_image: false,
          withdateranges: true,
          studies: [],
          container_id: inner.id,
        });

        // iframe appears when the widget bootstraps
        failTimer = setTimeout(() => {
          if (cancelled) return;
          const hasIframe = !!holder.querySelector("iframe");
          if (!hasIframe) {
            setStatus("error");
            cbRef.current?.("TradingView widget did not mount (network blocked?)");
          } else {
            setStatus("ready");
          }
        }, 7000);
        // usually ready sooner — flip early when possible
        setTimeout(() => {
          if (!cancelled && holder.querySelector("iframe")) setStatus("ready");
        }, 1500);
      } catch (e) {
        if (!cancelled) {
          setStatus("error");
          cbRef.current?.((e as Error).message);
        }
      }
    };

    void mount();
    return () => {
      cancelled = true;
      if (failTimer) clearTimeout(failTimer);
      if (holderRef.current) holderRef.current.innerHTML = "";
    };
  }, [symbol, tf]);

  return (
    <div className="relative h-full w-full">
      <div ref={holderRef} className="h-full w-full" />
      {status !== "ready" && (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 flex-col items-center gap-2 text-center">
          {status === "loading" ? (
            <span className="rounded-full border border-[#1C2A47] bg-[#0F1A30]/90 px-3 py-1.5 text-[10px] tracking-[0.2em] text-[#8C98AE]">
              LOADING TRADINGVIEW…
            </span>
          ) : (
            <span
              className="rounded-full border px-3 py-1.5 text-[10px] tracking-[0.2em]"
              style={{ borderColor: "rgba(212,175,55,0.5)", background: "rgba(212,175,55,0.08)", color: "#D4AF37" }}
            >
              TRADINGVIEW UNREACHABLE · SWITCHED TO HALO CHART
            </span>
          )}
        </div>
      )}
      <span className="sr-only" style={{ height }}>
        TradingView chart for {symbol}
      </span>
    </div>
  );
}
