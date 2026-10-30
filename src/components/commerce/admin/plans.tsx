"use client";

// ══════════════════════════════════════════════════════════════════════════
//  ADMIN · PLANS & FEATURES — Super-Administrator configuration. Changing a
//  plan affects NEW purchases only; existing licenses keep the entitlement
//  snapshot captured at issuance (preserved server-side).
// ══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { A, C } from "@/lib/halo/ui-helpers";
import { ActBtn, api, Note, SectionHead, StatusPill, TableWrap, Td, Th } from "./kit";

interface PlanRow {
  id: string; code: string; name: string; tagline: string; description: string;
  priceCents: number; currency: string; promoPriceCents: number | null;
  deviceLimit: number; features: string[]; active: boolean; displayOrder: number; icon: string;
}
interface FeatureDef { key: string; label: string; minPlan: number; group?: string }

const fieldCss: React.CSSProperties = { background: "#000714", border: "1px solid #1C4478", color: "#EAF3FF" };

export function AdminPlans() {
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [catalog, setCatalog] = useState<FeatureDef[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const [edit, setEdit] = useState<PlanRow | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const j = await api<{ plans: PlanRow[]; catalog: FeatureDef[] }>("/api/admin/plans");
    if (j.ok) { setPlans(j.plans); setCatalog(j.catalog); }
    else setErr(j.error ?? "Failed to load plans.");
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const save = async () => {
    if (!edit) return;
    setBusy(true);
    const j = await api<{ note?: string }>("/api/admin/plans", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: edit.id, name: edit.name, tagline: edit.tagline, description: edit.description,
        priceCents: edit.priceCents, currency: edit.currency,
        promoPriceCents: edit.promoPriceCents, deviceLimit: edit.deviceLimit,
        featureKeys: edit.features, active: edit.active, displayOrder: edit.displayOrder,
      }),
    });
    setBusy(false);
    setNote({ text: j.ok ? "Plan saved — existing licenses keep their original entitlement snapshot; only new purchases use the new configuration." : j.error ?? "Save failed.", bad: !j.ok });
    if (j.ok) { setEdit(null); await load(); }
  };

  if (err) return <div className="rounded-lg px-3 py-2.5 text-[11.5px]" style={{ background: A.red(0.1), color: C.red }}>{err}</div>;

  return (
    <div>
      <SectionHead title="Plans & Features" sub="Prices, device limits, entitlements and availability — Super Administrator only" />
      <div className="mb-3"><Note note={note} /></div>

      <TableWrap maxH={420}>
        <table className="w-full border-collapse">
          <thead>
            <tr><Th>Plan</Th><Th>Price</Th><Th>Promo</Th><Th>Devices</Th><Th>Features</Th><Th>Order</Th><Th>Availability</Th><Th w="1%">Actions</Th></tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.id} className="transition-colors hover:bg-[#041a36]">
                <Td><span className="font-bold" style={{ color: C.txt }}>{p.name}</span><div className="text-[9.5px]" style={{ color: C_DIM }}>{p.tagline}</div></Td>
                <Td mono>{(p.priceCents / 100).toLocaleString("en-US", { style: "currency", currency: p.currency, maximumFractionDigits: 0 })}</Td>
                <Td mono>{p.promoPriceCents ? (p.promoPriceCents / 100).toLocaleString("en-US", { style: "currency", currency: p.currency, maximumFractionDigits: 0 }) : "—"}</Td>
                <Td>{p.deviceLimit}</Td>
                <Td>{p.features.length}</Td>
                <Td>{p.displayOrder}</Td>
                <Td><StatusPill status={p.active ? "ACTIVE" : "OFF"} label={p.active ? "Published" : "Hidden"} /></Td>
                <Td><ActBtn tone="cyan" onClick={() => setEdit({ ...p })}>Edit</ActBtn></Td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>

      {/* editor dialog */}
      {edit ? (
        <div className="fixed inset-0 z-[220] flex items-center justify-center bg-[#020B1A]/80 px-4 backdrop-blur-sm" onClick={() => setEdit(null)}>
          <div className="halo-scroll max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl p-6" style={{ background: "linear-gradient(160deg, #041428 0%, #021229 100%)", border: `1px solid ${C.line}`, boxShadow: `0 24px 80px 0 ${A.blue(0.2)}` }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 text-[10px] font-extrabold tracking-[0.22em]" style={{ color: C.goldHover }}>EDIT PLAN · {edit.code}</div>
            <p className="mb-4 text-[10.5px]" style={{ color: C.muted }}>Existing customers are never affected — entitlements were snapshotted when their license was issued.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="mb-1.5 text-[9px] font-extrabold tracking-[0.18em]" style={{ color: C.label }}>NAME</div>
                <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className="w-full rounded-lg px-3 py-2 text-[12px]" style={fieldCss} />
              </div>
              <div>
                <div className="mb-1.5 text-[9px] font-extrabold tracking-[0.18em]" style={{ color: C.label }}>TAGLINE</div>
                <input value={edit.tagline} onChange={(e) => setEdit({ ...edit, tagline: e.target.value })} className="w-full rounded-lg px-3 py-2 text-[12px]" style={fieldCss} />
              </div>
              <div>
                <div className="mb-1.5 text-[9px] font-extrabold tracking-[0.18em]" style={{ color: C.label }}>PRICE ({edit.currency})</div>
                <input type="number" min={0} value={edit.priceCents / 100} onChange={(e) => setEdit({ ...edit, priceCents: Math.round(Number(e.target.value) * 100) })} className="w-full rounded-lg px-3 py-2 text-[12px]" style={fieldCss} />
              </div>
              <div>
                <div className="mb-1.5 text-[9px] font-extrabold tracking-[0.18em]" style={{ color: C.label }}>CURRENCY</div>
                <input value={edit.currency} onChange={(e) => setEdit({ ...edit, currency: e.target.value.toUpperCase().slice(0, 4) })} className="w-full rounded-lg px-3 py-2 text-[12px]" style={fieldCss} />
              </div>
              <div>
                <div className="mb-1.5 text-[9px] font-extrabold tracking-[0.18em]" style={{ color: C.label }}>PROMO PRICE (OPTIONAL)</div>
                <input type="number" min={0} value={edit.promoPriceCents ? edit.promoPriceCents / 100 : ""} onChange={(e) => setEdit({ ...edit, promoPriceCents: e.target.value === "" ? null : Math.round(Number(e.target.value) * 100) })} className="w-full rounded-lg px-3 py-2 text-[12px]" style={fieldCss} />
              </div>
              <div>
                <div className="mb-1.5 text-[9px] font-extrabold tracking-[0.18em]" style={{ color: C.label }}>DEVICE LIMIT</div>
                <input type="number" min={0} value={edit.deviceLimit} onChange={(e) => setEdit({ ...edit, deviceLimit: Number(e.target.value) })} className="w-full rounded-lg px-3 py-2 text-[12px]" style={fieldCss} />
              </div>
              <div>
                <div className="mb-1.5 text-[9px] font-extrabold tracking-[0.18em]" style={{ color: C.label }}>DISPLAY ORDER</div>
                <input type="number" value={edit.displayOrder} onChange={(e) => setEdit({ ...edit, displayOrder: Number(e.target.value) })} className="w-full rounded-lg px-3 py-2 text-[12px]" style={fieldCss} />
              </div>
              <div>
                <div className="mb-1.5 text-[9px] font-extrabold tracking-[0.18em]" style={{ color: C.label }}>AVAILABILITY</div>
                <label className="flex items-center gap-2 py-2 text-[12px]" style={{ color: C.txt2 }}>
                  <input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} className="accent-[#2ECCFF]" /> Published on pricing page
                </label>
              </div>
            </div>
            <div className="mt-3">
              <div className="mb-1.5 text-[9px] font-extrabold tracking-[0.18em]" style={{ color: C.label }}>DESCRIPTION</div>
              <textarea value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} rows={2} className="w-full rounded-lg px-3 py-2 text-[12px]" style={fieldCss} />
            </div>

            <div className="mt-4">
              <div className="mb-2 text-[9px] font-extrabold tracking-[0.18em]" style={{ color: C.label }}>FEATURE ENTITLEMENTS (this plan + everything below its rank)</div>
              <div className="grid max-h-56 grid-cols-1 gap-1 overflow-y-auto rounded-lg p-3 sm:grid-cols-2" style={{ background: A.white(0.02), border: `1px solid ${C.lineInner}` }}>
                {catalog.map((f) => (
                  <label key={f.key} className="flex cursor-pointer items-start gap-2 text-[10.5px]" style={{ color: C.txt2 }}>
                    <input type="checkbox" checked={edit.features.includes(f.key)} className="mt-0.5 accent-[#2ECCFF]"
                      onChange={(e) => setEdit({ ...edit, features: e.target.checked ? [...edit.features, f.key] : edit.features.filter((k) => k !== f.key) })} />
                    <span>{f.label} <span style={{ color: C_DIM }}>· {["Starter", "Pro", "Elite", "Ultimate"][f.minPlan - 1]}+</span></span>
                  </label>
                ))}
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <ActBtn tone="ghost" onClick={() => setEdit(null)}>Cancel</ActBtn>
              <button type="button" onClick={() => void save()} disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-[9.5px] font-extrabold tracking-[0.14em] transition-all hover:brightness-110 disabled:opacity-40"
                style={{ background: A.gold(0.14), color: C.goldHover, boxShadow: `inset 0 0 0 1px ${A.gold(0.4)}` }}>
                {busy ? <Loader2 size={10} className="animate-spin" /> : null}SAVE PLAN
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const C_DIM = "rgba(82,103,138,1)";
