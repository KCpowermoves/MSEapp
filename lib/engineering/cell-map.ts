/**
 * Cell mapping config for the BWI template.
 *
 * Maps each form field on the EngineeringProject to the exact cell
 * address in the source `engineering/template-BWI.xlsx` workbook. The
 * template-fill module walks this config + writes each value via
 * exceljs. When Excel opens the populated workbook, all 7,500+
 * formulas recalculate against the new inputs.
 *
 * Source: derived from `engineering/input-sheet.dump.md` (the dump of
 * BWI Template highlighted.xlsx). If the source template ever changes,
 * re-run `node engineering/dump-sheet.mjs` and update the addresses
 * below to match.
 */

export const CELL_MAP = {
  inputSheet: {
    sheetName: "Input Sheet",
    /** D2:G2 merged; we write to the top-left D2 */
    utility: "D2",
    /** K2:Q2 merged; top-left K2 */
    projectName: "K2",
    /** T2 single cell — "Small" / "Medium" / "Large" — drives the
     *  rebate-cap formula at row 14. */
    projectType: "T2",
    /** V2:X2 merged */
    projectSubtype: "V2",
    /** F3:H3 merged */
    squareFootage: "F3",
    /** Q3:X3 merged */
    address: "Q3",
    /** B101 / B104 — optional engineering settings overrides */
    engineeringFeeOverride: "B101",
    sensorCostOverride: "B104",
  },
  energyUseYearly: {
    sheetName: "Energy Use Yearly",
    /** First month at row 2 (row 1 is the header). Columns A–G:
     *  A=Start Date, B=End Date, C=Usage kWh, D=HDD, E=CDD,
     *  F=Demand (kW), G=Demand Cost. */
    startCol: "A",
    endCol: "B",
    usageCol: "C",
    hddCol: "D",
    cddCol: "E",
    demandCol: "F",
    demandCostCol: "G",
    startRow: 2,
    /** Template has ~48 rows of room (rows 2–49). */
    maxMonths: 48,
  },
  unitList: {
    sheetName: "Unit List",
    /** First HVAC row at row 5. Columns from the header (row 4):
     *  A=S.no, B=Tag, C=Serves, D=Tstat, E=Tons, F=OU-Model, G=QTY,
     *  H=SEER, I=Supply Fan HP, J=Heat Pump, K=Electric Heat kW,
     *  N=Controls, O=Proposed Schedule, P=Notes. (Cols L/M are
     *  HYPERLINK references — left static.) */
    startRow: 5,
    snoCol: "A",
    tagCol: "B",
    servesCol: "C",
    tstatCol: "D",
    tonsCol: "E",
    ouModelCol: "F",
    qtyCol: "G",
    seerCol: "H",
    supplyFanHpCol: "I",
    heatPumpCol: "J",
    electricHeatCol: "K",
    controlsCol: "N",
    proposedScheduleCol: "O",
    notesCol: "P",
    /** Input Sheet references B22:U42 (21 HVAC rows). */
    maxRows: 21,
  },
  walkInUnitsList: {
    sheetName: "Walk-in Units List",
    /** Coolers occupy rows 4–14 (rows 3 and 15 are "Coolers" / "Freezers"
     *  header banners). Freezers occupy rows 16–25. */
    coolerStartRow: 4,
    freezerStartRow: 16,
    /** Columns from header (row 2):
     *  A=No, B=Unit Tag, C=Condenser Model, D=Serial, E=Evaporator Model,
     *  F=Tonnage, G=MBH, H=Watts, I=AWEF, J=Fan Motor HP, K=# Fans. */
    noCol: "A",
    tagCol: "B",
    condenserModelCol: "C",
    serialCol: "D",
    evaporatorModelCol: "E",
    tonnageCol: "F",
    mbhCol: "G",
    wattsCol: "H",
    awefCol: "I",
    fanMotorHpCol: "J",
    numFansCol: "K",
    maxCoolers: 10,
    maxFreezers: 10,
  },
} as const;
