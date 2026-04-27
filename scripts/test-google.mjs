#!/usr/bin/env node
// Smoke test: verify the service account can authenticate and read the Sheet.
// Run: npm run test:google

import { google } from "googleapis";
import { config } from "dotenv";

config({ path: ".env.local" });

const required = (k) => {
  const v = process.env[k];
  if (!v) {
    console.error(`Missing env var: ${k}. Did you create .env.local?`);
    process.exit(1);
  }
  return v;
};

const auth = new google.auth.JWT({
  email: required("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
  key: required("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY").replace(/\\n/g, "\n"),
  scopes: [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
  ],
});

const sheets = google.sheets({ version: "v4", auth });
const drive = google.drive({ version: "v3", auth });

async function main() {
  console.log("Auth: OK\n");

  console.log("Sheet metadata:");
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: required("GOOGLE_SHEET_ID"),
    fields: "properties.title,sheets.properties.title",
  });
  console.log(`  Title: ${meta.data.properties?.title}`);
  console.log(`  Tabs:  ${meta.data.sheets?.map((s) => s.properties?.title).join(", ") ?? "(none)"}\n`);

  console.log("Drive root folder:");
  const folder = await drive.files.get({
    fileId: required("GOOGLE_DRIVE_ROOT_FOLDER_ID"),
    fields: "id,name,mimeType",
    supportsAllDrives: true,
  });
  console.log(`  Name: ${folder.data.name}`);
  console.log(`  Type: ${folder.data.mimeType}\n`);

  console.log("Reading Techs tab:");
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: required("GOOGLE_SHEET_ID"),
      range: "Techs!A1:E10",
    });
    const rows = res.data.values ?? [];
    if (rows.length === 0) {
      console.log("  (empty — run npm run seed to initialize)");
    } else {
      for (const r of rows) console.log(`  ${r.join(" | ")}`);
    }
  } catch (e) {
    console.log(`  (Techs tab not found — run npm run seed to create)`);
  }

  console.log("\nAll checks passed.");
}

main().catch((e) => {
  console.error("\nFAILED:", e.message);
  process.exit(1);
});
