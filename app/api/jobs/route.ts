import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { createJob, listActiveJobs, updateJob } from "@/lib/data/jobs";
import {
  ensureDraftDispatch,
  setDispatchCrew,
} from "@/lib/data/dispatches";
import type { CrewSplit, UtilityTerritory } from "@/lib/types";

const TERRITORIES: UtilityTerritory[] = ["BGE", "PEPCO", "Delmarva", "SMECO"];
const SPLITS: CrewSplit[] = ["Solo", "50-50", "33-33-33"];

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
  // Crew + split now collected at job creation. Optional — if not
  // provided, the dispatch starts blank and the tech can fill in
  // later on the submit page.
  const techsOnSite = Array.isArray(body.techsOnSite)
    ? body.techsOnSite.map((s: unknown) => String(s).trim()).filter(Boolean)
    : [];
  const crewSplitInput = body.crewSplit as CrewSplit | undefined;
  const crewSplit: CrewSplit = SPLITS.includes(crewSplitInput as CrewSplit)
    ? (crewSplitInput as CrewSplit)
    : "Solo";

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
  try {
    const job = await createJob({
      customerName,
      siteAddress,
      utilityTerritory: territory,
      // Self-sold concept removed from the workflow 2026-05-05.
      // Always FALSE for new jobs; the column stays in the schema for
      // historical rows.
      selfSold: false,
      soldBy: "",
      createdBy: session.name,
    });
    // If the tech picked a crew at creation, seed today's draft
    // dispatch so the submit page already knows who's on site.
    if (techsOnSite.length > 0) {
      try {
        const dispatch = await ensureDraftDispatch(job.jobId);
        await setDispatchCrew(dispatch.dispatchId, techsOnSite, crewSplit);
      } catch (e) {
        // Don't fail the job creation if the draft dispatch seed
        // fails — the tech can still fill in crew at submit time.
        console.warn("[jobs] failed to seed draft dispatch crew:", e);
      }
    }
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
  // Self-sold concept retired 2026-05-05 — no longer accepted on
  // PATCH. Historical rows keep whatever values they had; edit
  // directly in the sheet if you need to fix one.
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
