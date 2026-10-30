// ══════════════════════════════════════════════════════════════════════════
//  HALO COMMERCIAL PLATFORM · domain constants
//  Roles, account statuses, license statuses, payment statuses and the
//  centralized FEATURE CATALOG that maps every premium feature to the plan
//  that includes it. Backend-authoritative — the frontend only renders it.
// ══════════════════════════════════════════════════════════════════════════

export const ROLES = {
  SUPER_ADMIN: "SUPER_ADMIN",
  LICENSE_ADMIN: "LICENSE_ADMIN",
  SUPPORT_ADMIN: "SUPPORT_ADMIN",
  CUSTOMER: "CUSTOMER",
} as const;
export type Role = (typeof ROLES)[keyof typeof ROLES];

export const USER_STATUSES = {
  PENDING_EMAIL: "PENDING_EMAIL",
  PENDING_APPROVAL: "PENDING_APPROVAL",
  ACTIVE: "ACTIVE",
  SUSPENDED: "SUSPENDED",
  BLOCKED: "BLOCKED",
  REJECTED: "REJECTED",
} as const;

export const USER_STATUS_LABEL: Record<string, string> = {
  PENDING_EMAIL: "Verify E-mail",
  PENDING_APPROVAL: "Pending Approval",
  ACTIVE: "Active",
  SUSPENDED: "Suspended",
  BLOCKED: "Blocked",
  REJECTED: "Rejected",
};

export const LICENSE_STATUSES = {
  UNACTIVATED: "UNACTIVATED",
  ACTIVE: "ACTIVE",
  SUSPENDED: "SUSPENDED",
  REVOKED: "REVOKED",
} as const;

export const PAYMENT_STATUSES = {
  PENDING: "PENDING",
  VERIFIED: "VERIFIED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
  REFUNDED: "REFUNDED",
  DISPUTED: "DISPUTED",
} as const;

/** Only VERIFIED successful payments count as revenue. */
export const REVENUE_STATUSES = [PAYMENT_STATUSES.VERIFIED];

// ── Feature entitlement system ────────────────────────────────────────────
// Every premium feature maps to the minimum plan that includes it.
// Higher plans inherit everything below them:
//   Ultimate ⊃ Elite ⊃ Pro ⊃ Starter.
// minPlan: 1 = STARTER · 2 = PRO · 3 = ELITE · 4 = ULTIMATE

export const PLAN_RANK: Record<string, number> = {
  STARTER: 1,
  PRO: 2,
  ELITE: 3,
  ULTIMATE: 4,
};

export const RANK_PLAN: Record<number, string> = {
  1: "STARTER",
  2: "PRO",
  3: "ELITE",
  4: "ULTIMATE",
};

export interface FeatureDef {
  key: string;
  label: string;
  minPlan: number; // 1..4
  /** API surface groups this feature gates (integration map). */
  group?: "trading" | "strategies" | "analytics" | "voice" | "platform";
}

export const FEATURE_CATALOG: FeatureDef[] = [
  // ── Starter ──
  { key: "dashboard_standard", label: "Standard Trading Dashboard", minPlan: 1, group: "platform" },
  { key: "market_data", label: "Live Market Data", minPlan: 1, group: "platform" },
  { key: "assistant_basic", label: "Basic HALO AI Assistant", minPlan: 1, group: "voice" },
  { key: "trading_manual", label: "Manual Trading", minPlan: 1, group: "trading" },
  { key: "trading_auto", label: "Authorized Automated Trading", minPlan: 1, group: "trading" },
  { key: "instrument_single", label: "One Trading Instrument", minPlan: 1, group: "trading" },
  { key: "history_basic", label: "Basic Trade History", minPlan: 1, group: "analytics" },
  { key: "alerts_standard", label: "Standard Alerts", minPlan: 1, group: "platform" },
  { key: "support_standard", label: "Standard Support", minPlan: 1, group: "platform" },
  // ── Pro (Starter + …) ──
  { key: "assistant_advanced", label: "Advanced HALO AI Assistant", minPlan: 2, group: "voice" },
  { key: "instrument_multi", label: "Multi-Instrument Trading", minPlan: 2, group: "trading" },
  { key: "strategy_tools_advanced", label: "Advanced Strategy Tools", minPlan: 2, group: "strategies" },
  { key: "strategy_custom", label: "Custom Strategy Configuration", minPlan: 2, group: "strategies" },
  { key: "analytics_performance", label: "Performance Analytics", minPlan: 2, group: "analytics" },
  { key: "alerts_advanced", label: "Advanced Trading Alerts", minPlan: 2, group: "platform" },
  { key: "reporting_enhanced", label: "Enhanced Reporting", minPlan: 2, group: "analytics" },
  { key: "support_priority", label: "Priority Support", minPlan: 2, group: "platform" },
  // ── Elite (Pro + …) ──
  { key: "strategy_lab_full", label: "Full Strategy Lab", minPlan: 3, group: "strategies" },
  { key: "risk_guardian_advanced", label: "Advanced Risk Guardian", minPlan: 3, group: "trading" },
  { key: "trade_replay", label: "Trade Replay", minPlan: 3, group: "analytics" },
  { key: "analytics_advanced", label: "Advanced Performance Analytics", minPlan: 3, group: "analytics" },
  { key: "voice_advanced", label: "Advanced Voice Control", minPlan: 3, group: "voice" },
  { key: "multi_account", label: "Multi-Account Support", minPlan: 3, group: "trading" },
  { key: "support_dedicated", label: "Dedicated Support", minPlan: 3, group: "platform" },
  // ── Ultimate (Elite + …) ──
  { key: "admin_tools", label: "Advanced Administration Tools", minPlan: 4, group: "platform" },
  { key: "white_label", label: "White-Label Options", minPlan: 4, group: "platform" },
  { key: "integrations_custom", label: "Custom Integrations", minPlan: 4, group: "platform" },
  { key: "api_access", label: "API Access", minPlan: 4, group: "platform" },
  { key: "support_vip", label: "VIP Support", minPlan: 4, group: "platform" },
];

export const FEATURE_LABEL: Record<string, string> = Object.fromEntries(
  FEATURE_CATALOG.map((f) => [f.key, f.label]),
);

/** Which feature gates the existing consequential API surfaces. */
export const GATE_FEATURES = {
  bot: "trading_auto", // /api/bot/config · /api/bot/control
  strategies: "strategy_custom", // /api/strategies/*
} as const;

// ── Seed plans (proposed prices — editable from the admin dashboard) ──────

export interface PlanSeed {
  code: string;
  name: string;
  tagline: string;
  description: string;
  priceCents: number;
  deviceLimit: number;
  icon: string;
  displayOrder: number;
}

export const DEFAULT_PLANS: PlanSeed[] = [
  {
    code: "STARTER",
    name: "Starter",
    tagline: "Essential Trading Tools",
    description: "Everything a disciplined trader needs to run the HALO engine on one instrument.",
    priceCents: 19900,
    deviceLimit: 1,
    icon: "shield",
    displayOrder: 1,
  },
  {
    code: "PRO",
    name: "Pro",
    tagline: "Advanced Trading",
    description: "Advanced AI assistance, multi-instrument trading and custom strategy configuration.",
    priceCents: 39900,
    deviceLimit: 2,
    icon: "crown",
    displayOrder: 2,
  },
  {
    code: "ELITE",
    name: "Elite",
    tagline: "Professional Trader",
    description: "Full Strategy Lab, advanced Risk Guardian, trade replay and advanced voice control.",
    priceCents: 69900,
    deviceLimit: 3,
    icon: "gem",
    displayOrder: 3,
  },
  {
    code: "ULTIMATE",
    name: "Ultimate",
    tagline: "Institutional Grade",
    description: "Advanced administration tools, white-label options, custom integrations and API access.",
    priceCents: 119900,
    deviceLimit: 5,
    icon: "infinity",
    displayOrder: 4,
  },
];

/** Features granted to a NEW purchase of each plan (key set for featuresJson). */
export function featureKeysForRank(rank: number): string[] {
  return FEATURE_CATALOG.filter((f) => f.minPlan <= rank).map((f) => f.key);
}

// ── Simple in-memory rate limiter (per process) ───────────────────────────
// Production note: for multi-instance deployments swap for a durable store.

const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSec: 0 };
  }
  b.count += 1;
  if (b.count > limit) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
  }
  return { ok: true, retryAfterSec: 0 };
}

export function clientIp(req: Request): string {
  const h = req.headers;
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "local"
  );
}

export const CREATOR_LINE = "HALO 3EL Autotrader was created by Bismark Arko-Ofori. All rights reserved.";
