import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/payroll/auth";
import {
  createEngineeringProject,
  listAllEngineeringProjects,
} from "@/lib/data/engineering-projects";
import type {
  EngineeringLocation,
  EngineeringUtility,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_UTILITIES: EngineeringUtility[] = [
  "BGE",
  "PEPCO",
  "Delmarva",
  "SMECO",
];
const VALID_LOCATIONS: EngineeringLocation[] = ["BWI", "Andrews"];

export async function GET() {
  const guard = await requireAdmin();
  if ("response" in guard) return guard.response;
  const projects = await listAllEngineeringProjects();
  return NextResponse.json({ projects });
}

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if ("response" in guard) return guard.response;
  const { session } = guard;

  const body = await request.json().catch(() => null);
  if (!body)
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const customerName = String(body.customerName ?? "").trim();
  const utility = body.utility as EngineeringUtility;
  const location = body.location as EngineeringLocation;

  if (!customerName) {
    return NextResponse.json(
      { error: "Customer name is required" },
      { status: 400 }
    );
  }
  if (!VALID_UTILITIES.includes(utility)) {
    return NextResponse.json({ error: "Pick a utility" }, { status: 400 });
  }
  if (!VALID_LOCATIONS.includes(location)) {
    return NextResponse.json({ error: "Pick a location" }, { status: 400 });
  }

  try {
    const project = await createEngineeringProject({
      customerName,
      utility,
      location,
      createdBy: session.name ?? "",
    });
    revalidatePath("/admin/engineering");
    return NextResponse.json({ project });
  } catch (e) {
    console.error("[engineering POST] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
