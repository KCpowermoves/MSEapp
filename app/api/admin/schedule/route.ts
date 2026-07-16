import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/payroll/auth";
import { createVisit, listVisitsInRange } from "@/lib/data/schedule";
import { getJob } from "@/lib/data/jobs";

// GET  /api/admin/schedule?from=YYYY-MM-DD&to=YYYY-MM-DD → visits
// POST /api/admin/schedule → create a visit
//   Body: { jobId, date, startTime?, durationMins?, techs: string[], notes? }

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await requireAdmin();
  if ("response" in guard) return guard.response;
  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json(
      { error: "from/to must be YYYY-MM-DD" },
      { status: 400 }
    );
  }
  const visits = await listVisitsInRange({ startIso: from, endIso: to });
  return NextResponse.json({ visits });
}

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if ("response" in guard) return guard.response;

  let body: {
    jobId?: unknown;
    date?: unknown;
    startTime?: unknown;
    durationMins?: unknown;
    techs?: unknown;
    notes?: unknown;
    estUnits?: unknown;
    auditRequired?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  const jobId = String(body.jobId ?? "").trim();
  const date = String(body.date ?? "").trim();
  const startTime = String(body.startTime ?? "").trim();
  const durationMins = Number(body.durationMins ?? 0) || 0;
  const techs = Array.isArray(body.techs)
    ? body.techs.map((t) => String(t).trim()).filter(Boolean)
    : [];
  const notes = String(body.notes ?? "").slice(0, 500);
  const estUnits = Math.max(0, Math.round(Number(body.estUnits ?? 0) || 0));
  const auditRequired = Boolean(body.auditRequired);

  if (!jobId) {
    return NextResponse.json({ error: "jobId required" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: "date must be YYYY-MM-DD" },
      { status: 400 }
    );
  }
  if (startTime && !/^\d{2}:\d{2}$/.test(startTime)) {
    return NextResponse.json(
      { error: "startTime must be HH:mm" },
      { status: 400 }
    );
  }
  if (techs.length === 0) {
    return NextResponse.json(
      { error: "assign at least one tech" },
      { status: 400 }
    );
  }
  const job = await getJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  try {
    const visit = await createVisit({
      jobId,
      date,
      startTime,
      durationMins,
      techs,
      notes,
      estUnits,
      auditRequired,
      createdBy: guard.session.name,
    });
    revalidatePath("/admin/schedule");
    revalidatePath("/schedule");
    return NextResponse.json({ ok: true, visit });
  } catch (e) {
    console.error("[schedule POST] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
