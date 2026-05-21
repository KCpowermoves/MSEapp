#!/usr/bin/env node
// Build a PDF walkthrough manual for MSE Field.
//
// Drives Puppeteer through the key tech-facing screens, takes mobile-
// viewport screenshots, then assembles a PDF that pairs each screenshot
// with a real explanation of how to use it. Also includes a couple of
// text-only callout pages for things that can't be captured in a static
// shot (AI nameplate reading, pending-uploads + retry flow).
//
// Run:
//   1. In another terminal:  npx next dev -p 3030
//   2. node scripts/build-manual.mjs --base-url http://localhost:3030
//
// Output: docs/MSE-Field-Manual.pdf

import puppeteer from "puppeteer";
import { google } from "googleapis";
import { createRequire } from "module";
import { config } from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
// Regular pdfkit build — this script runs under Node where `fs` is
// real. The standalone build (used in lib/pdf-report.ts) stubs fs for
// browser/serverless and would break image embeds here.
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

// ── Sheet helper for cleaning up demo data ────────────────────────────
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
  if (matches.length === 0) return 0;
  const data = matches.map((m) => ({
    range: `Jobs!G${m.row}`,
    values: [["Closed"]],
  }));
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { valueInputOption: "RAW", data },
  });
  return matches.length;
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

async function clickByTextContains(page, tag, text) {
  return page.evaluate(
    (t, txt) => {
      const els = Array.from(document.querySelectorAll(t));
      const el = els.find((e) => (e.textContent ?? "").includes(txt));
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
  await page.setUserAgent(
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15"
  );

  const sections = [];

  // 1. Login (fresh, logged out)
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
  await page.evaluate(() =>
    fetch("/api/auth", { method: "DELETE" }).catch(() => {})
  );
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
  await sleep(400);
  sections.push({
    kind: "shot",
    title: "1. Sign in",
    body: [
      "Open the app and tap your 4-digit PIN. The pad submits automatically once you enter the fourth digit — no Enter button.",
      "Sessions last 30 days. You can sign out anytime via the icon in the top-right of every screen.",
      "If you get the wrong PIN, the dots shake. Hit the backspace icon to clear and try again.",
    ],
    file: await shot(page, 1, "login"),
  });

  // Log in
  for (const d of PIN) {
    await clickByText(page, "button", d);
    await sleep(150);
  }
  await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 });
  // Dismiss location modal — otherwise it blacks out every screenshot.
  await sleep(500);
  await clickByText(page, "button", "Not now").catch(() => {});
  await sleep(400);

  // 2. Jobs home
  await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle2" });
  await sleep(500);
  sections.push({
    kind: "shot",
    title: "2. Jobs home",
    body: [
      "Your daily home screen. Every job you're on from the last 7 days appears here.",
      "Tap a job tile to open it, the red New job button to start a new one, or pull down to refresh.",
      "Admins also see a dashboard icon (the 4-square grid) in the top-right.",
    ],
    file: await shot(page, 2, "jobs-home"),
  });

  // 3. New job — blank
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const demoName = `Manual Demo ${stamp}`;
  await page.goto(`${BASE}/jobs/new`, { waitUntil: "networkidle2" });
  await sleep(400);
  sections.push({
    kind: "shot",
    title: "3. New job — blank form",
    body: [
      "Three things to fill in: business name, utility territory, and crew on site.",
      "Business name is the property or company (e.g. \"Towson Office Plaza\") — not the contact person you're talking to.",
      "Crew defaults to just you, the logged-in tech. Tap additional teammates if anyone else is on site.",
    ],
    file: await shot(page, 3, "new-job-blank"),
  });

  // 4. New job — filled in
  await page.type('input[type="text"]', demoName);
  await sleep(150);
  await clickByText(page, "button", "BGE");
  await sleep(300);
  sections.push({
    kind: "shot",
    title: "4. New job — filled in",
    body: [
      "What it looks like once everything's picked. Selected utility lights up navy; selected crew names get a checkmark.",
      "Tap Create job at the bottom — the app drops you into the new job's detail screen ready for the first unit.",
    ],
    file: await shot(page, 4, "new-job-filled"),
  });

  await clickByText(page, "button", "Create job");
  await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 });
  await sleep(800);
  const jobUrl = page.url();
  const jobId = jobUrl.match(/\/jobs\/([^/?#]+)/)[1];

  // 5. Job detail (empty — no units yet)
  sections.push({
    kind: "shot",
    title: "5. Job detail",
    body: [
      "Inside a job. Tap Add unit for each HVAC unit you serviced — units stack up below as you add them.",
      "The Submit job button stays disabled until at least one unit is logged. Once you've added units, it lights up red.",
      "Use the back arrow (top-left) to return to the jobs list. The pencil icon edits the job's name or territory.",
    ],
    file: await shot(page, 5, "job-detail-empty"),
  });

  // 6. Add unit — type picker
  await page.goto(`${jobUrl}/units/new`, { waitUntil: "networkidle2" });
  await sleep(600);
  sections.push({
    kind: "shot",
    title: "6. Add unit — pick a type",
    body: [
      "First choose what kind of unit you're servicing. Each type has its own photo checklist:",
      "PTAC / Ductless — 3 photos (pre, post, nameplate). Split System — 11 photos (outdoor 3 sides + air handler).",
      "RTU-Small / Medium / Large — 7 photos each (coil 1 + 2 before/after, filter before/after, nameplate).",
    ],
    file: await shot(page, 6, "add-unit-type-picker"),
  });

  // Tap PTAC to expand the rest of the form
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("PTAC / Ductless")
    );
    btn?.click();
  });
  await sleep(800);
  sections.push({
    kind: "shot",
    title: "7. Add unit — PTAC checklist",
    body: [
      "Snap the nameplate FIRST. The AI auto-fills make / model / serial from the photo within a few seconds (more on the next page).",
      "Then capture pre-service, post-service, and (optional) filter shots. Each red asterisk is a required photo before you can save.",
      "Add a few extra photos for things worth flagging — gauges, problem areas, parts you swapped. Save unit when the checklist's full.",
    ],
    file: await shot(page, 7, "add-unit-ptac"),
  });

  // 8. AI nameplate callout (text-only)
  sections.push({
    kind: "callout",
    title: "8. AI nameplate reading",
    body: [
      "When you snap a nameplate photo, the app sends it to Claude AI to read the text. Within 3–5 seconds, make / model / serial appear in the fields below — no typing needed.",
      "A small banner above the fields tells you what happened: a gold sparkle means high confidence (the AI is sure); a red flag means medium confidence (glance over it and fix anything wrong); a muted note means the photo was too blurry — retake or type manually.",
      "If you retake the nameplate later, it re-reads automatically. The AI only overwrites fields you haven't already edited by hand — anything you typed yourself stays safe.",
      "Cost-wise this runs about half a cent per nameplate, paid through MSE's Anthropic account. No tech action needed.",
      "It also works fully offline — the photo queues up like any other and the OCR fires once you're back online.",
    ],
  });

  // 9. Submit job — create a unit via API so the submit page renders properly
  console.log("  seeding a demo unit so the submit page has something to show");
  await page.evaluate(async (jid) => {
    await fetch("/api/units", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId: jid,
        unitType: "PTAC / Ductless",
        label: "PTAC 1",
        make: "Carrier",
        model: "DEMO-AB-200",
        serial: "DEMO-12345",
        notes: "",
      }),
    });
  }, jobId);
  await sleep(800);

  await page.goto(`${jobUrl}/submit`, { waitUntil: "networkidle2" });
  await sleep(800);
  sections.push({
    kind: "shot",
    title: "9. Submitting a job",
    body: [
      "When you're done capturing units, tap Submit job on the job detail screen — it brings you here.",
      "Crew on site is pre-filled from what you picked at job creation. Tap Edit if anyone left mid-day or extra hands joined.",
      "Tap the red Submit job button at the bottom. The app finalizes the job server-side and drops you back at the jobs list with a green \"submitted\" confirmation.",
      "Photos that haven't finished uploading yet keep uploading in the background — submission isn't blocked on a perfect upload queue.",
    ],
    file: await shot(page, 9, "submit-page"),
  });

  // 10. Submitted toast
  await page.goto(`${BASE}/jobs?submitted=1`, { waitUntil: "networkidle2" });
  await sleep(600);
  sections.push({
    kind: "shot",
    title: "10. Job submitted",
    body: [
      "What you see right after you submit. The green banner across the top confirms the dispatch was logged.",
      "The toast fades after a few seconds. The job itself drops off the active list once everything's wrapped — usually the same day.",
      "An automated PDF service report is built in the background and saved to the customer's Drive folder once all photos finish uploading. Admins can resend that report from the dashboard.",
    ],
    file: await shot(page, 10, "submitted-toast"),
  });

  // 11. Pending uploads callout
  sections.push({
    kind: "callout",
    title: "11. Photos uploading & retries",
    body: [
      "Right after you capture a photo it goes into a local queue that uploads in the background. You'll see a small \"X pending\" pill next to your name in the header — that's the upload counter.",
      "Tap the pill to open the queue inspector. It shows every photo that's still in flight, plus any draft jobs / units waiting to sync because the tech was offline when they were created.",
      "If a photo's been stuck more than a minute, the worker auto-retries it. After 12 failed tries it surfaces a red error chip; tap the circular arrow next to it to force another attempt, or tap \"Retry everything\" at the top of the inspector to reset every stuck item at once.",
      "Photos stay safe on the phone even after they upload — they're kept locally as a 14-day backup. Tap the floppy-disk icon to pin a specific photo for indefinite local retention.",
      "Going offline mid-job is fine. The app keeps capturing into the queue and will drain it the next time you're back on cell or WiFi. Job submission also works offline — the dispatch will sync when connectivity returns.",
    ],
  });

  // 12. Admin dashboard
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle2" });
  await sleep(800);
  sections.push({
    kind: "shot",
    title: "12. Admin dashboard",
    body: [
      "Admins only. Per-tech rollup of the last 7 days at the top — pay, units, last seen location.",
      "Photo audit lists any unit whose photos are still missing — tap Edit to fix it before the customer report goes out.",
      "Recent submissions shows the last 10 dispatches with their PDF status. Re-render builds a fresh PDF (use this if you fixed photos after the fact). Send report emails the PDF to a customer — bring up the email field and tap Send.",
    ],
    file: await shot(page, 12, "admin-dashboard"),
  });

  await browser.close();
  return { sections, demoName };
}

// ── PDF assembly ─────────────────────────────────────────────────────
const NAVY = "#1A2332";
const GOLD = "#C5A572";
const MUTED = "#6B7280";
const LIGHT = "#E5E7EB";

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 56;
const CONTENT_W = PAGE_W - MARGIN * 2;

async function buildPdf(sections) {
  const outPath = path.join(docsDir, "MSE-Field-Manual.pdf");
  const doc = new PDFDocument({ size: "LETTER", margin: MARGIN });
  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  // ── Cover page ──
  const logoPath = path.join(projectRoot, "public", "logo.png");
  if (fs.existsSync(logoPath)) {
    doc.image(fs.readFileSync(logoPath), PAGE_W / 2 - 48, 140, {
      width: 96,
      height: 96,
    });
  }
  doc
    .fillColor(NAVY)
    .font("Helvetica-Bold")
    .fontSize(34)
    .text("MSE Field", 0, 270, { align: "center" });
  doc
    .fillColor(MUTED)
    .font("Helvetica")
    .fontSize(16)
    .text("Technician walkthrough", 0, 315, { align: "center" });
  doc
    .moveTo(PAGE_W / 2 - 60, 355)
    .lineTo(PAGE_W / 2 + 60, 355)
    .strokeColor(GOLD)
    .lineWidth(2)
    .stroke();
  doc
    .fillColor(MUTED)
    .fontSize(12)
    .text(
      "Every screen in the field app, in order. How to sign in, " +
        "log a unit, submit a job, handle stuck uploads, and what " +
        "admins see. A few text-only callouts cover things that only " +
        "make sense in motion (the AI nameplate reader, the upload " +
        "queue).",
      90,
      385,
      { width: PAGE_W - 180, align: "center", lineGap: 3 }
    );
  doc
    .fillColor(MUTED)
    .fontSize(10)
    .text(
      `Generated ${new Date().toLocaleDateString("en-US", {
        dateStyle: "long",
      })}`,
      0,
      PAGE_H - 90,
      { align: "center" }
    );
  doc
    .fillColor(MUTED)
    .fontSize(9)
    .text("Maryland Smart Energy — internal use", 0, PAGE_H - 72, {
      align: "center",
    });

  // ── Sections ──
  for (const s of sections) {
    doc.addPage();
    if (s.kind === "shot") renderShotPage(doc, s);
    else renderCalloutPage(doc, s);
  }

  doc.end();
  return new Promise((resolve, reject) => {
    stream.on("finish", () => resolve(outPath));
    stream.on("error", reject);
  });
}

function renderTitle(doc, title) {
  doc
    .fillColor(NAVY)
    .font("Helvetica-Bold")
    .fontSize(20)
    .text(title, MARGIN, MARGIN, { width: CONTENT_W });
  const titleBottom = doc.y;
  doc
    .moveTo(MARGIN, titleBottom + 4)
    .lineTo(PAGE_W - MARGIN, titleBottom + 4)
    .strokeColor(GOLD)
    .lineWidth(1)
    .stroke();
  return titleBottom + 16;
}

function renderBody(doc, body, top) {
  doc
    .fillColor(NAVY)
    .font("Helvetica")
    .fontSize(11);
  let y = top;
  for (const para of body) {
    doc.text(para, MARGIN, y, {
      width: CONTENT_W,
      lineGap: 2,
      paragraphGap: 8,
    });
    y = doc.y + 4;
  }
  return y;
}

function renderFooter(doc) {
  // Footer text is written into the bottom margin. pdfkit's text()
  // would auto-paginate if y > content bottom, so temporarily zero
  // the bottom margin around the draw to keep us on the same page.
  const oldBot = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc
    .fillColor(MUTED)
    .font("Helvetica")
    .fontSize(9)
    .text("MSE Field walkthrough", MARGIN, PAGE_H - 36, {
      width: CONTENT_W,
      align: "center",
      lineBreak: false,
    });
  doc.page.margins.bottom = oldBot;
}

function renderShotPage(doc, section) {
  const afterTitle = renderTitle(doc, section.title);
  const afterBody = renderBody(doc, section.body, afterTitle);

  // Image area — fit the screenshot below the body text, no rect frame.
  const imgTop = afterBody + 6;
  const imgMaxH = PAGE_H - imgTop - 60; // leave room for footer
  const imgMaxW = CONTENT_W;
  try {
    const buf = fs.readFileSync(section.file);
    // Compute scaled size to center horizontally
    const meta = doc.openImage(buf);
    const scale = Math.min(imgMaxW / meta.width, imgMaxH / meta.height);
    const w = meta.width * scale;
    const h = meta.height * scale;
    const x = MARGIN + (CONTENT_W - w) / 2;
    doc.image(buf, x, imgTop, { width: w, height: h });
    // Subtle shadow / border for the screenshot
    doc
      .strokeColor(LIGHT)
      .lineWidth(1)
      .rect(x, imgTop, w, h)
      .stroke();
  } catch (e) {
    doc
      .fillColor("#B91C1C")
      .fontSize(10)
      .text(`(screenshot unavailable: ${e instanceof Error ? e.message : String(e)})`,
        MARGIN,
        imgTop
      );
  }

  renderFooter(doc);
}

function renderCalloutPage(doc, section) {
  const afterTitle = renderTitle(doc, section.title);
  const afterBody = renderBody(doc, section.body, afterTitle + 4);

  // Decorative gold box at the bottom emphasizing "no screenshot,
  // happens live" — fills the visual gap a screenshot would.
  const boxTop = Math.min(afterBody + 16, PAGE_H - 200);
  const boxH = Math.min(180, PAGE_H - 60 - boxTop);
  doc
    .rect(MARGIN, boxTop, CONTENT_W, boxH)
    .fillColor("#FFF8E5")
    .fill();
  doc
    .rect(MARGIN, boxTop, CONTENT_W, boxH)
    .strokeColor(GOLD)
    .lineWidth(1)
    .stroke();
  doc
    .fillColor(NAVY)
    .font("Helvetica-Bold")
    .fontSize(13)
    .text("Tip", MARGIN + 18, boxTop + 18);
  doc
    .fillColor(NAVY)
    .font("Helvetica")
    .fontSize(11)
    .text(tipForSection(section.title), MARGIN + 18, boxTop + 42, {
      width: CONTENT_W - 36,
      lineGap: 3,
    });

  renderFooter(doc);
}

function tipForSection(title) {
  if (title.includes("AI nameplate")) {
    return (
      "Get the nameplate centered, well-lit, and in focus. The AI " +
      "handles glare and angled shots well but still works best on a " +
      "head-on shot with the full label in frame. If the photo's " +
      "blurry, retake — the OCR will re-fire automatically."
    );
  }
  if (title.includes("uploading")) {
    return (
      "Don't sweat the upload counter. Photos are safe on the phone " +
      "even before they reach the cloud — losing service won't lose " +
      "your work. Just keep capturing; the queue drains itself."
    );
  }
  return "";
}

// ── Driver ───────────────────────────────────────────────────────────
async function main() {
  try {
    const r = await fetch(`${BASE}/login`, { redirect: "manual" });
    if (!r.ok && r.status !== 200) throw new Error(`HTTP ${r.status}`);
  } catch (e) {
    console.error(
      `\n✗ Dev server not reachable at ${BASE}. Start it in another terminal:\n  npx next dev -p 3030\n`
    );
    process.exit(1);
  }

  console.log(`\n→ Pre-clean: closing any orphaned Manual Demo jobs`);
  try {
    const n = await closeJobByName("Manual Demo ");
    if (n > 0) console.log(`  closed ${n} orphaned demo job(s)`);
  } catch (e) {
    console.warn(`  pre-clean warning: ${e.message ?? e}`);
  }

  const { sections, demoName } = await capture();

  console.log(`\n→ Building PDF (${sections.length} sections)`);
  const outPath = await buildPdf(sections);
  console.log(`  ${outPath}`);

  console.log(`\n→ Cleaning up demo job ("${demoName}")`);
  try {
    const n = await closeJobByName(demoName);
    console.log(`  closed ${n} job(s)`);
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
