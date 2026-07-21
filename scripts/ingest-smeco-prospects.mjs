#!/usr/bin/env node
// One-off: load the Master SMECO Small Business CSV straight into the
// Prospects tab (bypasses the web upload + Vercel body limit). Maps the
// known columns, tags utility=SMECO and list "SMECO Small Business".
//
// Usage: node scripts/ingest-smeco-prospects.mjs

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import { config } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "..", ".env.local") });

const SRC = "C:/Users/kevin/Downloads/Master Smeco Small Business Sheet - Sheet1.csv";
const LIST_NAME = "SMECO Small Business";
const IMPORTED_BY = "Kevin C.";

const auth = new google.auth.JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });
const SHEET_ID = process.env.GOOGLE_SHEET_ID;

// --- CSV parse (quoted fields, CRLF) ---
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", q = false;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c === "\r") { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const raw = parseCsv(fs.readFileSync(SRC, "utf8")).filter((r) => r.some((c) => c.trim()));
const header = raw[0].map((h) => h.trim().toLowerCase());
const col = (name) => header.indexOf(name);
const iBiz = col("primary customer full name");
const iAddr = col("service address line 1");
const iCity = col("service city");
const iZip = col("service zip code");
const iPhone1 = col("phone 1");
const iPhone2 = col("phone 2");
const iEmail = col("email");
const iAcct = col("account number");
console.log("columns:", { iBiz, iAddr, iCity, iZip, iPhone1, iEmail, iAcct });
if (iBiz < 0) { console.error("no business column found"); process.exit(1); }

// --- Next PROS id ---
const existing = await sheets.spreadsheets.values.get({
  spreadsheetId: SHEET_ID, range: "Prospects!A2:A",
});
let maxN = 0;
for (const r of existing.data.values ?? []) {
  const m = String(r[0] ?? "").match(/^PROS-\d{4}-(\d+)$/);
  if (m) maxN = Math.max(maxN, Number(m[1]));
}
const year = new Date().getFullYear();
let n = maxN + 1;
const importedAt = new Date().toISOString();
const get = (r, i) => (i >= 0 ? String(r[i] ?? "").trim() : "");

const rows = [];
let skipped = 0;
for (let i = 1; i < raw.length; i++) {
  const r = raw[i];
  const biz = get(r, iBiz);
  if (!biz) { skipped++; continue; }
  const phone = get(r, iPhone1) || get(r, iPhone2);
  const id = `PROS-${year}-${String(n++).padStart(5, "0")}`;
  // Prospects columns A..S
  rows.push([
    id, importedAt, IMPORTED_BY, "New", "",          // id, at, by, status, agent
    biz, "", "", phone, get(r, iEmail),               // biz, contact, title, phone, email
    get(r, iAddr), get(r, iCity), get(r, iZip),       // address, city, zip
    "SMECO", get(r, iAcct), "",                        // utility, account, hvacUnits
    "", "", LIST_NAME,                                 // notes, usedByLeadId, listName
  ]);
}
console.log(`prepared ${rows.length} prospects (skipped ${skipped} without a name)`);

const CHUNK = 2000;
for (let i = 0; i < rows.length; i += CHUNK) {
  const slice = rows.slice(i, i + CHUNK);
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "Prospects!A1",
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: slice },
  });
  console.log(`  appended ${i + slice.length}/${rows.length}`);
}
console.log(`Done — ${rows.length} SMECO Small Business prospects loaded.`);
