#!/usr/bin/env node
// Puppeteer smoke test for the payroll UI:
//   1. Hit /admin/payroll unauth — should redirect to /login
//   2. Screenshot the login page (proves app renders)
//   3. Hit a few API routes — should return JSON 401 (not 500)
//
// Run with the dev server already up:
//   node scripts/puppeteer-smoke.mjs http://localhost:3001

import puppeteer from "puppeteer";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = path.join(process.cwd(), "temporary screenshots");
mkdirSync(OUT, { recursive: true });

function shotPath(label) {
  const i = Date.now();
  return path.join(OUT, `payroll-${label}-${i}.png`);
}

let pass = 0;
let fail = 0;
function check(label, cond, detail = "") {
  if (cond) {
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
    pass++;
  } else {
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    fail++;
  }
}

console.log(`\nPuppeteer smoke against ${BASE}\n`);

// ── API checks first (don't need a browser) ──────────────────────────
console.log("API auth surface:");
for (const route of [
  "/api/admin/payroll/periods",
  "/api/admin/payroll/preview",
  "/api/admin/payroll/adjustments",
  "/api/admin/payroll/reattribute",
  "/api/admin/payroll/split-change",
]) {
  const res = await fetch(`${BASE}${route}`, {
    method: route === "/api/admin/payroll/preview" ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: route === "/api/admin/payroll/preview" ? undefined : "{}",
  });
  const ok = res.status === 400 || res.status === 401;
  check(
    `${route} → ${res.status}`,
    ok,
    ok ? "" : "expected 401/400 for unauthed call"
  );
}

// ── Now the UI ───────────────────────────────────────────────────────
console.log("\nUI smoke:");
const browser = await puppeteer.launch({
  headless: "new",
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  // 1. Tech-facing /payroll — should redirect to /login when unauth
  const techResp = await page.goto(`${BASE}/payroll`, {
    waitUntil: "networkidle0",
  });
  check(
    "/payroll renders without 500",
    techResp.status() < 500,
    `status ${techResp.status()}`
  );
  check(
    "Unauthed /payroll → /login",
    page.url().endsWith("/login"),
    `landed at ${page.url()}`
  );

  let loginShot = shotPath("login");
  await page.screenshot({ path: loginShot, fullPage: true });
  console.log(`    screenshot: ${path.basename(loginShot)}`);

  // 2. Admin /admin/payroll — same redirect path
  const adminResp = await page.goto(`${BASE}/admin/payroll`, {
    waitUntil: "networkidle0",
  });
  check(
    "/admin/payroll renders without 500",
    adminResp.status() < 500,
    `status ${adminResp.status()}`
  );
  check(
    "Unauthed /admin/payroll → /login",
    page.url().endsWith("/login"),
    `landed at ${page.url()}`
  );

  // 3. Look for the PIN entry on the login page so we know the
  //    underlying auth pipeline didn't get clobbered
  const pinDigits = await page.$$("button");
  check(
    "Login page has PIN keypad buttons",
    pinDigits.length >= 10,
    `${pinDigits.length} buttons found`
  );

  // 4. Hit a list of payroll-specific endpoints to ensure they 401
  //    rather than 500 (auth chain intact)
  const techExport = await fetch(
    `${BASE}/api/payroll/periods/FAKE/export?format=pdf`
  );
  check(
    `/api/payroll/.../export (tech) → ${techExport.status}`,
    techExport.status === 401,
    "expected 401 unauthed"
  );
} finally {
  await browser.close();
}

console.log(`\nResults: ${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
