import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/payroll/auth";
import { getPayrollPeriod } from "@/lib/data/payroll-periods";
import { getDispatch } from "@/lib/data/dispatches";
import { listUnitsForDispatch } from "@/lib/data/units";
import { createSplitChange } from "@/lib/data/payroll-adjustments";
import { logPayrollAction } from "@/lib/data/payroll-log";
import { INSTALL_PAY, crewSize } from "@/lib/pay-rates";
import type { CrewSplit } from "@/lib/types";

// POST /api/admin/payroll/split-change
// Body: { periodId, dispatchId, newTechs[], newCrewSplit }
//
// Recomputes per-tech install pay for the dispatch under the NEW crew
// + split and writes delta adjustments (-old + new) for every tech
// affected, including any new techs joining the crew. Sales bonus,
// service rows, and travel pay are untouched — only Install changes.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_SPLITS: CrewSplit[] = ["Solo", "50-50", "33-33-33"];

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if ("response" in guard) return guard.response;

  let body: {
    periodId?: unknown;
    dispatchId?: unknown;
    newTechs?: unknown;
    newCrewSplit?: unknown;
    note?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  const periodId = String(body.periodId ?? "").trim();
  const dispatchId = String(body.dispatchId ?? "").trim();
  const newCrewSplit = String(body.newCrewSplit ?? "") as CrewSplit;
  const newTechs = Array.isArray(body.newTechs)
    ? (body.newTechs as unknown[])
        .map((t) => String(t ?? "").trim())
        .filter(Boolean)
    : [];

  if (!periodId) {
    return NextResponse.json({ error: "periodId required" }, { status: 400 });
  }
  if (!dispatchId) {
    return NextResponse.json(
      { error: "dispatchId required" },
      { status: 400 }
    );
  }
  if (!VALID_SPLITS.includes(newCrewSplit)) {
    return NextResponse.json(
      { error: "newCrewSplit must be Solo / 50-50 / 33-33-33" },
      { status: 400 }
    );
  }
  if (newTechs.length === 0) {
    return NextResponse.json(
      { error: "newTechs must have at least one tech" },
      { status: 400 }
    );
  }

  const expectedSize = crewSize(newCrewSplit);
  if (newTechs.length !== expectedSize) {
    return NextResponse.json(
      {
        error: `Crew size ${newTechs.length} does not match split ${newCrewSplit} (needs ${expectedSize})`,
      },
      { status: 400 }
    );
  }

  const period = await getPayrollPeriod(periodId);
  if (!period) {
    return NextResponse.json({ error: "Period not found" }, { status: 404 });
  }
  if (period.status !== "Draft") {
    return NextResponse.json(
      { error: "Unlock the period to Draft before changing splits" },
      { status: 409 }
    );
  }

  const dispatch = await getDispatch(dispatchId);
  if (!dispatch) {
    return NextResponse.json({ error: "Dispatch not found" }, { status: 404 });
  }
  const units = await listUnitsForDispatch(dispatchId);
  if (units.length === 0) {
    return NextResponse.json(
      { error: "Dispatch has no units to recompute" },
      { status: 409 }
    );
  }

  // Compute per-tech delta on Install only.
  const oldTechs = dispatch.techsOnSite;
  const oldSize = crewSize(dispatch.crewSplit);
  const newSize = crewSize(newCrewSplit);
  const allTechs = Array.from(new Set([...oldTechs, ...newTechs]));

  const oldPay = new Map<string, number>();
  const newPay = new Map<string, number>();
  for (const t of allTechs) {
    oldPay.set(t, 0);
    newPay.set(t, 0);
  }
  for (const u of units) {
    const base = INSTALL_PAY[u.unitType] ?? 0;
    const oldShare = base / oldSize;
    const newShare = base / newSize;
    for (const t of oldTechs) {
      oldPay.set(t, (oldPay.get(t) ?? 0) + oldShare);
    }
    for (const t of newTechs) {
      newPay.set(t, (newPay.get(t) ?? 0) + newShare);
    }
  }

  const deltas: Array<{ techName: string; delta: number }> = [];
  for (const t of allTechs) {
    const delta = (newPay.get(t) ?? 0) - (oldPay.get(t) ?? 0);
    if (Math.abs(delta) > 0.001) {
      deltas.push({ techName: t, delta: Math.round(delta * 100) / 100 });
    }
  }

  const description =
    String(body.note ?? "") ||
    `Crew split changed on ${dispatch.dispatchId}: ${dispatch.crewSplit} (${oldTechs.join(
      ", "
    )}) → ${newCrewSplit} (${newTechs.join(", ")})`;

  try {
    const rows = await createSplitChange({
      periodId,
      deltas,
      description,
      relatedDispatchId: dispatchId,
      createdBy: guard.session.name,
    });
    await logPayrollAction({
      admin: guard.session.name,
      action: "split-change",
      periodId,
      target: dispatchId,
      detail: description,
    });
    return NextResponse.json({ ok: true, deltas, rows });
  } catch (e) {
    console.error("[payroll/split-change POST] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
