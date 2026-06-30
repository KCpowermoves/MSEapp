import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/payroll/auth";
import {
  getEngineeringProject,
  softDeleteEngineeringProject,
  updateEngineeringProject,
} from "@/lib/data/engineering-projects";
import type {
  EngineeringLocation,
  EngineeringProjectStatus,
  EngineeringProjectType,
  EngineeringUtility,
  HvacUnitInput,
  MonthlyBill,
  WalkInUnitInput,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const guard = await requireAdmin();
  if ("response" in guard) return guard.response;
  const id = decodeURIComponent(params.id);
  const project = await getEngineeringProject(id);
  if (!project)
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ project });
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const guard = await requireAdmin();
  if ("response" in guard) return guard.response;
  const id = decodeURIComponent(params.id);
  const project = await getEngineeringProject(id);
  if (!project)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const patch: Parameters<typeof updateEngineeringProject>[0] = {
    projectId: id,
  };
  const b = body as Record<string, unknown>;
  if (b.customerName !== undefined)
    patch.customerName = String(b.customerName).trim();
  if (b.siteAddress !== undefined)
    patch.siteAddress = String(b.siteAddress).trim();
  if (b.utility !== undefined) patch.utility = b.utility as EngineeringUtility;
  if (b.projectType !== undefined)
    patch.projectType = b.projectType as EngineeringProjectType;
  if (b.projectSubtype !== undefined)
    patch.projectSubtype = String(b.projectSubtype).trim();
  if (b.squareFootage !== undefined)
    patch.squareFootage = Number(b.squareFootage) || 0;
  if (b.location !== undefined)
    patch.location = b.location as EngineeringLocation;
  if (b.annualKwh !== undefined)
    patch.annualKwh = Number(b.annualKwh) || 0;
  if (b.engineeringFeeOverride !== undefined)
    patch.engineeringFeeOverride =
      b.engineeringFeeOverride === null
        ? null
        : Number(b.engineeringFeeOverride);
  if (b.sensorCostOverride !== undefined)
    patch.sensorCostOverride =
      b.sensorCostOverride === null ? null : Number(b.sensorCostOverride);
  if (b.monthlyBills !== undefined && Array.isArray(b.monthlyBills))
    patch.monthlyBills = b.monthlyBills as MonthlyBill[];
  if (b.hvacUnits !== undefined && Array.isArray(b.hvacUnits))
    patch.hvacUnits = b.hvacUnits as HvacUnitInput[];
  if (b.walkInUnits !== undefined && Array.isArray(b.walkInUnits))
    patch.walkInUnits = b.walkInUnits as WalkInUnitInput[];
  if (b.status !== undefined)
    patch.status = b.status as EngineeringProjectStatus;
  if (b.notes !== undefined) patch.notes = String(b.notes);

  try {
    await updateEngineeringProject(patch);
    revalidatePath("/admin/engineering");
    revalidatePath(`/admin/engineering/${id}`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[engineering PATCH] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const guard = await requireAdmin();
  if ("response" in guard) return guard.response;
  const id = decodeURIComponent(params.id);
  try {
    await softDeleteEngineeringProject(id);
    revalidatePath("/admin/engineering");
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[engineering DELETE] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
