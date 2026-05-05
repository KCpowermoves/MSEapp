#!/usr/bin/env node
// Roster update — 2026-05-05.
// 1. Soft-deletes the placeholder single-first-name techs (Matt, Joe,
//    Mike) by flipping Active to FALSE, since real techs with the same
//    first names are joining.
// 2. Adds the five new techs at the bottom with PINs 0001-0005.
//
// Run: node scripts/update-techs-2026-05-05.mjs

import { google } from "googleapis";
import bcrypt from "bcryptjs";
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

const TO_DEACTIVATE = new Set(["Matt", "Joe", "Mike"]);

const NEW_TECHS = [
  { name: "Matt Ventura",   pin: "0001" },
  { name: "Mike Rippeon",   pin: "0002" },
  { name: "Joe Witczak",    pin: "0003" },
  { name: "Melvin Tuggle",  pin: "0004" },
  { name: "Ronald Tribull", pin: "0005" },
];

const existing = await sheets.spreadsheets.values.get({
  spreadsheetId: SHEET_ID,
  range: "Techs!A2:F",
});
const rows = existing.data.values ?? [];

const summary = [];

// 1. Soft-delete (Active=FALSE) any row whose Name (col B) is exactly
//    one of the single-first-name placeholders.
for (let i = 0; i < rows.length; i++) {
  const name = String(rows[i][1] ?? "").trim();
  const active = String(rows[i][3] ?? "").toUpperCase() === "TRUE";
  if (TO_DEACTIVATE.has(name) && active) {
    const sheetRow = i + 2;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `Techs!D${sheetRow}`,
      valueInputOption: "RAW",
      requestBody: { values: [["FALSE"]] },
    });
    summary.push({ action: "deactivated", techId: rows[i][0] ?? "?", name });
  }
}

// 2. Add new techs. If a name already exists (e.g. re-running this
//    script), update PIN + Active rather than duplicate the row.
let nextNum = rows.length + 1;
for (const t of NEW_TECHS) {
  const pinHash = await bcrypt.hash(t.pin, 10);
  const matchIdx = rows.findIndex((r) => r[1] === t.name);
  if (matchIdx >= 0) {
    const sheetRow = matchIdx + 2;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `Techs!C${sheetRow}:F${sheetRow}`,
      valueInputOption: "RAW",
      requestBody: { values: [[pinHash, "TRUE", "", "FALSE"]] },
    });
    summary.push({
      action: "updated",
      techId: rows[matchIdx][0] ?? "?",
      name: t.name,
      pin: t.pin,
    });
    continue;
  }
  const techId = `TECH-${String(nextNum).padStart(3, "0")}`;
  nextNum++;
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "Techs!A1",
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[techId, t.name, pinHash, "TRUE", "", "FALSE"]],
    },
  });
  summary.push({ action: "added", techId, name: t.name, pin: t.pin });
}

console.log("\n=== Roster update ===\n");
for (const s of summary) {
  if (s.action === "deactivated") {
    console.log(`DEACTIVATED  ${s.techId.padEnd(10)}  ${s.name}`);
  } else {
    console.log(
      `${s.action.toUpperCase().padEnd(11)}  ${s.techId.padEnd(10)}  ${s.name.padEnd(20)}  PIN: ${s.pin}`
    );
  }
}
console.log("\nDone.\n");
