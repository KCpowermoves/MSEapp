import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { createJob, listActiveJobs, updateJob } from "@/lib/data/jobs";
import type { UtilityTerritory } from "@/lib/types";

const TERRITORIES: UtilityTerritory[] = ["BGE", "PEPCO", "Delmarva", "SMECO"];

export async function GET() {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const jobs = await listActiveJobs();
  return NextResponse.json({ jobs });
}

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
  const customerName = String(body.customerName ?? "").trim();
  const siteAddress = String(body.siteAddress ?? "").trim();
  const territory = body.utilityTerritory as UtilityTerritory;
  const selfSold = Boolean(body.selfSold);
  const soldBy = String(body.soldBy ?? "").trim();
  if (!customerName) {
    return NextResponse.json(
      { error: "Business name is required" },
      { status: 400 }
    );
  }
  if (!TERRITORIES.includes(territory)) {
    return NextResponse.json(
      { error: "Pick a utility territory" },
      { status: 400 }
    );
  }
  if (selfSold && !soldBy) {
    return NextResponse.json(
      { error: "Pick who sold this job" },
      { status: 400 }
    );
  }
  try {
    const job = await createJob({
      customerName,
      siteAddress,
      utilityTerritory: territory,
      selfSold,
      soldBy,
      createdBy: session.name,
    });
    revalidatePath("/jobs");
    return NextResponse.json(job);
  } catch (e) {
    console.error("Job creation failed:", e);
    return NextResponse.json(
      { error: "Could not create job. Try again." },
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

  const jobId = String(body.jobId ?? "").trim();
  if (!jobId) return NextResponse.json({ error: "Missing jobId" }, { status: 400 });

  const patch: Parameters<typeof updateJob>[0] = { jobId };
  if (body.customerName !== undefined) patch.customerName = String(body.customerName).trim();
  if (body.siteAddress !== undefined) patch.siteAddress = String(body.siteAddress).trim();
  if (body.utilityTerritory !== undefined) {
    if (!TERRITORIES.includes(body.utilityTerritory))
      return NextResponse.json({ error: "Invalid territory" }, { status: 400 });
    patch.utilityTerritory = body.utilityTerritory as UtilityTerritory;
  }
  if (body.status !== undefined) {
    if (!["Active", "Closed"].includes(body.status))
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    patch.status = body.status as "Active" | "Closed";
  }
  if (body.selfSold !== undefined) patch.selfSold = Boolean(body.selfSold);
  if (body.soldBy !== undefined) patch.soldBy = String(body.soldBy).trim();
  if (body.notes !== undefined) patch.notes = String(body.notes).trim();

  try {
    await updateJob(patch);
    revalidatePath(`/jobs/${jobId}`);
    revalidatePath("/jobs");
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("Job update failed:", e);
    return NextResponse.json({ error: "Could not update job." }, { status: 500 });
  }
}
