import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { getJob, setJobCoverPhotoId } from "@/lib/data/jobs";
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
import {
  appendAuditItemSchedulePhoto,
  getAuditItem,
  setAuditItemField,
} from "@/lib/data/audit-items";
import { getAudit, setAuditField } from "@/lib/data/audits";
import type { PhotoSlot } from "@/lib/types";

const AUDIT_BUILDING_SLOTS = ["front", "fire-plan", "bas"] as const;
const AUDIT_ITEM_SLOTS = [
  "model-label",
  "nameplate",
  "fans",
  "temp",
  "wiring",
  "location",
  "schedule",
  "controls",
] as const;

const AUDIT_BUILDING_FIELD: Record<
  (typeof AUDIT_BUILDING_SLOTS)[number],
  "frontPhotoUrl" | "firePlanPhotoUrl" | "basPhotoUrl"
> = {
  front: "frontPhotoUrl",
  "fire-plan": "firePlanPhotoUrl",
  bas: "basPhotoUrl",
};

// "schedule" is special-cased separately (CSV append), so it's
// deliberately absent from this map. The upload handler checks for
// "schedule" first and only consults this map for single-cell slots.
const AUDIT_ITEM_SINGLE_FIELD: Record<
  Exclude<(typeof AUDIT_ITEM_SLOTS)[number], "schedule">,
  | "modelLabelPhotoUrl"
  | "nameplatePhotoUrl"
  | "fansPhotoUrl"
  | "tempPhotoUrl"
  | "wiringPhotoUrl"
  | "locationPhotoUrl"
  | "controlsPhotoUrl"
> = {
  "model-label": "modelLabelPhotoUrl",
  nameplate: "nameplatePhotoUrl",
  fans: "fansPhotoUrl",
  temp: "tempPhotoUrl",
  wiring: "wiringPhotoUrl",
  location: "locationPhotoUrl",
  controls: "controlsPhotoUrl",
};

function slugForAuditFilename(slot: string): string {
  return slot.replace(/[^a-zA-Z0-9_-]+/g, "_");
}

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
  const customerEmail = String(formData.get("customerEmail") ?? "")
    .trim()
    .slice(0, 200);
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
    // Kind-first: job-cover and signature are unambiguous intents and
    // should win over any stray unitId/serviceId on the request,
    // since those fields could be left over from a previous form
    // state and we don't want to silently misroute an upload.

    if (kind === "audit-building") {
      const auditId = String(formData.get("auditId") ?? "").trim();
      if (!auditId) {
        return NextResponse.json(
          { error: "Missing auditId" },
          { status: 400 }
        );
      }
      if (!AUDIT_BUILDING_SLOTS.includes(slot as never)) {
        return NextResponse.json(
          { error: "Invalid audit-building slot" },
          { status: 400 }
        );
      }
      const audit = await getAudit(auditId);
      if (!audit) {
        return NextResponse.json(
          { error: "Audit not found" },
          { status: 404 }
        );
      }
      // Audit photos live in an `Audit/` subfolder per job. Folder
      // creation is lazy + idempotent (getOrCreateFolder).
      const auditFolder = await getOrCreateFolder("Audit", rootFolderId);
      const filename = `${slugForAuditFilename(slot)}_${Date.now()}.jpg`;
      const uploaded = await uploadImage({
        folderId: auditFolder.id,
        filename,
        mimeType,
        body: buffer,
      });
      try {
        await setAuditField({
          auditId,
          field: AUDIT_BUILDING_FIELD[slot as keyof typeof AUDIT_BUILDING_FIELD],
          value: uploaded.url,
        });
      } catch (e) {
        console.error(
          `[upload] audit-building orphan: fileId=${uploaded.id} auditId=${auditId} slot=${slot}`,
          e
        );
        throw e;
      }
      revalidatePath(`/jobs/${jobId}/audit`);
      return NextResponse.json({ url: uploaded.url });
    }

    if (kind === "audit-item") {
      const itemId = String(formData.get("itemId") ?? "").trim();
      if (!itemId) {
        return NextResponse.json(
          { error: "Missing itemId" },
          { status: 400 }
        );
      }
      if (!AUDIT_ITEM_SLOTS.includes(slot as never)) {
        return NextResponse.json(
          { error: "Invalid audit-item slot" },
          { status: 400 }
        );
      }
      const item = await getAuditItem(itemId);
      if (!item) {
        return NextResponse.json(
          { error: "AuditItem not found" },
          { status: 404 }
        );
      }
      const auditFolder = await getOrCreateFolder("Audit", rootFolderId);
      const prefix =
        item.itemType === "Walk-In"
          ? `WalkIn-${String(item.itemNumber).padStart(3, "0")}`
          : item.itemType === "Thermostat"
          ? `Therm-${String(item.itemNumber).padStart(3, "0")}`
          : `WaterSource-${String(item.itemNumber).padStart(3, "0")}`;
      const filename = `${prefix}_${slugForAuditFilename(slot)}_${Date.now()}.jpg`;
      const uploaded = await uploadImage({
        folderId: auditFolder.id,
        filename,
        mimeType,
        body: buffer,
      });
      try {
        if (slot === "schedule") {
          // Multi-photo: append the URL to the CSV column.
          await appendAuditItemSchedulePhoto({ itemId, url: uploaded.url });
        } else {
          await setAuditItemField({
            itemId,
            field: AUDIT_ITEM_SINGLE_FIELD[
              slot as keyof typeof AUDIT_ITEM_SINGLE_FIELD
            ],
            value: uploaded.url,
          });
        }
      } catch (e) {
        console.error(
          `[upload] audit-item orphan: fileId=${uploaded.id} itemId=${itemId} slot=${slot}`,
          e
        );
        throw e;
      }
      revalidatePath(`/jobs/${jobId}/audit`);
      return NextResponse.json({ url: uploaded.url });
    }

    if (kind === "job-cover") {
      // Cover photo for the whole job. One file per job — overwriting
      // is fine since the previous cover is still in Drive history,
      // and the Sheets cell only stores the most recent fileId. We
      // always upload a new file rather than overwriting in-place to
      // keep the Drive view auditable.
      const safeCustomer = slugForFilename(job.customerName) || "job";
      const filename = `Cover_${safeCustomer}_${Date.now()}.jpg`;
      const uploaded = await uploadImage({
        folderId: rootFolderId,
        filename,
        mimeType,
        body: buffer,
      });
      try {
        await setJobCoverPhotoId({ jobId, fileId: uploaded.id });
      } catch (e) {
        // Sheet write failed but the file is in Drive — log the
        // orphan fileId so it's recoverable from the audit log.
        console.error(
          `[upload] job-cover orphan: fileId=${uploaded.id} jobId=${jobId}`,
          e
        );
        throw e;
      }
      revalidatePath("/jobs");
      revalidatePath(`/jobs/${jobId}`);
      revalidatePath("/admin/customers");
      return NextResponse.json({ url: uploaded.url, fileId: uploaded.id });
    }

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
      await setDispatchSignature(
        dispatchId,
        uploaded.url,
        signedByName,
        customerEmail
      );
      // Try the PDF render now too — if all photos already happened to
      // be uploaded by the time the customer signs, this completes the
      // dispatch's report immediately.
      tryRenderPdfIfReady(dispatchId).catch((e) =>
        console.warn("[upload] post-signature PDF render error:", e)
      );
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
