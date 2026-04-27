import "server-only";
import { TABS, appendRow } from "@/lib/google/sheets";
import {
  INSTALL_PAY,
  SALES_BONUS,
  SERVICE_PAY,
  crewSize,
  isTravelTerritory,
} from "@/lib/pay-rates";
import type {
  AdditionalService,
  Dispatch,
  Job,
  UnitServiced,
} from "@/lib/types";

interface AttributionInput {
  dispatch: Dispatch;
  job: Job;
  units: UnitServiced[];
  services: AdditionalService[];
}

interface AttribRow {
  date: string;
  dispatchId: string;
  techName: string;
  lineItem:
    | "Install"
    | "Sales (paid)"
    | "Sales (pending)"
    | "Service"
    | "Standalone Trip"
    | "Daily Stipend"
    | "Travel Bonus";
  amount: number;
  notes: string;
}

function buildRows(input: AttributionInput): AttribRow[] {
  const { dispatch, job, units, services } = input;
  const rows: AttribRow[] = [];
  const date = dispatch.dispatchDate;
  const techs = dispatch.techsOnSite;
  const cSize = crewSize(dispatch.crewSplit);
  if (!techs.length) return rows;

  for (const u of units) {
    const installTotal = INSTALL_PAY[u.unitType];
    const installPerTech = installTotal / cSize;
    for (const t of techs) {
      rows.push({
        date,
        dispatchId: dispatch.dispatchId,
        techName: t,
        lineItem: "Install",
        amount: installPerTech,
        notes: `Unit-${String(u.unitNumberOnJob).padStart(3, "0")} ${u.unitType} (${dispatch.crewSplit})`,
      });
    }
    if (job.selfSold && job.soldBy) {
      const fullBonus = SALES_BONUS[u.unitType];
      rows.push({
        date,
        dispatchId: dispatch.dispatchId,
        techName: job.soldBy,
        lineItem: "Sales (paid)",
        amount: fullBonus * 0.5,
        notes: `Unit-${String(u.unitNumberOnJob).padStart(3, "0")} ${u.unitType} on self-sold job (50% paid)`,
      });
      rows.push({
        date,
        dispatchId: dispatch.dispatchId,
        techName: job.soldBy,
        lineItem: "Sales (pending)",
        amount: fullBonus * 0.5,
        notes: `Unit-${String(u.unitNumberOnJob).padStart(3, "0")} ${u.unitType} on self-sold job (50% pending utility reimbursement)`,
      });
    }
  }

  for (const s of services) {
    const perItem = SERVICE_PAY[s.serviceType] ?? 0;
    if (s.quantity > 0 && perItem > 0) {
      rows.push({
        date,
        dispatchId: dispatch.dispatchId,
        techName: s.loggedBy,
        lineItem: "Service",
        amount: perItem * s.quantity,
        notes: `${s.quantity} × ${s.serviceType}`,
      });
    }
  }

  if (dispatch.dailyDrivingStipend > 0) {
    for (const t of techs) {
      rows.push({
        date,
        dispatchId: dispatch.dispatchId,
        techName: t,
        lineItem: "Daily Stipend",
        amount: dispatch.dailyDrivingStipend,
        notes: "Photos complete on dispatch day",
      });
    }
  }

  if (
    dispatch.travelDispatchBonus > 0 &&
    dispatch.driver &&
    isTravelTerritory(job.utilityTerritory)
  ) {
    rows.push({
      date,
      dispatchId: dispatch.dispatchId,
      techName: dispatch.driver,
      lineItem: "Travel Bonus",
      amount: dispatch.travelDispatchBonus,
      notes: `${job.utilityTerritory} territory`,
    });
  }

  return rows;
}

export async function writeAttributions(
  input: AttributionInput
): Promise<void> {
  const rows = buildRows(input);
  let i = 1;
  for (const r of rows) {
    const id = `ATTR-${input.dispatch.dispatchId}-${String(i++).padStart(3, "0")}`;
    await appendRow(TABS.payAttribution, [
      id,
      r.date,
      r.dispatchId,
      r.techName,
      r.lineItem,
      r.amount,
      r.notes,
    ]);
  }
}
