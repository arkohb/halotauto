// ══════════════════════════════════════════════════════════════════════════
//  /api/admin/admins · administrator account management (SUPER_ADMIN only)
//  No shared hardcoded passwords: each admin gets a unique password
//  (provided or securely generated, shown once) + mustChangePassword flag.
// ══════════════════════════════════════════════════════════════════════════

import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ROLES, type Role } from "@/lib/commerce/constants";
import { emailProblem, hashPassword, passwordProblem, requireSuper } from "@/lib/commerce/auth";
import { logAudit } from "@/lib/commerce/audit";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const g = await requireSuper();
    if (!g.ok) return NextResponse.json({ ok: false, error: g.error }, { status: g.status });
    const admins = await db.user.findMany({ where: { role: { not: ROLES.CUSTOMER } }, orderBy: { createdAt: "asc" } });
    return NextResponse.json({
      ok: true,
      admins: admins.map((a) => ({
        id: a.id,
        fullName: a.fullName,
        email: a.email,
        role: a.role,
        status: a.status,
        createdAt: a.createdAt.toISOString(),
        lastLoginAt: a.lastLoginAt?.toISOString() ?? null,
      })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const g = await requireSuper();
    if (!g.ok) return NextResponse.json({ ok: false, error: g.error }, { status: g.status });
    const actor = g.user;

    const body = (await req.json()) as { action?: string; email?: string; fullName?: string; role?: string; password?: string };
    const action = body.action ?? "create";

    if (action === "create") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const fullName = String(body.fullName ?? "").trim();
      const role = String(body.role ?? "");
      if (!Object.values(ROLES).includes(role as Role)) {
        return NextResponse.json({ ok: false, error: "Invalid role." }, { status: 400 });
      }
      const ep = emailProblem(email);
      if (ep) return NextResponse.json({ ok: false, error: ep }, { status: 400 });
      if (fullName.length < 2) return NextResponse.json({ ok: false, error: "Enter the administrator's full name." }, { status: 400 });

      const dup = await db.user.findUnique({ where: { email } });
      if (dup) return NextResponse.json({ ok: false, error: "An account with this e-mail already exists." }, { status: 409 });

      let generatedPassword = "";
      let password = String(body.password ?? "");
      if (!password) {
        generatedPassword = crypto.randomBytes(9).toString("base64url"); // ~12 chars, printable
        password = generatedPassword + "7A"; // guarantee letter+digit mix
      }
      const pp = passwordProblem(password);
      if (pp) return NextResponse.json({ ok: false, error: pp }, { status: 400 });

      const user = await db.user.create({
        data: {
          email,
          fullName,
          passwordHash: hashPassword(password),
          role,
          status: "ACTIVE",
          emailVerifiedAt: new Date(),
          mustChangePassword: !body.password,
        },
      });
      await logAudit({ action: "ADMIN_CREATED", actorId: actor.id, actorEmail: actor.email, actorRole: actor.role, targetType: "user", targetId: user.id, meta: { email, role } });

      return NextResponse.json({
        ok: true,
        admin: { id: user.id, email: user.email, role: user.role },
        // Generated password is returned ONCE over HTTPS for secure handover.
        generatedPassword: generatedPassword ? password : undefined,
      });
    }

    if (action === "set-role") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const role = String(body.role ?? "");
      const target = await db.user.findUnique({ where: { email } });
      if (!target) return NextResponse.json({ ok: false, error: "Administrator not found." }, { status: 404 });
      if (target.role === ROLES.SUPER_ADMIN && target.id !== actor.id) {
        return NextResponse.json({ ok: false, error: "Only another Super Administrator can be edited from a Super Admin session." }, { status: 403 });
      }
      if (!Object.values(ROLES).includes(role as Role)) {
        return NextResponse.json({ ok: false, error: "Invalid role." }, { status: 400 });
      }
      await db.user.update({ where: { id: target.id }, data: { role } });
      await logAudit({ action: "ADMIN_ROLE_CHANGED", actorId: actor.id, actorEmail: actor.email, actorRole: actor.role, targetType: "user", targetId: target.id, meta: { email, role } });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
