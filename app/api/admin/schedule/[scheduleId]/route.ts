import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/payroll/auth";
import { updateVisit } from "@/lib/data/schedule";

// PATCH /api/admin/schedule/[scheduleId]
//   Body: any of { date, startTime, durationMins, techs, notes, status }
//   status "Cancelled" is the soft delete — the row stays for history.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: { scheduleId: string } }
) {
  const guard = await requireAdmin();
  if ("response" in guard) return guard.response;

  const scheduleId = decodeURIComponent(params.scheduleId);
  let body: {
    date?: unknown;
    startTime?: unknown;
    durationMins?: unknown;
    techs?: unknown;
    notes?: unknown;
    status?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  const patch: Parameters<typeof updateVisit>[0]["patch"] = {};
  if (body.date !== undefined) {
    const d = String(body.date).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      return NextResponse.json(
        { error: "date must be YYYY-MM-DD" },
        { status: 400 }
      );
    }
    patch.date = d;
  }
  if (body.startTime !== undefined) {
    const t = String(body.startTime).trim();
    if (t && !/^\d{2}:\d{2}$/.test(t)) {
      return NextResponse.json(
        { error: "startTime must be HH:mm" },
        { status: 400 }
      );
    }
    patch.startTime = t;
  }
  if (body.durationMins !== undefined) {
    patch.durationMins = Number(body.durationMins) || 0;
  }
  if (body.techs !== undefined) {
    if (!Array.isArray(body.techs)) {
      return NextResponse.json({ error: "techs must be a list" }, { status: 400 });
    }
    const techs = body.techs.map((t) => String(t).trim()).filter(Boolean);
    if (techs.length === 0) {
      return NextResponse.json(
        { error: "assign at least one tech" },
        { status: 400 }
      );
    }
    patch.techs = techs;
  }
  if (body.notes !== undefined) patch.notes = String(body.notes).slice(0, 500);
  if (body.status !== undefined) {
    const s = String(body.status);
    if (s !== "Scheduled" && s !== "Cancelled") {
      return NextResponse.json(
        { error: "status must be Scheduled or Cancelled" },
        { status: 400 }
      );
    }
    patch.status = s;
  }

  try {
    await updateVisit({ scheduleId, patch, updatedBy: guard.session.name });
    revalidatePath("/admin/schedule");
    revalidatePath("/schedule");
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[schedule PATCH] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
