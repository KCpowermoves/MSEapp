import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { createJob, listActiveJobs } from "@/lib/data/jobs";
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
  if (!customerName || !siteAddress) {
    return NextResponse.json(
      { error: "Customer name and site address are required" },
      { status: 400 }
    );
  }
  if (!TERRITORIES.includes(territory)) {
    return NextResponse.json(
      { error: "Pick a utility territory" },
      { status: 400 }
    );
  }
  try {
    const job = await createJob({
      customerName,
      siteAddress,
      utilityTerritory: territory,
      createdBy: session.name,
    });
    return NextResponse.json(job);
  } catch (e) {
    console.error("Job creation failed:", e);
    return NextResponse.json(
      { error: "Could not create job. Try again." },
      { status: 500 }
    );
  }
}
