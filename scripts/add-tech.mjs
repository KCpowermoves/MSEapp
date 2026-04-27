#!/usr/bin/env node
// Add a tech to the Techs tab with a hashed PIN.
// Run: npm run add-tech -- --name "Jalen Smith" --pin 1234 [--phone "+12025551234"]
//
// Re-running with the same name updates that tech's PIN/phone in place.

import { google } from "googleapis";
import bcrypt from "bcryptjs";
import { config } from "dotenv";

config({ path: ".env.local" });

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1];
}

const name = arg("--name");
const pin = arg("--pin");
const phone = arg("--phone") ?? "";

if (!name || !pin || !/^\d{4}$/.test(pin)) {
  console.error("Usage: npm run add-tech -- --name \"First Last\" --pin 1234 [--phone \"+12025551234\"]");
  process.exit(1);
}

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

async function main() {
  const pinHash = await bcrypt.hash(pin, 10);

  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Techs!A2:E",
  });
  const rows = existing.data.values ?? [];

  const matchIdx = rows.findIndex((r) => r[1] === name);
  if (matchIdx >= 0) {
    const sheetRow = matchIdx + 2;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `Techs!C${sheetRow}:E${sheetRow}`,
      valueInputOption: "RAW",
      requestBody: { values: [[pinHash, "TRUE", phone]] },
    });
    console.log(`Updated tech: ${name} (row ${sheetRow})`);
    return;
  }

  const nextNum = rows.length + 1;
  const techId = `TECH-${nextNum.toString().padStart(3, "0")}`;
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "Techs!A1",
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [[techId, name, pinHash, "TRUE", phone]] },
  });
  console.log(`Added tech: ${techId} ${name}`);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
