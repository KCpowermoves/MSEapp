import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getDispatch, setDispatchEmailed } from "@/lib/data/dispatches";
import { getJob } from "@/lib/data/jobs";
import { listUnitsForDispatch } from "@/lib/data/units";
import { tryRenderPdfIfReady } from "@/lib/data/maybe-render-pdf";
import { sendReportEmail, type HeroPhotos } from "@/lib/email/send-report";
import { nowIso } from "@/lib/utils";
import type { UnitServiced } from "@/lib/types";

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
  // Pass autoEmail=false so we don't double-fire alongside the manual
  // send below.
  const renderResult = await tryRenderPdfIfReady(dispatchId, {
    autoEmail: false,
  });
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

  const units = await listUnitsForDispatch(dispatchId);
  const send = await sendReportEmail({
    to: recipient,
    customerName: job.customerName,
    pdfUrl,
    jobAddress: job.siteAddress,
    dispatchDate: dispatch.dispatchDate,
    rating: fresh?.customerRating || 0,
    googleReviewUrl:
      process.env.NEXT_PUBLIC_GOOGLE_REVIEW_URL ??
      "https://g.page/r/CW6VirUCAnCXEAI/review",
    heroPhotos: pickHeroFromUnits(units),
  });

  // If the manual send actually went through, stamp it so the auto-send
  // path knows we're done (and the admin can still resend afterward —
  // setDispatchEmailed overwrites with the latest timestamp).
  if (send.sent) {
    await setDispatchEmailed(dispatchId, nowIso());
  }

  return NextResponse.json({
    pdfUrl,
    recipient,
    ...send,
  });
}

function pickHeroFromUnits(units: UnitServiced[]): HeroPhotos | undefined {
  for (const u of units) {
    if (u.unitType === "PTAC / Ductless") {
      if (u.pre1Url && u.pre2Url)
        return { beforeUrl: u.pre1Url, afterUrl: u.pre2Url };
    } else if (u.pre1Url && u.post1Url) {
      return { beforeUrl: u.pre1Url, afterUrl: u.post1Url };
    }
  }
  return undefined;
}
