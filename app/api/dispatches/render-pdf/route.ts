import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { getJob } from "@/lib/data/jobs";
import {
  getDispatch,
  setDispatchReportPdf,
} from "@/lib/data/dispatches";
import { listUnitsForDispatch } from "@/lib/data/units";
import { uploadFile, jobFolderName, getOrCreateFolder, getRootFolderId } from "@/lib/google/drive";
import { buildJobPdf } from "@/lib/pdf-report";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Generate a service-report PDF for a submitted dispatch and stash it
 * in the job's Drive folder. Best-effort — failure here does not roll
 * back the dispatch.
 *
 * Called by the client AFTER a successful dispatch submit (and after
 * the optional signature upload) so the PDF embeds the signature too.
 */
export async function POST(request: Request) {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const dispatchId = String(body?.dispatchId ?? "");
  if (!dispatchId) {
    return NextResponse.json({ error: "Missing dispatchId" }, { status: 400 });
  }

  try {
    const dispatch = await getDispatch(dispatchId);
    if (!dispatch) {
      return NextResponse.json({ error: "Dispatch not found" }, { status: 404 });
    }
    const job = await getJob(dispatch.jobId);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    const units = await listUnitsForDispatch(dispatchId);

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
    revalidatePath(`/jobs/${dispatch.jobId}`);
    revalidatePath("/jobs");
    return NextResponse.json({ ok: true, url: uploaded.url });
  } catch (e) {
    console.error("[pdf] render failed:", e);
    return NextResponse.json(
      {
        ok: false,
        suppressed: true,
        error: e instanceof Error ? e.message : "PDF render failed",
      },
      { status: 200 } // never bubble up — client treats as fire-and-forget
    );
  }
}
