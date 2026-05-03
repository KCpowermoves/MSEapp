import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getDispatch } from "@/lib/data/dispatches";
import { getJob } from "@/lib/data/jobs";
import { tryRenderPdfIfReady } from "@/lib/data/maybe-render-pdf";
import { sendReportEmail } from "@/lib/email/send-report";

/**
 * Generates the dispatch's PDF report (if not already rendered) and
 * sends it to the customer email captured at the signature step.
 * Surfaces a useful response so the admin UI can show why a send
 * didn't happen (no email, photos still pending, HighLevel down, etc.).
 */
export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!session.isAdmin) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const dispatchId = String(body.dispatchId ?? "");
  // Optional override email — admin can resend to a corrected address.
  const overrideTo = String(body.to ?? "").trim();
  if (!dispatchId) {
    return NextResponse.json({ error: "Missing dispatchId" }, { status: 400 });
  }

  const dispatch = await getDispatch(dispatchId);
  if (!dispatch) {
    return NextResponse.json({ error: "Dispatch not found" }, { status: 404 });
  }
  const job = await getJob(dispatch.jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  // Make sure the PDF actually exists before we email a link to it.
  const renderResult = await tryRenderPdfIfReady(dispatchId);
  // Re-read dispatch so we have the freshest reportPdfUrl.
  const fresh = await getDispatch(dispatchId);
  const pdfUrl = fresh?.reportPdfUrl ?? renderResult.url ?? "";
  if (!pdfUrl) {
    return NextResponse.json(
      {
        error: "PDF not ready yet",
        reason: renderResult.reason ?? "pdf still pending",
      },
      { status: 409 }
    );
  }

  const recipient = overrideTo || fresh?.customerEmail || "";
  if (!recipient) {
    return NextResponse.json(
      { error: "No customer email on this dispatch" },
      { status: 400 }
    );
  }

  const send = await sendReportEmail({
    to: recipient,
    customerName: job.customerName,
    pdfUrl,
    jobAddress: job.siteAddress,
    dispatchDate: dispatch.dispatchDate,
  });

  return NextResponse.json({
    pdfUrl,
    recipient,
    ...send,
  });
}
