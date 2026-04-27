#!/usr/bin/env node
// List the contents of the Drive root folder (recursive, 1 level deep)
// so we can sanity-check that photo uploads actually landed.

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

const auth = new google.auth.JWT({
  email: required("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
  key: required("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY").replace(/\\n/g, "\n"),
  scopes: ["https://www.googleapis.com/auth/drive"],
});

const drive = google.drive({ version: "v3", auth });
const ROOT = required("GOOGLE_DRIVE_ROOT_FOLDER_ID");

async function listChildren(parentId) {
  const res = await drive.files.list({
    q: `'${parentId}' in parents and trashed=false`,
    fields: "files(id,name,mimeType,size)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    pageSize: 100,
  });
  return res.data.files ?? [];
}

const isFolder = (f) => f.mimeType === "application/vnd.google-apps.folder";

async function main() {
  console.log(`Root folder: ${ROOT}\n`);
  const top = await listChildren(ROOT);
  if (top.length === 0) {
    console.log("(empty)");
    return;
  }
  for (const item of top) {
    const tag = isFolder(item) ? "📁" : "📄";
    console.log(`${tag} ${item.name}`);
    if (isFolder(item)) {
      const children = await listChildren(item.id);
      for (const c of children) {
        const ctag = isFolder(c) ? "📁" : "📄";
        console.log(`   ${ctag} ${c.name}${c.size ? ` (${c.size} bytes)` : ""}`);
        if (isFolder(c)) {
          const grand = await listChildren(c.id);
          for (const g of grand) {
            console.log(`      📄 ${g.name}${g.size ? ` (${g.size} bytes)` : ""}`);
          }
        }
      }
    }
  }
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
