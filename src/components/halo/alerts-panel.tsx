"use client";

// ════════════════════════════════════════════════════════════════════════
//  ALERTS PANEL · Telegram · Email (SMTP) · Browser web-push
//  Event matrix + per-channel tests + delivery history.
// ════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { C } from "@/lib/halo/ui-helpers";

interface EventsCfg {
  fire: boolean;
  win: boolean;
  loss: boolean;
  scanner: boolean;
  broker: boolean;
  status: boolean;
}

interface Settings {
  telegramEnabled: boolean;
  telegramBotToken: string;
  telegramChatId: string;
  emailEnabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
  smtpFrom: string;
  smtpTo: string;
  pushEnabled: boolean;
  events: EventsCfg;
  vapidPublicKey: string;
}

interface LogRow {
  id: string;
  kind: string;
  channel: string;
  title: string;
  body: string;
  ok: boolean;
  error: string;
  createdAt: string;
}

interface Props {
  notify: (title: string, desc?: string, bad?: boolean) => void;
}

const EVENT_LABELS: Array<[keyof EventsCfg, string]> = [
  ["fire", "TRADE FIRED"],
  ["win", "TP HIT"],
  ["loss", "SL HIT"],
  ["scanner", "SCANNER SIGNAL"],
  ["broker", "BROKER ERRORS"],
  ["status", "BOT START / STOP"],
];

export function AlertsPanel({ notify }: Props) {
  const [s, setS] = useState<Settings | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [r1, r2] = await Promise.all([
        fetch("/api/alerts/settings", { cache: "no-store" }),
        fetch("/api/alerts/log", { cache: "no-store" }),
      ]);
      const j1 = (await r1.json()) as { settings?: Settings };
      const j2 = (await r2.json()) as { log?: LogRow[] };
      if (j1.settings) setS(j1.settings);
      if (j2.log) setLog(j2.log);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 12000);
    return () => clearInterval(id);
  }, [load]);

  const patch = (p: Partial<Settings>) => setS((old) => (old ? { ...old, ...p } : old));

  const save = async () => {
    if (!s) return;
    setBusy("save");
    try {
      const r = await fetch("/api/alerts/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(s),
      });
      const j = (await r.json()) as { ok: boolean; error?: string };
      notify(j.ok ? "ALERT SETTINGS SAVED" : "SAVE FAILED", j.error, !j.ok);
      await load();
    } finally {
      setBusy(null);
    }
  };

  const test = async (channel: "telegram" | "email" | "push" | "all") => {
    setBusy(`test:${channel}`);
    try {
      const r = await fetch("/api/alerts/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel }),
      });
      const j = (await r.json()) as {
        result?: { telegram?: { ok: boolean; error?: string }; email?: { ok: boolean; error?: string }; push?: { ok: boolean; error?: string; sent?: number } };
      };
      const res = j.result ?? {};
      const parts: string[] = [];
      if (res.telegram) parts.push(`Telegram: ${res.telegram.ok ? "sent" : res.telegram.error}`);
      if (res.email) parts.push(`Email: ${res.email.ok ? "sent" : res.email.error}`);
      if (res.push) parts.push(`Push: ${res.push.ok ? `sent ×${res.push.sent}` : res.push.error}`);
      const okAll = Object.values(res).every((x) => x?.ok);
      notify(okAll ? "TEST ALERTS DELIVERED" : "TEST PARTIALLY FAILED", parts.join(" · "), !okAll);
      await load();
    } finally {
      setBusy(null);
    }
  };

  const enablePush = async () => {
    setBusy("push");
    try {
      if (typeof Notification === "undefined") {
        notify("Push unsupported", "This browser has no Notification API.", true);
        return;
      }
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        notify("Permission denied", "Allow notifications in the browser to receive push alerts.", true);
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const keyRes = await fetch("/api/push");
      const keyJson = (await keyRes.json()) as { publicKey?: string };
      if (!keyJson.publicKey) {
        notify("No VAPID key", "Server could not provide a public key.", true);
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8(keyJson.publicKey) as BufferSource,
      });
      await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      notify("DEVICE SUBSCRIBED", "This browser now receives HALO 3EL push alerts.");
      await test("push");
    } catch (e) {
      notify("Push setup failed", (e as Error).message, true);
    } finally {
      setBusy(null);
    }
  };

  if (!s) {
    return <div className="rounded-xl border border-[#1C2A47] bg-[#0F1A30] h-40 animate-pulse" />;
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
      {/* left: channels */}
      <div className="space-y-4">
        <Card title="TELEGRAM" accent={C.green} right={<Switch checked={s.telegramEnabled} onCheckedChange={(c) => patch({ telegramEnabled: c })} />}>
          <InputRow label="BOT TOKEN" masked={s.telegramBotToken} onChange={(v) => patch({ telegramBotToken: v })} placeholder="123456:ABC-DEF…  from @BotFather" />
          <InputRow label="CHAT ID" value={s.telegramChatId} onChange={(v) => patch({ telegramChatId: v })} placeholder="e.g. 812345678 or @channelname" />
          <p className="text-[10px] text-[#5D606B] leading-snug">
            1 · Create a bot with @BotFather → copy the token. 2 · Send any message to your bot. 3 · Open
            api.telegram.org/bot&lt;token&gt;/getUpdates in a browser → copy chat.id.
          </p>
          <TestBtn onClick={() => void test("telegram")} busy={busy === "test:telegram"} />
        </Card>

        <Card title="EMAIL · SMTP" accent="#D4AF37" right={<Switch checked={s.emailEnabled} onCheckedChange={(c) => patch({ emailEnabled: c })} />}>
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2"><InputRow label="SMTP HOST" value={s.smtpHost} onChange={(v) => patch({ smtpHost: v })} placeholder="smtp.gmail.com" compact /></div>
            <div className="col-span-1"><InputRow label="PORT" value={String(s.smtpPort)} onChange={(v) => patch({ smtpPort: Number(v) || 587 })} compact /></div>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-[#1C2A47] bg-[#0B1426] px-3 py-2">
            <span className="text-[10px] tracking-wider text-[#8C98AE]">SSL / TLS (465)</span>
            <Switch checked={s.smtpSecure} onCheckedChange={(c) => patch({ smtpSecure: c, smtpPort: c ? 465 : 587 })} />
          </div>
          <InputRow label="USERNAME" value={s.smtpUser} onChange={(v) => patch({ smtpUser: v })} placeholder="you@gmail.com" />
          <InputRow label="PASSWORD" masked={s.smtpPass} onChange={(v) => patch({ smtpPass: v })} placeholder="app password (not your login)" />
          <InputRow label="FROM" value={s.smtpFrom} onChange={(v) => patch({ smtpFrom: v })} placeholder="you@gmail.com" />
          <InputRow label="TO" value={s.smtpTo} onChange={(v) => patch({ smtpTo: v })} placeholder="alerts@yourmail.com" />
          <TestBtn onClick={() => void test("email")} busy={busy === "test:email"} />
        </Card>

        <Card title="BROWSER PUSH" accent="#8C98AE" right={<Switch checked={s.pushEnabled} onCheckedChange={(c) => patch({ pushEnabled: c })} />}>
          <p className="text-[11px] text-[#8C98AE] leading-relaxed">
            Install the PWA (address-bar install button) and subscribe this device — fires, TP/SL and scanner
            signals arrive even when the tab is closed. VAPID keys are generated automatically.
          </p>
          <Button
            onClick={() => void enablePush()}
            disabled={busy !== null}
            className="w-full h-10 rounded-lg bg-[#16233D] text-[#E8ECF4] hover:bg-[#1C2A47] border border-[#2A3A5C] font-bold text-xs tracking-wider"
          >
            {busy === "push" || busy === "test:push" ? "SUBSCRIBING…" : "ENABLE PUSH ON THIS DEVICE"}
          </Button>
          <TestBtn label="SEND TEST PUSH" onClick={() => void test("push")} busy={busy === "test:push"} />
        </Card>

        <Button
          onClick={() => void save()}
          disabled={busy !== null}
          className="w-full h-11 rounded-lg bg-[#D4AF37] text-[#0B1426] hover:bg-[#E3C25A] font-bold text-sm tracking-wider"
        >
          {busy === "save" ? "SAVING…" : "SAVE ALERT SETTINGS"}
        </Button>
      </div>

      {/* right: event matrix + log */}
      <div className="space-y-4">
        <Card title="EVENT MATRIX" accent="#D4AF37">
          <div className="space-y-1.5">
            {EVENT_LABELS.map(([k, label]) => (
              <div key={k} className="flex items-center justify-between rounded-lg border border-[#1C2A47] bg-[#0B1426] px-3 py-2">
                <span className="text-[11px] font-bold tracking-wider text-[#E8ECF4]">{label}</span>
                <Switch
                  checked={s.events[k]}
                  onCheckedChange={(c) => patch({ events: { ...s.events, [k]: c } })}
                />
              </div>
            ))}
          </div>
        </Card>

        <Card title="DELIVERY LOG" accent={C.gray}>
          <div className="max-h-96 overflow-y-auto space-y-1.5 pr-1 halo-scroll">
            {log.length === 0 && <div className="text-[11px] text-[#5D606B] py-3 text-center">No alerts yet — run a test or wait for a signal.</div>}
            {log.map((l) => (
              <div key={l.id} className="rounded-lg border border-[#1C2A47] bg-[#0B1426] px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-bold tracking-wider" style={{ color: l.ok ? C.green : C.red }}>
                    {l.channel.toUpperCase()} {l.ok ? "✓" : "✕"}
                  </span>
                  <span className="text-[9px] text-[#5D606B] font-mono uppercase">
                    {l.kind} · {new Date(l.createdAt).toLocaleTimeString("en-GB")}
                  </span>
                </div>
                <div className="text-[11px] text-[#E8ECF4] mt-0.5 truncate">{l.title}</div>
                {l.error && <div className="text-[10px] text-[#F23645] mt-0.5 truncate font-mono">{l.error}</div>}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Card({
  title, accent, right, children,
}: {
  title: string;
  accent: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[#1C2A47] bg-[#0F1A30] overflow-hidden">
      <div className="px-4 py-3 border-b border-[#1C2A47] flex items-center justify-between">
        <span className="text-xs font-bold tracking-wider" style={{ color: accent }}>{title}</span>
        {right}
      </div>
      <div className="p-4 space-y-2.5">{children}</div>
    </div>
  );
}

function InputRow({
  label, value, masked, onChange, placeholder, compact,
}: {
  label: string;
  value?: string;
  masked?: string;
  onChange: (v: string) => void;
  placeholder?: string;
  compact?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const shown = editing ? draft : masked ?? value ?? "";
  return (
    <div className={compact ? "space-y-0.5" : "space-y-1"}>
      <label className="text-[10px] tracking-wider text-[#8C98AE]">{label}</label>
      <Input
        value={shown}
        onChange={(e) => {
          setDraft(e.target.value);
          setEditing(true);
          onChange(e.target.value);
        }}
        placeholder={placeholder}
        type={masked !== undefined && !editing ? "text" : "text"}
        autoComplete="off"
        className="h-9 bg-[#0B1426] border-[#1C2A47] text-xs font-mono text-[#E8ECF4]"
      />
    </div>
  );
}

function TestBtn({ onClick, busy, label = "SEND TEST" }: { onClick: () => void; busy?: boolean; label?: string }) {
  return (
    <Button
      variant="outline"
      onClick={onClick}
      disabled={busy}
      className="w-full h-9 rounded-lg border-[#2A3A5C] text-[#E8ECF4] hover:border-[#D4AF37] hover:text-[#D4AF37] bg-transparent text-[11px] font-bold tracking-wider"
    >
      {busy ? "SENDING…" : label}
    </Button>
  );
}

function urlB64ToUint8(b64: string): Uint8Array {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const b = (b64 + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
