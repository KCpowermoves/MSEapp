import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { setDispatchSignature, getDispatch } from "@/lib/data/dispatches";

/**
 * Saves only the customer email on a dispatch row — used by
 * /submit/confirm when the customer provides an email but doesn't sign.
 * (When they sign, /api/upload writes the email alongside the signature
 * in a single round-trip.)
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
  const customerEmail = String(body.customerEmail ?? "").trim().slice(0, 200);
  if (!dispatchId) {
    return NextResponse.json({ error: "Missing dispatchId" }, { status: 400 });
  }

  const existing = await getDispatch(dispatchId);
  if (!existing) {
    return NextResponse.json({ error: "Dispatch not found" }, { status: 404 });
  }

  // setDispatchSignature is the helper that already writes K/L/N — we
  // pass the existing sig values back through unchanged so only N moves.
  await setDispatchSignature(
    dispatchId,
    existing.signatureUrl,
    existing.signedByName,
    customerEmail
  );
  revalidatePath(`/jobs/${existing.jobId}`);
  return NextResponse.json({ ok: true });
}
