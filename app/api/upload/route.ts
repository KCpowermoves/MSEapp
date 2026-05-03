import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { getJob } from "@/lib/data/jobs";
import { getUnit, setUnitPhotoUrl } from "@/lib/data/units";
import { appendServicePhotoUrl } from "@/lib/data/services";
import { setDispatchSignature } from "@/lib/data/dispatches";
import { tryRenderPdfIfReady } from "@/lib/data/maybe-render-pdf";
import {
  getOrCreateFolder,
  getRootFolderId,
  jobFolderName,
  uploadImage,
} from "@/lib/google/drive";
import type { PhotoSlot } from "@/lib/types";

const PHOTO_SLOTS: PhotoSlot[] = [
  "pre", "post",
  "coil1_pre", "coil1_post", "coil2_pre", "coil2_post",
  "filter_pre", "filter_post",
  "out_pre_1", "out_pre_2", "out_pre_3",
  "out_post_1", "out_post_2", "out_post_3",
  "out_nameplate",
  "in_pre", "in_post", "in_nameplate",
  "nameplate", "filter",
  "additional",
];

export async function POST(request: Request) {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const file = formData.get("file");
  const jobId = String(formData.get("jobId") ?? "");
  const unitId = String(formData.get("unitId") ?? "");
  const serviceId = String(formData.get("serviceId") ?? "");
  const dispatchId = String(formData.get("dispatchId") ?? "");
  const kind = String(formData.get("kind") ?? "");
  const signedByName = String(formData.get("signedByName") ?? "").slice(0, 200);
  const slot = String(formData.get("slot") ?? "");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
  }

  const job = await getJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || "image/jpeg";

  const rootFolderId = job.driveFolderId || (await ensureJobFolderId(job));

  try {
    if (unitId) {
      if (!PHOTO_SLOTS.includes(slot as PhotoSlot)) {
        return NextResponse.json(
          { error: "Invalid photo slot" },
          { status: 400 }
        );
      }
      const unit = await getUnit(unitId);
      if (!unit) {
        return NextResponse.json({ error: "Unit not found" }, { status: 404 });
      }
      const numStr = String(unit.unitNumberOnJob).padStart(3, "0");
      const safeType = slugForFilename(unit.unitType);
      // For "additional" photos, append a sortable timestamp so multiple
      // uploads don't collide on filename.
      const slotPart =
        slot === "additional"
          ? `additional-${Date.now()}`
          : (slot as string);
      const filename = `Unit-${numStr}_${safeType}_${slotPart}.jpg`;
      const uploaded = await uploadImage({
        folderId: rootFolderId,
        filename,
        mimeType,
        body: buffer,
      });
      await setUnitPhotoUrl(unitId, slot as PhotoSlot, uploaded.url);
      revalidatePath(`/jobs/${jobId}`);
      revalidatePath("/jobs");
      // After every successful unit photo write, see if the parent
      // dispatch is now fully photographed. If yes, render the PDF.
      // Idempotent — does nothing if a PDF is already on file.
      tryRenderPdfIfReady(unit.dispatchId).catch((e) =>
        console.warn("[upload] post-photo PDF render error:", e)
      );
      return NextResponse.json({ url: uploaded.url });
    }

    if (serviceId) {
      const shortId = serviceId.split("-").at(-1) ?? serviceId;
      const filename = `Service-${shortId}_${Date.now()}.jpg`;
      const uploaded = await uploadImage({
        folderId: rootFolderId,
        filename,
        mimeType,
        body: buffer,
      });
      await appendServicePhotoUrl(serviceId, uploaded.url);
      return NextResponse.json({ url: uploaded.url });
    }

    if (dispatchId && kind === "signature") {
      const shortId = dispatchId.split("-").at(-1) ?? dispatchId;
      const filename = `Dispatch-${shortId}_signature.png`;
      const uploaded = await uploadImage({
        folderId: rootFolderId,
        filename,
        mimeType: "image/png",
        body: buffer,
      });
      await setDispatchSignature(dispatchId, uploaded.url, signedByName);
      revalidatePath(`/jobs/${jobId}`);
      return NextResponse.json({ url: uploaded.url });
    }
  } catch (e) {
    const inner = e as { cause?: { message?: string }; message?: string };
    const message =
      inner?.cause?.message ?? inner?.message ?? "Drive upload failed";
    console.error("Upload error:", e);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json(
    { error: "Either unitId or serviceId required" },
    { status: 400 }
  );
}

async function ensureJobFolderId(job: {
  customerName: string;
  siteAddress: string;
  createdDate: string;
}): Promise<string> {
  const created = new Date(job.createdDate);
  const folder = await getOrCreateFolder(
    jobFolderName({
      customerName: job.customerName,
      siteAddress: job.siteAddress,
      createdDate: created,
    }),
    getRootFolderId()
  );
  return folder.id;
}

function slugForFilename(s: string): string {
  return s.replace(/[^a-zA-Z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
}
