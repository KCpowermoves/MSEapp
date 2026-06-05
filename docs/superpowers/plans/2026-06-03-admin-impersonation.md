# Admin Impersonation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "View as Joe W" flow for admins — pick a tech from `/admin/techs`, cookie swaps to the tech's identity (admin's real identity preserved on the same cookie), persistent yellow banner offers Exit at all times. Sidecar Impersonation Log tab tracks every start/exit.

**Architecture:** Reuses the existing iron-session cookie. SessionData gains two optional fields (`impersonatorTechId`, `impersonatorName`). When set, all existing reads of `session.techId/name/isAdmin` resolve to the impersonated tech, so the entire app behaves as that tech with zero code changes downstream. New API routes flip the fields; new banner reads them; new admin page initiates them.

**Tech Stack:** Next.js 14 App Router, iron-session, Google Sheets, existing PowerShell/curl + `npm run build` verification (no unit-test framework).

**Spec reference:** [docs/superpowers/specs/2026-06-03-admin-impersonation-design.md](../specs/2026-06-03-admin-impersonation-design.md)

---

## Phase 0 — Sheet schema (2 tasks)

### Task 1: Add `Impersonation Log` to `seed/init-sheet.mjs`

**Files:**
- Modify: `seed/init-sheet.mjs`

- [ ] **Step 1: Append a new sheet definition after the existing `Audit Items` entry**

```js
  {
    name: "Impersonation Log",
    headers: [
      "Log ID",
      "Timestamp",
      "Event Type",
      "Admin Tech ID",
      "Admin Name",
      "Target Tech ID",
      "Target Name",
      "Notes",
    ],
    validations: [
      { col: "C", values: ["Start", "Exit"] },
    ],
    frozenRows: 1,
  },
```

- [ ] **Step 2: Verify parse**

Run: `node -e "import('./seed/init-sheet.mjs').then(() => console.log('ok'))"`
Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add seed/init-sheet.mjs
git commit -m "Impersonation: add Impersonation Log schema to seed"
```

---

### Task 2: One-off `init-impersonation-tab.mjs` + run on live sheet

**Files:**
- Create: `scripts/init-impersonation-tab.mjs`

- [ ] **Step 1: Write the script**

Mirror `scripts/init-audit-tabs.mjs` exactly, but with a single-tab `TABS` array:

```js
#!/usr/bin/env node
// Idempotent: creates the "Impersonation Log" tab on the production
// sheet if it doesn't already exist. Safe to re-run.
//
// Usage:
//   node scripts/init-impersonation-tab.mjs           # dry run
//   node scripts/init-impersonation-tab.mjs --apply   # commit changes

import { google } from "googleapis";
import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "..", ".env.local") });

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SA_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const SA_KEY = (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ?? "").replace(
  /\\n/g,
  "\n"
);

if (!SHEET_ID || !SA_EMAIL || !SA_KEY) {
  console.error("Missing Google service-account env vars in .env.local");
  process.exit(1);
}

const apply = process.argv.includes("--apply");

const TABS = [
  {
    name: "Impersonation Log",
    headers: [
      "Log ID",
      "Timestamp",
      "Event Type",
      "Admin Tech ID",
      "Admin Name",
      "Target Tech ID",
      "Target Name",
      "Notes",
    ],
    validations: [{ col: "C", values: ["Start", "Exit"] }],
  },
];

const auth = new google.auth.JWT({
  email: SA_EMAIL,
  key: SA_KEY,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

function colIndex(letter) {
  return letter.toUpperCase().charCodeAt(0) - "A".charCodeAt(0);
}

async function main() {
  console.log(apply ? "APPLY MODE" : "DRY RUN — pass --apply to commit");
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const existing = new Set(meta.data.sheets.map((s) => s.properties.title));
  for (const tab of TABS) {
    if (existing.has(tab.name)) {
      console.log(`  [skip] "${tab.name}" already exists`);
      continue;
    }
    console.log(`  [plan] create "${tab.name}" with ${tab.headers.length} cols`);
    if (!apply) continue;
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: tab.name,
                gridProperties: { frozenRowCount: 1 },
              },
            },
          },
        ],
      },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${tab.name}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [tab.headers] },
    });
    const sheetMeta = (
      await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID })
    ).data.sheets.find((s) => s.properties.title === tab.name);
    const sheetId = sheetMeta.properties.sheetId;
    const validationRequests = tab.validations.map((v) => ({
      setDataValidation: {
        range: {
          sheetId,
          startRowIndex: 1,
          startColumnIndex: colIndex(v.col),
          endColumnIndex: colIndex(v.col) + 1,
        },
        rule: {
          condition: {
            type: "ONE_OF_LIST",
            values: v.values.map((value) => ({ userEnteredValue: value })),
          },
          showCustomUi: true,
          strict: true,
        },
      },
    }));
    if (validationRequests.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: { requests: validationRequests },
      });
    }
    console.log(`  [done] created "${tab.name}"`);
  }
  console.log(apply ? "\nDone." : "\nDry run complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Dry run**

Run: `node scripts/init-impersonation-tab.mjs`
Expected: `[plan] create "Impersonation Log" with 8 cols`.

- [ ] **Step 3: Apply**

Run: `node scripts/init-impersonation-tab.mjs --apply`
Expected: `[done] created "Impersonation Log"`.

- [ ] **Step 4: Verify**

```bash
node -e "
import('googleapis').then(async ({ google }) => {
  const { config } = await import('dotenv');
  config({ path: '.env.local' });
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY||'').replace(/\\\\n/g, String.fromCharCode(10)),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const meta = await sheets.spreadsheets.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, fields: 'sheets.properties.title' });
  console.log('Has Impersonation Log:', meta.data.sheets.map(s => s.properties.title).includes('Impersonation Log'));
});
"
```
Expected: `Has Impersonation Log: true`.

- [ ] **Step 5: Commit**

```bash
git add scripts/init-impersonation-tab.mjs
git commit -m "Impersonation: one-off init script for Impersonation Log tab (applied)"
```

---

## Phase 1 — Types + IDs + data layer (3 tasks)

### Task 3: Extend `TABS`, `SessionData`, and ID generator

**Files:**
- Modify: `lib/google/sheets.ts`
- Modify: `lib/types.ts`
- Modify: `lib/id-generators.ts`

- [ ] **Step 1: Add `impersonationLog` to the `TABS` object**

In `lib/google/sheets.ts`, inside the `TABS` literal, add after `auditItems`:

```ts
  // Append-only audit trail of admin "View as Joe W" sessions.
  impersonationLog: "Impersonation Log",
```

- [ ] **Step 2: Extend `SessionData`**

In `lib/types.ts`, find the existing `SessionData` interface and add the two optional fields:

```ts
export interface SessionData {
  techId: string;
  name: string;
  loggedInAt: number;
  isAdmin?: boolean;
  /** When set, the cookie's identity (techId/name/isAdmin) is the
   *  impersonated tech and these fields carry the real admin who
   *  initiated impersonation. Cleared by /api/admin/impersonate/exit. */
  impersonatorTechId?: string;
  impersonatorName?: string;
}
```

- [ ] **Step 3: Add `nextImpersonationLogId`**

In `lib/id-generators.ts`, append:

```ts
export async function nextImpersonationLogId(): Promise<string> {
  const year = currentYear();
  const prefix = `IMP-${year}-`;
  const max = await getMaxIdNumber(TABS.impersonationLog, "A", prefix);
  return `${prefix}${pad(max + 1, 5)}`;
}
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add lib/google/sheets.ts lib/types.ts lib/id-generators.ts
git commit -m "Impersonation: TABS + SessionData fields + nextImpersonationLogId"
```

---

### Task 4: `lib/data/impersonation-log.ts` (append-only data layer)

**Files:**
- Create: `lib/data/impersonation-log.ts`

- [ ] **Step 1: Write the module**

```ts
import "server-only";
import { TABS, appendRow, readTab } from "@/lib/google/sheets";
import { nextImpersonationLogId } from "@/lib/id-generators";
import { nowIso } from "@/lib/utils";

export type ImpersonationEventType = "Start" | "Exit";

export interface ImpersonationLogEntry {
  logId: string;
  timestamp: string;
  eventType: ImpersonationEventType;
  adminTechId: string;
  adminName: string;
  targetTechId: string;
  targetName: string;
  notes: string;
}

function rowToEntry(row: string[]): ImpersonationLogEntry {
  return {
    logId: String(row[0] ?? ""),
    timestamp: String(row[1] ?? ""),
    eventType: (row[2] as ImpersonationEventType) || "Start",
    adminTechId: String(row[3] ?? ""),
    adminName: String(row[4] ?? ""),
    targetTechId: String(row[5] ?? ""),
    targetName: String(row[6] ?? ""),
    notes: String(row[7] ?? ""),
  };
}

export async function listImpersonationLog(
  opts: { fresh?: boolean } = {}
): Promise<ImpersonationLogEntry[]> {
  const rows = await readTab(TABS.impersonationLog, opts);
  return rows.filter((r) => r[0]).map(rowToEntry);
}

/**
 * Recent N entries, most recent first. Used by the /admin/techs page.
 */
export async function listRecentImpersonations(
  limit = 10
): Promise<ImpersonationLogEntry[]> {
  const all = await listImpersonationLog();
  return all
    .slice()
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, limit);
}

export async function logImpersonationEvent(opts: {
  eventType: ImpersonationEventType;
  adminTechId: string;
  adminName: string;
  targetTechId: string;
  targetName: string;
  notes?: string;
}): Promise<void> {
  const logId = await nextImpersonationLogId();
  await appendRow(TABS.impersonationLog, [
    logId,
    nowIso(),
    opts.eventType,
    opts.adminTechId,
    opts.adminName,
    opts.targetTechId,
    opts.targetName,
    opts.notes ?? "",
  ]);
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add lib/data/impersonation-log.ts
git commit -m "Impersonation: lib/data/impersonation-log.ts append-only log"
```

---

### Task 5: `lib/auth/impersonation.ts` helpers

**Files:**
- Create: `lib/auth/impersonation.ts`

- [ ] **Step 1: Write the helpers**

```ts
import "server-only";
import { getSession, loadAllTechs } from "@/lib/auth";
import { logImpersonationEvent } from "@/lib/data/impersonation-log";

/**
 * True when the current session is impersonating someone.
 * Cheap inline check — used by middleware / route guards.
 */
export async function isImpersonating(): Promise<boolean> {
  const session = await getSession();
  return Boolean(session.impersonatorTechId);
}

/**
 * Start impersonating a target tech. Caller must be admin (caller is
 * responsible for the requireAdmin() check upstream). Throws if the
 * target doesn't exist or isn't active.
 */
export async function startImpersonation(
  targetTechId: string
): Promise<void> {
  const session = await getSession();
  if (!session.techId) throw new Error("Not authenticated");
  if (!session.isAdmin) throw new Error("Admin only");

  const techs = await loadAllTechs();
  const target = techs.find((t) => t.techId === targetTechId);
  if (!target) throw new Error("Target tech not found");
  if (!target.active) throw new Error("Target tech is not active");

  // Stash the admin's real identity in the impersonator fields, swap
  // the effective identity to the target. Cookie still proves who
  // initiated when we exit.
  const adminTechId = session.techId;
  const adminName = session.name;

  session.impersonatorTechId = adminTechId;
  session.impersonatorName = adminName;
  session.techId = target.techId;
  session.name = target.name;
  session.isAdmin = target.isAdmin;
  await session.save();

  await logImpersonationEvent({
    eventType: "Start",
    adminTechId,
    adminName,
    targetTechId: target.techId,
    targetName: target.name,
  });
}

/**
 * End impersonation. Resolves the real admin from the impersonator
 * field on the cookie. Re-reads their current Techs row so name +
 * isAdmin are accurate (in case they changed mid-session). Cleared
 * cookie reverts to a normal admin session.
 *
 * Bypasses the admin check — the impersonator field is the proof that
 * an admin originally initiated this session.
 */
export async function exitImpersonation(): Promise<void> {
  const session = await getSession();
  if (!session.impersonatorTechId) {
    throw new Error("Not impersonating");
  }
  const realTechId = session.impersonatorTechId;
  const realNameAtStart = session.impersonatorName ?? "";

  const techs = await loadAllTechs();
  const real = techs.find((t) => t.techId === realTechId);
  if (!real) {
    // Edge case: admin was deactivated mid-session. Clear cookie
    // anyway so they're forced back to login.
    session.destroy();
    throw new Error("Original admin no longer exists");
  }

  const targetTechId = session.techId;
  const targetName = session.name;

  session.techId = real.techId;
  session.name = real.name;
  session.isAdmin = real.isAdmin;
  delete session.impersonatorTechId;
  delete session.impersonatorName;
  await session.save();

  await logImpersonationEvent({
    eventType: "Exit",
    adminTechId: realTechId,
    adminName: real.name || realNameAtStart,
    targetTechId,
    targetName,
  });
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add lib/auth/impersonation.ts
git commit -m "Impersonation: startImpersonation + exitImpersonation helpers"
```

---

## Phase 2 — API routes (2 tasks)

### Task 6: `POST /api/admin/impersonate`

**Files:**
- Create: `app/api/admin/impersonate/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/payroll/auth";
import { startImpersonation } from "@/lib/auth/impersonation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if ("response" in guard) return guard.response;

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const targetTechId = String(body.targetTechId ?? "").trim();
  if (!targetTechId) {
    return NextResponse.json({ error: "Missing targetTechId" }, { status: 400 });
  }

  try {
    await startImpersonation(targetTechId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[impersonate POST] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: route appears as `ƒ /api/admin/impersonate`.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/impersonate/route.ts
git commit -m "Impersonation: POST /api/admin/impersonate"
```

---

### Task 7: `POST /api/admin/impersonate/exit`

**Files:**
- Create: `app/api/admin/impersonate/exit/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { exitImpersonation } from "@/lib/auth/impersonation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// IMPORTANT: This route deliberately does NOT call requireAdmin().
// While impersonating, the effective identity is the tech (non-admin),
// so requireAdmin would block the very escape hatch. The proof that
// this caller is allowed to exit is the `impersonatorTechId` field
// on the cookie — only an admin's session could have set it.

export async function POST() {
  const session = await getSession();
  if (!session.techId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!session.impersonatorTechId) {
    return NextResponse.json(
      { error: "Not impersonating" },
      { status: 400 }
    );
  }

  try {
    await exitImpersonation();
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[impersonate/exit POST] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: route appears as `ƒ /api/admin/impersonate/exit`.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/impersonate/exit/route.ts
git commit -m "Impersonation: POST /api/admin/impersonate/exit"
```

---

## Phase 3 — UI (3 tasks)

### Task 8: `<ImpersonationBanner />` + wire into AppShell

**Files:**
- Create: `components/ImpersonationBanner.tsx`
- Modify: `components/AppShell.tsx`

- [ ] **Step 1: Write the banner component**

```tsx
"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  impersonatedName: string;
}

export function ImpersonationBanner({ impersonatedName }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function exit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/impersonate/exit", {
        method: "POST",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not exit");
      }
      // Full reload so every server component re-renders with the
      // admin identity restored.
      window.location.assign("/admin/techs");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  }

  return (
    <div
      role="alert"
      className={cn(
        "sticky top-0 z-30 w-full bg-yellow-300 border-b-2 border-yellow-400",
        "px-4 py-2 flex items-center gap-2"
      )}
    >
      <AlertTriangle className="w-4 h-4 text-mse-navy shrink-0" />
      <span className="text-xs font-bold text-mse-navy leading-tight flex-1 min-w-0 truncate">
        Viewing as <strong>{impersonatedName}</strong>
      </span>
      <button
        type="button"
        onClick={exit}
        disabled={busy}
        className={cn(
          "inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold",
          "bg-mse-navy text-white hover:bg-mse-navy-soft active:scale-95",
          busy && "opacity-60 cursor-wait"
        )}
      >
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <LogOut className="w-3 h-3" />}
        Exit
      </button>
      {error && (
        <div className="absolute top-full left-0 right-0 bg-mse-red text-white text-[11px] px-3 py-1">
          {error}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire into `AppShell`**

Read `components/AppShell.tsx` first to find the right insertion point — likely at the top of the rendered JSX so the banner sits above all content.

If `AppShell` is a server component, read the session there and pass `impersonatedName` to the banner. If it's a client component, the data must come from a prop passed by the parent layout.

Insert immediately above the existing top-level content:

```tsx
import { getSession } from "@/lib/auth";
import { ImpersonationBanner } from "@/components/ImpersonationBanner";

// inside the layout/component, at the top of the returned JSX:
{session.impersonatorTechId && (
  <ImpersonationBanner impersonatedName={session.name} />
)}
```

The exact integration depends on whether AppShell is server or client. If server, the conditional is straightforward. If client, lift the data fetch to the parent layout (`app/(app)/layout.tsx`) and pass through props.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add components/ImpersonationBanner.tsx components/AppShell.tsx
git commit -m "Impersonation: persistent yellow banner with Exit button"
```

---

### Task 9: `/admin/techs` page with View-as buttons + recent log

**Files:**
- Create: `app/(app)/admin/techs/page.tsx`
- Create: `components/admin/ImpersonateButton.tsx`

- [ ] **Step 1: Server page**

```tsx
import Link from "next/link";
import { ArrowLeft, Shield, User } from "lucide-react";
import { requireAdmin } from "@/lib/payroll/auth";
import { loadAllTechs } from "@/lib/auth";
import { listRecentImpersonations } from "@/lib/data/impersonation-log";
import { ImpersonateButton } from "@/components/admin/ImpersonateButton";

export const dynamic = "force-dynamic";

export default async function AdminTechsPage() {
  const guard = await requireAdmin();
  if ("response" in guard) return guard.response;

  const [techs, recent] = await Promise.all([
    loadAllTechs(),
    listRecentImpersonations(10),
  ]);
  const activeTechs = techs
    .filter((t) => t.active)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-6">
      <Link
        href="/admin"
        className="inline-flex items-center gap-1.5 text-xs text-mse-muted hover:text-mse-navy"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Admin
      </Link>

      <header>
        <div className="text-sm text-mse-muted">Admin</div>
        <h1 className="text-3xl font-bold text-mse-navy tracking-tight flex items-center gap-2">
          <Shield className="w-7 h-7 text-mse-gold" />
          View as Tech
        </h1>
        <p className="text-sm text-mse-muted mt-1 max-w-2xl">
          Diagnose what a tech sees — pick one to view the app from their
          identity. A persistent yellow banner reminds you you&apos;re
          impersonating; tap Exit to return.
        </p>
      </header>

      <section>
        <h2 className="text-sm font-semibold text-mse-muted uppercase tracking-wide mb-3">
          Active techs
        </h2>
        <ul className="space-y-2">
          {activeTechs.map((t) => (
            <li
              key={t.techId}
              className="bg-white rounded-2xl border border-mse-light p-4 shadow-card flex items-center gap-3"
            >
              <div className="w-10 h-10 rounded-full bg-mse-navy/10 flex items-center justify-center text-mse-navy font-bold text-sm shrink-0">
                {t.name.split(" ").map((p) => p[0] ?? "").filter(Boolean).slice(0, 2).join("").toUpperCase() || "?"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-mse-navy truncate flex items-center gap-1.5">
                  {t.name}
                  {t.isAdmin && (
                    <span className="text-[10px] font-bold uppercase tracking-wider bg-mse-gold/20 text-mse-navy px-1.5 py-0.5 rounded">
                      Admin
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-mse-muted font-mono">{t.techId}</div>
              </div>
              <ImpersonateButton
                targetTechId={t.techId}
                targetName={t.name}
              />
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-mse-muted uppercase tracking-wide mb-3">
          Recent impersonations
        </h2>
        {recent.length === 0 ? (
          <p className="text-xs text-mse-muted italic">No impersonations yet.</p>
        ) : (
          <ul className="space-y-1">
            {recent.map((e) => (
              <li
                key={e.logId}
                className="text-xs text-mse-muted bg-white border border-mse-light rounded-lg px-3 py-2 flex items-center justify-between gap-2"
              >
                <span className="flex items-center gap-1.5 min-w-0">
                  <User className="w-3 h-3 shrink-0" />
                  <strong className="text-mse-navy">{e.adminName}</strong>
                  <span>
                    {e.eventType === "Start" ? "started impersonating" : "exited impersonation of"}
                  </span>
                  <strong className="text-mse-navy truncate">{e.targetName}</strong>
                </span>
                <span className="text-mse-muted/80 whitespace-nowrap">
                  {formatStamp(e.timestamp)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function formatStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
```

- [ ] **Step 2: Write the client button**

```tsx
"use client";

import { useState } from "react";
import { Loader2, UserCheck } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  targetTechId: string;
  targetName: string;
}

export function ImpersonateButton({ targetTechId, targetName }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        `Start viewing the app as ${targetName}? You can exit any time from the yellow banner.`
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetTechId }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Could not start");
      window.location.assign("/jobs");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={start}
        disabled={busy}
        className={cn(
          "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold",
          "bg-mse-navy text-white hover:bg-mse-navy-soft active:scale-95",
          busy && "opacity-60 cursor-wait"
        )}
      >
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserCheck className="w-3 h-3" />}
        View as
      </button>
      {error && (
        <div className="text-[10px] text-mse-red">{error}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: build succeeds, route `/admin/techs` appears.

- [ ] **Step 4: Commit**

```bash
git add app/\(app\)/admin/techs/page.tsx components/admin/ImpersonateButton.tsx
git commit -m "Impersonation: /admin/techs page + ImpersonateButton + recent log list"
```

---

### Task 10: Add "View as Tech" tile on the existing `/admin` landing page

**Files:**
- Modify: `app/(app)/admin/page.tsx`

- [ ] **Step 1: Find the existing admin tile grid in `app/(app)/admin/page.tsx`**

Add a new entry pointing to `/admin/techs`. Style it consistently with the existing admin tiles (Library, Customers, Payroll, etc.). Reuse the same `<Link>` + card structure already present in the file. Example:

```tsx
<Link
  href="/admin/techs"
  className="block bg-white rounded-2xl border border-mse-light p-5 shadow-card hover:shadow-elevated active:scale-[0.99] transition-[transform,box-shadow]"
>
  <div className="flex items-center gap-3">
    <div className="w-10 h-10 rounded-full bg-mse-gold/20 flex items-center justify-center text-mse-navy font-bold text-lg shrink-0">
      👁
    </div>
    <div className="flex-1 min-w-0">
      <div className="font-bold text-mse-navy">View as Tech</div>
      <div className="text-[11px] text-mse-muted mt-0.5">
        Diagnose by impersonating a tech
      </div>
    </div>
  </div>
</Link>
```

The exact tile-grid markup in `app/(app)/admin/page.tsx` may differ from this — adapt the code to match the surrounding tile style (use the same className tokens as the neighboring tiles for consistent visual weight).

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add app/\(app\)/admin/page.tsx
git commit -m "Impersonation: add 'View as Tech' tile on /admin landing"
```

---

## Phase 4 — Final regression (1 task)

### Task 11: Full regression + smoke + push

**Files:** none

- [ ] **Step 1: Static gate**

```bash
npm run build
```

Expected: build succeeds. New routes appear:
- `ƒ /api/admin/impersonate`
- `ƒ /api/admin/impersonate/exit`
- `ƒ /admin/techs`

- [ ] **Step 2: Curl smoke (live, post-deploy)**

After merge + push, wait for Vercel deploy:

```bash
curl -sS -o /dev/null -w "POST impersonate: %{http_code}\n" -X POST https://ms-eapp.vercel.app/api/admin/impersonate -H "Content-Type: application/json" -d '{}' && \
curl -sS -o /dev/null -w "POST exit: %{http_code}\n" -X POST https://ms-eapp.vercel.app/api/admin/impersonate/exit && \
curl -sS -o /dev/null -w "GET /admin/techs: %{http_code}\n" https://ms-eapp.vercel.app/admin/techs
```

Expected:
- `POST impersonate: 401` (requires admin, unauthenticated)
- `POST exit: 401` (requires session, unauthenticated)
- `GET /admin/techs: 307` (redirects to login when unauthenticated — or 401 depending on guard)

- [ ] **Step 3: Browser walkthrough (manual, post-deploy)**

1. Log in as Kevin (admin)
2. Open `/admin/techs` → list of techs appears
3. Tap "View as Joe W"
4. Confirm dialog → land on `/jobs` with yellow banner
5. Open a job → behaves like Joe W (his name on entries, no admin UI)
6. Try to open `/admin` → 403
7. Tap Exit in the banner → back on `/admin/techs` as Kevin
8. Refresh the page → "Recent impersonations" shows the round-trip

- [ ] **Step 4: Final state check**

```bash
git status
```

Expected: clean working tree.

```bash
git log --oneline main..feature/admin-impersonation | wc -l
```

Expected: 11 commits.

---

## Notes for the implementer

- **No Co-Authored-By Claude lines** in commits (standing user rule).
- **Don't push** until Kevin says so (standing rule); the final push happens at the merge step which the controller will run.
- **Iron-session save call**: After modifying any session field, `await session.save()` is REQUIRED — otherwise the cookie doesn't update. The helpers in `lib/auth/impersonation.ts` already do this; don't skip it elsewhere.
- **Cookie SameSite=lax**: standard from iron-session config; cross-site impersonation isn't a concern here.
- **Memory: iOS stable-slot rule** does not apply to this feature (no photo upload).
- **Memory: don't auto-push** — controller handles the final `git push`.
