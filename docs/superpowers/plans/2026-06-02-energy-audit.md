# Energy Walkthrough Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a building-level energy walkthrough audit (walk-ins, thermostats, water-source, BAS) to every job, save-as-you-go, with explicit Job Complete / Audit Complete buttons replacing today's auto-finalize + 8pm cron.

**Architecture:** Two new Google Sheet tabs (`Audits`, `Audit Items`) + a new `Audit/` subfolder per job in Drive. Tech UI is a single-scroll page at `/jobs/[jobId]/audit` with sticky checklist header; cards stamp data on Sheets + photos on Drive in real time. Job-level finalize moves from passive (auto-trigger + cron) to explicit (Job Complete button), with an admin "Stuck Drafts" panel as the human-oversight backstop and a reopen-vs-approved-period guard.

**Tech Stack:** Next.js 14 App Router, Google Sheets API v4, Google Drive API, iron-session auth, PDFKit standalone, JSZip, IndexedDB upload queue. No unit-test framework — verification uses `tsc --noEmit`, `next build`, and route/page smoke tests via curl + browser.

**Spec reference:** [docs/superpowers/specs/2026-06-02-energy-audit-design.md](../specs/2026-06-02-energy-audit-design.md)

**Verification convention:** Each task ends with a verify step that runs `npm run build` (catches tsc + lint + next compile). Data-layer tasks additionally smoke-test against the live Sheet via a one-off node script. API tasks smoke via `curl`. UI tasks smoke by visiting the route in a real browser. Every task ends with a `git commit` (local only — do not push unless Kevin explicitly says).

---

## Phase 0 — Sheet schema (3 tasks)

### Task 1: Add Audits + Audit Items definitions to `seed/init-sheet.mjs`

**Files:**
- Modify: `seed/init-sheet.mjs`

- [ ] **Step 1: Add the two new sheet definitions**

Locate the array of sheet definitions in `seed/init-sheet.mjs`. After the existing `payrollAdjustments` definition (or the last entry — verify by reading the file), insert:

```js
  {
    name: "Audits",
    headers: [
      "Audit ID",
      "Job ID",
      "Status",
      "Created At",
      "Created By",
      "Updated At",
      "Completed At",
      "Completed By",
      "Front Photo URL",
      "Fire Plan Photo URL",
      "BAS Photo URL",
      "BAS Notes",
      "Notes",
    ],
    validations: [
      { col: "C", values: ["Draft", "Complete"] },
    ],
    frozenRows: 1,
  },
  {
    name: "Audit Items",
    headers: [
      "Item ID",
      "Audit ID",
      "Job ID",
      "Item Type",
      "Item Subtype",
      "Item Number",
      "Label",
      "Model Label Photo URL",
      "Nameplate Photo URL",
      "Fans Photo URL",
      "Temp Photo URL",
      "Wiring Photo URL",
      "Location Photo URL",
      "Schedule Photo URLs CSV",
      "Controls Photo URL",
      "Notes",
      "Logged By",
      "Logged At",
      "Status",
    ],
    validations: [
      { col: "D", values: ["Walk-In", "Thermostat", "Water-Source"] },
      { col: "S", values: ["Active", "Orphaned"] },
    ],
    frozenRows: 1,
  },
```

- [ ] **Step 2: Verify the file still parses as valid JS**

Run: `node -e "import('./seed/init-sheet.mjs').then(() => console.log('ok'))"`
Expected: prints `ok` (the import resolves without parse errors).

- [ ] **Step 3: Commit**

```bash
git add seed/init-sheet.mjs
git commit -m "Audit: add Audits + Audit Items schema to seed/init-sheet.mjs"
```

---

### Task 2: Write the one-off script that creates the two tabs on the live sheet

**Files:**
- Create: `scripts/init-audit-tabs.mjs`

- [ ] **Step 1: Write the script**

```js
#!/usr/bin/env node
// Idempotent: creates the "Audits" and "Audit Items" tabs on the
// production Google Sheet if they don't already exist, and stamps
// the header rows. Safe to re-run. Does not touch any other tab.
//
// Usage:
//   node scripts/init-audit-tabs.mjs           # dry run
//   node scripts/init-audit-tabs.mjs --apply   # commit changes

import { google } from "googleapis";
import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "..", ".env.local") });

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SA_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const SA_KEY = (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ?? "").replace(
  /\\n/g,
  "\n"
);

if (!SHEET_ID || !SA_EMAIL || !SA_KEY) {
  console.error("Missing Google service-account env vars in .env.local");
  process.exit(1);
}

const apply = process.argv.includes("--apply");

const TABS = [
  {
    name: "Audits",
    headers: [
      "Audit ID",
      "Job ID",
      "Status",
      "Created At",
      "Created By",
      "Updated At",
      "Completed At",
      "Completed By",
      "Front Photo URL",
      "Fire Plan Photo URL",
      "BAS Photo URL",
      "BAS Notes",
      "Notes",
    ],
    validations: [{ col: "C", values: ["Draft", "Complete"] }],
  },
  {
    name: "Audit Items",
    headers: [
      "Item ID",
      "Audit ID",
      "Job ID",
      "Item Type",
      "Item Subtype",
      "Item Number",
      "Label",
      "Model Label Photo URL",
      "Nameplate Photo URL",
      "Fans Photo URL",
      "Temp Photo URL",
      "Wiring Photo URL",
      "Location Photo URL",
      "Schedule Photo URLs CSV",
      "Controls Photo URL",
      "Notes",
      "Logged By",
      "Logged At",
      "Status",
    ],
    validations: [
      { col: "D", values: ["Walk-In", "Thermostat", "Water-Source"] },
      { col: "S", values: ["Active", "Orphaned"] },
    ],
  },
];

const auth = new google.auth.JWT({
  email: SA_EMAIL,
  key: SA_KEY,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

function colIndex(letter) {
  return letter.toUpperCase().charCodeAt(0) - "A".charCodeAt(0);
}

async function main() {
  console.log(
    apply
      ? "APPLY MODE — will create tabs + stamp headers"
      : "DRY RUN — pass --apply to commit changes"
  );
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const existing = new Set(meta.data.sheets.map((s) => s.properties.title));

  for (const tab of TABS) {
    if (existing.has(tab.name)) {
      console.log(`  [skip] "${tab.name}" already exists`);
      continue;
    }
    console.log(`  [plan] create "${tab.name}" with ${tab.headers.length} cols`);
    if (!apply) continue;
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: tab.name,
                gridProperties: { frozenRowCount: 1 },
              },
            },
          },
        ],
      },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${tab.name}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [tab.headers] },
    });
    // Apply dropdown validations via batchUpdate (DataValidation rule).
    const sheetMeta = (
      await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID })
    ).data.sheets.find((s) => s.properties.title === tab.name);
    const sheetId = sheetMeta.properties.sheetId;
    const validationRequests = tab.validations.map((v) => ({
      setDataValidation: {
        range: {
          sheetId,
          startRowIndex: 1,
          startColumnIndex: colIndex(v.col),
          endColumnIndex: colIndex(v.col) + 1,
        },
        rule: {
          condition: {
            type: "ONE_OF_LIST",
            values: v.values.map((value) => ({ userEnteredValue: value })),
          },
          showCustomUi: true,
          strict: true,
        },
      },
    }));
    if (validationRequests.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: { requests: validationRequests },
      });
    }
    console.log(`  [done] created "${tab.name}"`);
  }
  console.log(apply ? "\nDone." : "\nDry run complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Dry run on the live sheet**

Run: `node scripts/init-audit-tabs.mjs`
Expected output:
```
DRY RUN — pass --apply to commit changes
  [plan] create "Audits" with 13 cols
  [plan] create "Audit Items" with 19 cols

Dry run complete.
```

- [ ] **Step 3: Apply against the live sheet**

Run: `node scripts/init-audit-tabs.mjs --apply`
Expected: both `[done]` lines appear, no errors.

- [ ] **Step 4: Verify in the live sheet UI**

Open the Google Sheet in the browser. Confirm both tabs exist with the expected headers + dropdown validation on `Status` columns.

- [ ] **Step 5: Commit**

```bash
git add scripts/init-audit-tabs.mjs
git commit -m "Audit: one-off init script for Audits + Audit Items tabs (applied)"
```

---

### Task 3: Add `audits` and `auditItems` to the `TABS` constant

**Files:**
- Modify: `lib/google/sheets.ts:4-19`

- [ ] **Step 1: Add the new constants**

In the `TABS` object literal, after `payrollAdjustments: "Payroll Adjustments",` add:

```ts
  // Energy walkthrough audit — one row per job in `audits`, one row
  // per surveyed asset in `auditItems`. Photos live in an `Audit/`
  // subfolder inside each job's existing Drive folder.
  audits: "Audits",
  auditItems: "Audit Items",
```

- [ ] **Step 2: Verify**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add lib/google/sheets.ts
git commit -m "Audit: register Audits + Audit Items in TABS constant"
```

---

## Phase 1 — Types and ID generators (2 tasks)

### Task 4: Add audit types to `lib/types.ts`

**Files:**
- Modify: `lib/types.ts` (append after the last existing interface)

- [ ] **Step 1: Add the new types**

Append at the end of the file:

```ts
// ─── Energy Walkthrough Audit ────────────────────────────────────────

export type AuditStatus = "Draft" | "Complete";

export interface Audit {
  auditId: string;
  jobId: string;
  status: AuditStatus;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  /** Empty string until the tech taps Audit Complete. */
  completedAt: string;
  completedBy: string;
  /** Drive file URL for the front-of-building photo, optional. */
  frontPhotoUrl: string;
  /** Optional fire escape / M1 plan photo. */
  firePlanPhotoUrl: string;
  /** Optional BAS panel photo — Xavier usually handles BAS himself. */
  basPhotoUrl: string;
  basNotes: string;
  notes: string;
}

export type AuditItemType = "Walk-In" | "Thermostat" | "Water-Source";

export type WaterSourceSubtype =
  | "Chiller"
  | "Cooling Tower"
  | "Boiler"
  | "Controls"
  | "Other";

export type AuditItemStatus = "Active" | "Orphaned";

export interface AuditItem {
  itemId: string;
  auditId: string;
  jobId: string;
  itemType: AuditItemType;
  /** Water-source-only subtype. Empty string for walk-ins/thermostats. */
  itemSubtype: WaterSourceSubtype | "";
  /** 1-indexed counter within (auditId, itemType). What the tech sees
   *  as "Walk-In 1", "Walk-In 2". */
  itemNumber: number;
  label: string;
  // Polymorphic photo slots — empty string when not applicable.
  modelLabelPhotoUrl: string;
  nameplatePhotoUrl: string;
  fansPhotoUrl: string;
  tempPhotoUrl: string;
  wiringPhotoUrl: string;
  locationPhotoUrl: string;
  /** Thermostat schedule: 1..N URLs, comma-separated. */
  schedulePhotoUrlsCsv: string;
  controlsPhotoUrl: string;
  notes: string;
  loggedBy: string;
  loggedAt: string;
  status: AuditItemStatus;
}

/** Logical photo slot for the audit upload route. Determines which
 *  column the URL gets written to on the Audits or Audit Items row. */
export type AuditPhotoSlot =
  // Audits row (kind=audit-building)
  | "front"
  | "fire-plan"
  | "bas"
  // Audit Items row (kind=audit-item)
  | "model-label"
  | "nameplate"
  | "fans"
  | "temp"
  | "wiring"
  | "location"
  | "schedule"
  | "controls";
```

- [ ] **Step 2: Verify**

Run: `npm run build`
Expected: build succeeds. No type-only file should break.

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts
git commit -m "Audit: Audit + AuditItem types + AuditPhotoSlot"
```

---

### Task 5: Add `nextAuditId()` and `nextAuditItemId()` to `lib/id-generators.ts`

**Files:**
- Modify: `lib/id-generators.ts` (append at the end)

- [ ] **Step 1: Add the two generators**

Append:

```ts
export async function nextAuditId(): Promise<string> {
  const year = currentYear();
  const prefix = `AUD-${year}-`;
  const max = await getMaxIdNumber(TABS.audits, "A", prefix);
  return `${prefix}${pad(max + 1)}`;
}

export async function nextAuditItemId(): Promise<string> {
  const year = currentYear();
  const prefix = `AI-${year}-`;
  const max = await getMaxIdNumber(TABS.auditItems, "A", prefix);
  return `${prefix}${pad(max + 1, 5)}`;
}
```

- [ ] **Step 2: Verify**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add lib/id-generators.ts
git commit -m "Audit: nextAuditId + nextAuditItemId generators"
```

---

## Phase 2 — Data access layer (2 tasks)

### Task 6: Build `lib/data/audits.ts`

**Files:**
- Create: `lib/data/audits.ts`

- [ ] **Step 1: Write the data access module**

Mirror `lib/data/jobs.ts` shape. Full file:

```ts
import "server-only";
import {
  TABS,
  appendRow,
  findRowIndex,
  readTab,
  updateCell,
} from "@/lib/google/sheets";
import { nextAuditId } from "@/lib/id-generators";
import { nowIso } from "@/lib/utils";
import type { Audit, AuditStatus } from "@/lib/types";

function rowToAudit(row: string[]): Audit {
  return {
    auditId: String(row[0] ?? ""),
    jobId: String(row[1] ?? ""),
    status: (row[2] as AuditStatus) || "Draft",
    createdAt: String(row[3] ?? ""),
    createdBy: String(row[4] ?? ""),
    updatedAt: String(row[5] ?? ""),
    completedAt: String(row[6] ?? ""),
    completedBy: String(row[7] ?? ""),
    frontPhotoUrl: String(row[8] ?? ""),
    firePlanPhotoUrl: String(row[9] ?? ""),
    basPhotoUrl: String(row[10] ?? ""),
    basNotes: String(row[11] ?? ""),
    notes: String(row[12] ?? ""),
  };
}

export async function listAllAudits(
  opts: { fresh?: boolean } = {}
): Promise<Audit[]> {
  const rows = await readTab(TABS.audits, opts);
  return rows.filter((r) => r[0]).map(rowToAudit);
}

export async function getAuditForJob(
  jobId: string
): Promise<Audit | null> {
  const all = await listAllAudits();
  return all.find((a) => a.jobId === jobId) ?? null;
}

export async function getAudit(
  auditId: string
): Promise<Audit | null> {
  const all = await listAllAudits();
  return all.find((a) => a.auditId === auditId) ?? null;
}

/**
 * Idempotent create-or-get. If an audit row exists for jobId, returns
 * it. Otherwise creates a new Draft audit and returns it. Safe to
 * call on every page load of /jobs/[jobId]/audit.
 */
export async function ensureAudit(opts: {
  jobId: string;
  createdBy: string;
}): Promise<Audit> {
  const existing = await getAuditForJob(opts.jobId);
  if (existing) return existing;
  const auditId = await nextAuditId();
  const isoNow = nowIso();
  await appendRow(TABS.audits, [
    auditId,
    opts.jobId,
    "Draft",
    isoNow,
    opts.createdBy,
    isoNow,
    "", // CompletedAt
    "", // CompletedBy
    "", // FrontPhotoUrl
    "", // FirePlanPhotoUrl
    "", // BasPhotoUrl
    "", // BasNotes
    "", // Notes
  ]);
  return {
    auditId,
    jobId: opts.jobId,
    status: "Draft",
    createdAt: isoNow,
    createdBy: opts.createdBy,
    updatedAt: isoNow,
    completedAt: "",
    completedBy: "",
    frontPhotoUrl: "",
    firePlanPhotoUrl: "",
    basPhotoUrl: "",
    basNotes: "",
    notes: "",
  };
}

/**
 * Column-letter map for setAuditField. Keep in sync with the Audits
 * sheet schema (seed/init-sheet.mjs).
 */
const AUDIT_COLS = {
  status: "C",
  updatedAt: "F",
  completedAt: "G",
  completedBy: "H",
  frontPhotoUrl: "I",
  firePlanPhotoUrl: "J",
  basPhotoUrl: "K",
  basNotes: "L",
  notes: "M",
} as const;

export async function setAuditField(opts: {
  auditId: string;
  field: keyof typeof AUDIT_COLS;
  value: string;
}): Promise<void> {
  const rowIndex = await findRowIndex(TABS.audits, "A", opts.auditId);
  if (!rowIndex) throw new Error(`Audit not found: ${opts.auditId}`);
  const col = AUDIT_COLS[opts.field];
  await updateCell(`${TABS.audits}!${col}${rowIndex}`, opts.value);
  // Bump UpdatedAt on every change so the admin sees recency.
  if (opts.field !== "updatedAt") {
    await updateCell(
      `${TABS.audits}!${AUDIT_COLS.updatedAt}${rowIndex}`,
      nowIso()
    );
  }
}

export async function setAuditStatus(opts: {
  auditId: string;
  status: AuditStatus;
  byTechName: string;
}): Promise<void> {
  const rowIndex = await findRowIndex(TABS.audits, "A", opts.auditId);
  if (!rowIndex) throw new Error(`Audit not found: ${opts.auditId}`);
  const isoNow = nowIso();
  if (opts.status === "Complete") {
    await Promise.all([
      updateCell(`${TABS.audits}!${AUDIT_COLS.status}${rowIndex}`, "Complete"),
      updateCell(`${TABS.audits}!${AUDIT_COLS.completedAt}${rowIndex}`, isoNow),
      updateCell(
        `${TABS.audits}!${AUDIT_COLS.completedBy}${rowIndex}`,
        opts.byTechName
      ),
      updateCell(`${TABS.audits}!${AUDIT_COLS.updatedAt}${rowIndex}`, isoNow),
    ]);
  } else {
    await Promise.all([
      updateCell(`${TABS.audits}!${AUDIT_COLS.status}${rowIndex}`, "Draft"),
      updateCell(`${TABS.audits}!${AUDIT_COLS.completedAt}${rowIndex}`, ""),
      updateCell(`${TABS.audits}!${AUDIT_COLS.completedBy}${rowIndex}`, ""),
      updateCell(`${TABS.audits}!${AUDIT_COLS.updatedAt}${rowIndex}`, isoNow),
    ]);
  }
}
```

- [ ] **Step 2: Smoke-test against the live sheet**

Write a one-off file `scripts/_smoke-audit-data.mjs` (do not commit) that imports the compiled lib functions and prints the result. Simpler approach — use the existing `scripts/test-google.mjs` pattern. Run:

```
node -e "
process.env.NODE_OPTIONS = '--experimental-vm-modules';
import('dotenv').then(d => { d.config({ path: '.env.local' }); });
(async () => {
  const m = await import('./lib/data/audits.ts');
  console.log('listAllAudits OK, count =', (await m.listAllAudits()).length);
})();
" 2>&1 | tail
```

Expected: prints `listAllAudits OK, count = 0` (empty tab).
*Note: if the dynamic-import-of-TS path fails (Node can't execute TS directly without a loader), skip this smoke step — the `npm run build` in step 3 catches the wiring.*

- [ ] **Step 3: Verify**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add lib/data/audits.ts
git commit -m "Audit: lib/data/audits.ts — ensureAudit, getAudit, setAuditField, setAuditStatus"
```

---

### Task 7: Build `lib/data/audit-items.ts`

**Files:**
- Create: `lib/data/audit-items.ts`

- [ ] **Step 1: Write the data access module**

Full file:

```ts
import "server-only";
import {
  TABS,
  appendRow,
  findRowIndex,
  readTab,
  updateCell,
} from "@/lib/google/sheets";
import { nextAuditItemId } from "@/lib/id-generators";
import { nowIso } from "@/lib/utils";
import type {
  AuditItem,
  AuditItemStatus,
  AuditItemType,
  WaterSourceSubtype,
} from "@/lib/types";

function rowToAuditItem(row: string[]): AuditItem {
  return {
    itemId: String(row[0] ?? ""),
    auditId: String(row[1] ?? ""),
    jobId: String(row[2] ?? ""),
    itemType: (row[3] as AuditItemType) || "Walk-In",
    itemSubtype: (row[4] as WaterSourceSubtype | "") || "",
    itemNumber: Number(row[5] ?? 0),
    label: String(row[6] ?? ""),
    modelLabelPhotoUrl: String(row[7] ?? ""),
    nameplatePhotoUrl: String(row[8] ?? ""),
    fansPhotoUrl: String(row[9] ?? ""),
    tempPhotoUrl: String(row[10] ?? ""),
    wiringPhotoUrl: String(row[11] ?? ""),
    locationPhotoUrl: String(row[12] ?? ""),
    schedulePhotoUrlsCsv: String(row[13] ?? ""),
    controlsPhotoUrl: String(row[14] ?? ""),
    notes: String(row[15] ?? ""),
    loggedBy: String(row[16] ?? ""),
    loggedAt: String(row[17] ?? ""),
    status: (row[18] as AuditItemStatus) || "Active",
  };
}

export async function listAllAuditItems(
  opts: { fresh?: boolean } = {}
): Promise<AuditItem[]> {
  const rows = await readTab(TABS.auditItems, opts);
  return rows.filter((r) => r[0]).map(rowToAuditItem);
}

export async function listAuditItemsForAudit(
  auditId: string,
  opts: { fresh?: boolean } = {}
): Promise<AuditItem[]> {
  const all = await listAllAuditItems(opts);
  return all
    .filter((i) => i.auditId === auditId)
    .sort((a, b) => {
      if (a.itemType !== b.itemType) {
        return a.itemType.localeCompare(b.itemType);
      }
      return a.itemNumber - b.itemNumber;
    });
}

export async function getAuditItem(
  itemId: string
): Promise<AuditItem | null> {
  const all = await listAllAuditItems();
  return all.find((i) => i.itemId === itemId) ?? null;
}

export async function createAuditItem(opts: {
  auditId: string;
  jobId: string;
  itemType: AuditItemType;
  itemSubtype?: WaterSourceSubtype | "";
  itemNumber: number;
  label?: string;
  loggedBy: string;
}): Promise<AuditItem> {
  const itemId = await nextAuditItemId();
  const isoNow = nowIso();
  const subtype = opts.itemSubtype ?? "";
  await appendRow(TABS.auditItems, [
    itemId,
    opts.auditId,
    opts.jobId,
    opts.itemType,
    subtype,
    opts.itemNumber,
    opts.label ?? "",
    "", "", "", "", "", "", "", "", // photo URL slots H..O (8 cells)
    "",  // Notes
    opts.loggedBy,
    isoNow,
    "Active",
  ]);
  return {
    itemId,
    auditId: opts.auditId,
    jobId: opts.jobId,
    itemType: opts.itemType,
    itemSubtype: subtype,
    itemNumber: opts.itemNumber,
    label: opts.label ?? "",
    modelLabelPhotoUrl: "",
    nameplatePhotoUrl: "",
    fansPhotoUrl: "",
    tempPhotoUrl: "",
    wiringPhotoUrl: "",
    locationPhotoUrl: "",
    schedulePhotoUrlsCsv: "",
    controlsPhotoUrl: "",
    notes: "",
    loggedBy: opts.loggedBy,
    loggedAt: isoNow,
    status: "Active",
  };
}

const ITEM_COLS = {
  itemSubtype: "E",
  itemNumber: "F",
  label: "G",
  modelLabelPhotoUrl: "H",
  nameplatePhotoUrl: "I",
  fansPhotoUrl: "J",
  tempPhotoUrl: "K",
  wiringPhotoUrl: "L",
  locationPhotoUrl: "M",
  schedulePhotoUrlsCsv: "N",
  controlsPhotoUrl: "O",
  notes: "P",
  loggedAt: "R",
  status: "S",
} as const;

export async function setAuditItemField(opts: {
  itemId: string;
  field: keyof typeof ITEM_COLS;
  value: string | number;
}): Promise<void> {
  const rowIndex = await findRowIndex(TABS.auditItems, "A", opts.itemId);
  if (!rowIndex) throw new Error(`AuditItem not found: ${opts.itemId}`);
  const col = ITEM_COLS[opts.field];
  await updateCell(
    `${TABS.auditItems}!${col}${rowIndex}`,
    String(opts.value)
  );
  // Bump LoggedAt on every change.
  if (opts.field !== "loggedAt") {
    await updateCell(
      `${TABS.auditItems}!${ITEM_COLS.loggedAt}${rowIndex}`,
      nowIso()
    );
  }
}

/**
 * Append a Drive URL to the schedule CSV — used for thermostat
 * schedule photos which support multiple uploads per item.
 */
export async function appendAuditItemSchedulePhoto(opts: {
  itemId: string;
  url: string;
}): Promise<string> {
  const item = await getAuditItem(opts.itemId);
  if (!item) throw new Error(`AuditItem not found: ${opts.itemId}`);
  const existing = item.schedulePhotoUrlsCsv
    ? item.schedulePhotoUrlsCsv.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  existing.push(opts.url);
  const csv = existing.join(",");
  await setAuditItemField({
    itemId: opts.itemId,
    field: "schedulePhotoUrlsCsv",
    value: csv,
  });
  return csv;
}

export async function setAuditItemStatus(opts: {
  itemId: string;
  status: AuditItemStatus;
}): Promise<void> {
  await setAuditItemField({
    itemId: opts.itemId,
    field: "status",
    value: opts.status,
  });
}
```

- [ ] **Step 2: Verify**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add lib/data/audit-items.ts
git commit -m "Audit: lib/data/audit-items.ts CRUD + schedule-photo append + orphan status"
```

---

## Phase 3 — API routes (5 tasks)

### Task 8: `/api/audits` POST — create-or-get for a job

**Files:**
- Create: `app/api/audits/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { ensureAudit } from "@/lib/data/audits";
import { getJob, techCanAccessJob } from "@/lib/data/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const jobId = String(body.jobId ?? "").trim();
  if (!jobId) return NextResponse.json({ error: "Missing jobId" }, { status: 400 });

  const job = await getJob(jobId);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const canAccess = await techCanAccessJob({
    job,
    techName: session.name ?? "",
    isAdmin: session.isAdmin === true,
  });
  if (!canAccess) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const audit = await ensureAudit({
      jobId,
      createdBy: session.name ?? "",
    });
    return NextResponse.json({ audit });
  } catch (e) {
    console.error("[audits POST] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Verify**

Run: `npm run build`
Expected: build succeeds, route appears in the build summary as `ƒ /api/audits`.

- [ ] **Step 3: Smoke-test auth gate**

Run: `curl -sS -o /dev/null -w "%{http_code}\n" -X POST https://ms-eapp.vercel.app/api/audits -H "Content-Type: application/json" -d '{}'`
Expected: `401` (route exists and the guard fires).

*(This step happens after the next deploy. If running locally, swap the URL for `http://localhost:3000`.)*

- [ ] **Step 4: Commit**

```bash
git add app/api/audits/route.ts
git commit -m "Audit: POST /api/audits create-or-get for a job"
```

---

### Task 9: `/api/audits/[auditId]` PATCH + complete/reopen sub-routes

**Files:**
- Create: `app/api/audits/[auditId]/route.ts`
- Create: `app/api/audits/[auditId]/complete/route.ts`
- Create: `app/api/audits/[auditId]/reopen/route.ts`

- [ ] **Step 1: PATCH route for field updates (BasNotes, Notes)**

`app/api/audits/[auditId]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getAudit, setAuditField } from "@/lib/data/audits";
import { getJob, techCanAccessJob } from "@/lib/data/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PATCHABLE_FIELDS = ["basNotes", "notes"] as const;
type PatchableField = (typeof PATCHABLE_FIELDS)[number];

export async function PATCH(
  request: Request,
  { params }: { params: { auditId: string } }
) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const auditId = decodeURIComponent(params.auditId);
  const audit = await getAudit(auditId);
  if (!audit) return NextResponse.json({ error: "Audit not found" }, { status: 404 });

  const job = await getJob(audit.jobId);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  const canAccess = await techCanAccessJob({
    job,
    techName: session.name ?? "",
    isAdmin: session.isAdmin === true,
  });
  if (!canAccess) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    for (const field of PATCHABLE_FIELDS) {
      const raw = (body as Record<string, unknown>)[field];
      if (raw === undefined) continue;
      await setAuditField({
        auditId,
        field: field as PatchableField,
        value: String(raw),
      });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[audits PATCH] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: complete route**

`app/api/audits/[auditId]/complete/route.ts`:

```ts
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { getAudit, setAuditStatus } from "@/lib/data/audits";
import { getJob, techCanAccessJob } from "@/lib/data/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: { auditId: string } }
) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const auditId = decodeURIComponent(params.auditId);
  const audit = await getAudit(auditId);
  if (!audit) return NextResponse.json({ error: "Audit not found" }, { status: 404 });

  const job = await getJob(audit.jobId);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  const canAccess = await techCanAccessJob({
    job,
    techName: session.name ?? "",
    isAdmin: session.isAdmin === true,
  });
  if (!canAccess) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    await setAuditStatus({
      auditId,
      status: "Complete",
      byTechName: session.name ?? "",
    });
    revalidatePath(`/jobs/${audit.jobId}`);
    revalidatePath(`/jobs/${audit.jobId}/audit`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[audits/complete] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 3: reopen route**

`app/api/audits/[auditId]/reopen/route.ts`: same shape as the complete route, but call `setAuditStatus({ auditId, status: "Draft", byTechName: session.name ?? "" })`. Copy the file above verbatim and change only the status string + the error log prefix.

- [ ] **Step 4: Verify**

Run: `npm run build`
Expected: all three routes appear in the build output under `/api/audits/[auditId]`, `/.../complete`, `/.../reopen`.

- [ ] **Step 5: Commit**

```bash
git add app/api/audits/
git commit -m "Audit: PATCH + complete + reopen routes on /api/audits/[auditId]"
```

---

### Task 10: `/api/audit-items` POST + `/api/audit-items/[itemId]` PATCH/DELETE

**Files:**
- Create: `app/api/audit-items/route.ts`
- Create: `app/api/audit-items/[itemId]/route.ts`

- [ ] **Step 1: POST create**

`app/api/audit-items/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getAudit } from "@/lib/data/audits";
import { createAuditItem } from "@/lib/data/audit-items";
import { getJob, techCanAccessJob } from "@/lib/data/jobs";
import type { AuditItemType, WaterSourceSubtype } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_TYPES: AuditItemType[] = ["Walk-In", "Thermostat", "Water-Source"];
const VALID_SUBTYPES: WaterSourceSubtype[] = [
  "Chiller",
  "Cooling Tower",
  "Boiler",
  "Controls",
  "Other",
];

export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const auditId = String(body.auditId ?? "").trim();
  const jobId = String(body.jobId ?? "").trim();
  const itemType = body.itemType as AuditItemType;
  const itemSubtypeRaw = String(body.itemSubtype ?? "") as WaterSourceSubtype | "";
  const itemNumber = Number(body.itemNumber);
  const label = String(body.label ?? "").trim();

  if (!auditId || !jobId) {
    return NextResponse.json({ error: "Missing auditId or jobId" }, { status: 400 });
  }
  if (!VALID_TYPES.includes(itemType)) {
    return NextResponse.json({ error: "Invalid itemType" }, { status: 400 });
  }
  if (!Number.isInteger(itemNumber) || itemNumber < 1) {
    return NextResponse.json({ error: "itemNumber must be a positive integer" }, { status: 400 });
  }
  if (itemSubtypeRaw && !VALID_SUBTYPES.includes(itemSubtypeRaw)) {
    return NextResponse.json({ error: "Invalid itemSubtype" }, { status: 400 });
  }

  const audit = await getAudit(auditId);
  if (!audit) return NextResponse.json({ error: "Audit not found" }, { status: 404 });
  if (audit.jobId !== jobId) {
    return NextResponse.json({ error: "Audit does not belong to this job" }, { status: 400 });
  }
  const job = await getJob(jobId);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  const canAccess = await techCanAccessJob({
    job,
    techName: session.name ?? "",
    isAdmin: session.isAdmin === true,
  });
  if (!canAccess) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const item = await createAuditItem({
      auditId,
      jobId,
      itemType,
      itemSubtype: itemSubtypeRaw,
      itemNumber,
      label,
      loggedBy: session.name ?? "",
    });
    return NextResponse.json({ item });
  } catch (e) {
    console.error("[audit-items POST] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: PATCH / DELETE**

`app/api/audit-items/[itemId]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  getAuditItem,
  setAuditItemField,
  setAuditItemStatus,
} from "@/lib/data/audit-items";
import { getJob, techCanAccessJob } from "@/lib/data/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Subtype, label, notes are tech-editable. Photo URLs are written via
// /api/upload (see Phase 4). itemNumber is tech-editable for the
// orphan/revive flow. Status is admin-edit only.
const PATCHABLE_FIELDS = [
  "itemSubtype",
  "itemNumber",
  "label",
  "notes",
] as const;

export async function PATCH(
  request: Request,
  { params }: { params: { itemId: string } }
) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const itemId = decodeURIComponent(params.itemId);
  const item = await getAuditItem(itemId);
  if (!item) return NextResponse.json({ error: "AuditItem not found" }, { status: 404 });

  const job = await getJob(item.jobId);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  const canAccess = await techCanAccessJob({
    job,
    techName: session.name ?? "",
    isAdmin: session.isAdmin === true,
  });
  if (!canAccess) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    for (const field of PATCHABLE_FIELDS) {
      const raw = (body as Record<string, unknown>)[field];
      if (raw === undefined) continue;
      await setAuditItemField({
        itemId,
        field,
        value: typeof raw === "number" ? raw : String(raw),
      });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[audit-items PATCH] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { itemId: string } }
) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  // Soft-delete: mark Orphaned. True deletion is admin Sheet-side only
  // (no UI in v1 — see the spec's "Out of scope" section).
  const itemId = decodeURIComponent(params.itemId);
  const item = await getAuditItem(itemId);
  if (!item) return NextResponse.json({ error: "AuditItem not found" }, { status: 404 });

  const job = await getJob(item.jobId);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  const canAccess = await techCanAccessJob({
    job,
    techName: session.name ?? "",
    isAdmin: session.isAdmin === true,
  });
  if (!canAccess) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    await setAuditItemStatus({ itemId, status: "Orphaned" });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[audit-items DELETE] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 3: Verify**

Run: `npm run build`
Expected: both routes appear under `/api/audit-items`.

- [ ] **Step 4: Commit**

```bash
git add app/api/audit-items/
git commit -m "Audit: POST /api/audit-items + PATCH/DELETE on [itemId]"
```

---

### Task 11: Extend `/api/upload` with `kind=audit-building` and `kind=audit-item`

**Files:**
- Modify: `app/api/upload/route.ts`

- [ ] **Step 1: Add the AuditPhotoSlot validation list near the existing PHOTO_SLOTS constant**

Add at the top of the file alongside the existing import block:

```ts
import {
  appendAuditItemSchedulePhoto,
  getAuditItem,
  setAuditItemField,
} from "@/lib/data/audit-items";
import { getAudit, setAuditField } from "@/lib/data/audits";
import { getOrCreateFolder } from "@/lib/google/drive";
import type { AuditPhotoSlot } from "@/lib/types";

const AUDIT_BUILDING_SLOTS = ["front", "fire-plan", "bas"] as const;
const AUDIT_ITEM_SLOTS = [
  "model-label",
  "nameplate",
  "fans",
  "temp",
  "wiring",
  "location",
  "schedule",
  "controls",
] as const;

const AUDIT_BUILDING_FIELD: Record<
  (typeof AUDIT_BUILDING_SLOTS)[number],
  "frontPhotoUrl" | "firePlanPhotoUrl" | "basPhotoUrl"
> = {
  front: "frontPhotoUrl",
  "fire-plan": "firePlanPhotoUrl",
  bas: "basPhotoUrl",
};

// "schedule" is special-cased separately (CSV append), so it's
// deliberately absent from this map. The upload handler checks for
// "schedule" first and only consults this map for single-cell slots.
const AUDIT_ITEM_SINGLE_FIELD: Record<
  Exclude<(typeof AUDIT_ITEM_SLOTS)[number], "schedule">,
  "modelLabelPhotoUrl" | "nameplatePhotoUrl" | "fansPhotoUrl" | "tempPhotoUrl" | "wiringPhotoUrl" | "locationPhotoUrl" | "controlsPhotoUrl"
> = {
  "model-label": "modelLabelPhotoUrl",
  nameplate: "nameplatePhotoUrl",
  fans: "fansPhotoUrl",
  temp: "tempPhotoUrl",
  wiring: "wiringPhotoUrl",
  location: "locationPhotoUrl",
  controls: "controlsPhotoUrl",
};

function slugForAuditFilename(slot: string): string {
  return slot.replace(/[^a-zA-Z0-9_-]+/g, "_");
}
```

- [ ] **Step 2: Add the two new branches inside the existing `try { ... }` block**

Inside the upload route's try-block, **before** the `if (kind === "job-cover")` branch (so the audit branches take priority for their kinds), add:

```ts
    if (kind === "audit-building") {
      const auditId = String(formData.get("auditId") ?? "").trim();
      if (!auditId) {
        return NextResponse.json(
          { error: "Missing auditId" },
          { status: 400 }
        );
      }
      if (!AUDIT_BUILDING_SLOTS.includes(slot as never)) {
        return NextResponse.json(
          { error: "Invalid audit-building slot" },
          { status: 400 }
        );
      }
      const audit = await getAudit(auditId);
      if (!audit) {
        return NextResponse.json(
          { error: "Audit not found" },
          { status: 404 }
        );
      }
      // Audit photos live in an `Audit/` subfolder per job. Folder
      // creation is lazy + idempotent (getOrCreateFolder).
      const auditFolder = await getOrCreateFolder("Audit", rootFolderId);
      const filename = `${slugForAuditFilename(slot)}_${Date.now()}.jpg`;
      const uploaded = await uploadImage({
        folderId: auditFolder.id,
        filename,
        mimeType,
        body: buffer,
      });
      await setAuditField({
        auditId,
        field: AUDIT_BUILDING_FIELD[slot as keyof typeof AUDIT_BUILDING_FIELD],
        value: uploaded.url,
      });
      revalidatePath(`/jobs/${jobId}/audit`);
      return NextResponse.json({ url: uploaded.url });
    }

    if (kind === "audit-item") {
      const itemId = String(formData.get("itemId") ?? "").trim();
      if (!itemId) {
        return NextResponse.json(
          { error: "Missing itemId" },
          { status: 400 }
        );
      }
      if (!AUDIT_ITEM_SLOTS.includes(slot as never)) {
        return NextResponse.json(
          { error: "Invalid audit-item slot" },
          { status: 400 }
        );
      }
      const item = await getAuditItem(itemId);
      if (!item) {
        return NextResponse.json(
          { error: "AuditItem not found" },
          { status: 404 }
        );
      }
      const auditFolder = await getOrCreateFolder("Audit", rootFolderId);
      const prefix =
        item.itemType === "Walk-In"
          ? `WalkIn-${String(item.itemNumber).padStart(3, "0")}`
          : item.itemType === "Thermostat"
          ? `Therm-${String(item.itemNumber).padStart(3, "0")}`
          : `WaterSource-${String(item.itemNumber).padStart(3, "0")}`;
      const filename = `${prefix}_${slugForAuditFilename(slot)}_${Date.now()}.jpg`;
      const uploaded = await uploadImage({
        folderId: auditFolder.id,
        filename,
        mimeType,
        body: buffer,
      });
      if (slot === "schedule") {
        // Multi-photo: append the URL to the CSV column.
        await appendAuditItemSchedulePhoto({ itemId, url: uploaded.url });
      } else {
        await setAuditItemField({
          itemId,
          field: AUDIT_ITEM_SINGLE_FIELD[slot as keyof typeof AUDIT_ITEM_SINGLE_FIELD],
          value: uploaded.url,
        });
      }
      revalidatePath(`/jobs/${jobId}/audit`);
      return NextResponse.json({ url: uploaded.url });
    }
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add app/api/upload/route.ts
git commit -m "Audit: /api/upload handles kind=audit-building + kind=audit-item"
```

---

### Task 12: `/api/jobs/[jobId]/complete` + `/api/jobs/[jobId]/reopen` with approved-period guard

**Files:**
- Read first: `lib/data/dispatches.ts` to identify the existing `finalizeDispatch` or equivalent helper that writes Pay Attribution rows. Find it via: `grep -n "submittedAt\|writeAttributions\|finalize" lib/data/dispatches.ts` and `grep -n "Pay Attribution\|writeAttribution" lib/data/pay-attribution.ts`.
- Create: `app/api/jobs/[jobId]/complete/route.ts`
- Create: `app/api/jobs/[jobId]/reopen/route.ts`

- [ ] **Step 1: Locate the existing finalize + un-finalize helpers**

Run: `grep -rn "autoFinalizeOpenDraftsForTech\|finalizeDispatch\|writeAttributions" lib/data/`
Identify which function writes Pay Attribution rows + sets `Dispatches.submittedAt`. Note the exact name + signature. Likely something like `finalizeDispatch(dispatchId)` and a corresponding `unfinalizeDispatch(dispatchId)` or you'll need to delete the rows + clear the stamp inline.

- [ ] **Step 2: Write the complete route**

`app/api/jobs/[jobId]/complete/route.ts`:

```ts
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { autoFinalizeOpenDraftsForTech } from "@/lib/data/dispatches";
import { getJob, techCanAccessJob } from "@/lib/data/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: { jobId: string } }
) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const jobId = decodeURIComponent(params.jobId);
  const job = await getJob(jobId);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const canAccess = await techCanAccessJob({
    job,
    techName: session.name ?? "",
    isAdmin: session.isAdmin === true,
  });
  if (!canAccess) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    // Reuse the existing helper that finalizes any open Draft
    // dispatches for this tech on this job. Same logic that powered
    // the auto-finalize trigger — just called explicitly now.
    const result = await autoFinalizeOpenDraftsForTech(session.name ?? "", {
      onlyJobId: jobId,
    });
    revalidatePath(`/jobs/${jobId}`);
    revalidatePath("/jobs");
    return NextResponse.json({ ok: true, finalized: result?.finalizedCount ?? 0 });
  } catch (e) {
    console.error("[jobs/complete] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
```

*Note for the implementer: `autoFinalizeOpenDraftsForTech` may not accept an `onlyJobId` option yet. If not, extend its signature in `lib/data/dispatches.ts` to add an optional `onlyJobId?: string` filter that narrows the dispatches it considers. Keep the old caller behavior (no filter = all of the tech's open drafts) backward compatible. Verify by reading the function before extending.*

- [ ] **Step 3: Write the reopen route with approved-period guard**

`app/api/jobs/[jobId]/reopen/route.ts`:

```ts
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import {
  listDispatchesForJob,
  unfinalizeDispatch,
} from "@/lib/data/dispatches";
import { getJob, techCanAccessJob } from "@/lib/data/jobs";
import { listAllPayrollPeriods } from "@/lib/data/payroll-periods";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: { jobId: string } }
) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const jobId = decodeURIComponent(params.jobId);
  const job = await getJob(jobId);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const canAccess = await techCanAccessJob({
    job,
    techName: session.name ?? "",
    isAdmin: session.isAdmin === true,
  });
  if (!canAccess) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const dispatches = await listDispatchesForJob(jobId);
    const finalized = dispatches.filter((d) => d.submittedAt);
    if (finalized.length === 0) {
      return NextResponse.json({ ok: true, note: "Nothing to reopen." });
    }

    // Approved-period guard: any finalized dispatch whose date sits
    // inside an Approved or Paid period blocks the reopen.
    const periods = await listAllPayrollPeriods();
    const blockers: { dispatchDate: string; periodId: string; periodLabel: string }[] = [];
    for (const d of finalized) {
      for (const p of periods) {
        if (p.status !== "Approved" && p.status !== "Paid") continue;
        if (p.startDate <= d.dispatchDate && d.dispatchDate <= p.endDate) {
          blockers.push({
            dispatchDate: d.dispatchDate,
            periodId: p.periodId,
            periodLabel: p.label || `${p.startDate} – ${p.endDate}`,
          });
        }
      }
    }
    if (blockers.length > 0) {
      const b = blockers[0];
      return NextResponse.json(
        {
          error: `Locked — commission report ${b.periodLabel} is already ${
            periods.find((p) => p.periodId === b.periodId)?.status
          }. Ask admin to unlock the period first.`,
          blockingPeriodId: b.periodId,
        },
        { status: 409 }
      );
    }

    for (const d of finalized) {
      await unfinalizeDispatch(d.dispatchId);
    }
    revalidatePath(`/jobs/${jobId}`);
    revalidatePath("/jobs");
    return NextResponse.json({ ok: true, reopened: finalized.length });
  } catch (e) {
    console.error("[jobs/reopen] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
```

*Note for the implementer: `unfinalizeDispatch(dispatchId)` likely does not exist yet — you'll need to add it to `lib/data/dispatches.ts`. It must (a) delete all Pay Attribution rows where `Dispatch ID == dispatchId`, and (b) clear `Dispatches.submittedAt` for that row. Verify by reading the existing finalize logic in `lib/data/dispatches.ts` and inverting it.*

- [ ] **Step 4: Add `unfinalizeDispatch` to `lib/data/dispatches.ts`**

In `lib/data/dispatches.ts`, add a new exported function. Use the existing finalize pattern (which writes Pay Attribution rows + sets submittedAt) as a template. Sketch:

```ts
/**
 * Inverse of finalizeDispatch — deletes the Pay Attribution rows that
 * were written when this dispatch was finalized, then clears
 * Dispatches.submittedAt. Used by /api/jobs/[jobId]/reopen.
 *
 * Idempotent: if the dispatch isn't finalized, no-ops gracefully.
 */
export async function unfinalizeDispatch(dispatchId: string): Promise<void> {
  // 1. Delete Pay Attribution rows for this dispatch.
  await deletePayAttributionRowsForDispatch(dispatchId);
  // 2. Clear submittedAt on Dispatches.
  const rowIndex = await findRowIndex(TABS.dispatches, "A", dispatchId);
  if (!rowIndex) return;
  await updateCell(`${TABS.dispatches}!J${rowIndex}`, ""); // col J = Submitted At
}
```

The implementer must:
- Verify column J is `Submitted At` on the Dispatches sheet (check `lib/data/dispatches.ts:rowToDispatch`).
- Implement `deletePayAttributionRowsForDispatch` in `lib/data/pay-attribution.ts` — it should find every row with the matching dispatchId column and either set the row to empty (preserving row ordering for the sheet) or use `spreadsheets.batchUpdate` with `deleteDimension` calls. Read the existing append pattern in pay-attribution.ts to pick the right approach.
- Add the import for `deletePayAttributionRowsForDispatch` at the top of dispatches.ts.

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: build succeeds, both new routes appear.

- [ ] **Step 6: Commit**

```bash
git add app/api/jobs/ lib/data/dispatches.ts lib/data/pay-attribution.ts
git commit -m "Audit: POST /api/jobs/[jobId]/complete + reopen with approved-period guard"
```

---

## Phase 4 — Tech UI (5 tasks)

### Task 13: `/jobs/[jobId]/audit` server page shell

**Files:**
- Create: `app/(app)/jobs/[jobId]/audit/page.tsx`

- [ ] **Step 1: Write the page**

```tsx
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getJob, techCanAccessJob } from "@/lib/data/jobs";
import { ensureAudit } from "@/lib/data/audits";
import { listAuditItemsForAudit } from "@/lib/data/audit-items";
import { AuditForm } from "@/components/AuditForm";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export default async function AuditPage({
  params,
}: {
  params: { jobId: string };
}) {
  const jobId = decodeURIComponent(params.jobId);
  if (jobId.startsWith("local-job-")) {
    // Audit creation requires a server-known jobId so the AuditID can
    // be reserved. Offline-only jobs need to sync first.
    redirect(`/jobs/${encodeURIComponent(jobId)}`);
  }
  const session = await getSession();
  const job = await getJob(jobId);
  if (!job) notFound();
  const canAccess = await techCanAccessJob({
    job,
    techName: session.name ?? "",
    isAdmin: session.isAdmin === true,
  });
  if (!canAccess) notFound();

  // Idempotent — creates the audit on first visit, returns existing
  // row on every subsequent visit.
  const audit = await ensureAudit({
    jobId,
    createdBy: session.name ?? "",
  });
  const items = await listAuditItemsForAudit(audit.auditId);

  return (
    <AuditForm
      job={job}
      audit={audit}
      initialItems={items}
      currentUserName={session.name ?? ""}
    />
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: build succeeds, route `/jobs/[jobId]/audit` appears.

- [ ] **Step 3: Commit**

```bash
git add app/\(app\)/jobs/\[jobId\]/audit/page.tsx
git commit -m "Audit: /jobs/[jobId]/audit server page shell"
```

---

### Task 14: `components/AuditPhotoSlot.tsx` — reusable single-photo slot

**Files:**
- Create: `components/AuditPhotoSlot.tsx`

- [ ] **Step 1: Write the component**

This is a one-slot photo picker for audit photos. Reuses the iOS-safe stable-element pattern from PhotoCapture, but for a single slot (PhotoCapture handles N+1 dynamic slots; here we always have exactly one).

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  label: string;
  hint?: string;
  required?: boolean;
  /** Pre-existing Drive URL (empty when nothing uploaded yet). */
  existingUrl: string;
  /** Called with the picked File; parent owns the upload. */
  onPick: (file: File) => Promise<void>;
}

export function AuditPhotoSlot({
  label,
  hint,
  required,
  existingUrl,
  onPick,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (localUrl) URL.revokeObjectURL(localUrl);
    };
  }, [localUrl]);

  const handlePick = () => {
    if (busy) return;
    inputRef.current?.click();
  };

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setError(null);
    if (localUrl) URL.revokeObjectURL(localUrl);
    setLocalUrl(URL.createObjectURL(f));
    setBusy(true);
    try {
      await onPick(f);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remoteUrl = existingUrl
    ? `/api/photo?fileId=${encodeURIComponent(extractFileId(existingUrl))}&w=320`
    : null;
  const displayUrl = localUrl ?? remoteUrl;
  const hasPhoto = Boolean(displayUrl);

  return (
    <div className="space-y-1">
      <div className="text-[11px] uppercase tracking-wider font-bold text-mse-muted">
        {label}
        {required && <span className="text-mse-red ml-1">*</span>}
      </div>
      {hint && (
        <div className="text-[10px] text-mse-muted/80 leading-tight">{hint}</div>
      )}
      <button
        type="button"
        onClick={handlePick}
        disabled={busy}
        className={cn(
          "relative w-full aspect-[4/3] rounded-xl overflow-hidden border-2",
          "flex items-center justify-center text-mse-muted",
          "transition-[border-color,background-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mse-red",
          hasPhoto
            ? "border-mse-navy/20 bg-white"
            : "border-dashed border-mse-light bg-mse-light/30 hover:border-mse-navy/30 hover:text-mse-navy",
          busy && "opacity-70 cursor-wait"
        )}
      >
        {hasPhoto && displayUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={displayUrl}
              alt={label}
              className="absolute inset-0 w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" />
            <div className="absolute bottom-1.5 left-1.5 right-1.5 inline-flex items-center gap-1 text-[10px] font-bold text-white uppercase tracking-wider">
              {busy ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <RotateCcw className="w-3 h-3" />
              )}
              {busy ? "Uploading…" : "Retake"}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-1 text-xs font-semibold">
            <Camera className="w-5 h-5" />
            <span>Take photo</span>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleChange}
          className="hidden"
        />
      </button>
      {error && (
        <div className="text-[11px] text-mse-red bg-mse-red/5 rounded px-2 py-1">
          {error}
        </div>
      )}
    </div>
  );
}

// Extract the Drive file ID from a Drive URL — handles both the
// folder/{id} and uc?id={id} formats already in the schema.
function extractFileId(url: string): string {
  const match =
    url.match(/[?&]id=([A-Za-z0-9_-]+)/) ||
    url.match(/\/d\/([A-Za-z0-9_-]+)/) ||
    url.match(/\/file\/d\/([A-Za-z0-9_-]+)/);
  return match?.[1] ?? "";
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add components/AuditPhotoSlot.tsx
git commit -m "Audit: AuditPhotoSlot component"
```

---

### Task 15: `components/AuditForm.tsx` — top-level form + sections (Building + BAS)

**Files:**
- Create: `components/AuditForm.tsx`

- [ ] **Step 1: Write the shell**

This is the biggest component. Start with the shell, Building section, and BAS section. Walk-In / Thermostat / Water-Source sections come in the next task as a shared `AuditItemSection` component.

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";
import { AuditPhotoSlot } from "@/components/AuditPhotoSlot";
import { AuditItemSection } from "@/components/AuditItemSection";
import { cn } from "@/lib/utils";
import type {
  Audit,
  AuditItem,
  AuditItemType,
  Job,
} from "@/lib/types";

interface Props {
  job: Job;
  audit: Audit;
  initialItems: AuditItem[];
  currentUserName: string;
}

const SECTIONS: { key: AuditItemType | "Building" | "BAS"; label: string }[] = [
  { key: "Building", label: "Building" },
  { key: "Walk-In", label: "Walk-Ins" },
  { key: "Thermostat", label: "Thermostats" },
  { key: "Water-Source", label: "Water-source" },
  { key: "BAS", label: "BAS" },
];

export function AuditForm({ job, audit: initialAudit, initialItems }: Props) {
  const [audit, setAudit] = useState(initialAudit);
  const [items, setItems] = useState(initialItems);
  const [busyMarkComplete, setBusyMarkComplete] = useState(false);
  const [basNotes, setBasNotes] = useState(audit.basNotes);
  const [notes, setNotes] = useState(audit.notes);

  // Upload helpers — every audit photo goes through /api/upload with
  // kind=audit-building or kind=audit-item. The response carries the
  // new Drive URL which we splice into local state so the slot
  // re-renders with the cloud copy.
  async function uploadBuilding(slot: "front" | "fire-plan" | "bas", file: File) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("jobId", job.jobId);
    fd.append("auditId", audit.auditId);
    fd.append("kind", "audit-building");
    fd.append("slot", slot);
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!res.ok || !body.url) throw new Error(body.error ?? "Upload failed");
    setAudit((prev) => ({
      ...prev,
      ...(slot === "front" && { frontPhotoUrl: body.url ?? "" }),
      ...(slot === "fire-plan" && { firePlanPhotoUrl: body.url ?? "" }),
      ...(slot === "bas" && { basPhotoUrl: body.url ?? "" }),
    }));
  }

  async function patchAuditField(field: "basNotes" | "notes", value: string) {
    await fetch(`/api/audits/${encodeURIComponent(audit.auditId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
  }

  async function markComplete() {
    setBusyMarkComplete(true);
    try {
      const res = await fetch(
        `/api/audits/${encodeURIComponent(audit.auditId)}/complete`,
        { method: "POST" }
      );
      if (!res.ok) throw new Error("Could not mark complete");
      setAudit((prev) => ({
        ...prev,
        status: "Complete",
        completedAt: new Date().toISOString(),
      }));
    } finally {
      setBusyMarkComplete(false);
    }
  }

  async function reopen() {
    setBusyMarkComplete(true);
    try {
      const res = await fetch(
        `/api/audits/${encodeURIComponent(audit.auditId)}/reopen`,
        { method: "POST" }
      );
      if (!res.ok) throw new Error("Could not reopen");
      setAudit((prev) => ({
        ...prev,
        status: "Draft",
        completedAt: "",
        completedBy: "",
      }));
    } finally {
      setBusyMarkComplete(false);
    }
  }

  // Checklist tick logic — Building: front photo present? Sections
  // with items: at least one active item? BAS: optional, always green.
  const tickedSections = new Set<typeof SECTIONS[number]["key"]>();
  if (audit.frontPhotoUrl) tickedSections.add("Building");
  const activeItems = items.filter((i) => i.status === "Active");
  for (const t of ["Walk-In", "Thermostat", "Water-Source"] as const) {
    if (activeItems.some((i) => i.itemType === t)) tickedSections.add(t);
  }
  // BAS is always optional — tick when either photo or notes present.
  if (audit.basPhotoUrl || audit.basNotes) tickedSections.add("BAS");

  return (
    <div className="space-y-6 pb-24">
      <div className="flex items-center gap-2">
        <Link
          href={`/jobs/${encodeURIComponent(job.jobId)}`}
          className="p-2 -ml-2 text-mse-muted hover:text-mse-navy"
          aria-label="Back to job"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-mse-muted">Energy audit</div>
          <h1 className="text-2xl font-bold text-mse-navy truncate">
            {job.customerName}
          </h1>
        </div>
        <span
          className={cn(
            "px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
            audit.status === "Complete"
              ? "bg-emerald-500 text-white"
              : "bg-mse-gold text-mse-navy"
          )}
        >
          {audit.status}
        </span>
      </div>

      {/* Sticky checklist header */}
      <div className="sticky top-0 z-10 -mx-4 px-4 py-2 bg-white/95 backdrop-blur border-b border-mse-light">
        <div className="flex gap-1.5 overflow-x-auto">
          {SECTIONS.map((s) => (
            <a
              key={s.key}
              href={`#section-${s.key.toLowerCase()}`}
              className={cn(
                "px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider whitespace-nowrap",
                tickedSections.has(s.key)
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-mse-light text-mse-muted"
              )}
            >
              {tickedSections.has(s.key) ? "✓ " : "○ "}
              {s.label}
            </a>
          ))}
        </div>
      </div>

      {/* ─── Building ─── */}
      <section id="section-building" className="space-y-4">
        <h2 className="text-sm font-bold text-mse-navy uppercase tracking-wider">
          Building
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <AuditPhotoSlot
            label="Front of building"
            hint="Wide shot for context"
            required
            existingUrl={audit.frontPhotoUrl}
            onPick={(f) => uploadBuilding("front", f)}
          />
          <AuditPhotoSlot
            label="Fire escape / M1 plan"
            hint="Optional"
            existingUrl={audit.firePlanPhotoUrl}
            onPick={(f) => uploadBuilding("fire-plan", f)}
          />
        </div>
      </section>

      {/* ─── Walk-Ins ─── */}
      <AuditItemSection
        anchorId="section-walk-in"
        title="Walk-Ins"
        itemType="Walk-In"
        audit={audit}
        job={job}
        items={items}
        onItemsChange={setItems}
      />

      {/* ─── Thermostats ─── */}
      <AuditItemSection
        anchorId="section-thermostat"
        title="Thermostats"
        itemType="Thermostat"
        audit={audit}
        job={job}
        items={items}
        onItemsChange={setItems}
      />

      {/* ─── Water-Source ─── */}
      <AuditItemSection
        anchorId="section-water-source"
        title="Water-source"
        itemType="Water-Source"
        audit={audit}
        job={job}
        items={items}
        onItemsChange={setItems}
      />

      {/* ─── BAS ─── */}
      <section id="section-bas" className="space-y-4">
        <h2 className="text-sm font-bold text-mse-navy uppercase tracking-wider">
          BAS
        </h2>
        <p className="text-xs text-mse-muted">
          Usually Xavier handles BAS — capture the panel if visible.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <AuditPhotoSlot
            label="BAS system"
            hint="Optional"
            existingUrl={audit.basPhotoUrl}
            onPick={(f) => uploadBuilding("bas", f)}
          />
          <div className="space-y-1">
            <div className="text-[11px] uppercase tracking-wider font-bold text-mse-muted">
              BAS notes
            </div>
            <textarea
              value={basNotes}
              onChange={(e) => setBasNotes(e.target.value)}
              onBlur={() => patchAuditField("basNotes", basNotes)}
              rows={4}
              placeholder="Any notes for Xavier"
              className="w-full px-3 py-2 rounded-lg border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy resize-none"
            />
          </div>
        </div>
      </section>

      {/* ─── Audit notes ─── */}
      <section className="space-y-2">
        <div className="text-[11px] uppercase tracking-wider font-bold text-mse-muted">
          Overall audit notes
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => patchAuditField("notes", notes)}
          rows={4}
          placeholder="Anything worth flagging on the building"
          className="w-full px-3 py-2 rounded-lg border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy resize-none"
        />
      </section>

      {/* ─── Footer action ─── */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-mse-light p-4 safe-bottom z-10">
        <div className="max-w-2xl mx-auto">
          {audit.status === "Complete" ? (
            <button
              type="button"
              onClick={reopen}
              disabled={busyMarkComplete}
              className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-2xl font-bold bg-mse-gold/20 text-mse-navy border border-mse-gold hover:bg-mse-gold/30"
            >
              {busyMarkComplete && <Loader2 className="w-4 h-4 animate-spin" />}
              Audit complete · Reopen
            </button>
          ) : (
            <button
              type="button"
              onClick={markComplete}
              disabled={busyMarkComplete}
              className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-2xl font-bold bg-mse-gold text-mse-navy hover:bg-mse-gold/90 active:scale-[0.98]"
            >
              {busyMarkComplete ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
              Mark audit complete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build (will fail until Task 16 adds AuditItemSection)**

Run: `npm run build`
Expected: fails with "Cannot find module '@/components/AuditItemSection'". This is OK — Task 16 fills it in.

- [ ] **Step 3: Commit (failing build is fine — the next task fixes it)**

```bash
git add components/AuditForm.tsx
git commit -m "Audit: AuditForm shell (Building + BAS sections + checklist)"
```

---

### Task 16: `components/AuditItemSection.tsx` — Walk-In / Thermostat / Water-Source

**Files:**
- Create: `components/AuditItemSection.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useMemo, useState } from "react";
import { Plus, Minus, Loader2 } from "lucide-react";
import { AuditPhotoSlot } from "@/components/AuditPhotoSlot";
import { cn } from "@/lib/utils";
import type {
  Audit,
  AuditItem,
  AuditItemType,
  Job,
  WaterSourceSubtype,
} from "@/lib/types";

interface Props {
  anchorId: string;
  title: string;
  itemType: AuditItemType;
  audit: Audit;
  job: Job;
  items: AuditItem[];
  onItemsChange: (next: AuditItem[]) => void;
}

const WATER_SUBTYPES: WaterSourceSubtype[] = [
  "Chiller",
  "Cooling Tower",
  "Boiler",
  "Controls",
  "Other",
];

export function AuditItemSection({
  anchorId,
  title,
  itemType,
  audit,
  job,
  items,
  onItemsChange,
}: Props) {
  const mine = useMemo(
    () =>
      items
        .filter((i) => i.itemType === itemType && i.status === "Active")
        .sort((a, b) => a.itemNumber - b.itemNumber),
    [items, itemType]
  );
  const [busyCount, setBusyCount] = useState(false);

  async function bumpCount(direction: "up" | "down") {
    if (busyCount) return;
    setBusyCount(true);
    try {
      if (direction === "up") {
        const nextNumber = (mine.at(-1)?.itemNumber ?? 0) + 1;
        const res = await fetch("/api/audit-items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            auditId: audit.auditId,
            jobId: job.jobId,
            itemType,
            itemNumber: nextNumber,
          }),
        });
        const body = (await res.json().catch(() => ({}))) as { item?: AuditItem; error?: string };
        if (!res.ok || !body.item) throw new Error(body.error ?? "Add failed");
        onItemsChange([...items, body.item]);
      } else {
        const last = mine.at(-1);
        if (!last) return;
        const res = await fetch(
          `/api/audit-items/${encodeURIComponent(last.itemId)}`,
          { method: "DELETE" }
        );
        if (!res.ok) throw new Error("Could not orphan item");
        onItemsChange(
          items.map((i) =>
            i.itemId === last.itemId ? { ...i, status: "Orphaned" } : i
          )
        );
      }
    } finally {
      setBusyCount(false);
    }
  }

  async function uploadItemPhoto(
    item: AuditItem,
    slot: string,
    file: File
  ) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("jobId", job.jobId);
    fd.append("itemId", item.itemId);
    fd.append("kind", "audit-item");
    fd.append("slot", slot);
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!res.ok || !body.url) throw new Error(body.error ?? "Upload failed");
    onItemsChange(
      items.map((i) => {
        if (i.itemId !== item.itemId) return i;
        const updated = { ...i };
        if (slot === "model-label") updated.modelLabelPhotoUrl = body.url ?? "";
        if (slot === "nameplate") updated.nameplatePhotoUrl = body.url ?? "";
        if (slot === "fans") updated.fansPhotoUrl = body.url ?? "";
        if (slot === "temp") updated.tempPhotoUrl = body.url ?? "";
        if (slot === "wiring") updated.wiringPhotoUrl = body.url ?? "";
        if (slot === "location") updated.locationPhotoUrl = body.url ?? "";
        if (slot === "controls") updated.controlsPhotoUrl = body.url ?? "";
        if (slot === "schedule") {
          const existing = updated.schedulePhotoUrlsCsv
            ? updated.schedulePhotoUrlsCsv.split(",").map((s) => s.trim()).filter(Boolean)
            : [];
          existing.push(body.url ?? "");
          updated.schedulePhotoUrlsCsv = existing.join(",");
        }
        return updated;
      })
    );
  }

  async function patchItem(itemId: string, patch: Partial<AuditItem>) {
    await fetch(`/api/audit-items/${encodeURIComponent(itemId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    onItemsChange(items.map((i) => (i.itemId === itemId ? { ...i, ...patch } : i)));
  }

  return (
    <section id={anchorId} className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-mse-navy uppercase tracking-wider">
          {title}
        </h2>
        <div className="inline-flex items-center gap-2">
          <button
            type="button"
            onClick={() => bumpCount("down")}
            disabled={busyCount || mine.length === 0}
            className="w-8 h-8 inline-flex items-center justify-center rounded-full bg-mse-light text-mse-muted disabled:opacity-40"
            aria-label="Remove last"
          >
            <Minus className="w-4 h-4" />
          </button>
          <span className="w-8 text-center font-bold text-mse-navy tabular-nums">
            {mine.length}
          </span>
          <button
            type="button"
            onClick={() => bumpCount("up")}
            disabled={busyCount}
            className="w-8 h-8 inline-flex items-center justify-center rounded-full bg-mse-navy text-white"
            aria-label="Add"
          >
            {busyCount ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {mine.length === 0 ? (
        <p className="text-xs text-mse-muted italic px-3 py-4 border-2 border-dashed border-mse-light rounded-xl text-center">
          None — tap + to add the first.
        </p>
      ) : (
        <div className="space-y-3">
          {mine.map((item) => (
            <ItemCard
              key={item.itemId}
              item={item}
              itemType={itemType}
              onPhoto={(slot, file) => uploadItemPhoto(item, slot, file)}
              onPatch={(patch) => patchItem(item.itemId, patch)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ItemCard({
  item,
  itemType,
  onPhoto,
  onPatch,
}: {
  item: AuditItem;
  itemType: AuditItemType;
  onPhoto: (slot: string, file: File) => Promise<void>;
  onPatch: (patch: Partial<AuditItem>) => Promise<void>;
}) {
  const [label, setLabel] = useState(item.label);
  const [notes, setNotes] = useState(item.notes);
  const [subtype, setSubtype] = useState(item.itemSubtype);

  return (
    <div className="rounded-2xl border border-mse-light bg-white p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] uppercase tracking-wider font-bold text-mse-gold">
          {itemType.replace("-", " ")} {item.itemNumber}
        </div>
        {itemType === "Water-Source" && (
          <select
            value={subtype}
            onChange={(e) => {
              const v = e.target.value as WaterSourceSubtype | "";
              setSubtype(v);
              onPatch({ itemSubtype: v });
            }}
            className="text-xs px-2 py-1 rounded-md border border-mse-light bg-white"
          >
            <option value="">— Subtype —</option>
            {WATER_SUBTYPES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
      </div>

      <input
        type="text"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => onPatch({ label })}
        placeholder="Label (optional)"
        className="w-full px-3 py-2 rounded-lg border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy"
      />

      <div className="grid grid-cols-2 gap-3">
        {itemType === "Walk-In" && (
          <>
            <AuditPhotoSlot
              label="Model label"
              hint="Inside the walk-in, around back"
              required
              existingUrl={item.modelLabelPhotoUrl}
              onPick={(f) => onPhoto("model-label", f)}
            />
            <AuditPhotoSlot
              label="Fans"
              hint="Show the count"
              required
              existingUrl={item.fansPhotoUrl}
              onPick={(f) => onPhoto("fans", f)}
            />
            <AuditPhotoSlot
              label="Temp setting"
              required
              existingUrl={item.tempPhotoUrl}
              onPick={(f) => onPhoto("temp", f)}
            />
          </>
        )}
        {itemType === "Thermostat" && (
          <>
            <AuditPhotoSlot
              label="Existing wiring"
              required
              existingUrl={item.wiringPhotoUrl}
              onPick={(f) => onPhoto("wiring", f)}
            />
            <AuditPhotoSlot
              label="Location"
              hint="Optional"
              existingUrl={item.locationPhotoUrl}
              onPick={(f) => onPhoto("location", f)}
            />
            <ScheduleStrip
              csv={item.schedulePhotoUrlsCsv}
              onPick={(f) => onPhoto("schedule", f)}
            />
          </>
        )}
        {itemType === "Water-Source" && (
          <>
            <AuditPhotoSlot
              label="Model label / nameplate"
              required
              existingUrl={item.modelLabelPhotoUrl || item.nameplatePhotoUrl}
              onPick={(f) => onPhoto("model-label", f)}
            />
            <AuditPhotoSlot
              label="Controls"
              hint="Optional"
              existingUrl={item.controlsPhotoUrl}
              onPick={(f) => onPhoto("controls", f)}
            />
          </>
        )}
      </div>

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => onPatch({ notes })}
        rows={2}
        placeholder="Notes (optional)"
        className="w-full px-3 py-2 rounded-lg border border-mse-light bg-white text-xs focus:outline-none focus:border-mse-navy resize-none"
      />
    </div>
  );
}

function ScheduleStrip({
  csv,
  onPick,
}: {
  csv: string;
  onPick: (file: File) => Promise<void>;
}) {
  const urls = csv ? csv.split(",").map((s) => s.trim()).filter(Boolean) : [];
  // The first photo uses an AuditPhotoSlot for camera flow; we render
  // additional photos as small thumbnails next to it + one trailing
  // "add another" slot for multi-shot schedules.
  return (
    <div className={cn("col-span-2 space-y-2")}>
      <div className="text-[11px] uppercase tracking-wider font-bold text-mse-muted">
        Schedule {urls.length > 0 && <span className="text-mse-navy">· {urls.length}</span>}
      </div>
      <div className="text-[10px] text-mse-muted/80">
        One photo of the lit-up thermostat if no schedule; one per screen if scheduled.
      </div>
      <div className="grid grid-cols-3 gap-2">
        {urls.map((url, i) => (
          <div
            key={`${url}-${i}`}
            className="relative aspect-[4/3] rounded-lg overflow-hidden border border-mse-light bg-white"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/photo?fileId=${encodeURIComponent(extractFileId(url))}&w=240`}
              alt={`Schedule ${i + 1}`}
              className="absolute inset-0 w-full h-full object-cover"
            />
          </div>
        ))}
        <AuditPhotoSlot
          label={urls.length === 0 ? "First schedule photo" : "Add another"}
          existingUrl=""
          onPick={onPick}
        />
      </div>
    </div>
  );
}

function extractFileId(url: string): string {
  const match =
    url.match(/[?&]id=([A-Za-z0-9_-]+)/) ||
    url.match(/\/d\/([A-Za-z0-9_-]+)/) ||
    url.match(/\/file\/d\/([A-Za-z0-9_-]+)/);
  return match?.[1] ?? "";
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: build now succeeds (AuditForm import resolves).

- [ ] **Step 3: Browser smoke**

Start the dev server (`npm run dev`) in another terminal. Open `http://localhost:3000/jobs/<some-existing-jobId>/audit` after logging in. Verify:
- Sticky checklist header renders 5 chips.
- Building section shows two photo slots.
- Each item section's +/− buttons add/remove cards.
- Adding a Walk-In renders 3 photo slots. Adding a Thermostat renders wiring + location + schedule strip. Adding a Water-Source renders the subtype dropdown + 2 slots.

- [ ] **Step 4: Commit**

```bash
git add components/AuditItemSection.tsx
git commit -m "Audit: AuditItemSection — Walk-In / Therm / Water-Source cards with count steppers"
```

---

### Task 17: Wire `Complete Audit` entry button + audit-status pill on `/jobs/[jobId]`

**Files:**
- Modify: `components/JobDetail.tsx`
- Modify: `app/(app)/jobs/[jobId]/page.tsx` (pass audit summary to JobDetail)

- [ ] **Step 1: Pass audit summary into JobDetail**

In `app/(app)/jobs/[jobId]/page.tsx`, add at the top of the file:

```ts
import { getAuditForJob } from "@/lib/data/audits";
import { listAuditItemsForAudit } from "@/lib/data/audit-items";
```

In the data-loading section of the default export (the page component), add a parallel fetch for the audit summary. Find the existing `Promise.all` (or sequential awaits) and add:

```ts
const audit = await getAuditForJob(jobId);
const auditItemCount = audit
  ? (await listAuditItemsForAudit(audit.auditId)).filter((i) => i.status === "Active").length
  : 0;
```

Then pass them to `<JobDetail ...>`:

```tsx
<JobDetail
  // ... existing props ...
  auditStatus={audit?.status ?? null}
  auditItemCount={auditItemCount}
/>
```

- [ ] **Step 2: Accept the new props in JobDetail**

In `components/JobDetail.tsx`, update the `Props` interface:

```ts
interface Props {
  // ... existing fields ...
  /** Status of the energy audit for this job, or null when no audit
   *  exists yet. */
  auditStatus: "Draft" | "Complete" | null;
  /** Active (non-orphaned) audit item count. */
  auditItemCount: number;
}
```

Destructure in the function signature.

- [ ] **Step 3: Insert the Complete Audit entry button**

In the JSX, locate the existing `Add unit` button block (search for `Add unit` in the file). Right after the `<UnitsSection>` block, insert:

```tsx
<a
  href={`/jobs/${encodeURIComponent(job.jobId)}/audit`}
  className="block rounded-2xl bg-mse-gold/15 border-2 border-mse-gold/40 hover:bg-mse-gold/25 active:scale-[0.98] transition-[background-color,transform] p-5"
>
  <div className="flex items-center gap-3">
    <div className="w-10 h-10 rounded-full bg-mse-gold/30 flex items-center justify-center text-mse-navy font-bold text-lg shrink-0">
      ⚡
    </div>
    <div className="flex-1 min-w-0">
      <div className="font-bold text-mse-navy">Complete energy audit</div>
      <div className="text-[11px] text-mse-muted mt-0.5">
        {auditStatus === null
          ? "Walkthrough survey — building, walk-ins, therms, water-source, BAS."
          : auditStatus === "Draft"
          ? `Draft · ${auditItemCount} item${auditItemCount === 1 ? "" : "s"} logged`
          : `Complete ✓ · ${auditItemCount} item${auditItemCount === 1 ? "" : "s"}`}
      </div>
    </div>
  </div>
</a>
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Browser smoke**

Visit a job page. The Complete energy audit button should appear below the units list, link to `/jobs/[jobId]/audit`, and show appropriate status text.

- [ ] **Step 6: Commit**

```bash
git add components/JobDetail.tsx app/\(app\)/jobs/\[jobId\]/page.tsx
git commit -m "Audit: Complete Audit entry button + audit status on job detail page"
```

---

## Phase 5 — Job Complete / Reopen UI + auto-finalize removal (3 tasks)

### Task 18: `components/JobCompletionBar.tsx` — bottom-pinned buttons

**Files:**
- Create: `components/JobCompletionBar.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  jobId: string;
  /** True when at least one dispatch on this job is finalized
   *  (submittedAt set). */
  jobFinalized: boolean;
  /** Current audit status, or null when none exists yet. */
  auditStatus: "Draft" | "Complete" | null;
  auditId: string | null;
}

export function JobCompletionBar({
  jobId,
  jobFinalized,
  auditStatus,
  auditId,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<"job" | "audit" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggleJob() {
    setBusy("job");
    setError(null);
    try {
      const path = jobFinalized ? "reopen" : "complete";
      const res = await fetch(
        `/api/jobs/${encodeURIComponent(jobId)}/${path}`,
        { method: "POST" }
      );
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        blockingPeriodId?: string;
      };
      if (!res.ok) throw new Error(body.error ?? "Failed");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  async function toggleAudit() {
    if (!auditId) return;
    setBusy("audit");
    setError(null);
    try {
      const path = auditStatus === "Complete" ? "reopen" : "complete";
      const res = await fetch(
        `/api/audits/${encodeURIComponent(auditId)}/${path}`,
        { method: "POST" }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Failed");
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-mse-light p-4 safe-bottom z-10">
      <div className="max-w-2xl mx-auto space-y-2">
        {error && (
          <div className="text-[11px] text-mse-red bg-mse-red/5 border border-mse-red/20 rounded px-3 py-2">
            {error}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={toggleJob}
            disabled={busy !== null}
            className={cn(
              "py-3 rounded-2xl font-bold text-sm inline-flex items-center justify-center gap-1.5",
              jobFinalized
                ? "bg-mse-light text-mse-navy border border-mse-navy/20"
                : "bg-mse-red text-white shadow-card hover:bg-mse-red-hover"
            )}
          >
            {busy === "job" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : jobFinalized ? (
              <RotateCcw className="w-4 h-4" />
            ) : (
              <CheckCircle2 className="w-4 h-4" />
            )}
            {jobFinalized ? "Complete ✓ · Reopen" : "Job Complete"}
          </button>
          <button
            type="button"
            onClick={toggleAudit}
            disabled={busy !== null || !auditId}
            className={cn(
              "py-3 rounded-2xl font-bold text-sm inline-flex items-center justify-center gap-1.5",
              auditStatus === "Complete"
                ? "bg-mse-light text-mse-navy border border-mse-navy/20"
                : "bg-mse-gold text-mse-navy hover:bg-mse-gold/90"
            )}
          >
            {busy === "audit" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : auditStatus === "Complete" ? (
              <RotateCcw className="w-4 h-4" />
            ) : (
              <CheckCircle2 className="w-4 h-4" />
            )}
            {auditStatus === "Complete" ? "Audit ✓ · Reopen" : "Audit Complete"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add components/JobCompletionBar.tsx
git commit -m "Audit: JobCompletionBar bottom-pinned Job + Audit buttons"
```

---

### Task 19: Wire `JobCompletionBar` into `JobDetail.tsx` + add bottom padding

**Files:**
- Modify: `components/JobDetail.tsx`
- Modify: `app/(app)/jobs/[jobId]/page.tsx`

- [ ] **Step 1: Compute jobFinalized + pass to JobDetail**

In `app/(app)/jobs/[jobId]/page.tsx`, near the existing audit fetch:

```ts
const dispatchesForJob = await listAllDispatches();
const jobFinalized = dispatchesForJob.some(
  (d) => d.jobId === jobId && Boolean(d.submittedAt)
);
```

(If `listAllDispatches` is already imported and used, reuse the existing call instead of re-importing.)

Pass `jobFinalized={jobFinalized}` and `auditId={audit?.auditId ?? null}` to `<JobDetail>`.

- [ ] **Step 2: Render the bar at the bottom of JobDetail**

In `components/JobDetail.tsx`:
- Add `JobCompletionBar` import: `import { JobCompletionBar } from "@/components/JobCompletionBar";`
- Extend `Props` with `jobFinalized: boolean; auditId: string | null;`.
- The existing JSX root is `<div className="space-y-6">`. Wrap it (or update className) to add `pb-32` so the fixed bottom bar doesn't cover content. The bar itself is `position: fixed`, so add it as a sibling at the end of the JSX:

```tsx
<JobCompletionBar
  jobId={job.jobId}
  jobFinalized={jobFinalized}
  auditStatus={auditStatus}
  auditId={auditId}
/>
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Browser smoke**

Open a job page. Bottom-pinned bar should appear with both buttons. Tapping Job Complete should call the API and toggle the button to "Complete ✓ · Reopen".

- [ ] **Step 5: Commit**

```bash
git add components/JobDetail.tsx app/\(app\)/jobs/\[jobId\]/page.tsx
git commit -m "Audit: wire JobCompletionBar into job detail page"
```

---

### Task 20: Remove auto-finalize wiring + 8pm cron

**Files:**
- Modify: `app/(app)/jobs/page.tsx` (drop the fire-and-forget call)
- Modify: `app/(app)/jobs/[jobId]/page.tsx` (drop any auto-finalize there too)
- Modify: `components/JobDetail.tsx` (update AutoUploadCard copy)
- Delete: `app/api/cron/finalize-stale-dispatches/route.ts`
- Modify: `vercel.json` (remove the crons entry)

- [ ] **Step 1: Remove the auto-finalize call from `/jobs`**

In `app/(app)/jobs/page.tsx`, find:

```ts
if (techName) {
  autoFinalizeOpenDraftsForTech(techName, { exceptJobId: null }).catch(
    (e) => console.warn("[jobs] auto-finalize on index failed:", e)
  );
}
```

Replace with a comment that explains the removal:

```ts
// Auto-finalize-on-list-load was removed 2026-06-02. Dispatch
// finalize now requires the explicit Job Complete button on the job
// page (or admin force-finalize via the Stuck Drafts panel).
```

Remove the `autoFinalizeOpenDraftsForTech` import from this file.

- [ ] **Step 2: Remove the auto-finalize call from the job detail server page**

In `app/(app)/jobs/[jobId]/page.tsx`, find any call to `autoFinalizeOpenDraftsForTech`. Replace the same way (comment-out and remove the import).

- [ ] **Step 3: Update AutoUploadCard copy**

In `components/JobDetail.tsx`, find the AutoUploadCard line that reads:

```
"Auto-closes when you head to your next job, or by 8 PM ET at the latest. No submit needed."
```

Replace with:

```
"Tap Job Complete below when you're finished. Photos still upload as you go."
```

- [ ] **Step 4: Delete the cron route**

```bash
rm app/api/cron/finalize-stale-dispatches/route.ts
rmdir app/api/cron/finalize-stale-dispatches 2>/dev/null || true
rmdir app/api/cron 2>/dev/null || true
```

- [ ] **Step 5: Empty out `vercel.json` crons**

Replace the contents of `vercel.json` with:

```json
{}
```

(If `vercel.json` has other config keys besides `crons`, only delete the `crons` entry — keep the rest.)

- [ ] **Step 6: Verify build**

Run: `npm run build`
Expected: build succeeds, no more route for `/api/cron/finalize-stale-dispatches`. Build summary should also not list it.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Audit: remove auto-finalize trigger + 8pm cron — Job Complete button replaces both"
```

---

## Phase 6 — Admin Stuck Drafts panel (2 tasks)

### Task 21: Add `force-finalize` admin route

**Files:**
- Create: `app/api/admin/dispatches/[dispatchId]/finalize/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/payroll/auth";
import { autoFinalizeOpenDraftsForTech, getDispatch } from "@/lib/data/dispatches";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: { dispatchId: string } }
) {
  const guard = await requireAdmin();
  if ("response" in guard) return guard.response;

  const dispatchId = decodeURIComponent(params.dispatchId);
  const dispatch = await getDispatch(dispatchId);
  if (!dispatch) {
    return NextResponse.json({ error: "Dispatch not found" }, { status: 404 });
  }
  if (dispatch.submittedAt) {
    return NextResponse.json({ ok: true, note: "Already finalized." });
  }

  // Reuse the same helper that powered the auto-finalize trigger.
  // For each tech on the dispatch, run with onlyJobId/onlyDispatchId
  // filtered to this single dispatch.
  try {
    for (const techName of dispatch.techsOnSite) {
      await autoFinalizeOpenDraftsForTech(techName, {
        onlyDispatchId: dispatchId,
      });
    }
    revalidatePath("/admin");
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[admin/dispatches/finalize] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
```

*Note: similar to Task 12 — `autoFinalizeOpenDraftsForTech` may need an `onlyDispatchId` filter option. Extend the signature in `lib/data/dispatches.ts` if not present. The implementer should also add a `getDispatch(dispatchId)` accessor if one does not already exist (mirror `getJob`).*

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: route appears under `/api/admin/dispatches/[dispatchId]/finalize`.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/dispatches/ lib/data/dispatches.ts
git commit -m "Audit: admin force-finalize route per-dispatch"
```

---

### Task 22: `components/admin/StuckDraftsPanel.tsx` + wire into `/admin`

**Files:**
- Create: `components/admin/StuckDraftsPanel.tsx`
- Modify: `app/(app)/admin/page.tsx`

- [ ] **Step 1: Write the panel**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface StuckRow {
  dispatchId: string;
  jobId: string;
  customerName: string;
  techNames: string[];
  dispatchDate: string;
  ageDays: number;
}

interface Props {
  rows: StuckRow[];
}

export function StuckDraftsPanel({ rows }: Props) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function forceFinalize(dispatchId: string) {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Force-finalize this dispatch? Writes pay attribution rows as if the tech tapped Job Complete."
      )
    ) {
      return;
    }
    setBusyId(dispatchId);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/dispatches/${encodeURIComponent(dispatchId)}/finalize`,
        { method: "POST" }
      );
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Failed");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusyId(null);
    }
  }

  if (rows.length === 0) {
    return (
      <section className="rounded-2xl border border-mse-light bg-white p-5">
        <h2 className="text-sm font-bold text-mse-navy uppercase tracking-wider">
          Stuck Drafts
        </h2>
        <p className="text-xs text-mse-muted mt-2">
          No dispatches stuck in Draft for more than 48 hours.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border-2 border-mse-red/30 bg-mse-red/5 p-5">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-mse-red" />
        <h2 className="text-sm font-bold text-mse-red uppercase tracking-wider">
          Stuck Drafts ({rows.length})
        </h2>
      </div>
      <p className="text-xs text-mse-muted mt-1">
        Dispatches still Draft after 48+ hours. Force-finalize writes their pay attribution rows.
      </p>
      {error && (
        <div className="mt-3 text-[11px] text-mse-red bg-white border border-mse-red/40 rounded px-3 py-2">
          {error}
        </div>
      )}
      <ul className="mt-3 space-y-2">
        {rows.map((r) => (
          <li
            key={r.dispatchId}
            className="bg-white rounded-xl border border-mse-light p-3 flex items-center justify-between gap-2 flex-wrap"
          >
            <div className="flex-1 min-w-0">
              <div className="font-bold text-mse-navy text-sm truncate">
                {r.customerName}
              </div>
              <div className="text-[11px] text-mse-muted mt-0.5">
                {r.techNames.join(", ")} · {r.dispatchDate} · {r.ageDays}d old
              </div>
            </div>
            <button
              type="button"
              onClick={() => forceFinalize(r.dispatchId)}
              disabled={busyId !== null}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold",
                "bg-mse-navy text-white hover:bg-mse-navy-soft active:scale-95",
                busyId === r.dispatchId && "opacity-60"
              )}
            >
              {busyId === r.dispatchId ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : null}
              Force finalize
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 2: Compute the rows + render in `/admin`**

In `app/(app)/admin/page.tsx`, add:

```ts
import { StuckDraftsPanel } from "@/components/admin/StuckDraftsPanel";
import { listAllDispatches } from "@/lib/data/dispatches";
import { listAllJobs } from "@/lib/data/jobs";
```

Inside the page component's data-loading section, compute:

```ts
const [dispatches, jobs] = await Promise.all([
  listAllDispatches(),
  listAllJobs(),
]);
const jobsById = new Map(jobs.map((j) => [j.jobId, j]));
const cutoff = Date.now() - 48 * 60 * 60 * 1000;
const stuck = dispatches
  .filter((d) => !d.submittedAt)
  .filter((d) => {
    const created = new Date(d.dispatchDate + "T00:00:00Z").getTime();
    return Number.isFinite(created) && created < cutoff;
  })
  .map((d) => {
    const job = jobsById.get(d.jobId);
    return {
      dispatchId: d.dispatchId,
      jobId: d.jobId,
      customerName: job?.customerName ?? d.jobId,
      techNames: d.techsOnSite,
      dispatchDate: d.dispatchDate,
      ageDays: Math.floor((Date.now() - new Date(d.dispatchDate + "T00:00:00Z").getTime()) / (24 * 60 * 60 * 1000)),
    };
  })
  .sort((a, b) => b.ageDays - a.ageDays);
```

Render the panel near the top of the admin page JSX:

```tsx
<StuckDraftsPanel rows={stuck} />
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Browser smoke**

Open `/admin`. The panel should show either "No stuck drafts" or a list with Force-finalize buttons.

- [ ] **Step 5: Commit**

```bash
git add components/admin/StuckDraftsPanel.tsx app/\(app\)/admin/page.tsx
git commit -m "Audit: admin Stuck Drafts panel — lists 48h+ drafts with force-finalize"
```

---

## Phase 7 — Audit data on customer report PDF (2 tasks)

### Task 23: Extend `lib/customer-report.ts` to include audit data

**Files:**
- Modify: `lib/customer-report.ts`

- [ ] **Step 1: Extend `CustomerReportJob`**

In `lib/customer-report.ts`, add to the `CustomerReportJob` interface:

```ts
export interface CustomerReportJob {
  // ... existing fields ...
  audit: {
    auditId: string;
    status: "Draft" | "Complete";
    frontPhotoUrl: string;
    firePlanPhotoUrl: string;
    basPhotoUrl: string;
    basNotes: string;
    walkInCount: number;
    thermostatCount: number;
    waterSourceCount: number;
  } | null;
}
```

- [ ] **Step 2: Populate audit on each job**

In `buildCustomerReport`, add to the loop that builds each `CustomerReportJob`:

```ts
import { getAuditForJob } from "@/lib/data/audits";
import { listAuditItemsForAudit } from "@/lib/data/audit-items";

// ... inside the per-job loop ...
const auditRow = await getAuditForJob(job.jobId);
const auditItems = auditRow
  ? (await listAuditItemsForAudit(auditRow.auditId)).filter((i) => i.status === "Active")
  : [];
const audit = auditRow
  ? {
      auditId: auditRow.auditId,
      status: auditRow.status,
      frontPhotoUrl: auditRow.frontPhotoUrl,
      firePlanPhotoUrl: auditRow.firePlanPhotoUrl,
      basPhotoUrl: auditRow.basPhotoUrl,
      basNotes: auditRow.basNotes,
      walkInCount: auditItems.filter((i) => i.itemType === "Walk-In").length,
      thermostatCount: auditItems.filter((i) => i.itemType === "Thermostat").length,
      waterSourceCount: auditItems.filter((i) => i.itemType === "Water-Source").length,
    }
  : null;
```

Add `audit` to the pushed `CustomerReportJob` object.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add lib/customer-report.ts
git commit -m "Audit: include audit summary + counts on per-job customer report data"
```

---

### Task 24: Render audit section in the customer-report PDF

**Files:**
- Modify: `lib/customer-report-pdf.ts`

- [ ] **Step 1: Pull audit photos into the image-fetch map**

In `buildImageMap` (lib/customer-report-pdf.ts), add audit photos to the set. Reuse the existing `extractDriveFileId` helper from `@/lib/utils` (already imported in similar files). At the top of `lib/customer-report-pdf.ts`, ensure the import exists:

```ts
import { extractDriveFileId } from "@/lib/utils";
```

Then inside the existing `buildImageMap` loop:

```ts
for (const rj of report.jobs) {
  // ... existing fileId collection ...
  if (rj.audit) {
    const a = rj.audit;
    for (const url of [a.frontPhotoUrl, a.firePlanPhotoUrl, a.basPhotoUrl]) {
      const id = extractDriveFileId(url);
      if (id) ids.add(id);
    }
  }
}
```

- [ ] **Step 2: Render an audit subsection after each job's unit table**

In `renderJobSection` (or wherever per-job rendering ends in `buildCustomerReportPdf`), add at the end of the per-job block:

```ts
if (rj.audit) {
  ensureRoom(doc, 80);
  doc
    .fillColor(NAVY)
    .font("Helvetica-Bold")
    .fontSize(10)
    .text(`Energy audit · ${rj.audit.status}`, MARGIN, doc.y);
  doc.y += 14;
  doc
    .fillColor(MUTED)
    .font("Helvetica")
    .fontSize(8.5)
    .text(
      `Walk-Ins ${rj.audit.walkInCount}  ·  Thermostats ${rj.audit.thermostatCount}  ·  Water-source ${rj.audit.waterSourceCount}`,
      MARGIN,
      doc.y,
      { width: CONTENT_W }
    );
  doc.y += 12;

  // Building photos in a row (up to 3 thumbnails).
  const buildingPhotos = [
    { label: "Front", url: rj.audit.frontPhotoUrl },
    { label: "Fire plan", url: rj.audit.firePlanPhotoUrl },
    { label: "BAS", url: rj.audit.basPhotoUrl },
  ].filter((p) => p.url);
  if (buildingPhotos.length > 0) {
    const cols = 3;
    const gap = 6;
    const thumbW = (CONTENT_W - gap * (cols - 1)) / cols;
    const thumbH = thumbW * 0.72;
    ensureRoom(doc, thumbH + 18);
    const startY = doc.y;
    buildingPhotos.forEach((p, i) => {
      const x = MARGIN + i * (thumbW + gap);
      const id = extractDriveFileId(p.url);
      const img = id ? images.get(id) : undefined;
      if (img) {
        try {
          doc.image(img, x, startY, { fit: [thumbW, thumbH], align: "center", valign: "center" });
        } catch {}
      }
      doc
        .roundedRect(x, startY, thumbW, thumbH, 3)
        .lineWidth(0.5)
        .strokeColor(LIGHT)
        .stroke();
      doc
        .fillColor(MUTED)
        .font("Helvetica")
        .fontSize(7)
        .text(p.label, x, startY + thumbH + 1, { width: thumbW, align: "center" });
    });
    doc.y = startY + thumbH + 14;
  }
  if (rj.audit.basNotes) {
    ensureRoom(doc, 28);
    doc
      .fillColor(MUTED)
      .font("Helvetica-Oblique")
      .fontSize(8)
      .text(`BAS note: ${rj.audit.basNotes}`, MARGIN, doc.y, { width: CONTENT_W });
    doc.y += 14;
  }
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Smoke-test the PDF**

Log in as admin. Navigate to a customer who has at least one audit row, click "Customer report (PDF)". Confirm the audit subsection appears under that job's section with the building photo strip and item counts.

- [ ] **Step 5: Commit**

```bash
git add lib/customer-report-pdf.ts
git commit -m "Audit: include audit subsection in customer report PDF (counts + building strip)"
```

---

## Phase 8 — Final regression pass + push (1 task)

### Task 25: Full regression + push

**Files:** none (final verification)

- [ ] **Step 1: Run full static gate**

```bash
npm run build
```

Expected: build succeeds, all new routes appear:
- `ƒ /api/audits`
- `ƒ /api/audits/[auditId]`
- `ƒ /api/audits/[auditId]/complete`
- `ƒ /api/audits/[auditId]/reopen`
- `ƒ /api/audit-items`
- `ƒ /api/audit-items/[itemId]`
- `ƒ /api/jobs/[jobId]/complete`
- `ƒ /api/jobs/[jobId]/reopen`
- `ƒ /api/admin/dispatches/[dispatchId]/finalize`
- `ƒ /jobs/[jobId]/audit`

And the cron route should be **absent**: no entry for `/api/cron/finalize-stale-dispatches`.

- [ ] **Step 2: Live deployment smoke**

After Kevin gives the OK to push:
```bash
git push
```

Then smoke the auth gates:
```bash
curl -sS -o /dev/null -w "audits:%{http_code} items:" https://ms-eapp.vercel.app/api/audits && \
curl -sS -o /dev/null -w "%{http_code} complete:" https://ms-eapp.vercel.app/api/audits/AUD-FAKE/complete && \
curl -sS -o /dev/null -w "%{http_code}\n" https://ms-eapp.vercel.app/api/jobs/JOB-FAKE/complete
```

Expected: each returns `401` (route exists + guard fires). Failure to 401 means the route isn't deployed yet.

- [ ] **Step 3: End-to-end smoke in browser**

Log in as a tech. Open a job. Tap Complete Audit. Walk through a Building photo + a Walk-In with 3 photos. Leave the page, return — data persists. Tap Audit Complete; status flips to Complete. Tap Reopen. Tap Job Complete; row appears in the next pay attribution preview on the admin commission report. Tap Reopen.

- [ ] **Step 4: Memory update**

Add a memory entry recording the design decisions (cron removed, explicit Job Complete, etc.) so future sessions have context.

```bash
# (run from outside the repo — memory dir is in ~/.claude)
```

- [ ] **Step 5: Final commit if regression touched anything**

If steps 1–3 surfaced any fixups, commit them with a clear message. Then a final `git log --oneline -25` review for the spec's "Acceptance / done criteria" list.

---

## Notes for the implementer

- **Frequent commits.** Each task ends in a commit. Don't batch.
- **Don't push.** Kevin's standing memory rule. Push only on his explicit "go push it" or after Task 25.
- **No Co-Authored-By Claude in commit messages.** Standing memory rule.
- **The PDFKit standalone build wants ArrayBuffer, not Buffer**, for `doc.image()`. The pattern is in `lib/payroll-pdf.ts:fetchNameplate` and `lib/customer-report-pdf.ts:fetchDriveImage`. Reuse the magic-byte JPEG/PNG check.
- **Sheets auto-expands columns** on `updateCell` writes past the current header range, so adding column S without re-seeding is fine — but the cosmetic header gap is real. Run `init-audit-tabs.mjs --apply` for the two new tabs; the existing tabs already have the right headers stamped earlier (see commit `715c48b`).
- **iOS Safari stable-slot rule** (memory `project_mse_field_photo_slots`): when rendering dynamic photo grids, every slot must use the same element type with the same wrappers. `AuditPhotoSlot` follows this pattern by holding a single `<input>` element across renders.
