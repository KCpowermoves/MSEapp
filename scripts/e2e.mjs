#!/usr/bin/env node
// End-to-end test harness — exercises the full happy path against
// localhost:3000 using Puppeteer. Captures network traffic, console
// output, and per-step screenshots so failures are debuggable.
//
// Run: node scripts/e2e.mjs [baseUrl] [pin]

import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const screenshotsDir = path.join(projectRoot, "e2e-screenshots");
fs.mkdirSync(screenshotsDir, { recursive: true });

const BASE = process.argv[2] || "http://localhost:3000";
const PIN = process.argv[3] || "1234";

const log = (...args) => console.log(...args);
const ok = (msg) => console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
const fail = (msg) => console.log(`  \x1b[31m✗\x1b[0m ${msg}`);
const step = (msg) => console.log(`\n\x1b[1m${msg}\x1b[0m`);

function makeJpegBuffer() {
  // Minimal valid JPEG (1×1 white pixel) — enough for the camera input
  // and for browser-image-compression to process without error.
  return Buffer.from(
    "ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffdb0043010909090c0b0c180d0d1832211c2132323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232ffc00011080001000103012200021101031101ffc4001f0000010501010101010100000000000000000102030405060708090a0bffc400b5100002010303020403050504040000017d01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffc4001f0100030101010101010101010000000000000102030405060708090a0bffc400b51100020102040403040705040400010277000102031104052131061241510761711322328108144291a1b1c109233352f0156272d10a162434e125f11718191a262728292a35363738393a434445464748494a535455565758595a636465666768696a737475767778797a82838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae2e3e4e5e6e7e8e9eaf2f3f4f5f6f7f8f9faffda000c03010002110311003f00fbfca28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2803ffd9",
    "hex"
  );
}

async function shot(page, name) {
  const file = path.join(screenshotsDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
}

async function main() {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 });

  const networkLog = [];
  const consoleLog = [];

  page.on("response", async (res) => {
    const url = new URL(res.url());
    if (url.pathname.startsWith("/api/")) {
      let body = "";
      try {
        body = (await res.text()).slice(0, 400);
      } catch {}
      networkLog.push({
        method: res.request().method(),
        url: url.pathname + url.search,
        status: res.status(),
        body,
      });
    }
  });
  page.on("console", (msg) => {
    consoleLog.push(`[${msg.type()}] ${msg.text()}`);
  });
  page.on("pageerror", (err) => {
    consoleLog.push(`[pageerror] ${err.message}`);
  });

  let failed = false;
  const setFail = (m) => {
    failed = true;
    fail(m);
  };

  try {
    step("1. Open login screen");
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
    await shot(page, "01-login");
    const hasKeypad = await page.$("button");
    hasKeypad ? ok("login keypad rendered") : setFail("no keypad");

    step(`2. Enter PIN ${PIN}`);
    for (const digit of PIN) {
      await page.evaluate((d) => {
        const btn = Array.from(document.querySelectorAll("button")).find(
          (b) => b.textContent.trim() === d
        );
        btn?.click();
      }, digit);
      await new Promise((r) => setTimeout(r, 80));
    }
    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 8000 });
    await shot(page, "02-jobs-home");
    if (!page.url().endsWith("/jobs")) {
      setFail(`expected /jobs, got ${page.url()}`);
      throw new Error("login failed");
    }
    ok(`landed on ${page.url()}`);

    step("3. Create new job");
    const newJobLink = await page.$('a[href="/jobs/new"]');
    await newJobLink.click();
    await page.waitForNavigation({ waitUntil: "networkidle2" });
    await shot(page, "03-new-job-form");

    const customer = `E2E ${Date.now()}`;
    await page.type('input[type="text"]', customer);
    await page.type("textarea", "1234 Test Rd, Towson MD 21204");
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent.trim() === "Delmarva"
      );
      btn?.click();
    });
    await new Promise((r) => setTimeout(r, 200));
    await shot(page, "04-new-job-filled");

    // Submit
    const beforeUrl = page.url();
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent.trim() === "Create job"
      );
      btn?.click();
    });
    await page.waitForFunction(
      (b) => location.pathname !== new URL(b).pathname,
      { timeout: 12000 },
      beforeUrl
    );
    await new Promise((r) => setTimeout(r, 1500));
    await shot(page, "05-job-detail");
    const jobId = page.url().split("/").pop();
    ok(`job created: ${decodeURIComponent(jobId)}`);

    step("4. Set Today's crew + Add unit");
    await page.evaluate(() => {
      // Today's crew is a CrewPicker, find Kevin Lee chip
      const btn = Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent.trim() === "Kevin Lee"
      );
      btn?.click();
    });
    await new Promise((r) => setTimeout(r, 300));
    await shot(page, "06-crew-set");

    // Click Add unit
    await page.evaluate(() => {
      const link = Array.from(document.querySelectorAll("a")).find(
        (a) => a.textContent.includes("Add unit")
      );
      link?.click();
    });
    await page.waitForNavigation({ waitUntil: "networkidle2" });
    await shot(page, "07-add-unit-form");

    step("5. Fill unit form + capture 4 photos");
    // Unit type: PTAC
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent.trim().startsWith("PTAC")
      );
      btn?.click();
    });

    // Capture each photo by uploading a JPEG buffer to each file input
    const buffer = makeJpegBuffer();
    const tmpFile = path.join(screenshotsDir, "_test.jpg");
    fs.writeFileSync(tmpFile, buffer);

    const inputs = await page.$$('input[type="file"]');
    log(`  found ${inputs.length} file inputs`);
    // Upload to first 4 (pre, post, clean, nameplate — required ones).
    // After each upload wait for the slot's "Captured" label to appear
    // before moving on, otherwise rapid React state updates can stomp
    // each other.
    for (let i = 0; i < Math.min(4, inputs.length); i++) {
      const beforeCount = await page.evaluate(
        () => (document.body.innerText.match(/Captured/g) || []).length
      );
      await inputs[i].uploadFile(tmpFile);
      await page
        .waitForFunction(
          (b) => (document.body.innerText.match(/Captured/g) || []).length > b,
          { timeout: 8000 },
          beforeCount
        )
        .catch(() => {});
      log(`    uploaded photo ${i + 1}/4`);
    }
    // Final verification: 4 slots should show "Captured"
    const capturedCount = await page.evaluate(
      () => (document.body.innerText.match(/Captured/g) || []).length
    );
    log(`  ${capturedCount} slots captured`);
    await shot(page, "08-photos-captured");
    if (capturedCount < 4) {
      setFail(`only ${capturedCount}/4 required photos captured`);
      throw new Error("photo capture race");
    }

    step("6. Save unit");
    const beforeUrl2 = page.url();
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent.trim().startsWith("Save unit")
      );
      btn?.click();
    });
    await page.waitForFunction(
      (b) => location.pathname !== new URL(b).pathname,
      { timeout: 12000 },
      beforeUrl2
    );
    await new Promise((r) => setTimeout(r, 1000));
    await shot(page, "09-after-save-unit");

    step("7. Wait for upload queue to drain (up to 60s)");
    let queueDepth = -1;
    const start = Date.now();
    while (Date.now() - start < 60_000) {
      queueDepth = await page.evaluate(async () => {
        const dbReq = indexedDB.open("mse-field-upload-queue");
        return new Promise((resolve) => {
          dbReq.onsuccess = () => {
            const db = dbReq.result;
            if (!db.objectStoreNames.contains("photos"))
              return resolve(0);
            const tx = db.transaction("photos", "readonly");
            const store = tx.objectStore("photos");
            const req = store.count();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(-1);
          };
          dbReq.onerror = () => resolve(-1);
        });
      });
      if (queueDepth === 0) break;
      log(`    queue depth: ${queueDepth}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
    if (queueDepth === 0) {
      ok("upload queue drained");
    } else {
      setFail(`upload queue stuck at ${queueDepth} after 60s`);
    }

    step("8. Reload job detail and verify unit + photos");
    await page.goto(`${BASE}/jobs/${jobId}`, { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 1500));
    await shot(page, "10-job-detail-after-upload");
    const allUploaded = await page.evaluate(() => {
      const text = document.body.innerText;
      return /4\/4/.test(text);
    });
    if (allUploaded) ok("unit shows 4/4 photos");
    else setFail("unit doesn't show 4/4 photos");

    step("9. Submit dispatch");
    await page.evaluate(() => {
      const link = Array.from(document.querySelectorAll("a")).find(
        (a) => a.textContent.trim() === "Submit dispatch"
      );
      link?.click();
    });
    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 8000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1000));
    await shot(page, "11-submit-dispatch-form");

    // Click Submit
    const beforeUrl3 = page.url();
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent.trim() === "Submit"
      );
      btn?.click();
    });
    await page.waitForFunction(
      (b) => location.pathname !== new URL(b).pathname,
      { timeout: 8000 },
      beforeUrl3
    ).catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));
    await shot(page, "12-after-dispatch-submit");
    if (page.url().includes("/jobs")) ok("dispatch submitted, returned to /jobs");
    else setFail(`unexpected url after submit: ${page.url()}`);
  } catch (e) {
    setFail(`exception: ${e.message}`);
    console.error(e);
  }

  console.log("\n=== API CALLS ===");
  for (const r of networkLog) {
    const status = r.status >= 400 ? `\x1b[31m${r.status}\x1b[0m` : `\x1b[32m${r.status}\x1b[0m`;
    console.log(`  ${r.method} ${r.url} → ${status}`);
    if (r.status >= 400 && r.body) console.log(`    body: ${r.body}`);
  }

  console.log("\n=== CONSOLE ===");
  const interesting = consoleLog.filter(
    (l) => !l.includes("[verbose]") && !l.includes("[debug]")
  );
  for (const l of interesting.slice(0, 50)) console.log(`  ${l}`);
  if (interesting.length > 50)
    console.log(`  ... and ${interesting.length - 50} more`);

  await browser.close();

  console.log(
    `\n\x1b[1m${failed ? "\x1b[31mFAILED" : "\x1b[32mPASSED"}\x1b[0m`
  );
  console.log(`Screenshots: ${screenshotsDir}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error("Harness crashed:", e);
  process.exit(1);
});
