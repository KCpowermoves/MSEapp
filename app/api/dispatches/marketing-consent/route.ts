import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import {
  getDispatch,
  setDispatchMarketingConsent,
} from "@/lib/data/dispatches";

/**
 * Saves the customer's photo-and-story marketing consent flag. Only
 * exposed on the 5-star feedback step (after the Google review CTA),
 * so we never distract from the primary "leave a Google review" goal.
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
  const consent = body.consent === true;
  if (!dispatchId) {
    return NextResponse.json({ error: "Missing dispatchId" }, { status: 400 });
  }
  const dispatch = await getDispatch(dispatchId);
  if (!dispatch) {
    return NextResponse.json({ error: "Dispatch not found" }, { status: 404 });
  }
  await setDispatchMarketingConsent(dispatchId, consent);
  revalidatePath(`/jobs/${dispatch.jobId}`);
  return NextResponse.json({ ok: true });
}
