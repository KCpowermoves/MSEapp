#!/usr/bin/env node
// Seeds 7 weeks of realistic sample data (Jun 1 – Jul 16, 2026) for
// testing the weekly close workflow. Run AFTER reset-data.mjs --apply.
//
// Uses the real active tech roster (comp plans in the Techs tab apply)
// with clearly-fake customers. Deliberately includes every worklist
// scenario: clean jobs, missing photos, $0 pay, an unsubmitted draft,
// an incomplete audit, a schedule-required audit never started, a
// multi-week project, self-sold sales bonuses, and client-paid jobs so
// the releases board has real entries.
//
// Photo URLs reuse real Drive files (photos survive the reset), so
// images actually render in the app.
//
// Idempotent-ish: refuses to run if the Jobs tab already has rows.
//
// Usage: node scripts/seed-sample-data.mjs

import { google } from "googleapis";
import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "..", ".env.local") });

const required = (k) => {
  const v = process.env[k];
  if (!v) {
    console.error(`Missing env var: ${k}`);
    process.exit(1);
  }
  return v;
};

const SHEET_ID = required("GOOGLE_SHEET_ID");
const auth = new google.auth.JWT({
  email: required("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
  key: required("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY").replace(/\\n/g, "\n"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

// ─── Real Drive photos that survived the reset ──────────────────────
const PHOTOS = [
  "https://drive.google.com/file/d/1QcyYU8So3rmaRNRC_C7VXRfEqqbf6Tny/view?usp=drivesdk",
  "https://drive.google.com/file/d/1idbhxUNBfKhwjCEagpEsy_yRmFzQ-cu4/view?usp=drivesdk",
  "https://drive.google.com/file/d/1W_c3GoF-PMxqzSfZwsf8i05dVtWpWhtp/view?usp=drivesdk",
  "https://drive.google.com/file/d/1ZetAMkyJkeLizXSLSPC5w0o-WFjkI5bK/view?usp=drivesdk",
  "https://drive.google.com/file/d/1u02z5s3ppXKewa482DvM7uShlGf5HbNv/view?usp=drivesdk",
  "https://drive.google.com/file/d/1iwuN9dxMZ1ayPkDedAatSl3KsiF5Fq2V/view?usp=drivesdk",
  "https://drive.google.com/file/d/1f2uheQqD9__do2WV9j1QIxq3V7RcGGMc/view?usp=drivesdk",
  "https://drive.google.com/file/d/1Qg2C_alyQi7unqrhMSF1nxLd12avyDs1/view?usp=drivesdk",
];
let photoIdx = 0;
const nextPhoto = () => PHOTOS[photoIdx++ % PHOTOS.length];

// ─── Pay rates (mirror lib/pay-rates.ts) ─────────────────────────────
const INSTALL_PAY = { "PTAC / Ductless": 10, "RTU-S": 50, "RTU-M": 75, "RTU-L": 100 };
const SALES_BONUS = { "PTAC / Ductless": 5, "RTU-S": 25, "RTU-M": 35, "RTU-L": 50 };

// Real active field techs — comp plans already live in the Techs tab:
// Dante W. + Jamal W. full-upfront, Ivan P draw $1000, Stephen S. +
// Warren R. default 50/50.
const T = {
  dante: "Dante W.",
  jamal: "Jamal W.",
  ivan: "Ivan P",
  stephen: "Stephen S.",
  warren: "Warren R.",
};

// ─── Job definitions ────────────────────────────────────────────────
// week = Monday ISO. Each dispatch: date, techs, split, units
// (count/type), flags for the deliberate problem scenarios.
const JOBS = [
  // Week Jun 1 — clean history, clients paid
  {
    id: 1, customer: "Harborview Apartments (SAMPLE)", address: "1200 Harbor Ct, Baltimore MD",
    territory: "BGE", createdOn: "2026-06-01", status: "Closed",
    clientPaidAt: "2026-06-18T14:00:00.000Z",
    dispatches: [
      { date: "2026-06-01", techs: [T.dante, T.jamal], split: "50-50", units: { n: 14, type: "PTAC / Ductless" } },
      { date: "2026-06-02", techs: [T.dante, T.jamal], split: "50-50", units: { n: 12, type: "PTAC / Ductless" } },
    ],
  },
  {
    id: 2, customer: "Chesapeake Senior Living (SAMPLE)", address: "44 Bayview Dr, Annapolis MD",
    territory: "BGE", createdOn: "2026-06-03", status: "Closed",
    clientPaidAt: "2026-06-22T15:30:00.000Z",
    dispatches: [
      { date: "2026-06-04", techs: [T.ivan, T.stephen], split: "50-50", units: { n: 16, type: "PTAC / Ductless" } },
    ],
  },
  // Week Jun 8 — clean, one self-sold, clients paid
  {
    id: 3, customer: "Bayside Office Park (SAMPLE)", address: "800 Commerce Blvd, Dundalk MD",
    territory: "BGE", createdOn: "2026-06-08", status: "Closed",
    clientPaidAt: "2026-06-30T16:00:00.000Z",
    dispatches: [
      { date: "2026-06-09", techs: [T.warren, T.stephen], split: "50-50", units: { n: 3, type: "RTU-M" } },
      { date: "2026-06-10", techs: [T.warren, T.stephen], split: "50-50", units: { n: 2, type: "RTU-L" } },
    ],
  },
  {
    id: 4, customer: "Patterson Deli (SAMPLE)", address: "2711 Eastern Ave, Baltimore MD",
    territory: "BGE", createdOn: "2026-06-10", status: "Closed",
    selfSold: true, soldBy: T.dante,
    clientPaidAt: "2026-06-25T13:00:00.000Z",
    dispatches: [
      { date: "2026-06-11", techs: [T.dante], split: "Solo", units: { n: 8, type: "PTAC / Ductless" } },
    ],
  },
  // Week Jun 15 — one clean-but-unpaid, one MISSING PHOTOS + audit started
  {
    id: 5, customer: "Monument Square Hotel (SAMPLE)", address: "5 Monument Sq, Baltimore MD",
    territory: "Pepco", createdOn: "2026-06-15", status: "Closed",
    dispatches: [
      { date: "2026-06-16", techs: [T.dante, T.jamal, T.stephen], split: "33-33-33", units: { n: 18, type: "PTAC / Ductless" } },
      { date: "2026-06-17", techs: [T.dante, T.jamal, T.stephen], split: "33-33-33", units: { n: 15, type: "PTAC / Ductless" } },
    ],
  },
  {
    id: 6, customer: "Riverside Laundromat (SAMPLE)", address: "310 Light St, Baltimore MD",
    territory: "BGE", createdOn: "2026-06-17", status: "Closed",
    auditDraft: true, // audit started, never completed
    dispatches: [
      { date: "2026-06-18", techs: [T.ivan], split: "Solo", units: { n: 8, type: "PTAC / Ductless", missingPhotos: 2 } },
    ],
  },
  // Week Jun 22 — multi-week project part 1 + clean paid job
  {
    id: 7, customer: "Lakefront Community Center (SAMPLE)", address: "90 Lakefront Pkwy, Columbia MD",
    territory: "BGE", createdOn: "2026-06-22", status: "Closed",
    dispatches: [
      { date: "2026-06-23", techs: [T.warren, T.jamal], split: "50-50", units: { n: 3, type: "RTU-M" } },
      // part 2 lands in the following week WITH missing photos — tests
      // the multi-week re-flag behavior
      { date: "2026-07-01", techs: [T.warren, T.jamal], split: "50-50", units: { n: 3, type: "RTU-M", missingPhotos: 1 } },
    ],
  },
  {
    id: 8, customer: "Eastpoint Retail Group (SAMPLE)", address: "7839 Eastpoint Mall, Baltimore MD",
    territory: "BGE", createdOn: "2026-06-24", status: "Closed",
    clientPaidAt: "2026-07-08T14:00:00.000Z",
    dispatches: [
      { date: "2026-06-25", techs: [T.stephen, T.dante], split: "50-50", units: { n: 13, type: "PTAC / Ductless" } },
    ],
  },
  // Week Jun 29 — $0-pay dispatch + clean paid job
  {
    id: 9, customer: "Cornerstone Church (SAMPLE)", address: "1400 Gorsuch Ave, Baltimore MD",
    territory: "BGE", createdOn: "2026-06-29", status: "Closed",
    dispatches: [
      // Crew arrived, equipment inaccessible, submitted with no units
      { date: "2026-06-30", techs: [T.ivan, T.warren], split: "50-50", units: { n: 0, type: "PTAC / Ductless" } },
    ],
  },
  {
    id: 10, customer: "Southgate Diner (SAMPLE)", address: "6900 Ritchie Hwy, Glen Burnie MD",
    territory: "BGE", createdOn: "2026-07-01", status: "Closed",
    clientPaidAt: "2026-07-14T15:00:00.000Z",
    dispatches: [
      { date: "2026-07-02", techs: [T.ivan, T.warren], split: "50-50", units: { n: 11, type: "PTAC / Ductless" } },
    ],
  },
  // Week Jul 6 — the close-target week: one clean, one UNSUBMITTED +
  // schedule-required audit never started
  {
    id: 11, customer: "Northwood Medical Plaza (SAMPLE)", address: "2200 Loch Raven Rd, Towson MD",
    territory: "BGE", createdOn: "2026-07-06", status: "Closed",
    dispatches: [
      { date: "2026-07-07", techs: [T.dante, T.jamal, T.stephen], split: "33-33-33", units: { n: 16, type: "PTAC / Ductless" } },
      { date: "2026-07-08", techs: [T.dante, T.jamal, T.stephen], split: "33-33-33", units: { n: 12, type: "PTAC / Ductless" } },
    ],
  },
  {
    id: 12, customer: "Fallsway Auto Group (SAMPLE)", address: "2100 Fallsway, Baltimore MD",
    territory: "BGE", createdOn: "2026-07-08", status: "Active",
    scheduledAuditVisit: "2026-07-09", // visit required an audit; never started
    dispatches: [
      // Never submitted — the tech logged units and walked away
      { date: "2026-07-09", techs: [T.ivan], split: "Solo", units: { n: 10, type: "PTAC / Ductless" }, unsubmitted: true },
    ],
  },
  // Week Jul 13 (current) — one clean, one live draft from today
  {
    id: 13, customer: "Meridian Business Center (SAMPLE)", address: "400 Redland Ct, Owings Mills MD",
    territory: "BGE", createdOn: "2026-07-13", status: "Active",
    dispatches: [
      { date: "2026-07-14", techs: [T.warren, T.stephen], split: "50-50", units: { n: 12, type: "PTAC / Ductless" } },
    ],
  },
  {
    id: 14, customer: "Glenn Heights HOA (SAMPLE)", address: "12 Glenn Heights Way, Ellicott City MD",
    territory: "BGE", createdOn: "2026-07-16", status: "Active",
    dispatches: [
      // Today's open draft — live work, must NOT flag on the worklist
      { date: "2026-07-16", techs: [T.dante, T.jamal], split: "50-50", units: { n: 5, type: "PTAC / Ductless" }, unsubmitted: true, liveToday: true },
    ],
  },
];

// ─── Row builders ────────────────────────────────────────────────────
const pad = (n, w = 4) => String(n).padStart(w, "0");
const crewSize = (s) => (s === "33-33-33" ? 3 : s === "50-50" ? 2 : 1);

const jobRows = [];
const dispatchRows = [];
const unitRows = [];
const attribRows = [];
const auditRows = [];
const scheduleRows = [];

let dispatchNum = 0;
let unitNum = 0;
let auditNum = 0;

for (const j of JOBS) {
  const jobId = `JOB-2026-${pad(j.id)}`;
  const createdIso = `${j.createdOn}T12:00:00.000Z`;
  const lastDate = j.dispatches[j.dispatches.length - 1].date;

  jobRows.push([
    jobId, createdIso, `${lastDate}T21:00:00.000Z`,
    j.customer, j.address, j.territory, j.status,
    j.selfSold ? "TRUE" : "FALSE", j.selfSold ? j.soldBy : "",
    "", "", // Drive folder URL/ID — sample jobs have no folder
    "Kevin C.", "Sample data", "", "",
    j.clientPaidAt ?? "", j.clientPaidAt ? "Kevin C." : "",
    "", "", "", // R/S/T finalize stamp empty
  ]);

  if (j.auditDraft) {
    auditRows.push([
      `AUDIT-2026-${pad(++auditNum)}`, jobId, "Draft",
      createdIso, T.ivan, createdIso, "", "",
      nextPhoto(), "", "", "", "Sample: started on site, never finished",
    ]);
  }
  if (j.scheduledAuditVisit) {
    scheduleRows.push([
      `SCHED-2026-${pad(1)}`, jobId, j.scheduledAuditVisit, "09:00", 120,
      T.ivan, "Sample visit — audit was required", "Scheduled",
      "Kevin C.", createdIso, "", "", 10, "TRUE",
    ]);
  }

  for (const d of j.dispatches) {
    const dispatchId = `DSP-2026-${pad(++dispatchNum)}`;
    const size = crewSize(d.split);
    const missing = d.units.missingPhotos ?? 0;
    const photosComplete = d.units.n > 0 && missing === 0;
    const submittedAt = d.unsubmitted ? "" : `${d.date}T21:30:00.000Z`;

    dispatchRows.push([
      dispatchId, jobId, d.date, d.techs.join(", "), d.split,
      d.techs[0], 0, 0, photosComplete ? "TRUE" : "FALSE", submittedAt,
      "", "", "", "", 0, "", "", "FALSE",
    ]);

    // Units — RTUs need 7 photo slots, PTACs need 3. The last `missing`
    // units get their post/after photos left blank.
    for (let u = 1; u <= d.units.n; u++) {
      const unitId = `UNIT-2026-${pad(++unitNum, 5)}`;
      const isMissing = u > d.units.n - missing;
      const isRtu = d.units.type.startsWith("RTU");
      // Columns G-N: pre1, pre2, pre3, post1, post2, post3, nameplate, filter
      const photos = isRtu
        ? [nextPhoto(), nextPhoto(), isMissing ? "" : nextPhoto(), isMissing ? "" : nextPhoto(), isMissing ? "" : nextPhoto(), "", nextPhoto(), nextPhoto()]
        : [nextPhoto(), isMissing ? "" : nextPhoto(), "", "", "", "", nextPhoto(), ""];
      unitRows.push([
        unitId, dispatchId, jobId, u, d.units.type, "",
        ...photos, "",
        "Carrier", `52CQ${300 + u}`, `SN${d.date.replaceAll("-", "")}${pad(u, 3)}`,
        "", d.techs[0], `${d.date}T18:00:00.000Z`,
        "", "", "", "", "FALSE",
      ]);
    }

    // Pay attribution — written only for submitted dispatches, exactly
    // like submitDispatch would have.
    if (!d.unsubmitted && d.units.n > 0) {
      let i = 1;
      const installPerTech = INSTALL_PAY[d.units.type] / size;
      for (let u = 1; u <= d.units.n; u++) {
        for (const t of d.techs) {
          attribRows.push([
            `ATTR-${dispatchId}-${pad(i++, 3)}`, d.date, dispatchId, t,
            "Install", installPerTech,
            `Unit-${pad(u, 3)} ${d.units.type} (${d.split})`,
          ]);
        }
        if (j.selfSold && j.soldBy) {
          const bonus = SALES_BONUS[d.units.type];
          attribRows.push([
            `ATTR-${dispatchId}-${pad(i++, 3)}`, d.date, dispatchId, j.soldBy,
            "Sales (paid)", bonus * 0.5,
            `Unit-${pad(u, 3)} ${d.units.type} on self-sold job (50% paid)`,
          ]);
          attribRows.push([
            `ATTR-${dispatchId}-${pad(i++, 3)}`, d.date, dispatchId, j.soldBy,
            "Sales (pending)", bonus * 0.5,
            `Unit-${pad(u, 3)} ${d.units.type} on self-sold job (50% pending utility reimbursement)`,
          ]);
        }
      }
    }
  }
}

// ─── Write ───────────────────────────────────────────────────────────
async function appendAll(tab, rows) {
  if (rows.length === 0) return;
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${tab}!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: rows },
  });
  console.log(`  ${tab}: ${rows.length} rows`);
}

// Guard: refuse to seed on top of existing data.
const existing = await sheets.spreadsheets.values.get({
  spreadsheetId: SHEET_ID,
  range: "Jobs!A2:A",
});
if ((existing.data.values ?? []).filter((r) => r[0]).length > 0) {
  console.error("Jobs tab is not empty — run reset-data.mjs --apply first.");
  process.exit(1);
}

console.log("Seeding sample data (Jun 1 – Jul 16, 2026)…");
await appendAll("Jobs", jobRows);
await appendAll("Dispatches", dispatchRows);
await appendAll("Units Serviced", unitRows);
await appendAll("Pay Attribution", attribRows);
await appendAll("Audits", auditRows);
await appendAll("Schedule", scheduleRows);

console.log(`\nDone. ${jobRows.length} jobs, ${dispatchRows.length} dispatches, ${unitRows.length} units, ${attribRows.length} attribution rows.`);
console.log("\nNext: trigger the weekly-period cron to backfill Mon–Sun periods:");
console.log('  curl -A "vercel-cron/1.0" "https://ms-eapp.vercel.app/api/cron/weekly-period?anchor=2026-07-15"');
