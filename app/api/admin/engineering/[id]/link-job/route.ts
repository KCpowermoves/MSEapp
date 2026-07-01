import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/payroll/auth";
import {
  getEngineeringProject,
  updateEngineeringProject,
} from "@/lib/data/engineering-projects";
import { getJob } from "@/lib/data/jobs";
import { listUnitsForJob } from "@/lib/data/units";
import type { HvacUnitInput, UnitServiced } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Rough mapping from the tech app's UnitType enum to a numeric tonnage
// hint. The engineering project's HVAC form expects a tonnage number;
// techs don't record it directly, so we default from the size class.
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

function unitToHvacInput(unit: UnitServiced): HvacUnitInput {
  return {
    tag: unit.label || `Unit ${unit.unitNumberOnJob}`,
    serves: "",
    tstat: "",
    tons: tonsFromUnitType(unit.unitType),
    ouModel: [unit.make, unit.model].filter(Boolean).join(" "),
    qty: 1,
    seer: 0,
    supplyFanHp: 0,
    heatPump: "No",
    electricHeatKw: 0,
    controls: "",
    proposedSchedule: "",
    notes: unit.serial ? `Serial: ${unit.serial}` : unit.notes || "",
  };
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
    // Clear the link.
    await updateEngineeringProject({
      projectId: id,
      linkedJobId: "",
    });
    revalidatePath(`/admin/engineering/${id}`);
    return NextResponse.json({ ok: true, cleared: true });
  }

  const job = await getJob(jobId);
  if (!job)
    return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const units = await listUnitsForJob(jobId);
  const activeUnits = units.filter((u) => !u.deleted);
  const hvacUnits = activeUnits.map(unitToHvacInput);

  await updateEngineeringProject({
    projectId: id,
    linkedJobId: jobId,
    customerName: job.customerName,
    siteAddress: job.siteAddress,
    hvacUnits,
  });

  revalidatePath(`/admin/engineering/${id}`);
  return NextResponse.json({
    ok: true,
    linkedJobId: jobId,
    customerName: job.customerName,
    siteAddress: job.siteAddress,
    unitsAdded: hvacUnits.length,
  });
}
