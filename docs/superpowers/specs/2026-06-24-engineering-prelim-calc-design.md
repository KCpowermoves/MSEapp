# Engineering Preliminary Calculator — Design

**Date:** 2026-06-24
**Owner:** Kevin
**Status:** Approved (build proceeding)

## Goal

Replace the manual Excel-only workflow for MSE's preliminary energy
audits. The engineering team currently fills out a 14-sheet calculator
workbook by hand (project info, monthly utility bills, HVAC unit
inventory, walk-in refrigeration inventory). The workbook has ~7,500
formulas including bin-method calculations against TMY3 weather data
and produces a preliminary report PDF plus a customer-signed SOW.

Goal: a web form on the admin side that captures the same inputs,
persists them, and on demand renders the populated Excel workbook +
populated SOW Word doc as downloads. We do not port the math —
the .xlsx template stays as the calculation engine.

## Scope

- New admin-only `/admin/engineering` section in the existing app
- Five-section input form covering project info, utility bills,
  HVAC units, walk-in units, engineering settings
- Persistent storage in a new `Engineering Projects` Google Sheet tab
- On-demand server-side `.xlsx` + `.docx` generation by filling the
  source template's input cells
- Location selector (BWI / Andrews AFB), v1 ships BWI only
- v1 generates BOTH the calculator workbook and the SOW

## Out of scope (v1)

- Server-side PDF generation. Engineer opens the populated .xlsx in
  Excel and exports to PDF locally (File → Export → Create PDF).
- Porting the 7,500 Excel formulas to TypeScript. The .xlsx stays
  the calculation engine.
- Andrews AFB TMY3 data. Template ready to swap once Kevin provides
  it.
- Customer-facing signing flow for the SOW (still emailed / printed
  / signed manually).
- Editing the lookup catalogs (Unit List with SEER table, etc.) via
  the UI. v1 keeps those static in the template.
- ECM (Energy Conservation Measure) descriptions — the template has
  preset ECM-1 (HVAC Schedule) and ECM-2 (Refrigeration Sensor) baked
  in. v1 doesn't let users add new ECM types.

## Source template

`engineering/template-BWI.xlsx` (committed binary, ~5.5 MB) — derived
from the BWI-template-highlighted file Kevin provided. The yellow
cells across four sheets are the input surface:

- **Input Sheet**: ~6 project-metadata cells (utility, name, sq ft,
  address, type, subtype)
- **Energy Use Yearly**: 12–48 monthly utility bill rows ×
  (start date, end date, kWh usage, HDD, CDD, optional demand)
- **Unit List**: 1–20 HVAC unit rows × 16 columns (tag, serves, tons,
  SEER, fan HP, heat pump, controls, schedule, etc.)
- **Walk-in Units List**: 1–10 cooler rows + 1–10 freezer rows × 11
  columns (tag, models, tonnage, MBH, AWEF, fans)
- Plus a handful of optional engineering-fee overrides on Input Sheet

Everything else in the workbook (TMY3 weather data, ECM calc engines,
report layouts, Word merge values) stays static and recalculates from
the inputs when Excel opens the populated file.

## Data model

### New sheet tab: `Engineering Projects`

Single row per project. Equipment lists stored as JSON strings to
avoid sheet-width explosion (a single project can have 20 HVAC units
× 16 columns = 320 cells).

| Col | Field | Type | Notes |
|---|---|---|---|
| A | Project ID | string | `ENG-2026-NNNN` |
| B | Created At | ISO ts | |
| C | Created By | string | admin name from session |
| D | Updated At | ISO ts | bumped on every save |
| E | Status | enum | `Draft` / `Final` (manual flag for engineer) |
| F | Customer Name | string | e.g. "Mango Grove" |
| G | Site Address | string | full property address |
| H | Utility | enum | `BGE` / `PEPCO` / `Delmarva` / `SMECO` |
| I | Project Type | enum | `Small` / `Medium` / `Large` (drives rebate cap) |
| J | Project Subtype | string | "Building Tune-up" by default |
| K | Square Footage | number | building sq ft |
| L | Location | enum | `BWI` / `Andrews` |
| M | Annual kWh | number | derived from monthly bills, also stored |
| N | Engineering Fee Override | number\|null | optional override of the calculated fee |
| O | Sensor Cost Override | number\|null | optional override |
| P | Monthly Bills JSON | string | array of `{startDate, endDate, kwh, hdd, cdd, demandKw?, demandCost?}` |
| Q | HVAC Units JSON | string | array of `{tag, serves, tons, ouModel, qty, seer, supplyFanHp, heatPump, electricHeatKw, controls, proposedSchedule, notes}` |
| R | Walk-in Units JSON | string | array of `{kind, tag, condenserModel, serial, evaporatorModel, tonnage, mbh, watts, awef, fanMotorHp, numFans}` where kind is `Cooler` or `Freezer` |
| S | Notes | string | engineer free text |

### ID generator

`nextEngineeringProjectId()` → `ENG-2026-NNNN` following the existing
pattern in `lib/id-generators.ts`.

## API surface

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/engineering` | List all projects (returns the raw rows) |
| POST | `/api/admin/engineering` | Create a new project with body `{customerName, utility, ...}` |
| GET | `/api/admin/engineering/[id]` | Fetch a single project |
| PATCH | `/api/admin/engineering/[id]` | Update any project field; equipment JSON columns accepted as objects |
| DELETE | `/api/admin/engineering/[id]` | Soft-delete (set Status=Deleted) |
| GET | `/api/admin/engineering/[id]/xlsx` | Generate + return populated calculator workbook |
| GET | `/api/admin/engineering/[id]/sow` | Generate + return populated SOW docx |

All require admin via `requireAdmin()`.

## Tech UI

### `/admin/engineering` (list page)

- Admin-only.
- Table of projects: Customer name, utility, sq ft, last updated,
  status, action buttons.
- "New project" button top-right.
- Empty state: "No projects yet. Tap New project to start."

### `/admin/engineering/new` (create form)

Minimal first-step form — just the project name + utility +
location. POST creates the row, redirect to the detail/edit page
where the engineer fills in everything else.

### `/admin/engineering/[id]` (edit form)

Five-section single-scroll form:

#### Section 1 — Project info

- Customer name (text)
- Site address (text)
- Utility (dropdown: BGE / PEPCO / Delmarva / SMECO)
- Project type (dropdown: Small / Medium / Large)
- Project subtype (text, default "Building Tune-up")
- Square footage (number)
- Location (dropdown: BWI / Andrews) — Andrews disabled in v1 with
  tooltip "TMY3 data not yet loaded; coming soon"
- Notes (textarea)

#### Section 2 — Utility bills

Table with one row per month. Engineer pastes from the utility's CSV
or types in:

- Start date, End date, kWh usage, HDD, CDD, optional demand kW,
  optional demand cost.
- "Add month" / "Remove row" buttons.
- Live "Annual kWh" total displayed.

#### Section 3 — HVAC units

Table with one row per unit:

- Unit tag (e.g. "Unit 1")
- Serves (e.g. "Common space")
- Tonnage (number)
- OU Model (string)
- Quantity (number, default 1)
- SEER (number)
- Supply fan HP (number)
- Heat pump (yes/no)
- Electric heating kW (number, optional)
- Controls (text, e.g. "Programmable thermostat")
- Proposed schedule (text — picked up by ECM-1)
- Notes (text)
- "Add unit" / "Remove" buttons

Max 21 units (template `B22:U42` only has 21 rows for HVAC).

#### Section 4 — Walk-in units

Two sub-sections inside (Coolers, Freezers). Each is a table:

- Tag, Condenser model, Serial, Evaporator model, Tonnage, MBH,
  Watts, AWEF, Fan motor HP, # of fans
- "Add cooler" / "Add freezer" / "Remove" buttons

Max 10 coolers + 10 freezers (template walks rows 4–14 + 16–25).

#### Section 5 — Engineering settings

- Engineering fee override (number, optional — leave blank to use
  calculated value)
- Sensor cost override (number, optional)

#### Footer — bottom-pinned action bar

- "Save" (autosaves on blur but a manual button for confidence)
- "Download workbook (.xlsx)" — fetches `/xlsx`
- "Download SOW (.docx)" — fetches `/sow`

### `/admin` landing page

Add a new "Engineering" tile linking to `/admin/engineering`.

## Template-fill module (server-side)

`lib/engineering/template-fill.ts` — pure function:

```ts
async function fillCalculatorTemplate(
  project: EngineeringProject,
  templatePath: string
): Promise<Buffer>
```

Steps:
1. Open the template via `exceljs.readFile(templatePath)`.
2. Walk a cell-mapping config that maps form fields → cell addresses
   for each input sheet (Input Sheet, Energy Use Yearly, Unit List,
   Walk-in Units List).
3. Write each input value to its target cell.
4. Save to a buffer via `workbook.xlsx.writeBuffer()`.
5. Return the buffer.

The cell-mapping config is the most important config in the whole
feature. It's a single TypeScript object:

```ts
export const CELL_MAP = {
  inputSheet: {
    utility: "D2",          // merged D2:G2
    projectName: "K2",      // merged K2:Q2
    projectType: "T2",
    projectSubtype: "V2",   // merged V2:X2
    squareFootage: "F3",    // merged F3:H3
    address: "Q3",          // merged Q3:X3
    engineeringFeeOverride: "B101",
    sensorCostOverride: "B104",
  },
  energyUseYearly: {
    startCol: "A",          // row N: start date
    endCol: "B",            // end date
    usageCol: "C",          // kWh
    hddCol: "D",
    cddCol: "E",
    demandCol: "F",
    demandCostCol: "G",
    startRow: 2,            // first month starts at row 2
    maxMonths: 48,          // 4 years of monthly bills
  },
  unitList: {
    startRow: 5,            // first HVAC row
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
    maxRows: 21,
  },
  walkInUnits: {
    coolerStartRow: 4,
    freezerStartRow: 16,
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
```

When the template has merged cells (like utility/name on Row 2), we
write to the TOP-LEFT cell of each merge. exceljs handles this
correctly — Excel reads the merged-cell value from the top-left.

The cell mapping is captured ONCE during implementation by inspecting
the template (the dumps `engineering/input-sheet.dump.md` etc. are the
source of truth). If the template ever changes, the engineer updates
this config to match.

## SOW Word merge

`lib/engineering/sow-fill.ts`:

```ts
async function fillSowTemplate(
  project: EngineeringProject,
  templatePath: string,
  calcWorkbook: Buffer
): Promise<Buffer>
```

Approach: Use `docxtemplater` + `pizzip` (battle-tested Word merge
library). The SOW template will be the existing `Mango Grove SOW.docx`
converted to use `{{placeholder}}` syntax for the merge fields.

The merge values come from the Word Input sheet (row 2/3). Instead of
opening the just-filled calculator workbook to read those cells, the
SOW fill computes the same labels directly from the project data
(customer name, utility, calculated totals, etc.).

Most SOW merge fields are project metadata (customer name, address,
utility, square footage) which are already in the form data. The
engineering totals (estimated cost, kWh savings, payback) come from
the formulas the engineer would normally see in the workbook — for
the SOW v1, we use rounded estimates derived from the same form
inputs, NOT from re-reading the calc workbook. This decouples the
SOW from needing Excel to recalculate.

If the formulas the SOW needs are too complex to replicate in TS,
v1 falls back to a simpler SOW that mostly contains project
metadata + customer signature fields, leaving the numerical values
filled in manually by the engineer. Spec'd as a known caveat;
revisit if Kevin needs richer SOW values in v1.

## Migration

- One-off `scripts/init-engineering-tab.mjs` adds the
  `Engineering Projects` sheet (same pattern as audit / impersonation
  init scripts).
- `seed/init-sheet.mjs` gets the new sheet definition too for fresh
  deploys.
- The BWI template gets committed at `engineering/template-BWI.xlsx`
  with a `.gitignore` exception so it travels with the deploy.

## Acceptance / done criteria

1. An admin can navigate to `/admin/engineering`, click "New
   project," and create a project with name + utility + location.
2. The admin can fill in all five sections and save. Data round-trips
   through the `Engineering Projects` sheet.
3. The admin can click "Download workbook" and receive a populated
   `.xlsx` file that, when opened in Excel, has all 7,500 formulas
   recalculate against their inputs and produces the same kind of
   output the original template did for Mango Grove.
4. The admin can click "Download SOW" and receive a populated
   `.docx` file with project metadata merged into the right fields.
5. `tsc --noEmit`, `next lint`, and `next build` all pass.

## Open / deferred items

- **Andrews AFB TMY3 data** — Kevin will provide; when received, add
  `engineering/template-Andrews.xlsx` and toggle the location dropdown
  to allow it.
- **Server-side PDF rendering** — deferred. Engineer prints to PDF
  from Excel locally for now.
- **Per-customer linking** — engineering projects could be linked
  to existing MSE customers (the Jobs sheet). Out of scope for v1
  to keep the surface small; cross-linking is a follow-up.
- **ECM editor** — the template hard-codes ECM-1 + ECM-2. If MSE
  wants to add new ECM types or customize ECMs per project, that's a
  v2 build.
- **Lookup catalog editing** — Unit List has efficiency curves baked
  in (B32 SEER = 18, B33 EER = derived). Engineers can override
  these in the workbook itself after download. UI-side editing is v2.
