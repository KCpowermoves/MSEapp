import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/payroll/auth";
import { startImpersonation } from "@/lib/auth/impersonation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if ("response" in guard) return guard.response;

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const targetTechId = String(body.targetTechId ?? "").trim();
  if (!targetTechId) {
    return NextResponse.json({ error: "Missing targetTechId" }, { status: 400 });
  }

  try {
    await startImpersonation(targetTechId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[impersonate POST] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
