#!/usr/bin/env node
// End-to-end test harness — exercises multiple realistic scenarios
// against localhost:3000 using Puppeteer + verifies the resulting
// Sheet state via the Google API. Captures network traffic, console
// output, and per-step screenshots so failures are debuggable.
//
// Run: npm run e2e [-- baseUrl pin]

import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import { config } from "dotenv";

config({ path: ".env.local" });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const screenshotsDir = path.join(projectRoot, "e2e-screenshots");
fs.mkdirSync(screenshotsDir, { recursive: true });

const BASE = process.argv[2] || "http://localhost:3000";
const PIN = process.argv[3] || "7950";

const ok = (msg) => console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
const fail = (msg) => console.log(`  \x1b[31m✗\x1b[0m ${msg}`);
const step = (msg) => console.log(`\n\x1b[1m${msg}\x1b[0m`);

let failures = 0;
function expect(condition, msg) {
  if (condition) ok(msg);
  else {
    fail(msg);
    failures++;
  }
}

// Tiny valid JPEG (~750 bytes) that browser-image-compression can
// process without choking. Used as a stand-in for camera capture.
function makeJpegBuffer() {
  return Buffer.from(
    "ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffdb0043010909090c0b0c180d0d1832211c2132323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232ffc00011080001000103012200021101031101ffc4001f0000010501010101010100000000000000000102030405060708090a0bffc400b5100002010303020403050504040000017d01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffc4001f0100030101010101010101010000000000000102030405060708090a0bffc400b51100020102040403040705040400010277000102031104052131061241510761711322328108144291a1b1c109233352f0156272d10a162434e125f11718191a262728292a35363738393a434445464748494a535455565758595a636465666768696a737475767778797a82838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae2e3e4e5e6e7e8e9eaf2f3f4f5f6f7f8f9faffda000c03010002110311003f00fbfca28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2803ffd9",
    "hex"
  );
}

const TMP_FILE = path.join(screenshotsDir, "_test.jpg");
fs.writeFileSync(TMP_FILE, makeJpegBuffer());

async function shot(page, name) {
  await page.screenshot({
    path: path.join(screenshotsDir, `${name}.png`),
    fullPage: true,
  });
}

async function clickByText(page, tag, text) {
  return page.evaluate(
    (t, txt) => {
      const el = Array.from(document.querySelectorAll(t)).find(
        (e) => e.textContent.trim() === txt || e.textContent.trim().startsWith(txt)
      );
      if (el) {
        el.click();
        return true;
      }
      return false;
    },
    tag,
    text
  );
}

// Click a CrewPicker chip only if it isn't already selected (so we
// don't accidentally toggle multi-select OFF). Selected chips have
// the bg-mse-navy class and a check icon.
async function ensureChipSelected(page, name) {
  return page.evaluate((n) => {
    const btn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent.trim() === n
    );
    if (!btn) return false;
    const isSelected = btn.className.includes("bg-mse-navy");
    if (!isSelected) btn.click();
    return true;
  }, name);
}

async function waitForUrlChange(page, fromUrl, ms = 12000) {
  return page
    .waitForFunction(
      (b) => location.pathname !== new URL(b).pathname,
      { timeout: ms },
      fromUrl
    )
    .catch(() => false);
}

async function login(page) {
  step("Login");
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
  await page.evaluate(() =>
    fetch("/api/auth", { method: "GET" }).catch(() => {})
  );
  await new Promise((r) => setTimeout(r, 400));
  for (const digit of PIN) {
    await clickByText(page, "button", digit);
    await new Promise((r) => setTimeout(r, 200));
  }
  await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 });
  expect(page.url().endsWith("/jobs"), `landed on /jobs (got ${page.url()})`);
}

async function createJob(page, opts) {
  step(`Create job: ${opts.customer} (${opts.territory})${opts.selfSold ? " · self-sold" : ""}`);
  await page.goto(`${BASE}/jobs/new`, { waitUntil: "networkidle2" });
  await page.type('input[type="text"]', opts.customer);
  await clickByText(page, "button", opts.territory);
  if (opts.selfSold) {
    // Click the toggle — it's the only role="switch" on the page
    await page.evaluate(() => {
      const sw = document.querySelector('[role="switch"]');
      sw?.click();
    });
    await new Promise((r) => setTimeout(r, 200));
    // Pick the seller from the chip list
    await clickByText(page, "button", opts.soldBy);
    await new Promise((r) => setTimeout(r, 200));
  }
  const before = page.url();
  await clickByText(page, "button", "Create job");
  await waitForUrlChange(page, before);
  await new Promise((r) => setTimeout(r, 1500));
  const jobId = decodeURIComponent(page.url().split("/").pop());
  expect(jobId.startsWith("JOB-"), `job created (${jobId})`);
  return jobId;
}

async function setCrew(page, jobId, members) {
  await page.goto(`${BASE}/jobs/${encodeURIComponent(jobId)}`, {
    waitUntil: "networkidle2",
  });
  await new Promise((r) => setTimeout(r, 800));
  for (const m of members) {
    await ensureChipSelected(page, m);
    await new Promise((r) => setTimeout(r, 150));
  }
}

function requiredPhotoCount(unitType) {
  if (unitType === "PTAC / Ductless") return 3;
  if (unitType === "Split System") return 11;
  // RTU-S / RTU-M / RTU-L
  return 7;
}

async function addUnit(page, jobId, unitType) {
  step(`Add ${unitType} unit`);
  await page.goto(
    `${BASE}/jobs/${encodeURIComponent(jobId)}/units/new`,
    { waitUntil: "networkidle2" }
  );
  await new Promise((r) => setTimeout(r, 400));
  // Click the picker button by data-unit-type attribute (avoids display-label mismatch)
  const clicked = await page.evaluate((type) => {
    const btn = document.querySelector(`[data-unit-type="${type}"]`);
    if (btn) { btn.click(); return true; }
    return false;
  }, unitType);
  expect(clicked, `unit type button found for "${unitType}"`);
  // Wait for photo slots to render after type selection
  await new Promise((r) => setTimeout(r, 500));

  const requiredCount = requiredPhotoCount(unitType);
  const inputs = await page.$$('input[type="file"]');
  expect(
    inputs.length >= requiredCount,
    `${requiredCount} photo slots rendered for ${unitType} (got ${inputs.length})`
  );
  for (let i = 0; i < requiredCount; i++) {
    const before = await page.evaluate(
      () => document.querySelectorAll('[data-photo-captured]').length
    );
    await inputs[i].uploadFile(TMP_FILE);
    await page
      .waitForFunction(
        (b) => document.querySelectorAll('[data-photo-captured]').length > b,
        { timeout: 8000 },
        before
      )
      .catch(() => {});
  }
  const captured = await page.evaluate(
    () => document.querySelectorAll('[data-photo-captured]').length
  );
  expect(
    captured >= requiredCount,
    `${requiredCount} required photos captured for ${unitType} (got ${captured})`
  );

  const before = page.url();
  await clickByText(page, "button", "Save unit");
  await waitForUrlChange(page, before);
  await new Promise((r) => setTimeout(r, 1500));
  ok(`unit saved`);
}

async function addService(page, jobId, serviceType, quantity = 1) {
  step(`Add service: ${serviceType} × ${quantity}`);
  await page.goto(
    `${BASE}/jobs/${encodeURIComponent(jobId)}/services/new`,
    { waitUntil: "networkidle2" }
  );
  await new Promise((r) => setTimeout(r, 400));
  // Service type label is shortened in UI
  const label =
    serviceType === "Thermostat (regular)"
      ? "Thermostat"
      : serviceType === "Thermostat (scheduled)"
      ? "Thermostat (scheduled)"
      : "Endo Cube";
  await clickByText(page, "button", label);
  // Bump qty
  for (let i = 1; i < quantity; i++) {
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const plus = btns.find((b) => {
        const svg = b.querySelector("svg");
        return svg && b.className.includes("bg-mse-navy") && !b.textContent.trim();
      });
      plus?.click();
    });
    await new Promise((r) => setTimeout(r, 100));
  }
  const before = page.url();
  await clickByText(page, "button", "Save service");
  await waitForUrlChange(page, before);
  await new Promise((r) => setTimeout(r, 1200));
  ok("service saved");
}

async function waitForUploadQueue(page, ms = 120_000) {
  step("Wait for upload queue to drain");
  const start = Date.now();
  let depth = -1;
  while (Date.now() - start < ms) {
    depth = await page.evaluate(async () => {
      const dbReq = indexedDB.open("mse-field-upload-queue");
      return new Promise((resolve) => {
        dbReq.onsuccess = () => {
          const db = dbReq.result;
          if (!db.objectStoreNames.contains("photos")) return resolve(0);
          const tx = db.transaction("photos", "readonly");
          // Count only photos NOT in the "uploaded" backup state —
          // those are intentionally kept as a local recovery copy.
          const req = tx.objectStore("photos").getAll();
          req.onsuccess = () => {
            const active = (req.result ?? []).filter(
              (p) => p.status !== "uploaded"
            );
            resolve(active.length);
          };
          req.onerror = () => resolve(-1);
        };
        dbReq.onerror = () => resolve(-1);
      });
    });
    if (depth === 0) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  if (depth !== 0) {
    // Dump remaining queue items for debugging
    const items = await page.evaluate(async () => {
      const dbReq = indexedDB.open("mse-field-upload-queue");
      return new Promise((resolve) => {
        dbReq.onsuccess = () => {
          const db = dbReq.result;
          if (!db.objectStoreNames.contains("photos")) return resolve([]);
          const tx = db.transaction("photos", "readonly");
          const req = tx.objectStore("photos").getAll();
          req.onsuccess = () =>
            resolve(
              (req.result ?? [])
                .filter((p) => p.status !== "uploaded")
                .map((p) => ({
                  id: p.id,
                  slot: p.photoSlot,
                  status: p.status,
                  attempts: p.attempts,
                  error: p.lastError,
                  ageSec: Math.round((Date.now() - p.capturedAt) / 1000),
                }))
            );
          req.onerror = () => resolve([]);
        };
        dbReq.onerror = () => resolve([]);
      });
    });
    console.log("  stuck items:", JSON.stringify(items, null, 2));
  }
  expect(depth === 0, `upload queue drained (final depth ${depth})`);
}

async function submitDispatch(page, jobId, opts) {
  step(`Submit dispatch (${opts.split}, driver: ${opts.driver ?? "—"})`);
  await page.goto(
    `${BASE}/jobs/${encodeURIComponent(jobId)}/submit`,
    { waitUntil: "networkidle2" }
  );
  await new Promise((r) => setTimeout(r, 800));

  // Server redirects /submit → /jobs/{jobId} when no draft dispatch
  // exists. Detect that and report a real failure.
  if (!page.url().endsWith("/submit")) {
    fail(
      `submit page redirected to ${page.url()} — no draft dispatch found for job ${jobId}`
    );
    failures++;
    return;
  }

  // Crew picker — make sure each crew member is selected (idempotent).
  for (const c of opts.crew) await ensureChipSelected(page, c);
  await new Promise((r) => setTimeout(r, 200));

  // Pay split
  const splitLabel =
    opts.split === "Solo"
      ? "Solo"
      : opts.split === "50-50"
      ? "50 / 50"
      : "Three-way";
  await clickByText(page, "button", splitLabel);
  await new Promise((r) => setTimeout(r, 200));

  // Driver (only if not Solo)
  if (opts.split !== "Solo" && opts.driver) {
    await clickByText(page, "button", opts.driver);
    await new Promise((r) => setTimeout(r, 200));
  }

  // Watch for /api/dispatches POST so we know submit actually fired
  const dispatchPromise = page.waitForResponse(
    (r) => r.url().includes("/api/dispatches") && r.request().method() === "POST",
    { timeout: 12000 }
  );

  const before = page.url();
  await clickByText(page, "button", "Submit");
  let dispatchRes;
  try {
    dispatchRes = await dispatchPromise;
  } catch {
    fail(`Submit button click did not fire POST /api/dispatches`);
    failures++;
    return;
  }
  expect(
    dispatchRes.status() === 200,
    `POST /api/dispatches returned ${dispatchRes.status()}`
  );
  let dispatchId = null;
  try {
    const body = await dispatchRes.json();
    dispatchId = body.dispatchId ?? null;
  } catch {}
  await waitForUrlChange(page, before);
  await new Promise((r) => setTimeout(r, 1500));
  expect(page.url().endsWith("/jobs?submitted=1"), "redirected to /jobs?submitted=1");
  return dispatchId;
}

// === Sheet verification ===

const auth = new google.auth.JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  scopes: [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
  ],
});
const sheets = google.sheets({ version: "v4", auth });
const drive = google.drive({ version: "v3", auth });

async function readTab(tab) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${tab}!A2:ZZ`,
  });
  return res.data.values ?? [];
}

async function verifySheetState(expected, baseline = {}, runDispatchIds = new Set()) {
  step("Verify Sheet state");
  const [jobs, dispatches, units, services, payAttr] = await Promise.all([
    readTab("Jobs"),
    readTab("Dispatches"),
    readTab("Units Serviced"),
    readTab("Additional Services"),
    readTab("Pay Attribution"),
  ]);
  const newJobs      = jobs.length      - (baseline.jobs      ?? 0);
  const newDisp      = dispatches.length - (baseline.dispatches ?? 0);
  const newUnits     = units.length     - (baseline.units     ?? 0);
  const newServices  = services.length  - (baseline.services  ?? 0);
  const newPayAttr   = payAttr.length   - (baseline.payAttr   ?? 0);
  expect(newJobs === expected.jobs,
    `Jobs added: expected ${expected.jobs}, got ${newJobs}`);
  expect(newDisp === expected.dispatches,
    `Dispatches added: expected ${expected.dispatches}, got ${newDisp}`);
  expect(newUnits === expected.units,
    `Units added: expected ${expected.units}, got ${newUnits}`);
  expect(newServices === expected.services,
    `Services added: expected ${expected.services}, got ${newServices}`);
  expect(newPayAttr >= expected.minPayAttr,
    `Pay Attribution added: expected ≥ ${expected.minPayAttr}, got ${newPayAttr}`);

  // Spot-check that every dispatch from THIS run is submitted +
  // photos-complete. Don't fault historical dispatches from prior runs
  // that may have left partial state behind.
  const submittedThisRun = dispatches.filter(
    (d) => d[9] && runDispatchIds.has(d[0])
  );
  for (const d of submittedThisRun) {
    if (d[8] !== "TRUE") {
      fail(`dispatch ${d[0]} not photos-complete`);
      failures++;
    }
  }
  if (submittedThisRun.length === expected.dispatches) {
    ok(`all ${submittedThisRun.length} dispatches submitted with photos-complete`);
  }

  // Verify only units from this run have required photo URLs
  // Column indices: G=6 (first photo slot), M=12 (nameplate)
  const newUnitsOnly = units.slice(baseline.units ?? 0);
  for (const u of newUnitsOnly) {
    const firstPhoto = u[6];
    const nameplate = u[12];
    if (!(firstPhoto && nameplate)) {
      fail(`unit ${u[0]} (type=${u[4]}) missing photo URLs — G=${firstPhoto ?? "empty"}, M=${nameplate ?? "empty"}`);
      failures++;
    }
  }
  if (newUnitsOnly.length > 0) ok(`all ${newUnitsOnly.length} new units have first photo + nameplate URLs`);

  return { jobs, dispatches, units, services, payAttr };
}

async function verifyDriveState(expectedJobs) {
  step("Verify Shared Drive state");
  const root = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  const res = await drive.files.list({
    q: `'${root}' in parents and trashed=false and mimeType='application/vnd.google-apps.folder'`,
    fields: "files(id,name)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    pageSize: 50,
  });
  const folders = res.data.files ?? [];
  expect(
    folders.length >= expectedJobs,
    `Drive root has ≥ ${expectedJobs} job folders (got ${folders.length})`
  );
  // Sample one job folder and verify Unit-prefixed photo files (flat
  // structure — no per-unit subfolders)
  if (folders.length > 0) {
    const contents = await drive.files.list({
      q: `'${folders[0].id}' in parents and trashed=false`,
      fields: "files(id,name,mimeType)",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      pageSize: 100,
    });
    const all = contents.data.files ?? [];
    const subfolders = all.filter(
      (f) => f.mimeType === "application/vnd.google-apps.folder"
    );
    expect(
      subfolders.length === 0,
      `${folders[0].name} should be flat (got ${subfolders.length} subfolders)`
    );
    const unitPhotos = all.filter(
      (f) => f.name.startsWith("Unit-") && f.mimeType?.startsWith("image/")
    );
    expect(
      unitPhotos.length >= 3,
      `${folders[0].name} has ≥ 3 Unit photos (got ${unitPhotos.length})`
    );
    // Spot-check a filename has the expected pattern (Unit-NNN_<type>_<slot>.jpg)
    const sample = unitPhotos[0]?.name ?? "";
    const matchesPattern = /^Unit-\d{3}_.+\.jpg$/.test(sample);
    expect(matchesPattern, `filename pattern matches: ${sample}`);
  }
}

// === Main ===

async function main() {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 });

  const networkLog = [];
  page.on("response", async (res) => {
    const url = new URL(res.url());
    if (url.pathname.startsWith("/api/")) {
      let body = "";
      try {
        body = (await res.text()).slice(0, 300);
      } catch {}
      networkLog.push({
        method: res.request().method(),
        url: url.pathname,
        status: res.status(),
        body,
      });
    }
  });
  page.on("pageerror", (err) =>
    console.log(`  \x1b[33m[pageerror]\x1b[0m ${err.message}`)
  );

  try {
    await login(page);
    await shot(page, "01-after-login");

    // Capture baseline row counts so assertions are relative, not absolute
    step("Capture baseline Sheet counts");
    const [bJobs, bDisp, bUnits, bSvc, bPay] = await Promise.all([
      readTab("Jobs"), readTab("Dispatches"), readTab("Units Serviced"),
      readTab("Additional Services"), readTab("Pay Attribution"),
    ]);
    const baseline = {
      jobs: bJobs.length, dispatches: bDisp.length,
      units: bUnits.length, services: bSvc.length, payAttr: bPay.length,
    };
    console.log("  baseline:", baseline);

    // Track dispatch IDs created in this run so pay math filters correctly
    const runDispatchIds = [];

    // Tag every test customer with a timestamp so it's obvious in the
    // sheet which run created which row — and so cleanup-test-jobs can
    // close them without false-matching real customers.
    const runStamp = new Date()
      .toISOString()
      .replace(/[^\dT]/g, "")
      .slice(0, 13); // e.g. "20260502T2143"
    const tag = (label) => `e2e ${label} ${runStamp}`;

    // ============================================================
    // SCENARIO 1 — Solo BGE job, single PTAC/Ductless unit
    // ============================================================
    console.log("\n\x1b[36m═══ Scenario 1: Solo BGE job, 1 PTAC/Ductless unit ═══\x1b[0m");
    const job1 = await createJob(page, {
      customer: tag("BGE Solo"),
      address: "100 Main St, Baltimore MD 21201",
      territory: "BGE",
      selfSold: false,
    });
    await setCrew(page, job1, ["Kevin Cheung"]);
    await addUnit(page, job1, "PTAC / Ductless");
    await waitForUploadQueue(page);
    const dsp1 = await submitDispatch(page, job1, { crew: ["Kevin Cheung"], split: "Solo" });
    if (dsp1) runDispatchIds.push(dsp1);
    await shot(page, "scenario-1-end");

    // ============================================================
    // SCENARIO 2 — Self-sold Delmarva job, 2 units (PTAC + RTU-S)
    // + thermostat service, travel bonus + sales bonus
    // ============================================================
    console.log("\n\x1b[36m═══ Scenario 2: Self-sold Delmarva, PTAC + RTU-S + thermostat ═══\x1b[0m");
    const job2 = await createJob(page, {
      customer: tag("Delmarva Self-Sold"),
      address: "200 Bay Ave, Salisbury MD 21801",
      territory: "Delmarva",
      selfSold: true,
      soldBy: "Kevin Cheung",
    });
    await setCrew(page, job2, ["Kevin Cheung"]);
    await addUnit(page, job2, "PTAC / Ductless");
    await addUnit(page, job2, "RTU-S");
    await addService(page, job2, "Thermostat (regular)", 2);
    await waitForUploadQueue(page);
    const dsp2 = await submitDispatch(page, job2, { crew: ["Kevin Cheung"], split: "Solo" });
    if (dsp2) runDispatchIds.push(dsp2);
    await shot(page, "scenario-2-end");

    // ============================================================
    // VERIFICATION
    // ============================================================
    const sheetState = await verifySheetState({
      jobs: 2,
      dispatches: 2,
      units: 3, // 1 PTAC/Ductless + 1 PTAC/Ductless + 1 RTU-S
      services: 1,
      minPayAttr: 8,
    }, baseline, new Set(runDispatchIds));
    await verifyDriveState(2);

    // Pay math:
    //   Scenario 1 (Solo BGE, 1 PTAC/Ductless):
    //     Install:  $10
    //     Stipend:  $10
    //
    //   Scenario 2 (Solo Delmarva self-sold, 1 PTAC/Ductless + 1 RTU-S, 2× thermostat):
    //     Install:        $10 + $50 = $60
    //     Sales (paid):   ($5 + $30) × 0.5 = $17.50
    //     Sales (pending):($5 + $30) × 0.5 = $17.50
    //     Service:        2 × $25 = $50
    //     Stipend:        $10
    //     Travel bonus:   $40
    //
    //   Totals across both scenarios:
    //     Install:        $10 + $60 = $70
    //     Sales (paid):   $17.50
    //     Sales (pending):$17.50
    //     Service:        $50
    //     Stipend:        $10 + $10 = $20
    //     Travel:         $40
    //     Grand total:    $215
    step("Verify Pay Attribution math");
    const sumByLineItem = {};
    // Filter to only rows from this run's dispatches (col C = dispatchId)
    const runPayRows = sheetState.payAttr.filter((r) =>
      runDispatchIds.length === 0 || runDispatchIds.includes(r[2])
    );
    console.log(`  filtering ${sheetState.payAttr.length} rows → ${runPayRows.length} for this run`);
    for (const r of runPayRows) {
      const item = r[4];
      const amt = Number(r[5]);
      if (Number.isFinite(amt)) sumByLineItem[item] = (sumByLineItem[item] ?? 0) + amt;
    }
    console.log("  by line item:", sumByLineItem);
    const expectedInstall = 10 + 10 + 50;       // $70
    const expectedSalesPaid = (5 + 30) * 0.5;   // $17.50
    const expectedSalesPending = (5 + 30) * 0.5; // $17.50
    const expectedService = 2 * 25;              // $50
    expect(
      Math.abs((sumByLineItem.Install ?? 0) - expectedInstall) < 0.01,
      `Install pay: expected ${expectedInstall}, got ${sumByLineItem.Install}`
    );
    expect(
      Math.abs((sumByLineItem["Sales (paid)"] ?? 0) - expectedSalesPaid) < 0.01,
      `Sales (paid): expected ${expectedSalesPaid}, got ${sumByLineItem["Sales (paid)"]}`
    );
    expect(
      Math.abs((sumByLineItem["Sales (pending)"] ?? 0) - expectedSalesPending) < 0.01,
      `Sales (pending): expected ${expectedSalesPending}, got ${sumByLineItem["Sales (pending)"]}`
    );
    expect(
      Math.abs((sumByLineItem.Service ?? 0) - expectedService) < 0.01,
      `Service pay: expected ${expectedService}, got ${sumByLineItem.Service}`
    );
    // Stipend & travel removed per company policy — no longer asserted

    // Verify Pay Calc tab actually rolls up correctly
    step("Verify Pay Calc rollup for Kevin Cheung");
    const payCalc = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "Pay Calc!A4:H4",
      valueRenderOption: "UNFORMATTED_VALUE",
    });
    const row = payCalc.data.values?.[0] ?? [];
    console.log(
      `  Pay Calc row 4: tech=${row[0]} install=${row[1]} salesPaid=${row[2]} salesPending=${row[3]} service=${row[4]} stipend=${row[5]} travel=${row[6]} total=${row[7]}`
    );
    expect(row[0] === "Kevin Cheung", `tech name in Pay Calc row 4 = "Kevin Cheung"`);
    const thisRunTotal =
      expectedInstall + expectedSalesPaid + expectedSalesPending + expectedService;
    // Pay Calc tab is cumulative across all test runs — just verify it's
    // at least this run's contribution and is a valid number
    expect(
      Number.isFinite(Number(row[7])) && Number(row[7]) >= thisRunTotal,
      `Pay Calc total is ≥ this run's ${thisRunTotal} (got ${row[7]})`
    );
  } catch (e) {
    fail(`harness crashed: ${e.message}`);
    console.error(e);
    failures++;
  }

  console.log("\n=== API CALLS ===");
  for (const r of networkLog) {
    const status =
      r.status >= 400
        ? `\x1b[31m${r.status}\x1b[0m`
        : `\x1b[32m${r.status}\x1b[0m`;
    console.log(`  ${r.method.padEnd(6)} ${r.url.padEnd(20)} → ${status}`);
    if (r.status >= 400 && r.body) console.log(`    ${r.body}`);
  }

  await browser.close();

  console.log(
    `\n\x1b[1m${
      failures === 0 ? "\x1b[32mALL CHECKS PASSED" : `\x1b[31m${failures} CHECKS FAILED`
    }\x1b[0m`
  );
  console.log(`Screenshots: ${screenshotsDir}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
