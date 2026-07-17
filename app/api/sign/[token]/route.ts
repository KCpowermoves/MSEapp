import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getLeadByToken, updateLead } from "@/lib/data/leads";
import { convertLeadToJob } from "@/lib/data/lead-convert";
import { buildAgreementPdf } from "@/lib/agreement-pdf";
import { uploadFile } from "@/lib/google/drive";
import { getJob } from "@/lib/data/jobs";
import { nowIso } from "@/lib/utils";

// POST /api/sign/[token] — execute the agreement. Public; the
// unguessable token is the authorization (same trust model the old
// SignNow share links had). On success:
//   1. lead converts to a Job (idempotent — double-taps can't dupe)
//   2. the signed agreement PDF is generated and stored in the job's
//      Drive folder
//   3. the lead records the signed PDF URL
//
// The PDF step is best-effort: a Drive hiccup must not undo a
// legally-signed conversion. Failures log loudly for admin follow-up.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024;

export async function POST(
  request: Request,
  { params }: { params: { token: string } }
) {
  const token = decodeURIComponent(params.token);
  const lead = await getLeadByToken(token);
  if (!lead || lead.status === "Cancelled") {
    return NextResponse.json({ error: "Agreement not found" }, { status: 404 });
  }
  if (lead.jobId) {
    // Already executed — idempotent success.
    return NextResponse.json({ ok: true, alreadySigned: true });
  }

  let body: {
    signedName?: unknown;
    consent?: unknown;
    signatureDataUrl?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  const signedName = String(body.signedName ?? "").trim();
  if (!signedName) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  if (body.consent !== true) {
    return NextResponse.json(
      { error: "E-sign consent is required" },
      { status: 400 }
    );
  }
  const dataUrl = String(body.signatureDataUrl ?? "");
  const m = dataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) {
    return NextResponse.json({ error: "Signature missing" }, { status: 400 });
  }
  const signaturePng = Buffer.from(m[1], "base64");
  if (signaturePng.length < 200 || signaturePng.length > MAX_SIGNATURE_BYTES) {
    return NextResponse.json({ error: "Signature invalid" }, { status: 400 });
  }

  const signedAtIso = nowIso();
  const signerIp =
    (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
    "unknown";

  try {
    // 1. Convert — creates the Job (+ Drive folder) and, if the agent
    //    assigned at sale time, the scheduled visit.
    const { lead: converted } = await convertLeadToJob({
      leadId: lead.leadId,
      by: "customer-signature",
    });

    // 2. Render + store the signed agreement PDF (best-effort).
    let signedPdfUrl = "";
    try {
      const pdf = await buildAgreementPdf({
        lead: { ...lead, signedAt: signedAtIso },
        signaturePng,
        signedName,
        signedAtIso,
        signerIp,
      });
      const job = converted.jobId ? await getJob(converted.jobId) : null;
      if (job?.driveFolderId) {
        const uploaded = await uploadFile({
          folderId: job.driveFolderId,
          filename: `Agreement - ${lead.businessName || lead.contactName || lead.leadId} - ${signedAtIso.slice(0, 10)}.pdf`,
          mimeType: "application/pdf",
          body: pdf,
        });
        signedPdfUrl = uploaded.url;
      }
    } catch (pdfErr) {
      console.error(
        `[sign] PDF generation/upload failed for ${lead.leadId} — job ${converted.jobId} still created:`,
        pdfErr
      );
    }

    if (signedPdfUrl) {
      await updateLead({ leadId: lead.leadId, signedPdfUrl });
    }

    revalidatePath("/sales");
    revalidatePath("/jobs");
    return NextResponse.json({ ok: true, jobId: converted.jobId });
  } catch (e) {
    console.error("[sign] failed:", e);
    return NextResponse.json(
      { error: "Could not complete signing — please try again." },
      { status: 500 }
    );
  }
}
