#!/usr/bin/env node
// Build a PDF walkthrough manual for MSE Field.
//
// 1. Drives Puppeteer through the key tech-facing screens, taking
//    mobile-viewport screenshots of each.
// 2. Creates a throwaway "Manual Demo <timestamp>" job so screens
//    have realistic content (closed afterward so it doesn't pollute
//    the live job list).
// 3. Assembles a PDF with cover, captions, and embedded screenshots.
//
// Run:
//   1. In a separate terminal:  npx next dev
//      (or use whichever port — pass --base-url=http://localhost:PORT)
//   2. node scripts/build-manual.mjs
//
// Output: docs/MSE-Field-Manual.pdf

import puppeteer from "puppeteer";
import { google } from "googleapis";
// eslint-disable-next-line @typescript-eslint/no-require-imports
import { createRequire } from "module";
import { config } from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
// Regular pdfkit build (NOT the standalone variant we use in
// lib/pdf-report.ts) — this script runs under Node where `fs` is
// real, and pdfkit needs that to load images/fonts. The standalone
// build stubs `fs` for browser/serverless and breaks image embeds.
const PDFDocument = require("pdfkit");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
config({ path: path.resolve(projectRoot, ".env.local") });

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  if (i === -1) return fallback;
  return process.argv[i + 1];
};
const BASE = arg("--base-url", "http://localhost:3000");
const PIN = arg("--pin", "7950");

const docsDir = path.join(projectRoot, "docs");
const shotsDir = path.join(docsDir, "manual-screenshots");
fs.mkdirSync(shotsDir, { recursive: true });

// ── Sheet helper for creating + cleaning up the demo job ──────────────
const sheetsAuth = new google.auth.JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth: sheetsAuth });
const SHEET_ID = process.env.GOOGLE_SHEET_ID;

async function closeJobByName(namePrefix) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Jobs!A2:G",
  });
  const rows = res.data.values ?? [];
  const matches = [];
  rows.forEach((r, i) => {
    if (String(r[3] ?? "").startsWith(namePrefix)) {
      matches.push({ row: i + 2, jobId: r[0], name: r[3] });
    }
  });
  if (matches.length === 0) return;
  const data = matches.map((m) => ({
    range: `Jobs!G${m.row}`,
    values: [["Closed"]],
  }));
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { valueInputOption: "RAW", data },
  });
  console.log(`  closed ${matches.length} "${namePrefix}" job(s)`);
}

// ── Puppeteer helpers ────────────────────────────────────────────────
async function clickByText(page, tag, text) {
  return page.evaluate(
    (t, txt) => {
      const els = Array.from(document.querySelectorAll(t));
      const el = els.find((e) => (e.textContent ?? "").trim() === txt);
      if (!el) return false;
      el.click();
      return true;
    },
    tag,
    text
  );
}

async function shot(page, idx, name) {
  const file = path.join(
    shotsDir,
    `${String(idx).padStart(2, "0")}-${name}.png`
  );
  await page.screenshot({ path: file, fullPage: true });
  console.log(`  screenshot: ${path.basename(file)}`);
  return file;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Capture flow ─────────────────────────────────────────────────────
async function capture() {
  console.log(`\n→ Launching Puppeteer against ${BASE}`);
  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 },
  });
  const page = await browser.newPage();
  // iPhone-ish UA so iOS-only CSS branches render the way a tech would see.
  await page.setUserAgent(
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15"
  );

  const captures = [];

  // 1. Login screen — visit fresh, ensure logged out first.
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
  await page.evaluate(() =>
    fetch("/api/auth", { method: "DELETE" }).catch(() => {})
  );
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
  await sleep(400);
  captures.push({
    title: "1. Sign in",
    caption:
      "Tap your 4-digit PIN. The app remembers you for 30 days unless " +
      "you tap the log-out icon in the header.",
    file: await shot(page, 1, "login"),
  });

  // Log in
  for (const d of PIN) {
    await clickByText(page, "button", d);
    await sleep(150);
  }
  await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 });

  // Dismiss the location-consent modal that pops up on first visit —
  // otherwise it blacks out every subsequent screenshot.
  await sleep(500);
  await clickByText(page, "button", "Not now").catch(() => {});
  await sleep(400);

  // 2. Jobs home (empty state on first load, then with our demo job).
  captures.push({
    title: "2. Jobs home",
    caption:
      "Your job list. Active jobs over the last 7 days show here. " +
      "Tap the red New job button to start a new one. The header shows " +
      "your name and a logout icon. Admins also see a dashboard icon.",
    file: await shot(page, 2, "jobs-home-empty"),
  });

  // 3. Create a Manual Demo job
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const demoName = `Manual Demo ${stamp}`;
  await page.goto(`${BASE}/jobs/new`, { waitUntil: "networkidle2" });
  await sleep(400);
  captures.push({
    title: "3. New job — blank form",
    caption:
      "Business name first (the property or company — not the contact " +
      "person), then pick the utility territory. Crew defaults to you; " +
      "tap a teammate to add them. Tap Create job when done.",
    file: await shot(page, 3, "new-job-blank"),
  });

  await page.type('input[type="text"]', demoName);
  await sleep(150);
  await clickByText(page, "button", "BGE");
  await sleep(300);
  captures.push({
    title: "4. New job — filled in",
    caption:
      "Filled-in example. Crew shows the logged-in tech selected by " +
      "default. Add others by tapping their name in the picker.",
    file: await shot(page, 4, "new-job-filled"),
  });

  await clickByText(page, "button", "Create job");
  await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 });
  await sleep(800);

  const jobUrl = page.url();
  captures.push({
    title: "5. Job detail",
    caption:
      "Inside a job. Tap Add unit for every HVAC unit you serviced. " +
      "Once at least one unit is logged, the red Submit job button " +
      "lights up. Already-submitted units show a SUBMITTED chip.",
    file: await shot(page, 5, "job-detail-empty"),
  });

  // 6. Add unit form
  await page.goto(`${jobUrl}/units/new`, { waitUntil: "networkidle2" });
  await sleep(600);
  captures.push({
    title: "6. Add unit — pick a type",
    caption:
      "First choose the unit type. PTAC / Ductless for through-the-wall " +
      "units; RTU-S/M/L for rooftop units (small/medium/large); Split " +
      "System for outdoor + indoor air handler pairs. Each type has its " +
      "own photo checklist.",
    file: await shot(page, 6, "add-unit-type-picker"),
  });

  // Tap PTAC to expand the rest of the form. The button text spans
  // two lines (label + subtitle), so substring-match instead of
  // exact-match.
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("PTAC / Ductless")
    );
    btn?.click();
  });
  await sleep(800);
  captures.push({
    title: "7. Add unit — PTAC checklist",
    caption:
      "Nameplate goes first — the OCR reads make / model / serial off " +
      "the photo and auto-fills the fields. Model is required; make and " +
      "serial are optional. Then capture before / after photos and any " +
      "extras. Tap Save unit when the checklist is full.",
    file: await shot(page, 7, "add-unit-ptac"),
  });

  // 8. Back to /jobs to show populated home
  await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle2" });
  await sleep(600);
  captures.push({
    title: "8. Jobs home — populated",
    caption:
      "Once you have an active job, it shows here with photo progress " +
      "(0/3 etc.). Tap to open. Pull down to refresh.",
    file: await shot(page, 8, "jobs-home-populated"),
  });

  // 9. Admin dashboard (only visible to admins, but the route exists)
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle2" });
  await sleep(800);
  captures.push({
    title: "9. Admin dashboard",
    caption:
      "Admins only. Per-tech rollup for the last 7 days, photo audit " +
      "(units missing required photos), recent submissions with PDF " +
      "report status and a Resend button for emailing customers.",
    file: await shot(page, 9, "admin-dashboard"),
  });

  await browser.close();
  return { captures, demoName };
}

// ── PDF assembly ─────────────────────────────────────────────────────
function buildPdf(captures) {
  const outPath = path.join(docsDir, "MSE-Field-Manual.pdf");
  const doc = new PDFDocument({ size: "LETTER", margin: 56 });
  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  const NAVY = "#1A2332";
  const GOLD = "#C5A572";
  const MUTED = "#6B7280";

  // ── Cover page ──
  // pdfkit's standalone build can't read images from a path in this
  // ESM context — load each image to a Buffer first.
  const logoPath = path.join(projectRoot, "public", "logo.png");
  if (fs.existsSync(logoPath)) {
    const logoBuf = fs.readFileSync(logoPath);
    doc.image(logoBuf, doc.page.width / 2 - 48, 130, { width: 96, height: 96 });
  }
  doc
    .fillColor(NAVY)
    .font("Helvetica-Bold")
    .fontSize(34)
    .text("MSE Field", 0, 260, { align: "center" });
  doc
    .fillColor(MUTED)
    .font("Helvetica")
    .fontSize(16)
    .text("Technician walkthrough", 0, 305, { align: "center" });
  doc
    .moveTo(doc.page.width / 2 - 60, 345)
    .lineTo(doc.page.width / 2 + 60, 345)
    .strokeColor(GOLD)
    .lineWidth(2)
    .stroke();
  doc
    .fillColor(MUTED)
    .fontSize(12)
    .text(
      "A quick visual tour of the field-tech PWA — sign in, log a unit, " +
        "submit a job, and what admins see.",
      90,
      370,
      { width: doc.page.width - 180, align: "center" }
    );
  doc
    .fillColor(MUTED)
    .fontSize(10)
    .text(`Generated ${new Date().toLocaleDateString("en-US", { dateStyle: "long" })}`,
      0,
      doc.page.height - 90,
      { align: "center" }
    );
  doc
    .fillColor(MUTED)
    .fontSize(9)
    .text("Maryland Smart Energy — internal use", 0, doc.page.height - 72, {
      align: "center",
    });

  // ── Section per screenshot ──
  for (const c of captures) {
    doc.addPage();

    // Title bar
    doc
      .fillColor(NAVY)
      .font("Helvetica-Bold")
      .fontSize(18)
      .text(c.title, { paragraphGap: 6 });
    doc
      .moveTo(56, doc.y)
      .lineTo(doc.page.width - 56, doc.y)
      .strokeColor(GOLD)
      .lineWidth(1)
      .stroke();
    doc.moveDown(0.5);

    // Caption
    doc
      .fillColor(MUTED)
      .font("Helvetica")
      .fontSize(11)
      .text(c.caption, { paragraphGap: 14, lineGap: 2 });

    // Screenshot — frame + fit
    const imgTop = doc.y;
    const maxW = doc.page.width - 112; // 56pt margin each side
    const maxH = doc.page.height - imgTop - 80;
    try {
      doc
        .strokeColor("#E5E7EB")
        .lineWidth(1)
        .rect(54, imgTop - 2, maxW + 4, maxH + 4)
        .stroke();
      const imgBuf = fs.readFileSync(c.file);
      doc.image(imgBuf, { fit: [maxW, maxH], align: "center" });
    } catch (e) {
      doc
        .fillColor("#B91C1C")
        .fontSize(10)
        .text(`(screenshot unavailable: ${e instanceof Error ? e.message : String(e)})`);
    }

    // Footer
    doc
      .fillColor(MUTED)
      .fontSize(9)
      .text("MSE Field walkthrough", 56, doc.page.height - 56, {
        width: doc.page.width - 112,
        align: "left",
      });
    doc.fontSize(9).text(`Page ${doc.bufferedPageRange().start + doc.bufferedPageRange().count}`, 56, doc.page.height - 56, {
      width: doc.page.width - 112,
      align: "right",
    });
  }

  doc.end();
  return new Promise((resolve, reject) => {
    stream.on("finish", () => resolve(outPath));
    stream.on("error", reject);
  });
}

// ── Driver ───────────────────────────────────────────────────────────
async function main() {
  // Verify dev server is reachable before we burn time
  try {
    const r = await fetch(`${BASE}/login`, { redirect: "manual" });
    if (!r.ok && r.status !== 200) {
      throw new Error(`HTTP ${r.status}`);
    }
  } catch (e) {
    console.error(
      `\n✗ Dev server not reachable at ${BASE}. Start it in another terminal:\n  npx next dev\n  (or pass --base-url=http://localhost:PORT if you're on a different port)\n`
    );
    process.exit(1);
  }

  // Clear out any stale "Manual Demo" rows from earlier runs so the
  // populated-jobs screenshot only shows the demo created by THIS run.
  console.log(`\n→ Pre-clean: closing any orphaned Manual Demo jobs`);
  try {
    await closeJobByName("Manual Demo ");
  } catch (e) {
    console.warn(`  pre-clean warning: ${e.message ?? e}`);
  }

  const { captures, demoName } = await capture();

  console.log(`\n→ Building PDF`);
  const outPath = await buildPdf(captures);
  console.log(`  ${outPath}`);

  console.log(`\n→ Cleaning up demo job ("${demoName}")`);
  try {
    await closeJobByName(demoName);
  } catch (e) {
    console.warn(`  cleanup warning: ${e.message ?? e}`);
  }

  console.log(`\n✓ Done.\n`);
  console.log(`  PDF:         ${path.relative(projectRoot, outPath)}`);
  console.log(`  Screenshots: ${path.relative(projectRoot, shotsDir)}\n`);
}

main().catch((e) => {
  console.error("FAILED:", e.stack ?? e.message ?? e);
  process.exit(1);
});
