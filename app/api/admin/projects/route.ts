import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/payroll/auth";
import { createJob } from "@/lib/data/jobs";
import {
  ensureDraftDispatch,
  setDispatchCrew,
} from "@/lib/data/dispatches";
import { findRowIndex, updateCell, TABS } from "@/lib/google/sheets";
import { crewSize } from "@/lib/pay-rates";
import type { CrewSplit, UtilityTerritory } from "@/lib/types";

// POST /api/admin/projects
//
// Admin-side project creation. Same backing data model as a regular
// job (Jobs row + initial dispatch), but with a richer set of role
// assignments captured up front:
//
//   - customerName, siteAddress, utilityTerritory  — the basics
//   - projectLead                                  — tech in charge,
//                                                    stamped on Jobs col N
//   - salesRep                                     — when set, also
//                                                    flips selfSold=TRUE
//                                                    and stamps Job.soldBy
//   - crew                                         — initial techsOnSite
//                                                    on the draft dispatch
//   - driver                                       — driver field on the
//                                                    draft dispatch
//   - notes                                        — free-text on the job
//
// crewSplit is derived from crew size (Solo / 50-50 / 33-33-33) so the
// admin doesn't have to think about it; same convention as everywhere
// else in the app.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const TERRITORIES: UtilityTerritory[] = ["BGE", "PEPCO", "Delmarva", "SMECO"];

function deriveSplitFromCrewSize(n: number): CrewSplit {
  if (n <= 1) return "Solo";
  if (n === 2) return "50-50";
  return "33-33-33";
}

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if ("response" in guard) return guard.response;
  const { session } = guard;

  let body: {
    customerName?: unknown;
    siteAddress?: unknown;
    utilityTerritory?: unknown;
    projectLead?: unknown;
    salesRep?: unknown;
    crew?: unknown;
    driver?: unknown;
    notes?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  const customerName = String(body.customerName ?? "").trim();
  const siteAddress = String(body.siteAddress ?? "").trim();
  const utilityTerritory = String(
    body.utilityTerritory ?? ""
  ) as UtilityTerritory;
  const projectLead = String(body.projectLead ?? "").trim();
  const salesRep = String(body.salesRep ?? "").trim();
  const driver = String(body.driver ?? "").trim();
  const notes = String(body.notes ?? "").trim();
  const crew = Array.isArray(body.crew)
    ? (body.crew as unknown[])
        .map((c) => String(c ?? "").trim())
        .filter(Boolean)
    : [];

  // ── Validation ──────────────────────────────────────────────────
  if (!customerName) {
    return NextResponse.json(
      { error: "Customer name is required" },
      { status: 400 }
    );
  }
  if (!TERRITORIES.includes(utilityTerritory)) {
    return NextResponse.json(
      { error: "Pick a utility territory" },
      { status: 400 }
    );
  }
  // Driver, if set, must be one of the crew.
  if (driver && !crew.includes(driver)) {
    return NextResponse.json(
      { error: "Driver must be one of the crew members" },
      { status: 400 }
    );
  }

  try {
    // ── Step 1: create the Jobs row + Drive folder ──────────────────
    const job = await createJob({
      customerName,
      siteAddress,
      utilityTerritory,
      selfSold: Boolean(salesRep),
      soldBy: salesRep,
      createdBy: session.name,
      notes,
      projectLead,
    });

    // ── Step 2: seed the draft dispatch with crew + driver ──────────
    if (crew.length > 0) {
      try {
        const dispatch = await ensureDraftDispatch(job.jobId);
        const split = deriveSplitFromCrewSize(crew.length);
        await setDispatchCrew(dispatch.dispatchId, crew, split);
        // setDispatchCrew doesn't touch driver — write it ourselves.
        if (driver) {
          const rowIndex = await findRowIndex(
            TABS.dispatches,
            "A",
            dispatch.dispatchId
          );
          if (rowIndex) {
            await updateCell(
              `${TABS.dispatches}!F${rowIndex}`,
              driver,
              "RAW"
            );
          }
        }
      } catch (e) {
        console.warn(
          "[admin/projects] failed to seed draft dispatch:",
          e instanceof Error ? e.message : e
        );
      }
    }

    revalidatePath("/admin/customers");
    revalidatePath("/jobs");
    revalidatePath(`/jobs/${job.jobId}`);

    return NextResponse.json({
      ok: true,
      job,
      meta: {
        crew,
        crewSize: crewSize(deriveSplitFromCrewSize(crew.length)),
        driver,
        projectLead,
        salesRep,
      },
    });
  } catch (e) {
    console.error("[admin/projects POST] failed:", e);
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "Could not create project",
      },
      { status: 500 }
    );
  }
}
