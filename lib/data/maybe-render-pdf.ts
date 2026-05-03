import "server-only";
import { getJob } from "@/lib/data/jobs";
import {
  getDispatch,
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

/**
 * Server-side PDF generator for a submitted dispatch. Idempotent and
 * conditional:
 *
 *  - Skips if the dispatch hasn't been submitted yet.
 *  - Skips if a PDF has already been rendered (reportPdfUrl is set).
 *  - Skips if any unit on the dispatch is still missing required photos
 *    (the photo URLs aren't on the unit row yet — the PDF would render
 *    blank tiles).
 *
 * Called from two places, both fire-and-forget:
 *  - /api/dispatches POST   — covers dispatches with no photos
 *    (submitted while photos already done)
 *  - /api/upload            — covers the typical case: each successful
 *    photo upload re-checks; the LAST upload triggers the render.
 */
export async function tryRenderPdfIfReady(
  dispatchId: string
): Promise<{ rendered: boolean; reason?: string; url?: string }> {
  if (!dispatchId) return { rendered: false, reason: "no dispatchId" };

  const dispatch = await getDispatch(dispatchId);
  if (!dispatch) return { rendered: false, reason: "dispatch not found" };
  if (!dispatch.submittedAt) return { rendered: false, reason: "not submitted" };
  if (dispatch.reportPdfUrl) return { rendered: false, reason: "already rendered", url: dispatch.reportPdfUrl };

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

    // Auto-send the report to the customer if we captured an email at
    // the signature step. Fire-and-forget — render success shouldn't be
    // blocked by HighLevel hiccups, and the admin can always Resend
    // from the dashboard if delivery didn't go through.
    if (dispatch.customerEmail) {
      sendReportEmail({
        to: dispatch.customerEmail,
        customerName: job.customerName,
        pdfUrl: uploaded.url,
        jobAddress: job.siteAddress,
        dispatchDate: dispatch.dispatchDate,
      })
        .then((res) => {
          if (!res.sent) {
            console.warn(
              `[pdf] auto-send email skipped (${res.reason ?? "unknown"})`
            );
          }
        })
        .catch((e) => console.warn("[pdf] auto-send email error:", e));
    }
    return { rendered: true, url: uploaded.url };
  } catch (e) {
    console.error("[pdf] tryRenderPdfIfReady failed:", e);
    return {
      rendered: false,
      reason: e instanceof Error ? e.message : "render failed",
    };
  }
}
