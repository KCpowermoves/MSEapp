import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { ensureDraftDispatch, getDispatch } from "@/lib/data/dispatches";
import {
  createUnit,
  getUnit,
  nextUnitNumberOnJob,
  softDeleteUnit,
  updateUnit,
} from "@/lib/data/units";
import type { UnitEngineeringSpecs, UnitType } from "@/lib/types";

// Sanitize the hidden nameplate specs the client passes through from the
// OCR scan. Returns undefined when nothing usable was sent so we don't
// stamp an empty blob over a unit that never got scanned.
function parseSpecs(raw: unknown): UnitEngineeringSpecs | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const specs: UnitEngineeringSpecs = {
    tons: num(o.tons),
    seer: num(o.seer),
    supplyFanHp: num(o.supplyFanHp),
    heatPump: String(o.heatPump ?? "No").trim() || "No",
    electricHeatKw: num(o.electricHeatKw),
  };
  // All-zero / all-default means the scan read no engineering fields —
  // skip so a later re-scan or link-time OCR can still fill them.
  const hasData =
    specs.tons > 0 ||
    specs.seer > 0 ||
    specs.supplyFanHp > 0 ||
    specs.electricHeatKw > 0 ||
    specs.heatPump.toLowerCase() === "yes";
  return hasData ? specs : undefined;
}

const UNIT_TYPES: UnitType[] = [
  "PTAC / Ductless",
  // "Split System" is the legacy combined-side type kept in the
  // union for historical rows. New units choose between the
  // Outdoor / Indoor split variants below.
  "Split System",
  "Outdoor Split System",
  "Indoor Split System",
  "RTU-S",
  "RTU-M",
  "RTU-L",
];

export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const jobId = String(body.jobId ?? "");
  const unitType = body.unitType as UnitType;
  const make = String(body.make ?? "").trim();
  const model = String(body.model ?? "").trim();
  const serial = String(body.serial ?? "").trim();
  const notes = String(body.notes ?? "").trim();

  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
  }
  if (!UNIT_TYPES.includes(unitType)) {
    return NextResponse.json({ error: "Pick a unit type" }, { status: 400 });
  }
  if (!model) {
    return NextResponse.json(
      { error: "Model number is required" },
      { status: 400 }
    );
  }

  const label = String(body.label ?? "").trim();

  try {
    const dispatch = await ensureDraftDispatch(jobId);
    const unitNumber = await nextUnitNumberOnJob(jobId);
    const unit = await createUnit({
      dispatchId: dispatch.dispatchId,
      jobId,
      unitNumberOnJob: unitNumber,
      unitType,
      label,
      make,
      model,
      serial,
      notes,
      loggedBy: session.name,
      engineeringSpecs: parseSpecs(body.engineeringSpecs),
    });
    revalidatePath(`/jobs/${jobId}`);
    revalidatePath(`/jobs/${jobId}/service`);
    revalidatePath("/jobs");
    return NextResponse.json({ unit, dispatchId: dispatch.dispatchId });
  } catch (e) {
    console.error("Unit creation failed:", e);
    return NextResponse.json(
      { error: "Could not save unit. Try again." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const unitId = String(body.unitId ?? "").trim();
  if (!unitId) return NextResponse.json({ error: "Missing unitId" }, { status: 400 });

  const patch: Parameters<typeof updateUnit>[0] = { unitId };
  if (body.unitType !== undefined) {
    if (!UNIT_TYPES.includes(body.unitType))
      return NextResponse.json({ error: "Invalid unit type" }, { status: 400 });
    patch.unitType = body.unitType as UnitType;
  }
  if (body.label !== undefined) patch.label = String(body.label).trim();
  if (body.make !== undefined) patch.make = String(body.make).trim();
  if (body.model !== undefined) {
    const trimmed = String(body.model).trim();
    if (!trimmed) {
      return NextResponse.json(
        { error: "Model number is required" },
        { status: 400 }
      );
    }
    patch.model = trimmed;
  }
  if (body.serial !== undefined) patch.serial = String(body.serial).trim();
  if (body.notes !== undefined) patch.notes = String(body.notes).trim();
  if (body.engineeringSpecs !== undefined) {
    const specs = parseSpecs(body.engineeringSpecs);
    if (specs) patch.engineeringSpecs = specs;
  }

  try {
    await updateUnit(patch);
    const u = await getUnit(unitId);
    if (u?.jobId) {
      revalidatePath(`/jobs/${u.jobId}`);
      revalidatePath(`/jobs/${u.jobId}/service`);
    }
    revalidatePath("/jobs");
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("Unit update failed:", e);
    return NextResponse.json({ error: "Could not update unit." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const unitId = new URL(request.url).searchParams.get("unitId");
  if (!unitId)
    return NextResponse.json({ error: "Missing unitId" }, { status: 400 });

  const unit = await getUnit(unitId);
  if (!unit)
    return NextResponse.json({ error: "Unit not found" }, { status: 404 });

  // Refuse to delete units that are part of a submitted dispatch — pay
  // attribution rows already reference them and removing the unit
  // would leave dangling pay rows.
  const dispatch = await getDispatch(unit.dispatchId);
  if (dispatch?.submittedAt) {
    return NextResponse.json(
      {
        error:
          "This unit is part of a submitted dispatch and can't be deleted. Edit instead.",
      },
      { status: 409 }
    );
  }

  try {
    await softDeleteUnit(unitId);
    revalidatePath(`/jobs/${unit.jobId}`);
    revalidatePath(`/jobs/${unit.jobId}/service`);
    revalidatePath("/jobs");
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("Unit delete failed:", e);
    return NextResponse.json({ error: "Could not delete unit." }, { status: 500 });
  }
}
