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
      "Open the app and tap your 4-digit PIN. The pad submits automatically once you enter the fourth digit. There is no Enter button to press.",
      "Sessions last 30 days. You can sign out anytime by tapping the exit icon in the top-right corner of any screen.",
      "If you tap the wrong PIN, the dots shake. Hit the backspace icon to clear and try again.",
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
      "Your daily home screen. Every job you have worked on in the last 7 days appears here.",
      "Tap a job tile to open it, or tap the red New job button to start a new one.",
      "If a job you expected is not showing up yet, pull down on the list to refresh.",
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
    title: "3. New job, blank form",
    body: [
      "Three things to fill in: business name, utility territory, and crew on site.",
      "Business name is the property or company (for example, \"Towson Office Plaza\"), not the contact person you are talking to.",
      "Crew on site defaults to just you, the logged-in tech. Tap additional teammates if anyone else is on site with you today.",
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
    title: "4. New job, filled in",
    body: [
      "Here is what the form looks like once everything is picked. The selected utility lights up navy. Selected crew names show a checkmark next to them.",
      "Tap Create job at the bottom. The app drops you into the new job's detail screen, ready for the first unit.",
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
      "Inside a job. Tap Add unit for each HVAC unit you serviced. Units stack up below as you add them.",
      "The Submit job button stays disabled until at least one unit is logged. Once you have added units, it lights up red.",
      "Use the back arrow in the top-left to return to the jobs list. The pencil icon edits the job's name or territory.",
    ],
    file: await shot(page, 5, "job-detail-empty"),
  });

  // 6. Add unit — type picker
  await page.goto(`${jobUrl}/units/new`, { waitUntil: "networkidle2" });
  await sleep(600);
  sections.push({
    kind: "shot",
    title: "6. Add unit, pick a type",
    body: [
      "First choose what kind of unit you are servicing. Each type has its own photo checklist:",
      "PTAC / Ductless takes 3 photos (pre, post, nameplate). Split System takes 11 photos (outdoor unit from 3 sides plus the air handler).",
      "RTU Small, Medium, and Large each take 7 photos (coil 1 and coil 2 before and after, filter before and after, plus the nameplate).",
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
    title: "7. Add unit, PTAC checklist",
    body: [
      "Snap the nameplate FIRST. The AI fills in make, model, and serial from the photo within a few seconds (more on the next page).",
      "Then capture pre-service, post-service, and (optional) filter shots. Each red asterisk is a required photo before you can save.",
      "Add a few extra photos for anything worth flagging like gauges, problem areas, or parts you swapped. Tap Save unit when the checklist is full.",
    ],
    file: await shot(page, 7, "add-unit-ptac"),
  });

  // 8. AI nameplate callout (text + visual mini-banners drawn in PDF)
  sections.push({
    kind: "ocr-callout",
    title: "8. AI nameplate reading",
    intro: [
      "Snap a photo of the nameplate and Claude AI reads the make, model, and serial straight off the label. Within about 5 seconds, the fields below the photo fill in by themselves. No typing needed.",
      "A small banner above the fields tells you how the read went. You will see one of these three:",
    ],
    outro: [
      "If you retake the nameplate later, the AI reads it again. Anything you have already corrected by hand stays as you typed it. The AI never overwrites your edits.",
      "This works offline too. The photo waits in the queue and the AI fills in the fields as soon as you are back on a signal.",
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
      "When you are done capturing units, tap Submit job on the job detail screen. It brings you here.",
      "Crew on site is pre-filled from what you picked at job creation. Tap Edit if anyone left mid-day or extra hands joined.",
      "Tap the red Submit job button at the bottom. The app finalizes the job and drops you back at the jobs list with a confirmation message.",
      "Photos that have not finished uploading yet keep uploading in the background. Submission is not blocked on a perfect upload queue.",
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
      "What you see right after you submit. The gold banner at the top confirms the dispatch was logged.",
      "The banner fades after a few seconds. The job itself drops off the active list once everything is wrapped, usually the same day.",
      "An automated service report is built in the background and saved to the customer's Drive folder once all photos finish uploading.",
    ],
    file: await shot(page, 10, "submitted-toast"),
  });

  // 11. Pending uploads callout
  sections.push({
    kind: "callout",
    title: "11. Photos uploading and stuck retries",
    body: [
      "Right after you capture a photo, it goes into a local queue that uploads in the background. You will see a small \"X pending\" pill next to your name in the header. That is the upload counter.",
      "Tap the pill to open the queue inspector. It shows every photo that is still in flight, plus any draft jobs or units waiting to sync because you were offline when you created them.",
      "If a photo has been stuck for more than a minute, the app auto-retries it. After 12 failed tries it shows a red error. Tap the circular arrow next to that photo to force another attempt, or tap \"Retry everything\" at the top of the inspector to reset every stuck item at once.",
      "Photos stay safe on the phone even after they upload. They are kept locally as a 14-day backup. Tap the floppy-disk icon to pin a specific photo so it never auto-deletes.",
      "Going offline mid-job is fine. The app keeps capturing into the queue and drains it the next time you are back on cell or WiFi. Job submission also works offline. The dispatch will sync once you are connected again.",
    ],
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
    doc.image(fs.readFileSync(logoPath), PAGE_W / 2 - 56, 120, {
      width: 112,
      height: 112,
    });
  }
  doc
    .fillColor(NAVY)
    .font("Helvetica-Bold")
    .fontSize(30)
    .text("Maryland Smart Energy", 0, 270, { align: "center" });
  doc
    .fillColor(NAVY)
    .font("Helvetica-Bold")
    .fontSize(30)
    .text("field app", 0, 306, { align: "center" });
  doc
    .moveTo(PAGE_W / 2 - 60, 358)
    .lineTo(PAGE_W / 2 + 60, 358)
    .strokeColor(GOLD)
    .lineWidth(2)
    .stroke();
  doc
    .fillColor(NAVY)
    .font("Helvetica")
    .fontSize(18)
    .text("Training Manual", 0, 372, { align: "center" });
  doc
    .fillColor(MUTED)
    .fontSize(12)
    .text(
      "This manual walks you through the field app screen by screen. " +
        "Read it before your first job, and keep it handy whenever you " +
        "are not sure what a button does. Each section shows a real " +
        "screen from the app and explains what to tap, where things go, " +
        "and what to do when something does not work the way you expect.",
      80,
      420,
      { width: PAGE_W - 160, align: "center", lineGap: 4 }
    );
  doc
    .fillColor(MUTED)
    .fontSize(10)
    .text(
      `Last updated ${new Date().toLocaleDateString("en-US", {
        dateStyle: "long",
      })}`,
      0,
      PAGE_H - 90,
      { align: "center" }
    );
  doc
    .fillColor(MUTED)
    .fontSize(9)
    .text("Maryland Smart Energy internal use", 0, PAGE_H - 72, {
      align: "center",
    });

  // ── Sections ──
  for (const s of sections) {
    doc.addPage();
    if (s.kind === "shot") renderShotPage(doc, s);
    else if (s.kind === "ocr-callout") renderOcrCalloutPage(doc, s);
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
    .text("Field app training manual", MARGIN, PAGE_H - 36, {
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

// ── Mini-banner reproductions for the OCR callout ───────────────────

// Sparkle icon: 4-pointed star drawn with two thin diamonds.
function drawSparkleIcon(doc, cx, cy, size, color) {
  doc.save();
  doc.fillColor(color);
  const h = size / 2;
  // Vertical diamond
  doc
    .moveTo(cx, cy - h)
    .lineTo(cx + h * 0.32, cy)
    .lineTo(cx, cy + h)
    .lineTo(cx - h * 0.32, cy)
    .closePath()
    .fill();
  // Horizontal diamond (slightly narrower)
  doc
    .moveTo(cx - h, cy)
    .lineTo(cx, cy + h * 0.28)
    .lineTo(cx + h, cy)
    .lineTo(cx, cy - h * 0.28)
    .closePath()
    .fill();
  doc.restore();
}

// Alert triangle icon with a tiny bang inside.
function drawTriangleIcon(doc, cx, cy, size, color) {
  doc.save();
  doc.fillColor(color);
  const h = size / 2;
  doc
    .moveTo(cx, cy - h)
    .lineTo(cx + h * 0.95, cy + h * 0.72)
    .lineTo(cx - h * 0.95, cy + h * 0.72)
    .closePath()
    .fill();
  // Bang stroke + dot in white
  doc.fillColor("#FFFFFF");
  doc.rect(cx - 0.6, cy - h * 0.18, 1.2, h * 0.55).fill();
  doc.circle(cx, cy + h * 0.5, 0.9).fill();
  doc.restore();
}

function drawMiniBanner(doc, x, y, width, opts) {
  const { bg, border, iconColor, iconType, headline, body, textColor } = opts;
  const padX = 14;
  const padY = 12;
  const iconBox = 16;
  const gap = 10;
  const textX = x + padX + iconBox + gap;
  const textW = width - padX - iconBox - gap - padX;

  // Measure body so the banner sizes itself nicely.
  doc.font("Helvetica").fontSize(10);
  const headlineW = doc.widthOfString(headline + " ");
  const bodyHeight = doc.heightOfString(headline + " " + body, {
    width: textW,
    lineGap: 2,
  });
  const h = Math.max(40, bodyHeight + padY * 2);

  // Background + border
  doc.save();
  doc.roundedRect(x, y, width, h, 8).fillColor(bg).fill();
  doc.roundedRect(x, y, width, h, 8).strokeColor(border).lineWidth(1).stroke();
  doc.restore();

  // Icon
  const iconCx = x + padX + iconBox / 2;
  const iconCy = y + padY + iconBox / 2;
  if (iconType === "sparkle") {
    drawSparkleIcon(doc, iconCx, iconCy, iconBox, iconColor);
  } else {
    drawTriangleIcon(doc, iconCx, iconCy, iconBox, iconColor);
  }

  // Text: bold headline + normal body, on one wrapped block
  doc.fillColor(textColor).font("Helvetica-Bold").fontSize(10);
  doc.text(headline, textX, y + padY, {
    width: textW,
    lineGap: 2,
    continued: true,
  });
  doc.font("Helvetica").text(" " + body, { width: textW, lineGap: 2 });

  return h;
}

function renderOcrCalloutPage(doc, section) {
  const afterTitle = renderTitle(doc, section.title);
  const afterIntro = renderBody(doc, section.intro, afterTitle);

  // Three mini-banner reproductions, stacked.
  let y = afterIntro + 8;
  const w = CONTENT_W;
  y += drawMiniBanner(doc, MARGIN, y, w, {
    bg: "#FFF8E5",
    border: "#F0D27B",
    iconColor: GOLD,
    iconType: "sparkle",
    textColor: NAVY,
    headline: "Auto-filled from photo.",
    body: "Edit anything below if it is off. (High confidence read.)",
  }) + 10;
  y += drawMiniBanner(doc, MARGIN, y, w, {
    bg: "#FEF2F2",
    border: "#FECACA",
    iconColor: "#B91C1C",
    iconType: "triangle",
    textColor: "#B91C1C",
    headline: "Auto-filled, please review for accuracy.",
    body: "Some characters may be hard to read in the photo. (Medium confidence read.)",
  }) + 10;
  y += drawMiniBanner(doc, MARGIN, y, w, {
    bg: "#F3F4F6",
    border: LIGHT,
    iconColor: MUTED,
    iconType: "triangle",
    textColor: MUTED,
    headline: "Could not read the nameplate clearly.",
    body: "Please type the info below. (Photo was blurry or angled.)",
  }) + 16;

  // Closing text after the banners.
  renderBody(doc, section.outro, y);
  renderFooter(doc);
}

function renderCalloutPage(doc, section) {
  const afterTitle = renderTitle(doc, section.title);
  const afterBody = renderBody(doc, section.body, afterTitle + 4);

  // Closing tip box for callouts that benefit from one.
  const tip = tipForSection(section.title);
  if (!tip) {
    renderFooter(doc);
    return;
  }
  const boxTop = Math.min(afterBody + 16, PAGE_H - 200);
  const boxH = Math.min(160, PAGE_H - 60 - boxTop);
  doc
    .roundedRect(MARGIN, boxTop, CONTENT_W, boxH, 10)
    .fillColor("#FFF8E5")
    .fill();
  doc
    .roundedRect(MARGIN, boxTop, CONTENT_W, boxH, 10)
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
    .text(tip, MARGIN + 18, boxTop + 42, {
      width: CONTENT_W - 36,
      lineGap: 3,
    });

  renderFooter(doc);
}

function tipForSection(title) {
  if (title.includes("uploading")) {
    return (
      "Do not stress about the upload counter. Photos are safe on the " +
      "phone even before they reach the cloud. Losing service does not " +
      "lose your work. Just keep capturing. The queue drains itself."
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
