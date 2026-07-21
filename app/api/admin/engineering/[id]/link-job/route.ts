import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/payroll/auth";
import {
  getEngineeringProject,
  updateEngineeringProject,
} from "@/lib/data/engineering-projects";
import { getJob } from "@/lib/data/jobs";
import { listUnitsForJob } from "@/lib/data/units";
import { getAuditForJob } from "@/lib/data/audits";
import { listAuditItemsForAudit } from "@/lib/data/audit-items";
import { extractDriveFileId, nowIso } from "@/lib/utils";
import {
  ocrEngineeringDocument,
  engineeringOcrConfigured,
} from "@/lib/engineering/nameplate-ocr";
import type {
  AuditItem,
  EngineeringDocument,
  HvacUnitInput,
  UnitServiced,
  WalkInUnitInput,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Auto-OCR of the pushed nameplates runs inside this request (in
// parallel, best-effort). Give it room; the linker saves the photos +
// carried data BEFORE OCR so a slow read never loses the link.
export const maxDuration = 120;

// Cap total auto-OCR calls per link so a huge building can't fan out
// unbounded. Extra nameplates still get pushed as "pending" for the
// engineer to OCR on demand.
const MAX_AUTO_OCR = 20;

// Rough mapping from the tech app's UnitType enum to a numeric tonnage
// hint. Techs don't record tonnage directly; the nameplate OCR fills
// the real value when it can, so this is only a fallback.
function tonsFromUnitType(unitType: string): number {
  switch (unitType) {
    case "PTAC / Ductless":
      return 1;
    case "RTU-S":
      return 5;
    case "RTU-M":
      return 15;
    case "RTU-L":
      return 30;
    default:
      return 0;
  }
}

// make / model / serial are already captured on the tech side, so we
// carry them straight across (no re-OCR). Engineering specs
// (tons/SEER/fan HP/heat pump) come from the hidden nameplate specs
// captured at scan time when present; only units captured before that
// shipped fall back to the link-time nameplate OCR below.
function unitToHvacInput(unit: UnitServiced): HvacUnitInput {
  const s = unit.engineeringSpecs;
  return {
    tag: unit.label || `Unit ${unit.unitNumberOnJob}`,
    serves: "",
    tstat: "",
    tons: s?.tons ? s.tons : tonsFromUnitType(unit.unitType),
    ouModel: [unit.make, unit.model].filter(Boolean).join(" "),
    qty: 1,
    seer: s?.seer ?? 0,
    supplyFanHp: s?.supplyFanHp ?? 0,
    heatPump: s?.heatPump ?? "No",
    electricHeatKw: s?.electricHeatKw ?? 0,
    controls: "",
    proposedSchedule: "",
    notes: unit.serial ? `Serial: ${unit.serial}` : unit.notes || "",
  };
}

// Nameplate photo URLs on a serviced unit — the outdoor/primary plate
// (nameplateUrl) and, for split systems, the indoor air handler plate.
function unitNameplateUrls(unit: UnitServiced): string[] {
  return [unit.nameplateUrl, unit.inNameplateUrl].filter(
    (u) => u && u.trim()
  );
}

// Walk-in refrigeration comes from the building tune-up AUDIT (walk-in
// items), not the serviced-unit list. Each becomes a Walk-in row; the
// nameplate OCR fills models/tonnage/etc.
function walkInItemToInput(item: AuditItem): WalkInUnitInput {
  return {
    kind: "Cooler",
    tag: item.label || `Walk-in ${item.itemNumber}`,
    condenserModel: "",
    serial: "",
    evaporatorModel: "",
    tonnage: 0,
    mbh: 0,
    watts: 0,
    awef: 0,
    fanMotorHp: 0,
    numFans: 0,
  };
}

function walkInNameplateUrls(item: AuditItem): string[] {
  return [item.nameplatePhotoUrl, item.modelLabelPhotoUrl].filter(
    (u) => u && u.trim()
  );
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const guard = await requireAdmin();
  if ("response" in guard) return guard.response;
  const id = decodeURIComponent(params.id);
  const project = await getEngineeringProject(id);
  if (!project)
    return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const body = await request.json().catch(() => null);
  if (!body)
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const jobId = String(body.jobId ?? "").trim();
  if (!jobId) {
    // Clear the link. Carried rows/photos stay; the admin prunes them.
    await updateEngineeringProject({ projectId: id, linkedJobId: "" });
    revalidatePath(`/admin/engineering/${id}`);
    return NextResponse.json({ ok: true, cleared: true });
  }

  const job = await getJob(jobId);
  if (!job)
    return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const by = guard.session.name;
  const now = nowIso();

  // ── HVAC units from the serviced-unit list ───────────────────────
  const units = (await listUnitsForJob(jobId)).filter((u) => !u.deleted);
  const hvacUnits = units.map(unitToHvacInput);

  // ── Walk-in refrigeration from the audit ─────────────────────────
  const audit = await getAuditForJob(jobId);
  const walkInItems = audit
    ? (await listAuditItemsForAudit(audit.auditId)).filter(
        (i) => i.itemType === "Walk-In" && i.status === "Active"
      )
    : [];
  const walkInUnits = walkInItems.map(walkInItemToInput);

  // ── Build the nameplate documents (reference the same Drive files,
  //    no re-upload) and remember which row each one fills ───────────
  type PlateDoc = {
    doc: EngineeringDocument;
    ocrKind: "hvac-nameplate" | "walkin-nameplate";
    rowIndex: number; // index into hvacUnits or walkInUnits
    primary: boolean; // only the first plate per row is auto-OCR'd
  };
  const plates: PlateDoc[] = [];
  const seenFileIds = new Set(project.documents.map((d) => d.fileId));

  function pushPlate(
    url: string,
    name: string,
    ocrKind: PlateDoc["ocrKind"],
    rowIndex: number,
    primary: boolean,
    ocrStatus: EngineeringDocument["ocrStatus"]
  ) {
    const fileId = extractDriveFileId(url);
    if (!fileId || seenFileIds.has(fileId)) return;
    seenFileIds.add(fileId);
    plates.push({
      doc: {
        fileId,
        url,
        name,
        kind: ocrKind,
        uploadedAt: now,
        uploadedBy: by,
        ocrStatus,
      },
      ocrKind,
      rowIndex,
      primary,
    });
  }

  units.forEach((unit, i) => {
    // Specs already captured at scan time → carry them, no OCR. Only
    // legacy units (no stored specs) get the primary plate auto-OCR'd.
    const hasSpecs = Boolean(unit.engineeringSpecs);
    unitNameplateUrls(unit).forEach((url, j) =>
      pushPlate(
        url,
        `${hvacUnits[i].tag} nameplate`,
        "hvac-nameplate",
        i,
        j === 0 && !hasSpecs,
        hasSpecs ? "skip" : "pending"
      )
    );
  });
  walkInItems.forEach((item, i) => {
    walkInNameplateUrls(item).forEach((url, j) =>
      pushPlate(
        url,
        `${walkInUnits[i].tag} nameplate`,
        "walkin-nameplate",
        i,
        j === 0,
        "pending"
      )
    );
  });

  // ── Save the durable state FIRST (link + carried data + pending
  //    photos), so a slow OCR pass can never lose the link ──────────
  const documents = [...project.documents, ...plates.map((p) => p.doc)];
  await updateEngineeringProject({
    projectId: id,
    linkedJobId: jobId,
    customerName: job.customerName,
    siteAddress: job.siteAddress,
    hvacUnits,
    walkInUnits,
    documents,
  });

  // ── Auto-OCR the primary nameplate of each row to fill the specs
  //    the tech side never captured. Best-effort: failures just leave
  //    that plate "pending" for a manual retry ──────────────────────
  let ocrFilled = 0;
  if (engineeringOcrConfigured()) {
    const targets = plates.filter((p) => p.primary).slice(0, MAX_AUTO_OCR);
    if (plates.filter((p) => p.primary).length > MAX_AUTO_OCR) {
      console.warn(
        `[link-job] ${plates.filter((p) => p.primary).length} plates exceed auto-OCR cap ${MAX_AUTO_OCR}; extras left pending`
      );
    }
    const results = await Promise.all(
      targets.map(async (p) => {
        try {
          const { result, summary } = await ocrEngineeringDocument(
            p.doc.fileId,
            p.ocrKind
          );
          return { p, result, summary, ok: true as const };
        } catch (e) {
          console.error(`[link-job] OCR failed for ${p.doc.fileId}:`, e);
          return {
            p,
            ok: false as const,
            summary: e instanceof Error ? e.message : "OCR error",
          };
        }
      })
    );

    for (const r of results) {
      const docEntry = documents.find((d) => d.fileId === r.p.doc.fileId);
      if (!r.ok) {
        if (docEntry) {
          docEntry.ocrStatus = "failed";
          docEntry.ocrError = r.summary;
        }
        continue;
      }
      if (docEntry) {
        docEntry.ocrStatus = "ok";
        docEntry.ocrSummary = r.summary;
      }
      ocrFilled++;
      // Merge only the engineering specs — keep make/model/serial (and
      // the tag) that were carried from the tech capture.
      if (
        r.result.kind === "hvac-nameplate" &&
        hvacUnits[r.p.rowIndex]
      ) {
        const u = hvacUnits[r.p.rowIndex];
        const o = r.result.unit;
        if (o.tons) u.tons = o.tons;
        if (o.seer) u.seer = o.seer;
        if (o.supplyFanHp) u.supplyFanHp = o.supplyFanHp;
        if (o.heatPump) u.heatPump = o.heatPump;
        if (o.electricHeatKw) u.electricHeatKw = o.electricHeatKw;
      } else if (
        r.result.kind === "walkin-nameplate" &&
        walkInUnits[r.p.rowIndex]
      ) {
        const w = walkInUnits[r.p.rowIndex];
        const o = r.result.unit;
        w.kind = o.kind;
        if (o.condenserModel) w.condenserModel = o.condenserModel;
        if (o.serial) w.serial = o.serial;
        if (o.evaporatorModel) w.evaporatorModel = o.evaporatorModel;
        if (o.tonnage) w.tonnage = o.tonnage;
        if (o.mbh) w.mbh = o.mbh;
        if (o.watts) w.watts = o.watts;
        if (o.awef) w.awef = o.awef;
        if (o.fanMotorHp) w.fanMotorHp = o.fanMotorHp;
        if (o.numFans) w.numFans = o.numFans;
      }
    }

    // Persist the OCR-filled specs + document statuses.
    await updateEngineeringProject({
      projectId: id,
      hvacUnits,
      walkInUnits,
      documents,
    });
  }

  revalidatePath(`/admin/engineering/${id}`);
  return NextResponse.json({
    ok: true,
    linkedJobId: jobId,
    customerName: job.customerName,
    siteAddress: job.siteAddress,
    unitsAdded: hvacUnits.length,
    walkInsAdded: walkInUnits.length,
    nameplatesAdded: plates.length,
    ocrFilled,
  });
}
