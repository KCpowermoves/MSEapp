import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import {
  getLeadByToken,
  updateLead,
  updateLeadFields,
} from "@/lib/data/leads";
import { convertLeadToJob } from "@/lib/data/lead-convert";
import { buildPacketDocuments } from "@/lib/agreements/fill-engine.mjs";
import { uploadFile } from "@/lib/google/drive";
import { getJob } from "@/lib/data/jobs";
import { nowIso } from "@/lib/utils";

// POST /api/sign/[token] — execute the agreement packet. Public; the
// unguessable token is the authorization. On success:
//   1. any field edits made at the table are saved to the lead
//   2. the lead converts to a Job (idempotent)
//   3. the REAL utility paperwork is filled + signature-stamped into
//      one merged PDF and stored in the job's Drive folder
//
// The PDF step is best-effort: a Drive hiccup must not undo a
// signed conversion. Failures log loudly for admin follow-up.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024;
const FIELD_KEYS = [
  "businessName", "contactName", "title", "email", "phone",
  "address", "city", "zip", "accountNumber", "hvacUnits",
] as const;

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
    return NextResponse.json({ ok: true, alreadySigned: true });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
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

  // Merge table-side edits over the stored lead values.
  const rawFields = (body.fields ?? {}) as Record<string, unknown>;
  const fields: Record<string, string> = {};
  for (const k of FIELD_KEYS) {
    const edited = rawFields[k];
    fields[k] =
      typeof edited === "string" ? edited.trim().slice(0, 200) : String(lead[k] ?? "");
  }
  const primaryUse = String(body.primaryUse ?? lead.primaryUse ?? "").slice(0, 40);
  const customerType = String(body.customerType ?? lead.customerType ?? "").slice(0, 40);

  const signedAtIso = nowIso();

  try {
    // 1. Persist edits so the lead/job reflect what was signed.
    try {
      await updateLeadFields({
        leadId: lead.leadId,
        businessName: fields.businessName,
        contactName: fields.contactName,
        email: fields.email,
        phone: fields.phone,
        address: fields.address,
        city: fields.city,
        zip: fields.zip,
        accountNumber: fields.accountNumber,
        hvacUnits: fields.hvacUnits,
        title: fields.title,
        primaryUse,
        customerType,
      });
    } catch (e) {
      console.warn("[sign] field save failed (continuing):", e);
    }

    // 2. Convert — creates the Job (+ Drive folder) and, if assigned
    //    at sale, the scheduled visit.
    const { lead: converted } = await convertLeadToJob({
      leadId: lead.leadId,
      by: "customer-signature",
    });

    // 3. Fill the real paperwork and store it (best-effort). Each
    //    document in the packet is saved as its OWN PDF in the job's
    //    Drive folder — never merged — so a customer who signed two or
    //    three forms ends up with two or three separate files.
    let signedPdfUrl = "";
    try {
      const docs = await buildPacketDocuments({
        packetKey: lead.utility,
        fields,
        primaryUse,
        customerType,
        signaturePng,
        signedAt: new Date(signedAtIso),
      });
      const job = converted.jobId ? await getJob(converted.jobId) : null;
      if (job?.driveFolderId) {
        const who = fields.businessName || fields.contactName || lead.leadId;
        const date = signedAtIso.slice(0, 10);
        const urls: string[] = [];
        for (const doc of docs) {
          const uploaded = await uploadFile({
            folderId: job.driveFolderId,
            filename: `Signed - ${who} - ${doc.label} - ${date}.pdf`,
            mimeType: "application/pdf",
            body: Buffer.from(doc.bytes),
          });
          urls.push(uploaded.url);
        }
        // Point the lead's quick link at the job's Drive folder, which
        // now holds every separate signed document.
        signedPdfUrl = job.driveFolderUrl || urls[0] || "";
      }
    } catch (pdfErr) {
      console.error(
        `[sign] packet PDFs failed for ${lead.leadId} — job ${converted.jobId} still created:`,
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
