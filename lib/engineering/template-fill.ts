import "server-only";
import path from "path";
import ExcelJS from "exceljs";
import { CELL_MAP } from "@/lib/engineering/cell-map";
import type { EngineeringProject } from "@/lib/types";

/**
 * Fill the BWI calculator template with this project's inputs and
 * return the populated workbook as a Buffer. When the engineer opens
 * the .xlsx in Excel, all formulas recalculate against the new
 * inputs.
 *
 * The template path defaults to `engineering/template-BWI.xlsx`
 * relative to the repo root. v1 only supports BWI; when Andrews TMY3
 * data lands, this function will branch on `project.location`.
 */
export async function fillCalculatorTemplate(
  project: EngineeringProject,
  opts: { templatePath?: string } = {}
): Promise<Buffer> {
  const templatePath =
    opts.templatePath ??
    path.join(process.cwd(), "engineering", "template-BWI.xlsx");

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(templatePath);

  // ── Input Sheet ───────────────────────────────────────────────────
  const inputSheet = wb.getWorksheet(CELL_MAP.inputSheet.sheetName);
  if (!inputSheet) {
    throw new Error(
      `Template missing sheet: ${CELL_MAP.inputSheet.sheetName}`
    );
  }
  setCell(inputSheet, CELL_MAP.inputSheet.utility, project.utility);
  setCell(inputSheet, CELL_MAP.inputSheet.projectName, project.customerName);
  setCell(inputSheet, CELL_MAP.inputSheet.projectType, project.projectType);
  setCell(
    inputSheet,
    CELL_MAP.inputSheet.projectSubtype,
    project.projectSubtype
  );
  setCell(
    inputSheet,
    CELL_MAP.inputSheet.squareFootage,
    project.squareFootage
  );
  setCell(inputSheet, CELL_MAP.inputSheet.address, project.siteAddress);
  if (project.engineeringFeeOverride !== null) {
    setCell(
      inputSheet,
      CELL_MAP.inputSheet.engineeringFeeOverride,
      project.engineeringFeeOverride
    );
  }
  if (project.sensorCostOverride !== null) {
    setCell(
      inputSheet,
      CELL_MAP.inputSheet.sensorCostOverride,
      project.sensorCostOverride
    );
  }

  // ── Energy Use Yearly (monthly bills) ─────────────────────────────
  const eu = wb.getWorksheet(CELL_MAP.energyUseYearly.sheetName);
  if (!eu) {
    throw new Error(
      `Template missing sheet: ${CELL_MAP.energyUseYearly.sheetName}`
    );
  }
  const billsLimit = Math.min(
    project.monthlyBills.length,
    CELL_MAP.energyUseYearly.maxMonths
  );
  for (let i = 0; i < billsLimit; i++) {
    const row = CELL_MAP.energyUseYearly.startRow + i;
    const b = project.monthlyBills[i];
    setCell(eu, `${CELL_MAP.energyUseYearly.startCol}${row}`, isoToDate(b.startDate));
    setCell(eu, `${CELL_MAP.energyUseYearly.endCol}${row}`, isoToDate(b.endDate));
    setCell(eu, `${CELL_MAP.energyUseYearly.usageCol}${row}`, b.usage);
    setCell(eu, `${CELL_MAP.energyUseYearly.hddCol}${row}`, b.hdd);
    setCell(eu, `${CELL_MAP.energyUseYearly.cddCol}${row}`, b.cdd);
    if (b.demandKw !== undefined && b.demandKw !== null) {
      setCell(eu, `${CELL_MAP.energyUseYearly.demandCol}${row}`, b.demandKw);
    }
    if (b.demandCost !== undefined && b.demandCost !== null) {
      setCell(
        eu,
        `${CELL_MAP.energyUseYearly.demandCostCol}${row}`,
        b.demandCost
      );
    }
  }

  // ── Unit List (HVAC) ──────────────────────────────────────────────
  const ul = wb.getWorksheet(CELL_MAP.unitList.sheetName);
  if (!ul) {
    throw new Error(`Template missing sheet: ${CELL_MAP.unitList.sheetName}`);
  }
  const hvacLimit = Math.min(project.hvacUnits.length, CELL_MAP.unitList.maxRows);
  for (let i = 0; i < hvacLimit; i++) {
    const row = CELL_MAP.unitList.startRow + i;
    const u = project.hvacUnits[i];
    setCell(ul, `${CELL_MAP.unitList.snoCol}${row}`, i + 1);
    setCell(ul, `${CELL_MAP.unitList.tagCol}${row}`, u.tag);
    setCell(ul, `${CELL_MAP.unitList.servesCol}${row}`, u.serves);
    setCell(ul, `${CELL_MAP.unitList.tstatCol}${row}`, u.tstat);
    setCell(ul, `${CELL_MAP.unitList.tonsCol}${row}`, u.tons);
    setCell(ul, `${CELL_MAP.unitList.ouModelCol}${row}`, u.ouModel);
    setCell(ul, `${CELL_MAP.unitList.qtyCol}${row}`, u.qty);
    setCell(ul, `${CELL_MAP.unitList.seerCol}${row}`, u.seer);
    setCell(ul, `${CELL_MAP.unitList.supplyFanHpCol}${row}`, u.supplyFanHp);
    setCell(ul, `${CELL_MAP.unitList.heatPumpCol}${row}`, u.heatPump);
    if (u.electricHeatKw !== undefined && u.electricHeatKw !== null) {
      setCell(
        ul,
        `${CELL_MAP.unitList.electricHeatCol}${row}`,
        u.electricHeatKw
      );
    }
    setCell(ul, `${CELL_MAP.unitList.controlsCol}${row}`, u.controls);
    setCell(ul, `${CELL_MAP.unitList.proposedScheduleCol}${row}`, u.proposedSchedule);
    setCell(ul, `${CELL_MAP.unitList.notesCol}${row}`, u.notes);
  }

  // ── Walk-in Units List (coolers + freezers) ───────────────────────
  const wu = wb.getWorksheet(CELL_MAP.walkInUnitsList.sheetName);
  if (!wu) {
    throw new Error(
      `Template missing sheet: ${CELL_MAP.walkInUnitsList.sheetName}`
    );
  }
  const coolers = project.walkInUnits.filter((w) => w.kind === "Cooler");
  const freezers = project.walkInUnits.filter((w) => w.kind === "Freezer");
  writeWalkIns(
    wu,
    coolers,
    CELL_MAP.walkInUnitsList.coolerStartRow,
    CELL_MAP.walkInUnitsList.maxCoolers
  );
  writeWalkIns(
    wu,
    freezers,
    CELL_MAP.walkInUnitsList.freezerStartRow,
    CELL_MAP.walkInUnitsList.maxFreezers
  );

  // ── Save & return ─────────────────────────────────────────────────
  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer as ArrayBuffer);
}

function writeWalkIns(
  sheet: ExcelJS.Worksheet,
  items: { tag: string; condenserModel: string; serial: string; evaporatorModel: string; tonnage: number; mbh: number; watts: number; awef: number; fanMotorHp: number; numFans: number }[],
  startRow: number,
  maxRows: number
): void {
  const limit = Math.min(items.length, maxRows);
  for (let i = 0; i < limit; i++) {
    const row = startRow + i;
    const u = items[i];
    setCell(sheet, `${CELL_MAP.walkInUnitsList.noCol}${row}`, i + 1);
    setCell(sheet, `${CELL_MAP.walkInUnitsList.tagCol}${row}`, u.tag);
    setCell(sheet, `${CELL_MAP.walkInUnitsList.condenserModelCol}${row}`, u.condenserModel);
    setCell(sheet, `${CELL_MAP.walkInUnitsList.serialCol}${row}`, u.serial);
    setCell(sheet, `${CELL_MAP.walkInUnitsList.evaporatorModelCol}${row}`, u.evaporatorModel);
    setCell(sheet, `${CELL_MAP.walkInUnitsList.tonnageCol}${row}`, u.tonnage);
    setCell(sheet, `${CELL_MAP.walkInUnitsList.mbhCol}${row}`, u.mbh);
    setCell(sheet, `${CELL_MAP.walkInUnitsList.wattsCol}${row}`, u.watts);
    setCell(sheet, `${CELL_MAP.walkInUnitsList.awefCol}${row}`, u.awef);
    setCell(sheet, `${CELL_MAP.walkInUnitsList.fanMotorHpCol}${row}`, u.fanMotorHp);
    setCell(sheet, `${CELL_MAP.walkInUnitsList.numFansCol}${row}`, u.numFans);
  }
}

/** Convert ISO date string to a JS Date so exceljs writes a real
 *  Excel date (which the formulas can do month math on). */
function isoToDate(iso: string): Date | string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00Z");
  return Number.isNaN(d.getTime()) ? iso : d;
}

function setCell(
  sheet: ExcelJS.Worksheet,
  address: string,
  value: string | number | Date | null | undefined
): void {
  if (value === undefined || value === null || value === "") {
    // Skip empties — preserves the template's default if any.
    return;
  }
  const cell = sheet.getCell(address);
  cell.value = value;
}
