import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { ensureDraftDispatch } from "@/lib/data/dispatches";
import { createUnit, nextUnitNumberOnJob } from "@/lib/data/units";
import type { UnitSubType, UnitType } from "@/lib/types";

const UNIT_TYPES: UnitType[] = ["PTAC", "Standard", "Medium", "Large"];
const UNIT_SUB_TYPES: UnitSubType[] = [
  "Standard tune-up",
  "Water-source heat pump",
  "VRV-VRF",
  "Other building tune-up",
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
  const unitSubType = body.unitSubType as UnitSubType;
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
  if (!UNIT_SUB_TYPES.includes(unitSubType)) {
    return NextResponse.json({ error: "Pick a sub-type" }, { status: 400 });
  }

  try {
    const dispatch = await ensureDraftDispatch(jobId);
    const unitNumber = await nextUnitNumberOnJob(jobId);
    const unit = await createUnit({
      dispatchId: dispatch.dispatchId,
      jobId,
      unitNumberOnJob: unitNumber,
      unitType,
      unitSubType,
      make,
      model,
      serial,
      notes,
      loggedBy: session.name,
    });
    return NextResponse.json({ unit, dispatchId: dispatch.dispatchId });
  } catch (e) {
    console.error("Unit creation failed:", e);
    return NextResponse.json(
      { error: "Could not save unit. Try again." },
      { status: 500 }
    );
  }
}
