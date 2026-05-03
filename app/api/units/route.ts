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
import type { UnitType } from "@/lib/types";

const UNIT_TYPES: UnitType[] = [
  "PTAC / Ductless", "Split System", "RTU-S", "RTU-M", "RTU-L",
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
    });
    revalidatePath(`/jobs/${jobId}`);
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
  if (body.model !== undefined) patch.model = String(body.model).trim();
  if (body.serial !== undefined) patch.serial = String(body.serial).trim();
  if (body.notes !== undefined) patch.notes = String(body.notes).trim();

  try {
    await updateUnit(patch);
    const u = await getUnit(unitId);
    if (u?.jobId) revalidatePath(`/jobs/${u.jobId}`);
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
    revalidatePath("/jobs");
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("Unit delete failed:", e);
    return NextResponse.json({ error: "Could not delete unit." }, { status: 500 });
  }
}
