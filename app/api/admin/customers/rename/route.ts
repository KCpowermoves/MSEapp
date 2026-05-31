import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/payroll/auth";
import { renameCustomer } from "@/lib/data/jobs";

// POST /api/admin/customers/rename
// Body: { fromName, toName }
// Updates the customer name on every Jobs row currently matching
// fromName (case-insensitive). Use cases: fix a typo, merge two
// records that should be one ("Rivera Deli" + "rivera deli").

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if ("response" in guard) return guard.response;

  let body: { fromName?: unknown; toName?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }
  const fromName = String(body.fromName ?? "").trim();
  const toName = String(body.toName ?? "").trim();
  if (!fromName) {
    return NextResponse.json(
      { error: "fromName required" },
      { status: 400 }
    );
  }
  if (!toName) {
    return NextResponse.json(
      { error: "toName required" },
      { status: 400 }
    );
  }
  if (toName.length > 120) {
    return NextResponse.json(
      { error: "toName too long (max 120 chars)" },
      { status: 400 }
    );
  }

  try {
    const result = await renameCustomer({ fromName, toName });
    return NextResponse.json({
      ok: true,
      updatedJobIds: result.updatedJobIds,
      newSlug: encodeURIComponent(toName),
    });
  } catch (e) {
    console.error("[admin/customers/rename] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
