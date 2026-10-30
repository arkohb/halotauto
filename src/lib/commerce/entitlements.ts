// ══════════════════════════════════════════════════════════════════════════
//  ENTITLEMENTS · centralized feature-access resolution
//  The BACKEND is authoritative. Frontend variables, browser storage, URLs
//  and modified API requests can never unlock a feature — every check here
//  runs server-side against the license's stored entitlement snapshot.
// ══════════════════════════════════════════════════════════════════════════

import { FEATURE_CATALOG, PLAN_RANK, featureKeysForRank } from "./constants";

/** Full feature-key list a NEW purchase of `planCode` receives. */
export function featuresForPlan(planCode: string): string[] {
  const rank = PLAN_RANK[planCode] ?? 1;
  return featureKeysForRank(rank);
}

/** Entitlement snapshot stored on a license at issuance — survives later plan edits. */
export function entitlementSnapshot(planCode: string): string[] {
  return featuresForPlan(planCode);
}

export function parseEntitlements(json: string): string[] {
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function hasFeature(entitlements: string[], featureKey: string): boolean {
  return entitlements.includes(featureKey);
}

/** Highest plan code that satisfies the given entitlement list (display helper). */
export function planCodeForRank(rank: number): string {
  const code = Object.entries(PLAN_RANK).find(([, r]) => r === rank)?.[0];
  return code ?? "STARTER";
}

/** For upgrade prompts: the minimum plan that includes `featureKey`. */
export function minPlanForFeature(featureKey: string): string | null {
  const f = FEATURE_CATALOG.find((x) => x.key === featureKey);
  if (!f) return null;
  const rank = f.minPlan;
  return Object.entries(PLAN_RANK).find(([, r]) => r === rank)?.[0] ?? null;
}

/** Features the customer does NOT have, grouped by the plan that unlocks them (upgrade nudge). */
export function lockedFeaturesByPlan(entitlements: string[]): { planCode: string; features: string[] }[] {
  const byRank = new Map<number, string[]>();
  for (const f of FEATURE_CATALOG) {
    if (entitlements.includes(f.key)) continue;
    const list = byRank.get(f.minPlan) ?? [];
    list.push(f.key);
    byRank.set(f.minPlan, list);
  }
  return [...byRank.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rank, features]) => ({ planCode: Object.entries(PLAN_RANK).find(([, r]) => r === rank)?.[0] ?? "STARTER", features }));
}
