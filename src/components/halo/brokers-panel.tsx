"use client";

// ════════════════════════════════════════════════════════════════════════
//  BROKERS PANEL · every CFD platform live out of the box
//  • Featured MT4/MT5 LOGIN card — paste your broker login/password/server
//    and HALO provisions the MetaApi cloud connection automatically
//  • Auto catalog of ALL platforms (OANDA · IG · MT4/MT5 · Binance · FXCM ·
//    cTrader · Deriv · custom bridge) — connect, auto-test, GO LIVE
//  • GO LIVE = activate account + route the EA's real C3 orders to it
// ════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { C } from "@/lib/halo/ui-helpers";
import { BROKERS, brokerMeta, MT_SERVERS, type CredField } from "@/lib/brokers/broker-meta";
import {
  BROKER_DIRECTORY,
  DIRECTORY_MT_SERVERS,
  searchFirms,
  viaLabel,
  type DirectoryCategory,
  type FirmEntry,
} from "@/lib/brokers/broker-directory";

export interface BrokerRow {
  id: string;
  kind: string;
  label: string;
  env: string;
  status: string;
  statusMsg: string;
  active: boolean;
  lastCheckAt: string | null;
  masked: Record<string, string>;
}

interface Props {
  notify: (title: string, desc?: string, bad?: boolean) => void;
}

// platform tiles of the always-on catalog (metaapi has the featured card; paper is built-in)
const CATALOG_KINDS = ["oanda", "ig", "binance", "fxcm", "ctrader", "deriv", "webhook"] as const;

export function BrokersPanel({ notify }: Props) {
  const [rows, setRows] = useState<BrokerRow[]>([]);
  const [execMode, setExecMode] = useState<"paper" | "live">("paper");
  const [execBroker, setExecBroker] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [presetKind, setPresetKind] = useState<string>("oanda");
  const [presetLabel, setPresetLabel] = useState<string>("");
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<DirectoryCategory>("all");
  const [mtPrefill, setMtPrefill] = useState<{
    server: string;
    platform: "mt4" | "mt5";
    label: string;
    nonce: number;
  } | null>(null);
  const mtCardRef = useRef<HTMLDivElement>(null);

  const serverOptions = useMemo(
    () => Array.from(new Set([...MT_SERVERS, ...DIRECTORY_MT_SERVERS])),
    []
  );
  const firms = useMemo(() => searchFirms(query, cat), [query, cat]);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/brokers", { cache: "no-store" });
      const j = (await r.json()) as { brokers?: BrokerRow[] };
      setRows(j.brokers ?? []);
      const s = await fetch("/api/bot/state", { cache: "no-store" });
      if (s.ok) {
        const sj = (await s.json()) as { exec?: { executionMode?: string; broker?: { label?: string } | null } };
        setExecMode(sj.exec?.executionMode === "live" ? "live" : "paper");
        setExecBroker(sj.exec?.broker?.label ?? null);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const test = async (id: string) => {
    setBusyId(`${id}:test`);
    try {
      const r = await fetch(`/api/brokers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test" }),
      });
      const j = (await r.json()) as { ok: boolean; status?: string; statusMsg?: string; error?: string };
      if (!j.ok) notify("Test failed", j.error, true);
      else notify(j.status === "ok" ? "CONNECTION OK" : "TEST FAILED", j.statusMsg, j.status !== "ok");
      await load();
    } catch (e) {
      notify("Action failed", (e as Error).message, true);
    } finally {
      setBusyId(null);
    }
  };

  const setActive = async (id: string) => {
    setBusyId(`${id}:act`);
    try {
      const r = await fetch(`/api/brokers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "activate" }),
      });
      const j = (await r.json()) as { ok: boolean; warn?: string; error?: string };
      if (!j.ok) notify("Activate failed", j.error, true);
      else notify("ACCOUNT ACTIVATED", j.warn ?? "Live orders route through this account.");
      await load();
    } catch (e) {
      notify("Action failed", (e as Error).message, true);
    } finally {
      setBusyId(null);
    }
  };

  /** one-click GO LIVE: activate + arm the EA's live order routing on this account */
  const goLive = async (id: string, label: string) => {
    setBusyId(`${id}:live`);
    try {
      const r = await fetch(`/api/brokers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "activate", andGoLive: true }),
      });
      const j = (await r.json()) as { ok: boolean; liveArmed?: boolean; warn?: string; error?: string };
      if (!j.ok) notify("GO LIVE failed", j.error, true);
      else if (j.liveArmed) {
        notify("LIVE ROUTING ARMED", `EA C3 fires now execute on ${label} with real SL/TP.`);
        if (j.warn) notify("Heads up", j.warn, true);
      } else notify("Account activated — but not live yet", j.warn ?? "Run TEST until it passes, then GO LIVE.", true);
      await load();
    } catch (e) {
      notify("Action failed", (e as Error).message, true);
    } finally {
      setBusyId(null);
    }
  };

  const switchToPaper = async () => {
    setBusyId("paper");
    try {
      const r = await fetch("/api/bot/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exec: { executionMode: "paper" } }),
      });
      const j = (await r.json()) as { ok: boolean; error?: string };
      if (j.ok) notify("PAPER EXECUTION ON", "All fills simulated — safe to experiment.");
      else notify("Mode change rejected", j.error, true);
      await load();
    } catch (e) {
      notify("Action failed", (e as Error).message, true);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string) => {
    setBusyId(`${id}:del`);
    try {
      await fetch(`/api/brokers/${id}`, { method: "DELETE" });
      notify("ACCOUNT REMOVED");
      await load();
    } finally {
      setBusyId(null);
    }
  };

  /** directory pick: MT firms pre-fill the featured login card; others open their connect dialog */
  const pickFirm = (f: FirmEntry) => {
    if (f.kind === "metaapi") {
      setMtPrefill({
        server: f.servers[0] ?? "",
        platform: f.platform ?? "mt5",
        label: f.name,
        nonce: Date.now(),
      });
      notify("SERVER PRE-FILLED", `${f.name} — paste your MT login + master password, then CONNECT MT ACCOUNT.`);
      mtCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    setPresetKind(f.kind);
    setPresetLabel(f.name);
    setAddOpen(true);
  };

  return (
    <div className="space-y-4">
      {/* ── header strip ── */}
      <div className="rounded-xl border border-[#1C2A47] bg-[#0F1A30] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-bold tracking-wider text-[#E8ECF4]">BROKER CONNECTIONS · ALL PLATFORMS LIVE</div>
            <div className="text-[11px] text-[#8C98AE] mt-0.5">
              Real market orders with SL/TP. Credentials stay on this server — only masked hints reach the browser.
            </div>
          </div>
          <div
            className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[11px] font-bold tracking-wider"
            style={{
              borderColor: execMode === "live" ? "rgba(242,54,69,0.5)" : "rgba(8,153,129,0.5)",
              color: execMode === "live" ? C.red : C.green,
              background: execMode === "live" ? "rgba(242,54,69,0.07)" : "rgba(8,153,129,0.07)",
            }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: execMode === "live" ? C.red : C.green }} />
            {execMode === "live" ? `LIVE · ${execBroker ?? "broker"}` : "PAPER EXECUTION"}
          </div>
        </div>
      </div>

      {/* ── featured: MT4/MT5 direct login ── */}
      <div ref={mtCardRef} className="scroll-mt-4">
        <MtLoginCard
          notify={notify}
          onDone={() => void load()}
          prefill={mtPrefill}
          serverOptions={serverOptions}
        />
      </div>

      {/* ── broker directory · all prop firms + CFD brokers ── */}
      <DirectorySection
        query={query}
        setQuery={setQuery}
        cat={cat}
        setCat={setCat}
        firms={firms}
        onPick={pickFirm}
      />

      {/* ── connected accounts ── */}
      {rows.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] font-bold tracking-wider text-[#8C98AE]">
            CONNECTED ACCOUNTS ({rows.length})
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {rows.map((b) => {
              const meta = brokerMeta(b.kind);
              const statusColor = b.status === "ok" ? C.green : b.status === "error" ? C.red : C.gold;
              const isExecTarget = execMode === "live" && b.active;
              return (
                <div
                  key={b.id}
                  className="rounded-xl border bg-[#0F1A30] p-4"
                  style={{ borderColor: isExecTarget ? C.red : b.active ? C.gold : "#1C2A47" }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm text-[#E8ECF4] truncate">{b.label}</span>
                        <Badge variant="outline" className="text-[9px] border-[#2A3A5C] text-[#8C98AE] uppercase">
                          {meta?.name ?? b.kind}
                        </Badge>
                        {b.env && b.env !== "—" && (
                          <Badge
                            variant="outline"
                            className="text-[9px] uppercase"
                            style={{
                              borderColor: /live|real/i.test(b.env) ? "rgba(242,54,69,0.6)" : "rgba(8,153,129,0.6)",
                              color: /live|real/i.test(b.env) ? C.red : C.green,
                            }}
                          >
                            {String(b.env)}
                          </Badge>
                        )}
                      </div>
                      <div className="text-[11px] text-[#8C98AE] mt-1 truncate">{meta?.tagline}</div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className="flex items-center gap-1.5 text-[10px] font-bold tracking-wider" style={{ color: statusColor }}>
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: statusColor }} />
                        {isExecTarget ? "EXECUTING" : b.active ? "ACTIVE" : b.status.toUpperCase()}
                      </span>
                      {b.active && (
                        <Switch checked={b.active} disabled aria-label="active account" className="scale-75 pointer-events-none" />
                      )}
                    </div>
                  </div>

                  {b.statusMsg && (
                    <div
                      className="mt-2 text-[11px] font-mono rounded-md px-2 py-1.5 leading-relaxed break-words"
                      style={{
                        background: b.status === "ok" ? "rgba(8,153,129,0.08)" : "rgba(242,54,69,0.08)",
                        color: b.status === "ok" ? C.green : C.red,
                      }}
                    >
                      {b.statusMsg}
                    </div>
                  )}

                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[#5D606B] font-mono">
                    {Object.entries(b.masked).slice(0, 4).map(([k, v]) => (
                      <span key={k}>
                        {k}: <span className="text-[#8C98AE]">{v}</span>
                      </span>
                    ))}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busyId !== null}
                      onClick={() => void test(b.id)}
                      className="h-8 px-3 text-[11px] border-[#2A3A5C] text-[#E8ECF4] hover:border-[#D4AF37] hover:text-[#D4AF37] bg-transparent"
                    >
                      {busyId === `${b.id}:test` ? "TESTING…" : "TEST"}
                    </Button>
                    {!b.active && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busyId !== null}
                        onClick={() => void setActive(b.id)}
                        className="h-8 px-3 text-[11px] border-[#2A3A5C] text-[#E8ECF4] hover:border-[#089981] hover:text-[#089981] bg-transparent"
                      >
                        SET ACTIVE
                      </Button>
                    )}
                    {b.status === "ok" && !isExecTarget && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            size="sm"
                            disabled={busyId !== null}
                            className="h-8 px-3 text-[11px] bg-[#D4AF37] text-[#0B1426] hover:bg-[#E3C25A] font-bold"
                          >
                            {busyId === `${b.id}:live` ? "ARMING…" : "⚡ GO LIVE"}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="bg-[#101C33] border-[#2A3A5C] text-[#E8ECF4]">
                          <AlertDialogHeader>
                            <AlertDialogTitle className="text-[#D4AF37]">Route EA orders to {b.label}?</AlertDialogTitle>
                            <AlertDialogDescription className="text-[#8C98AE]">
                              REAL MONEY. Every C3 fire becomes a live market order on this account with SL/TP
                              attached — using the current sizing settings. Make sure the EA is started and the
                              symbol exists on this broker. Paper fallback stays one tap away.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel className="bg-transparent border-[#2A3A5C] text-[#8C98AE]">Cancel</AlertDialogCancel>
                            <AlertDialogAction className="bg-[#D4AF37] text-[#0B1426] hover:bg-[#E3C25A]" onClick={() => void goLive(b.id, b.label)}>
                              ARM LIVE ROUTING
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busyId !== null}
                          className="h-8 px-3 text-[11px] border-[#2A3A5C] text-[#8C98AE] hover:border-[#F23645] hover:text-[#F23645] bg-transparent ml-auto"
                        >
                          REMOVE
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="bg-[#101C33] border-[#2A3A5C] text-[#E8ECF4]">
                        <AlertDialogHeader>
                          <AlertDialogTitle className="text-[#D4AF37]">Remove {b.label}?</AlertDialogTitle>
                          <AlertDialogDescription className="text-[#8C98AE]">
                            Credentials are wiped. If it was the active live account, execution falls back to paper.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="bg-transparent border-[#2A3A5C] text-[#8C98AE]">Cancel</AlertDialogCancel>
                          <AlertDialogAction className="bg-[#F23645] text-white hover:bg-[#FF4D5B]" onClick={() => void remove(b.id)}>
                            Remove
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── all platforms · auto catalog ── */}
      <div className="space-y-2">
        <div className="text-[11px] font-bold tracking-wider text-[#8C98AE]">
          ALL PLATFORMS · READY TO CONNECT
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {/* paper built-in tile */}
          <div className="rounded-xl border border-[#1C2A47] bg-[#0F1A30] p-4 flex flex-col justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-sm text-[#E8ECF4]">Paper (simulated)</span>
                <Badge variant="outline" className="text-[9px] border-[rgba(8,153,129,0.6)] text-[#089981] uppercase">
                  built-in · always on
                </Badge>
              </div>
              <div className="text-[11px] text-[#8C98AE] mt-1 leading-snug">
                Instant simulated fills, no credentials. The default execution for every new session.
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={busyId !== null || execMode === "paper"}
              onClick={() => void switchToPaper()}
              className="h-8 px-3 text-[11px] border-[rgba(8,153,129,0.5)] text-[#089981] hover:bg-[rgba(8,153,129,0.08)] bg-transparent w-fit"
            >
              {execMode === "paper" ? "CURRENT MODE" : "USE PAPER"}
            </Button>
          </div>

          {/* every other platform */}
          {CATALOG_KINDS.map((kind) => {
            const meta = brokerMeta(kind);
            if (!meta) return null;
            const count = rows.filter((r) => r.kind === kind).length;
            return (
              <div key={kind} className="rounded-xl border border-[#1C2A47] bg-[#0F1A30] p-4 flex flex-col justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-sm text-[#E8ECF4]">{meta.name}</span>
                    {count > 0 && (
                      <Badge variant="outline" className="text-[9px] border-[rgba(212,175,55,0.5)] text-[#D4AF37] uppercase">
                        {count} connected
                      </Badge>
                    )}
                  </div>
                  <div className="text-[11px] text-[#8C98AE] mt-1 leading-snug">{meta.tagline}</div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setPresetKind(kind);
                    setAddOpen(true);
                  }}
                  className="h-8 px-3 text-[11px] border-[#2A3A5C] text-[#E8ECF4] hover:border-[#D4AF37] hover:text-[#D4AF37] bg-transparent w-fit"
                >
                  {count > 0 ? "ADD ANOTHER" : "CONNECT"}
                </Button>
              </div>
            );
          })}

          {/* metaapi pointer tile — the featured card handles it */}
          <div className="rounded-xl border border-[rgba(212,175,55,0.4)] bg-[rgba(212,175,55,0.05)] p-4 flex flex-col justify-between gap-3">
            <div>
              <div className="font-bold text-sm text-[#E8ECF4]">MT4 / MT5 · MetaApi</div>
              <div className="text-[11px] text-[#8C98AE] mt-1 leading-snug">
                Your broker&apos;s MT login works here — use the gold MT4/MT5 LOGIN card at the top of this page.
              </div>
            </div>
            <Badge variant="outline" className="text-[9px] border-[rgba(212,175,55,0.5)] text-[#D4AF37] uppercase w-fit">
              direct login above
            </Badge>
          </div>
        </div>
      </div>

      {rows.length === 0 && loading && (
        <div className="rounded-xl border border-dashed border-[#2A3A5C] bg-[#0F1A30] p-8 text-center text-[#8C98AE] text-sm">
          Loading broker connections…
        </div>
      )}

      {/* connect dialog for the other platforms */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <AddBrokerDialog
          presetKind={presetKind}
          presetLabel={presetLabel}
          onDone={() => {
            setAddOpen(false);
            void load();
          }}
          notify={notify}
        />
      </Dialog>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
//  MT4 / MT5 LOGIN CARD · paste broker MT credentials → auto-provision
// ════════════════════════════════════════════════════════════════════════

function MtLoginCard({
  notify,
  onDone,
  prefill,
  serverOptions,
}: {
  notify: Props["notify"];
  onDone: () => void;
  prefill?: { server: string; platform: "mt4" | "mt5"; label: string; nonce: number } | null;
  serverOptions?: string[];
}) {
  const [platform, setPlatform] = useState<"mt5" | "mt4">("mt5");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [server, setServer] = useState("");
  const [token, setToken] = useState("");
  const [label, setLabel] = useState("");
  const [goLive, setGoLive] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [platKey, setPlatKey] = useState<"active" | "expired" | "missing" | null>(null); // platform key status
  const [cloud, setCloud] = useState<"live" | "down" | null>(null); // MetaApi cloud reachability

  useEffect(() => {
    fetch("/api/brokers/mt-login", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { platformKey?: boolean; jwtValid?: boolean; reachable?: boolean }) => {
        setPlatKey(j.platformKey ? (j.jwtValid === false ? "expired" : "active") : "missing");
        setCloud(j.reachable ? "live" : "down");
      })
      .catch(() => {
        setPlatKey("missing");
        setCloud("down");
      });
  }, []);

  // directory pick: pre-fill server / platform / label (identity bumps on every pick)
  useEffect(() => {
    if (!prefill) return;
    setPlatform(prefill.platform);
    setServer(prefill.server);
    setLabel(prefill.label);
  }, [prefill]);

  const submit = async () => {
    setError("");
    if (!advanced && (!login.trim() || !password || !server.trim())) {
      setError("Enter your MT login, password and server — exactly as shown in your MT4/MT5 terminal.");
      return;
    }
    if (advanced && !accountId.trim() && (!login.trim() || !password || !server.trim())) {
      setError("Provide either your MT login details, or paste an existing MetaApi account ID under Advanced.");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/brokers/mt-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: token.trim() || undefined, // optional — the platform key built into this deployment is used when empty
          platform,
          login: login.trim(),
          password,
          server: server.trim(),
          label: label.trim() || undefined,
          accountId: advanced && accountId.trim() ? accountId.trim() : undefined,
        }),
      });
      const j = (await r.json()) as {
        ok: boolean; id?: string; status?: string; statusMsg?: string; autoActivated?: boolean; error?: string;
      };
      if (!j.ok) {
        setError(j.error ?? "MT connection failed");
        notify("MT CONNECTION FAILED", j.error, true);
        return;
      }
      if (j.status === "ok") {
        notify(
          j.autoActivated ? "MT ACCOUNT CONNECTED · ACTIVE" : "MT ACCOUNT CONNECTED",
          j.statusMsg ?? "Balance fetched from your broker." + (j.autoActivated ? " Account set ACTIVE automatically — GO LIVE is one tap." : "")
        );
      } else {
        notify("ADDED — BUT TEST FAILED", j.statusMsg ?? "Deployment may still be running — press TEST on the account card in a minute.", true);
      }
      // one-click arm live routing when requested and the test passed
      if (goLive && j.id && j.status === "ok") {
        const ar = await fetch(`/api/brokers/${j.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "activate", andGoLive: true }),
        });
        const aj = (await ar.json()) as { ok: boolean; liveArmed?: boolean; warn?: string };
        if (aj.ok && aj.liveArmed) {
          notify("LIVE AUTOTRADING ARMED", "Start the EA and every C3 fire executes on your MT account with SL/TP.");
        } else {
          notify("Not live yet", aj.warn ?? "Run TEST, then press GO LIVE on the account card.", true);
        }
      }
      // wipe secrets from the form
      setPassword("");
      setToken("");
      setAccountId("");
      onDone();
    } catch (e) {
      setError((e as Error).message);
      notify("MT connection failed", (e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-[#D4AF37] bg-[rgba(212,175,55,0.04)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-bold tracking-wider text-[#D4AF37]">MT4 / MT5 LOGIN · JUST YOUR BROKER LOGIN DETAILS</div>
          <div className="text-[11px] text-[#8C98AE] mt-0.5 max-w-2xl leading-relaxed">
            Works with virtually any MT4/MT5 broker — IC Markets, Pepperstone, XM, Exness, FTMO, Vantage, Deriv, Axi, FxPro…
            Every broker API is already built into HALO — nothing to install, no keys to wire up. Paste your MT login
            details and the system provisions everything automatically, then the built-in EA autotrades the account live.
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <span
            className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[9px] font-extrabold tracking-[0.12em] border"
            style={
              platKey === "active" && cloud === "live"
                ? { borderColor: "rgba(8,153,129,0.6)", color: C.green, background: "rgba(8,153,129,0.08)" }
                : { borderColor: "rgba(212,175,55,0.6)", color: C.gold, background: "rgba(212,175,55,0.08)" }
            }
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: platKey === "active" && cloud === "live" ? C.green : C.gold }} />
            {platKey === null
              ? "CHECKING PLATFORM…"
              : platKey === "active"
                ? cloud === "live"
                  ? "BROKER CLOUD · LIVE"
                  : "BROKER CLOUD · UNREACHABLE"
                : platKey === "expired"
                  ? "PLATFORM KEY · EXPIRED — OVERRIDE BELOW"
                  : "PLATFORM KEY · MISSING"}
          </span>
          <Badge variant="outline" className="text-[9px] border-[#D4AF37] text-[#D4AF37] uppercase">
            recommended
          </Badge>
        </div>
      </div>

      {/* ── how-to steps ── */}
      <ol className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] leading-relaxed">
        {[
          <>
            Nothing to install — every broker API (MT4/MT5 cloud bridge, OANDA, IG, Binance, bridges) already ships inside
            this app. No manual API adding, ever.
          </>,
          <>
            Enter your MT <span className="text-[#E8ECF4]">login</span> (account number),{" "}
            <span className="text-[#E8ECF4]">master password</span> and <span className="text-[#E8ECF4]">server</span> —
            exactly as they appear in your MT4/MT5 terminal&apos;s login window.
          </>,
          <>
            Press <span className="text-[#D4AF37]">CONNECT MT ACCOUNT</span> — HALO provisions + deploys the cloud
            connection from your login details automatically, auto-tests it, shows your balance and sets the account
            <span className="text-[#E8ECF4]"> ACTIVE</span> for live routing.
          </>,
          <>
            Press <span className="text-[#D4AF37]">GO LIVE</span> on the account card (or flip the switch below),{" "}
            <span className="text-[#E8ECF4]">START</span> the EA — every C3 fire is sent to your MT account as a real
            market order with SL/TP.
          </>,
        ].map((step, i) => (
          <li key={i} className="flex gap-2 rounded-lg border border-[#1C2A47] bg-[#0F1A30] px-3 py-2">
            <span className="shrink-0 h-5 w-5 rounded-full bg-[#D4AF37] text-[#0B1426] text-[10px] font-bold flex items-center justify-center">
              {i + 1}
            </span>
            <span className="text-[#8C98AE]">{step}</span>
          </li>
        ))}
      </ol>

      {/* ── form ── */}
      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="PLATFORM">
          <div className="grid grid-cols-2 gap-2">
            {(["mt5", "mt4"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPlatform(p)}
                className={`h-9 rounded-lg text-[11px] font-bold uppercase tracking-wider border ${
                  platform === p ? "border-[#D4AF37] text-[#D4AF37]" : "border-[#1C2A47] text-[#8C98AE]"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </Field>
        <Field label="MT ACCOUNT (LOGIN)">
          <Input
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            placeholder="e.g. 51234567"
            aria-label="MT login"
            autoComplete="off"
            className="h-9 bg-[#0B1426] border-[#1C2A47] text-sm text-[#E8ECF4]"
          />
        </Field>
        <Field label="MT PASSWORD (MASTER)">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="your trading password — not the investor/read-only one"
            aria-label="MT password"
            autoComplete="new-password"
            className="h-9 bg-[#0B1426] border-[#1C2A47] text-sm text-[#E8ECF4]"
          />
        </Field>
        <Field label="SERVER" hint="Copy it from the MT4/MT5 login window — suggestions appear as you type.">
          <Input
            value={server}
            onChange={(e) => setServer(e.target.value)}
            placeholder={platform === "mt5" ? "ICMarketsSC-MT5" : "ICMarketsSC-MT4"}
            list="mt-server-suggestions"
            aria-label="MT server"
            autoComplete="off"
            className="h-9 bg-[#0B1426] border-[#1C2A47] text-sm text-[#E8ECF4]"
          />
          <datalist id="mt-server-suggestions">
            {(serverOptions && serverOptions.length > 0 ? serverOptions : MT_SERVERS).map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Field>
        <Field label="LABEL (OPTIONAL)">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="IC Markets gold · live"
            aria-label="MT account label"
            className="h-9 bg-[#0B1426] border-[#1C2A47] text-sm text-[#E8ECF4]"
          />
        </Field>
      </div>

      {/* advanced: existing MetaApi account / optional token override */}
      <button
        type="button"
        onClick={() => setAdvanced((v) => !v)}
        className="mt-3 text-[11px] text-[#8C98AE] hover:text-[#D4AF37] tracking-wider"
      >
        {advanced ? "▾" : "▸"} ADVANCED — EXISTING METAAPI ACCOUNT / TOKEN OVERRIDE
      </button>
      {advanced && (
        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3 max-w-2xl">
          <Field
            label="METAAPI ACCOUNT ID (OPTIONAL)"
            hint="Skips auto-provisioning — HALO connects straight to this account."
          >
            <Input
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              placeholder="uuid of the account in app.metaapi.cloud"
              aria-label="MetaApi account id"
              className="h-9 bg-[#0B1426] border-[#1C2A47] text-xs font-mono text-[#E8ECF4]"
            />
          </Field>
          <Field
            label="METAAPI TOKEN OVERRIDE (OPTIONAL)"
            hint={
              platKey
                ? "Leave empty — this deployment's built-in platform key is used automatically."
                : "This deployment has no built-in platform key yet — paste a free token from app.metaapi.cloud, or ask the operator to set METAAPI_TOKEN on the server."
            }
          >
            <Input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="eyJhbGciOi… (only if the platform key is missing)"
              aria-label="MetaApi token override"
              autoComplete="off"
              className="h-9 bg-[#0B1426] border-[#1C2A47] text-sm text-[#E8ECF4]"
            />
          </Field>
        </div>
      )}

      {/* go-live switch + submit */}
      <div className="mt-4 flex flex-col md:flex-row md:items-center gap-3">
        <div className="flex items-center gap-2 flex-1">
          <Switch checked={goLive} onCheckedChange={setGoLive} aria-label="go live after connect" />
          <span className="text-[11px] text-[#E8ECF4]">
            Route EA live orders here immediately after connect
            <span className="text-[#8C98AE]"> — real money, every C3 fire executes on this account.</span>
          </span>
        </div>
        <Button
          onClick={() => void submit()}
          disabled={busy}
          className="h-10 px-5 rounded-lg bg-[#D4AF37] text-[#0B1426] hover:bg-[#E3C25A] font-bold text-xs tracking-wider shrink-0"
        >
          {busy ? "PROVISIONING · DEPLOYING · TESTING (up to 1 min)" : "CONNECT MT ACCOUNT"}
        </Button>
      </div>

      {error && (
        <div className="mt-3 text-[11px] font-mono rounded-md px-2 py-1.5 leading-relaxed bg-[rgba(242,54,69,0.08)] text-[#F23645] break-words">
          {error}
        </div>
      )}

      <div className="mt-3 text-[10px] text-[#5D606B] leading-relaxed">
        Broker APIs are part of the system — your MT login details are the only input. Autotrading checklist: account TEST
        passes · GO LIVE armed · EA started on the dashboard · a scanned symbol fires C3 → market order with SL/TP hits your
        MT terminal instantly. Telegram/email/push alerts fire on every fill.
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
//  BROKER DIRECTORY · every prop firm + CFD broker, one tap to connect
// ════════════════════════════════════════════════════════════════════════

function DirectorySection({
  query,
  setQuery,
  cat,
  setCat,
  firms,
  onPick,
}: {
  query: string;
  setQuery: (v: string) => void;
  cat: DirectoryCategory;
  setCat: (c: DirectoryCategory) => void;
  firms: FirmEntry[];
  onPick: (f: FirmEntry) => void;
}) {
  const props = firms.filter((f) => f.category === "prop");
  const cfds = firms.filter((f) => f.category === "cfd");
  const propTotal = BROKER_DIRECTORY.filter((x) => x.category === "prop").length;
  const cfdTotal = BROKER_DIRECTORY.filter((x) => x.category === "cfd").length;

  const tile = (f: FirmEntry) => (
    <button
      key={f.id}
      type="button"
      onClick={() => onPick(f)}
      aria-label={`Connect ${f.name}`}
      className="text-left rounded-xl border border-[#1C2A47] bg-[#0F1A30] p-3 transition-colors hover:border-[#D4AF37] group"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-bold text-sm text-[#E8ECF4] group-hover:text-[#D4AF37]">{f.name}</span>
        <Badge
          variant="outline"
          className="text-[8px] uppercase shrink-0"
          style={{
            borderColor: f.category === "prop" ? "rgba(212,175,55,0.55)" : "rgba(140,152,174,0.4)",
            color: f.category === "prop" ? C.gold : "#8C98AE",
          }}
        >
          {f.category === "prop" ? "PROP" : "CFD"}
        </Badge>
      </div>
      <div className="text-[10px] text-[#8C98AE] mt-1 leading-snug">{f.assets}</div>
      {f.servers[0] ? (
        <div className="mt-2 text-[9px] font-mono text-[#5D606B] truncate">
          <span className="text-[#8C98AE]">server:</span> {f.servers[0]}
          {f.servers.length > 1 && <span className="text-[#5D606B]"> +{f.servers.length - 1}</span>}
        </div>
      ) : (
        <div className="mt-2 text-[9px] font-mono text-[#5D606B] truncate">{viaLabel(f.kind)}</div>
      )}
      {f.note && <div className="mt-1.5 text-[9px] text-[#5D606B] leading-snug line-clamp-2">{f.note}</div>}
      <div
        className="mt-2 text-[10px] font-bold tracking-wider text-[#D4AF37] opacity-0 group-hover:opacity-100 transition-opacity"
      >
        CONNECT →
      </div>
    </button>
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] font-bold tracking-wider text-[#8C98AE]">
          BROKER DIRECTORY · {BROKER_DIRECTORY.length} PROP FIRMS & CFD BROKERS · PICK YOURS
        </div>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search firm, broker or server…"
          aria-label="Search broker directory"
          className="h-8 w-56 bg-[#0B1426] border-[#1C2A47] text-[11px] text-[#E8ECF4] placeholder:text-[#5D606B]"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {([
          ["all", `ALL (${BROKER_DIRECTORY.length})`],
          ["prop", `PROP FIRMS (${propTotal})`],
          ["cfd", `CFD BROKERS (${cfdTotal})`],
        ] as [DirectoryCategory, string][]).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setCat(key)}
            className={`h-8 px-3 rounded-lg text-[10px] font-bold tracking-wider border transition-colors ${
              cat === key ? "border-[#D4AF37] text-[#D4AF37]" : "border-[#1C2A47] text-[#8C98AE] hover:border-[#2A3A5C]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {firms.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#2A3A5C] bg-[#0F1A30] p-6 text-center text-[11px] text-[#8C98AE]">
          No firm matches &ldquo;{query}&rdquo; — the MT4/MT5 LOGIN card above accepts <span className="text-[#E8ECF4]">any</span> MT
          broker on earth: paste your login · password · server.
        </div>
      ) : (
        <>
          {(cat === "all" || cat === "prop") && props.length > 0 && (
            <div className="space-y-2">
              {cat === "all" && (
                <div className="text-[10px] font-bold tracking-wider text-[#D4AF37]">
                  PROP FIRMS — FUNDED ACCOUNTS ({props.length})
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">{props.map(tile)}</div>
            </div>
          )}
          {(cat === "all" || cat === "cfd") && cfds.length > 0 && (
            <div className="space-y-2">
              {cat === "all" && (
                <div className="text-[10px] font-bold tracking-wider text-[#8C98AE]">CFD BROKERS ({cfds.length})</div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">{cfds.map(tile)}</div>
            </div>
          )}
        </>
      )}

      <div className="text-[10px] text-[#5D606B] leading-relaxed">
        MT4/MT5 firms connect with your broker login (login · master password · server — pre-filled from this directory).
        Futures desks (Topstep, Apex…) and platform-native props route through the webhook bridge. Every adapter is part
        of the system — nothing to install, no API keys to add.
      </div>
    </div>
  );
}

// ───────────────────────── add-broker dialog (other platforms) ─────────────────────────

function AddBrokerDialog({
  presetKind,
  presetLabel,
  onDone,
  notify,
}: {
  presetKind: string;
  presetLabel?: string;
  onDone: () => void;
  notify: Props["notify"];
}) {
  const [kind, setKind] = useState<string>(presetKind);
  const [label, setLabel] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [symbolMap, setSymbolMap] = useState("");
  const [busy, setBusy] = useState(false);
  const meta = brokerMeta(kind);

  // follow preset changes when the dialog reopens
  useEffect(() => {
    setKind(presetKind);
    setValues({});
    setLabel(presetLabel ?? "");
    setSymbolMap("");
  }, [presetKind, presetLabel]);

  const pickKind = (k: string) => {
    setKind(k);
    setValues({});
    setLabel("");
    setSymbolMap("");
  };

  const save = async () => {
    if (!meta) return;
    setBusy(true);
    try {
      const creds: Record<string, unknown> = { ...values };
      creds.environment = creds.environment ?? meta.fields.find((f) => f.key === "environment")?.options?.[0];
      if (symbolMap.trim()) {
        try {
          creds.symbolMap = JSON.parse(symbolMap);
        } catch {
          notify("Symbol map is not valid JSON", undefined, true);
          setBusy(false);
          return;
        }
      }
      const r = await fetch("/api/brokers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, label: label || meta.name, creds }),
      });
      const j = (await r.json()) as { ok: boolean; error?: string; id?: string };
      if (!j.ok) {
        notify("Could not add broker", j.error, true);
        setBusy(false);
        return;
      }
      // immediately test
      if (j.id) {
        const tr = await fetch(`/api/brokers/${j.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "test" }),
        });
        const tj = (await tr.json()) as { ok: boolean; status?: string; statusMsg?: string };
        notify(
          tj.status === "ok" ? "BROKER CONNECTED" : "ADDED — BUT TEST FAILED",
          tj.statusMsg,
          tj.status !== "ok"
        );
      }
      onDone();
    } catch (e) {
      notify("Save failed", (e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent className="bg-[#101C33] border-[#2A3A5C] text-[#E8ECF4] max-w-lg max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="text-[#D4AF37] text-base">Connect a CFD broker</DialogTitle>
        <DialogDescription className="text-[#8C98AE] text-xs">
          Pick a platform, paste its API credentials, then TEST. GO LIVE afterwards routes the EA&apos;s real orders there.
        </DialogDescription>
      </DialogHeader>

      <div className="grid grid-cols-2 gap-2">
        {BROKERS.filter((b) => b.kind !== "paper").map((b) => (
          <button
            key={b.kind}
            onClick={() => pickKind(b.kind)}
            className={`text-left rounded-lg border px-3 py-2 transition-colors ${
              kind === b.kind ? "border-[#D4AF37] bg-[rgba(212,175,55,0.08)]" : "border-[#1C2A47] hover:border-[#2A3A5C]"
            }`}
          >
            <div className="text-xs font-bold text-[#E8ECF4]">{b.name}</div>
            <div className="text-[10px] text-[#8C98AE] leading-snug mt-0.5 line-clamp-2">{b.tagline}</div>
          </button>
        ))}
      </div>

      {meta && (
        <div className="space-y-3 pt-1">
          <Field label="LABEL">
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={meta.name}
              className="h-9 bg-[#0B1426] border-[#1C2A47] text-sm text-[#E8ECF4]"
            />
          </Field>
          {meta.fields.map((f) => (
            <Field key={f.key} label={f.label} hint={f.hint}>
              <CredInput field={f} value={values[f.key] ?? ""} onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))} />
            </Field>
          ))}
          <Field
            label="SYMBOL MAP (optional, JSON)"
            hint='internal → broker symbol, e.g. {"PAXGUSDT":"XAU_USD"}'
          >
            <Input
              value={symbolMap}
              onChange={(e) => setSymbolMap(e.target.value)}
              placeholder='{"PAXGUSDT":"XAU_USD"}'
              className="h-9 bg-[#0B1426] border-[#1C2A47] text-xs font-mono text-[#E8ECF4]"
            />
          </Field>
          {meta.notes.length > 0 && (
            <ul className="text-[10px] text-[#8C98AE] leading-relaxed list-disc pl-4 space-y-0.5">
              {meta.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <DialogFooter>
        <Button
          onClick={() => void save()}
          disabled={busy || !meta}
          className="w-full h-10 rounded-lg bg-[#D4AF37] text-[#0B1426] hover:bg-[#E3C25A] font-bold text-xs tracking-wider"
        >
          {busy ? "CONNECTING…" : "CONNECT + TEST"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] tracking-wider text-[#8C98AE]">{label}</label>
      {children}
      {hint && <div className="text-[10px] text-[#5D606B] leading-snug">{hint}</div>}
    </div>
  );
}

function CredInput({ field, value, onChange }: { field: CredField; value: string; onChange: (v: string) => void }) {
  if (field.type === "switch") {
    return (
      <div className="flex items-center gap-2 h-9">
        <Switch checked={value === "yes"} onCheckedChange={(c) => onChange(c ? "yes" : "")} />
        <span className="text-xs text-[#8C98AE]">{value === "yes" ? "enabled" : "disabled"}</span>
      </div>
    );
  }
  if (field.type === "select") {
    return (
      <div className="grid grid-cols-2 gap-2">
        {(field.options ?? []).map((o) => (
          <button
            key={o}
            onClick={() => onChange(o)}
            className={`h-9 rounded-lg text-[11px] font-bold uppercase tracking-wider border ${
              value === o ? "border-[#D4AF37] text-[#D4AF37]" : "border-[#1C2A47] text-[#8C98AE]"
            }`}
          >
            {o}
          </button>
        ))}
      </div>
    );
  }
  return (
    <Input
      type={field.type === "password" ? "password" : "text"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.placeholder}
      autoComplete="off"
      className="h-9 bg-[#0B1426] border-[#1C2A47] text-sm text-[#E8ECF4]"
    />
  );
}
