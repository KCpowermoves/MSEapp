#!/usr/bin/env node
// Build .env.local from a service-account JSON key file.
// Reads the JSON, escapes newlines in the private key, generates a session
// password, and writes .env.local with all 5 required values.
//
// Run: node scripts/build-env.mjs <path-to-key.json> <sheet-id> <drive-folder-id>
//
// Existing .env.local is overwritten only if --force is passed.

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const envPath = path.join(projectRoot, ".env.local");

const args = process.argv.slice(2);
const force = args.includes("--force");
const positional = args.filter((a) => !a.startsWith("--"));

const [keyPath, sheetId, driveFolderId] = positional;

if (!keyPath || !sheetId || !driveFolderId) {
  console.error(
    "Usage: node scripts/build-env.mjs <key.json> <sheet-id> <drive-folder-id> [--force]"
  );
  process.exit(1);
}

if (fs.existsSync(envPath) && !force) {
  console.error(`.env.local already exists. Re-run with --force to overwrite.`);
  process.exit(1);
}

const raw = fs.readFileSync(keyPath, "utf8");
const json = JSON.parse(raw);

if (!json.client_email || !json.private_key) {
  console.error(
    "Key file is missing client_email or private_key. Wrong file?"
  );
  process.exit(1);
}

const escapedKey = json.private_key.replace(/\n/g, "\\n");
const sessionPassword = crypto.randomBytes(32).toString("base64");

const env = `GOOGLE_SERVICE_ACCOUNT_EMAIL=${json.client_email}
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="${escapedKey}"
GOOGLE_SHEET_ID=${sheetId}
GOOGLE_DRIVE_ROOT_FOLDER_ID=${driveFolderId}
IRON_SESSION_PASSWORD=${sessionPassword}
APP_URL=http://localhost:3000
`;

fs.writeFileSync(envPath, env, { mode: 0o600 });
console.log(`Wrote ${envPath}`);
console.log(`  service account: ${json.client_email}`);
console.log(`  sheet ID:        ${sheetId}`);
console.log(`  drive folder:    ${driveFolderId}`);
console.log(`  iron-session pw: (generated, 32 bytes)`);
