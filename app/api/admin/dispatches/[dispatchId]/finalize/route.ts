import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/payroll/auth";
import { autoFinalizeOpenDraftsForTech, getDispatch } from "@/lib/data/dispatches";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: { dispatchId: string } }
) {
  const guard = await requireAdmin();
  if ("response" in guard) return guard.response;

  const dispatchId = decodeURIComponent(params.dispatchId);
  const dispatch = await getDispatch(dispatchId);
  if (!dispatch) {
    return NextResponse.json({ error: "Dispatch not found" }, { status: 404 });
  }
  if (dispatch.submittedAt) {
    return NextResponse.json({ ok: true, note: "Already finalized." });
  }

  // Reuse the same helper that powered the auto-finalize trigger.
  // For each tech on the dispatch, run with onlyJobId/onlyDispatchId
  // filtered to this single dispatch.
  try {
    for (const techName of dispatch.techsOnSite) {
      await autoFinalizeOpenDraftsForTech(techName, {
        onlyDispatchId: dispatchId,
      });
    }
    revalidatePath("/admin");
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[admin/dispatches/finalize] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
