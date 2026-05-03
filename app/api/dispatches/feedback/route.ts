import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { setDispatchFeedback, getDispatch } from "@/lib/data/dispatches";
import { tryRenderPdfIfReady } from "@/lib/data/maybe-render-pdf";

/**
 * Saves the customer's post-service rating (1–5) plus optional written
 * feedback. 5-star ratings get redirected to a Google Reviews URL on
 * the client; lower ratings drop into a private feedback form instead.
 * Either way we store the rating here so it shows up in the admin
 * dashboard.
 */
export async function POST(request: Request) {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const dispatchId = String(body.dispatchId ?? "");
  const rating = Math.max(0, Math.min(5, Number(body.rating ?? 0) || 0));
  const feedback = String(body.feedback ?? "").trim().slice(0, 2000);
  if (!dispatchId) {
    return NextResponse.json({ error: "Missing dispatchId" }, { status: 400 });
  }
  const existing = await getDispatch(dispatchId);
  if (!existing) {
    return NextResponse.json({ error: "Dispatch not found" }, { status: 404 });
  }
  await setDispatchFeedback(dispatchId, rating, feedback);

  // Now that the rating is on file, retry render+email. If the PDF is
  // ready and the email hasn't gone out yet, this fires the auto-email
  // with the rating-aware CTA (5★ gets the Google review nudge, lower
  // ratings get the "what could we do better" line). Idempotent.
  tryRenderPdfIfReady(dispatchId).catch((e) =>
    console.warn("[feedback] post-rating render/email error:", e)
  );

  revalidatePath(`/jobs/${existing.jobId}`);
  return NextResponse.json({ ok: true });
}
