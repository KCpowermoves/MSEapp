import "server-only";
import { getJob } from "@/lib/data/jobs";
import {
  getDispatch,
  setDispatchEmailed,
  setDispatchReportPdf,
} from "@/lib/data/dispatches";
import {
  listUnitsForDispatch,
  unitHasAllRequiredPhotos,
} from "@/lib/data/units";
import {
  getOrCreateFolder,
  getRootFolderId,
  jobFolderName,
  uploadFile,
} from "@/lib/google/drive";
import { buildJobPdf } from "@/lib/pdf-report";
import { sendReportEmail } from "@/lib/email/send-report";
import { nowIso } from "@/lib/utils";

/**
 * Server-side PDF generator + auto-emailer for a submitted dispatch.
 * Idempotent and conditional. Called from several places fire-and-forget:
 *
 *  - /api/dispatches POST          — covers dispatches with no photos
 *    (submitted while photos already done)
 *  - /api/upload (per-photo)       — typical case: each photo upload
 *    re-checks; the LAST upload triggers the render.
 *  - /api/upload (signature)       — final-step trigger that also picks
 *    up the customer email.
 *  - /api/dispatches/feedback      — when the customer rates, we re-try
 *    so the email goes out with the rating-aware CTA.
 *
 * The render is gated by reportPdfUrl. The email send is gated
 * separately by reportEmailedAt — that way we can render long before
 * the customer rates, and the email still fires (with rating context)
 * once they finish the feedback step.
 */
export async function tryRenderPdfIfReady(
  dispatchId: string,
  opts: { autoEmail?: boolean } = { autoEmail: true }
): Promise<{ rendered: boolean; emailed?: boolean; reason?: string; url?: string }> {
  if (!dispatchId) return { rendered: false, reason: "no dispatchId" };

  const dispatch = await getDispatch(dispatchId);
  if (!dispatch) return { rendered: false, reason: "dispatch not found" };
  if (!dispatch.submittedAt)
    return { rendered: false, reason: "not submitted" };

  let pdfUrl = dispatch.reportPdfUrl;
  let rendered = false;

  if (!pdfUrl) {
    const units = await listUnitsForDispatch(dispatchId);
    if (units.length === 0) return { rendered: false, reason: "no units" };
    const allReady = units.every((u) => unitHasAllRequiredPhotos(u));
    if (!allReady) return { rendered: false, reason: "photos still pending" };

    const job = await getJob(dispatch.jobId);
    if (!job) return { rendered: false, reason: "job not found" };

    try {
      const pdfBuffer = await buildJobPdf({ job, dispatch, units });
      const folderId =
        job.driveFolderId ||
        (
          await getOrCreateFolder(
            jobFolderName({
              customerName: job.customerName,
              siteAddress: job.siteAddress,
              createdDate: new Date(job.createdDate),
            }),
            getRootFolderId()
          )
        ).id;
      const shortDispatch = dispatchId.split("-").at(-1) ?? dispatchId;
      const filename = `Service-Report_${dispatch.dispatchDate}_${shortDispatch}.pdf`;
      const uploaded = await uploadFile({
        folderId,
        filename,
        mimeType: "application/pdf",
        body: pdfBuffer,
      });
      await setDispatchReportPdf(dispatchId, uploaded.url);
      pdfUrl = uploaded.url;
      rendered = true;
    } catch (e) {
      console.error("[pdf] tryRenderPdfIfReady failed:", e);
      return {
        rendered: false,
        reason: e instanceof Error ? e.message : "render failed",
      };
    }
  }

  // PDF is in hand — try the auto-email once unless the caller opted
  // out (admin Resend button does its own send + stamp).
  const emailed = opts.autoEmail !== false
    ? await maybeAutoEmail(dispatchId, pdfUrl)
    : false;
  return { rendered, emailed, url: pdfUrl };
}

/**
 * Send the report email to the customer if we have an address on file
 * AND we haven't already sent it. Marks reportEmailedAt on success so
 * the next caller skips. Returns true if a send was actually attempted
 * (and accepted by HighLevel) on this call.
 */
async function maybeAutoEmail(
  dispatchId: string,
  pdfUrl: string
): Promise<boolean> {
  // Re-read so we see the freshest customer-side fields (rating may have
  // been written between the original render and this email attempt).
  const dispatch = await getDispatch(dispatchId);
  if (!dispatch) return false;
  if (!dispatch.customerEmail) return false;
  if (dispatch.reportEmailedAt) return false;

  const job = await getJob(dispatch.jobId);
  if (!job) return false;

  const googleReviewUrl =
    process.env.NEXT_PUBLIC_GOOGLE_REVIEW_URL ??
    "https://g.page/r/CW6VirUCAnCXEAI/review";

  try {
    const result = await sendReportEmail({
      to: dispatch.customerEmail,
      customerName: job.customerName,
      pdfUrl,
      jobAddress: job.siteAddress,
      dispatchDate: dispatch.dispatchDate,
      rating: dispatch.customerRating || 0,
      googleReviewUrl,
    });
    if (result.sent) {
      await setDispatchEmailed(dispatchId, nowIso());
      return true;
    }
    console.warn(
      `[pdf] auto-send email skipped (${result.reason ?? "unknown"})`
    );
    return false;
  } catch (e) {
    console.warn("[pdf] auto-send email error:", e);
    return false;
  }
}
