#!/usr/bin/env node
// Full backup: copies the entire app spreadsheet (every tab, every row)
// into the app's Drive root folder with a timestamped name. Run before
// any destructive data operation.
//
// Usage: node scripts/backup-sheet.mjs

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
const ROOT_FOLDER = required("GOOGLE_DRIVE_ROOT_FOLDER_ID");

const auth = new google.auth.JWT({
  email: required("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
  key: required("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY").replace(/\\n/g, "\n"),
  scopes: ["https://www.googleapis.com/auth/drive"],
});
const drive = google.drive({ version: "v3", auth });

const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
const name = `MSE Field BACKUP ${stamp}`;

const res = await drive.files.copy({
  fileId: SHEET_ID,
  requestBody: { name, parents: [ROOT_FOLDER] },
  supportsAllDrives: true,
});

console.log(`Backup created: "${name}"`);
console.log(`File ID: ${res.data.id}`);
console.log(`URL: https://docs.google.com/spreadsheets/d/${res.data.id}`);
