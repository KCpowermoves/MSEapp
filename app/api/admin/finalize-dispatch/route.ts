import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDispatch, submitDispatch } from "@/lib/data/dispatches";

// Admin "Finalize now" button on the dashboard. Lets an admin close a
// draft dispatch on demand instead of waiting for the tech to nav
// away or for the 8pm cron. Pulls crew + split from the existing
// draft row (set at job-creation), so no payload needed beyond the
// dispatchId.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session.techId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!session.isAdmin) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  let body: { dispatchId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }
  const dispatchId =
    typeof body.dispatchId === "string" ? body.dispatchId.trim() : "";
  if (!dispatchId) {
    return NextResponse.json(
      { error: "dispatchId required" },
      { status: 400 }
    );
  }

  const draft = await getDispatch(dispatchId);
  if (!draft) {
    return NextResponse.json({ error: "Dispatch not found" }, { status: 404 });
  }
  if (draft.submittedAt) {
    return NextResponse.json(
      { error: "Already finalized" },
      { status: 409 }
    );
  }

  try {
    const finalized = await submitDispatch({
      dispatchId,
      techsOnSite: draft.techsOnSite,
      crewSplit: draft.crewSplit,
      driver: draft.driver,
    });
    return NextResponse.json({ ok: true, dispatch: finalized });
  } catch (e) {
    console.error("[admin/finalize-dispatch] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
