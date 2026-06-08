import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { exitImpersonation } from "@/lib/auth/impersonation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// IMPORTANT: This route deliberately does NOT call requireAdmin().
// While impersonating, the effective identity is the tech (non-admin),
// so requireAdmin would block the very escape hatch. The proof that
// this caller is allowed to exit is the `impersonatorTechId` field
// on the cookie — only an admin's session could have set it.

export async function POST() {
  const session = await getSession();
  if (!session.techId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!session.impersonatorTechId) {
    return NextResponse.json(
      { error: "Not impersonating" },
      { status: 400 }
    );
  }

  try {
    await exitImpersonation();
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[impersonate/exit POST] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
