#!/usr/bin/env node
// Initialize the MSE Field Operations Google Sheet.
// Idempotent — safe to re-run. Creates missing tabs, sets headers, data
// validation, Pay Rates constants, and Pay Calc formulas.
//
// Run: npm run seed

import { google } from "googleapis";
import { config } from "dotenv";

config({ path: ".env.local" });

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

const TABS = [
  {
    name: "Techs",
    headers: ["Tech ID", "Name", "PIN Hash", "Active", "Phone"],
    validations: [
      { col: "D", values: ["TRUE", "FALSE"] },
    ],
    frozenRows: 1,
  },
  {
    name: "Jobs",
    headers: [
      "Job ID",
      "Created Date",
      "Last Activity Date",
      "Customer Name",
      "Site Address",
      "Utility Territory",
      "Status",
      "Self-Sold",
      "Sold By",
      "Drive Folder URL",
      "Drive Folder ID",
      "Created By",
      "Notes",
    ],
    validations: [
      { col: "F", values: ["BGE", "PEPCO", "Delmarva", "SMECO"] },
      { col: "G", values: ["Active", "Closed"] },
      { col: "H", values: ["TRUE", "FALSE"] },
    ],
    frozenRows: 1,
  },
  {
    name: "Dispatches",
    headers: [
      "Dispatch ID",
      "Job ID",
      "Dispatch Date",
      "Techs On Site",
      "Crew Split",
      "Driver",
      "Daily Driving Stipend",
      "Travel Dispatch Bonus",
      "Photos Complete",
      "Submitted At",
    ],
    validations: [
      { col: "E", values: ["Solo", "50-50", "33-33-33"] },
      { col: "I", values: ["TRUE", "FALSE"] },
    ],
    frozenRows: 1,
  },
  {
    name: "Units Serviced",
    headers: [
      "Unit ID",
      "Dispatch ID",
      "Job ID",
      "Unit Number on Job",
      "Unit Type",
      "Unit Sub-type",
      "Pre Photo URL",
      "Post Photo URL",
      "Clean Photo URL",
      "Nameplate Photo URL",
      "Filter Photo URL",
      "Make",
      "Model",
      "Serial",
      "Notes",
      "Logged By",
      "Logged At",
    ],
    validations: [
      { col: "E", values: ["PTAC", "Standard 3-20", "Mid-Large 20-50", "Large 50+"] },
      { col: "F", values: ["Standard tune-up", "Water-source heat pump", "VRV-VRF", "Other building tune-up"] },
    ],
    frozenRows: 1,
  },
  {
    name: "Additional Services",
    headers: [
      "Service ID",
      "Dispatch ID",
      "Job ID",
      "Service Type",
      "Quantity",
      "Photo URLs",
      "Notes",
      "Logged By",
      "Logged At",
    ],
    validations: [
      { col: "D", values: ["Thermostat (regular)", "Thermostat (scheduled)", "Endo Cube"] },
    ],
    frozenRows: 1,
  },
  {
    name: "Pay Attribution",
    headers: [
      "Attribution ID",
      "Dispatch Date",
      "Dispatch ID",
      "Tech Name",
      "Line Item",
      "Amount",
      "Notes",
    ],
    validations: [
      { col: "E", values: ["Install", "Sales (paid)", "Sales (pending)", "Service", "Daily Stipend", "Travel Bonus"] },
    ],
    frozenRows: 1,
  },
  {
    name: "Pay Rates",
    headers: ["Category", "Item", "Amount", "Notes"],
    validations: [],
    frozenRows: 1,
  },
  {
    name: "Pay Calc",
    headers: [],
    validations: [],
    frozenRows: 3,
  },
];

const PAY_RATES_DATA = [
  ["Install Pay", "PTAC", 10, "under 3 tons / hotels"],
  ["Install Pay", "Standard 3-20", 50, "3-20 tons"],
  ["Install Pay", "Mid-Large 20-50", 75, "20-50 tons"],
  ["Install Pay", "Large 50+", 100, "50+ tons"],
  ["Sales Bonus", "PTAC", 5, "100% to Sold By tech"],
  ["Sales Bonus", "Standard 3-20", 30, "100% to Sold By tech"],
  ["Sales Bonus", "Mid-Large 20-50", 50, "100% to Sold By tech"],
  ["Sales Bonus", "Large 50+", 75, "100% to Sold By tech"],
  ["Sales Bonus Split", "Paid Now", 0.5, "50% paid on dispatch submit"],
  ["Sales Bonus Split", "Pending", 0.5, "50% paid after utility reimbursement"],
  ["Service Pay", "Thermostat (regular)", 25, "during regular HVAC visit"],
  ["Service Pay", "Thermostat (scheduled)", 30, "scheduling required"],
  ["Service Pay", "Endo Cube", 20, "per unit"],
  ["Crew Size", "Solo", 1, ""],
  ["Crew Size", "50-50", 2, ""],
  ["Crew Size", "33-33-33", 3, ""],
  ["Driving", "Daily Stipend", 10, "per dispatch day with Photos Complete"],
  ["Driving", "Travel Bonus", 40, "Delmarva/SMECO; 100% to Driver"],
];

async function getSheetMeta() {
  const res = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: "sheets.properties" });
  return res.data.sheets ?? [];
}

function findSheet(meta, name) {
  return meta.find((s) => s.properties?.title === name) ?? null;
}

async function ensureTab(meta, tab) {
  const existing = findSheet(meta, tab.name);
  if (existing) return existing.properties.sheetId;
  const res = await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: { title: tab.name, gridProperties: { frozenRowCount: tab.frozenRows } },
          },
        },
      ],
    },
  });
  return res.data.replies[0].addSheet.properties.sheetId;
}

async function setHeaders(tab) {
  if (!tab.headers.length) return;
  // Pad row 1 out to column Z so any stale headers from older schemas
  // get blanked out when columns are removed.
  const padded = [...tab.headers];
  while (padded.length < 26) padded.push("");
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${tab.name}!A1:Z1`,
    valueInputOption: "RAW",
    requestBody: { values: [padded] },
  });
}

async function setHeaderFormatting(sheetId, headerCount) {
  if (!headerCount) return;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 0,
              endRowIndex: 1,
              startColumnIndex: 0,
              endColumnIndex: headerCount,
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.10, green: 0.14, blue: 0.20 },
                textFormat: {
                  foregroundColor: { red: 1, green: 1, blue: 1 },
                  bold: true,
                  fontFamily: "Inter",
                },
                horizontalAlignment: "LEFT",
              },
            },
            fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
          },
        },
      ],
    },
  });
}

function colLetterToIndex(letter) {
  return letter.charCodeAt(0) - "A".charCodeAt(0);
}

async function setDataValidation(sheetId, validations) {
  if (!validations.length) return;
  const requests = validations.map((v) => ({
    setDataValidation: {
      range: {
        sheetId,
        startRowIndex: 1,
        startColumnIndex: colLetterToIndex(v.col),
        endColumnIndex: colLetterToIndex(v.col) + 1,
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
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests } });
}

async function setPayRatesData() {
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: "Pay Rates!A2",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: PAY_RATES_DATA },
  });
}

async function setPayCalcLayout(sheetId) {
  // Row 1: pay-period filter inputs
  // Row 3: column headers
  // Rows 4-13: tech rows (up to 10 active techs supported by default)
  const periodHeader = [
    [
      "Pay Period Start",
      "=DATE(YEAR(TODAY()), MONTH(TODAY()), DAY(TODAY()) - WEEKDAY(TODAY(), 2) + 1 - 7)",
      "Pay Period End",
      "=DATE(YEAR(TODAY()), MONTH(TODAY()), DAY(TODAY()) - WEEKDAY(TODAY(), 2))",
    ],
  ];
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: "Pay Calc!A1",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: periodHeader },
  });

  const colHeaders = [
    [
      "Tech",
      "Install Pay",
      "Sales (paid)",
      "Sales (pending)",
      "Service Pay",
      "Daily Stipend",
      "Travel Bonus",
      "Total",
    ],
  ];
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: "Pay Calc!A3:Z3",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[...colHeaders[0], "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]] },
  });

  const rows = [];
  for (let i = 0; i < 10; i++) {
    const r = i + 4;
    const techRef = `IFERROR(INDEX(FILTER(Techs!B:B, Techs!D:D=TRUE), ${i + 1}), "")`;
    const sumifs = (lineItem) =>
      `=IF($A${r}="", "", SUMIFS('Pay Attribution'!F:F, 'Pay Attribution'!D:D, $A${r}, 'Pay Attribution'!E:E, "${lineItem}", 'Pay Attribution'!B:B, ">="&$B$1, 'Pay Attribution'!B:B, "<="&$D$1))`;
    rows.push([
      `=${techRef}`,
      sumifs("Install"),
      sumifs("Sales (paid)"),
      sumifs("Sales (pending)"),
      sumifs("Service"),
      sumifs("Daily Stipend"),
      sumifs("Travel Bonus"),
      `=IF($A${r}="", "", SUM(B${r}:G${r}))`,
      "",
    ]);
  }
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: "Pay Calc!A4:I13",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: rows },
  });

  // Format the header row 3
  await setHeaderFormatting(sheetId, 8);
  // Bold + light gray for the period filter row
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 4 },
            cell: { userEnteredFormat: { backgroundColor: { red: 0.96, green: 0.96, blue: 0.96 }, textFormat: { bold: true } } },
            fields: "userEnteredFormat(backgroundColor,textFormat)",
          },
        },
        {
          updateSheetProperties: {
            properties: { sheetId, gridProperties: { frozenRowCount: 3 } },
            fields: "gridProperties.frozenRowCount",
          },
        },
      ],
    },
  });
}

async function setColumnWidths(sheetId, widths) {
  const requests = widths.map(([col, px]) => ({
    updateDimensionProperties: {
      range: { sheetId, dimension: "COLUMNS", startIndex: colLetterToIndex(col), endIndex: colLetterToIndex(col) + 1 },
      properties: { pixelSize: px },
      fields: "pixelSize",
    },
  }));
  if (!requests.length) return;
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests } });
}

async function setHyperlinkFormat(sheetId, col) {
  const idx = colLetterToIndex(col);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 1, startColumnIndex: idx, endColumnIndex: idx + 1 },
            cell: { userEnteredFormat: { textFormat: { foregroundColor: { red: 0.0, green: 0.4, blue: 0.85 }, underline: true } } },
            fields: "userEnteredFormat(textFormat)",
          },
        },
      ],
    },
  });
}

async function main() {
  console.log(`Seeding Sheet: ${SHEET_ID}\n`);

  let meta = await getSheetMeta();

  for (const tab of TABS) {
    process.stdout.write(`Tab "${tab.name}": `);
    const sheetId = await ensureTab(meta, tab);
    await setHeaders(tab);
    await setHeaderFormatting(sheetId, tab.headers.length);
    await setDataValidation(sheetId, tab.validations);
    console.log("ok");
  }

  // Refresh meta after potential tab creation
  meta = await getSheetMeta();
  const findId = (n) => meta.find((s) => s.properties?.title === n)?.properties?.sheetId;

  console.log("\nWriting Pay Rates data...");
  await setPayRatesData();

  console.log("Writing Pay Calc layout + formulas...");
  await setPayCalcLayout(findId("Pay Calc"));

  console.log("Setting column widths + link styling...");
  await setColumnWidths(findId("Jobs"), [
    ["A", 130],
    ["B", 160],
    ["C", 160],
    ["D", 200],
    ["E", 280],
    ["F", 100],
    ["H", 240],
  ]);
  await setHyperlinkFormat(findId("Jobs"), "H");
  await setColumnWidths(findId("Units Serviced"), [
    ["I", 200],
    ["J", 200],
    ["K", 200],
    ["L", 200],
    ["M", 200],
  ]);
  for (const c of ["I", "J", "K", "L", "M"]) {
    await setHyperlinkFormat(findId("Units Serviced"), c);
  }

  // Hide the Pay Attribution tab so admins focus on Pay Calc
  const payAttrId = findId("Pay Attribution");
  if (payAttrId !== undefined) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        requests: [
          {
            updateSheetProperties: {
              properties: { sheetId: payAttrId, hidden: true },
              fields: "hidden",
            },
          },
        ],
      },
    });
  }

  console.log("\nSeed complete.");
  console.log("\nNext steps:");
  console.log("  1. Open the Sheet and verify all tabs exist with correct headers.");
  console.log("  2. Add tech rows to the Techs tab (use scripts/add-tech.mjs to hash PINs).");
  console.log("  3. Run: npm run test:google");
}

main().catch((e) => {
  console.error("\nFAILED:", e.message);
  if (e.errors) console.error(e.errors);
  process.exit(1);
});
