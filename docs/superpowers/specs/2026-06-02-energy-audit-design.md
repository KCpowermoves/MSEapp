# Energy Walkthrough Audit — Design

**Date:** 2026-06-02
**Owner:** Kevin
**Status:** Approved (pending spec review)

## Goal

Capture a building-level energy survey alongside the existing HVAC unit
tune-up data, so MSE has a complete property file for every job. The
audit is optional, save-as-you-go, and tech-completed in the field.

The same change replaces the current passive auto-finalize behavior
(server-side trigger on tech moving to next job + 8pm cron) with an
explicit `Job Complete` button — eliminating two pieces of magic the
tech doesn't see in exchange for one button they tap.

## Out of scope (v1)

- Pay attribution for audit items. Audit data is survey only; no money
  attaches.
- Xavier's BAS configuration workflow. The audit captures a single
  optional photo + note; Xavier handles BAS work outside this app.
- Audit history / versioning. The audit is a living document — edits
  overwrite in place.
- Admin "edit audit item" UI. v1 is read-only for admins; tech-side
  editing covers all data entry. (Deferred to a follow-up.)

## Data model

### New sheet tab: `Audits`

One row per job. Audit ID generated from a new counter (mirrors
`nextJobId()`).

| Col | Field | Type | Notes |
|---|---|---|---|
| A | AuditID | string | `AUD-2026-NNNN` |
| B | JobID | string | FK to Jobs.A |
| C | Status | enum | `Draft` / `Complete` |
| D | CreatedAt | ISO ts | |
| E | CreatedBy | string | tech name |
| F | UpdatedAt | ISO ts | |
| G | CompletedAt | ISO ts | empty until Audit Complete tapped |
| H | CompletedBy | string | empty until Audit Complete tapped |
| I | FrontPhotoUrl | string | Drive URL, optional |
| J | FirePlanPhotoUrl | string | Drive URL, optional |
| K | BasPhotoUrl | string | Drive URL, optional |
| L | BasNotes | string | free text, optional |
| M | Notes | string | free text |

### New sheet tab: `Audit Items`

One row per surveyed asset. Polymorphic by ItemType — different
ItemTypes use different subsets of photo columns. Empty columns stay
empty, same pattern Units sheet uses today for PTAC vs RTU slots.

| Col | Field | Type | Notes |
|---|---|---|---|
| A | ItemID | string | `AI-2026-NNNNN` |
| B | AuditID | string | FK to Audits.A |
| C | JobID | string | duplicated FK for fast filters |
| D | ItemType | enum | `Walk-In` / `Thermostat` / `Water-Source` |
| E | ItemSubtype | enum / string | water-source only: `Chiller` / `Cooling Tower` / `Boiler` / `Controls` / `Other`; empty otherwise |
| F | ItemNumber | int | 1..N within (AuditID, ItemType) — what the tech sees as "Walk-In 1", "Walk-In 2" |
| G | Label | string | free-text human label, optional |
| H | ModelLabelPhotoUrl | string | walk-in: model label inside the unit; water-source: model plate |
| I | NameplatePhotoUrl | string | water-source nameplate, also used for chiller/tower/boiler |
| J | FansPhotoUrl | string | walk-in: photo showing fan count |
| K | TempPhotoUrl | string | walk-in: temp setting display |
| L | WiringPhotoUrl | string | thermostat: existing wiring |
| M | LocationPhotoUrl | string | thermostat: where it sits in the building |
| N | SchedulePhotoUrlsCsv | string | thermostat: comma-separated Drive URLs (one or many) |
| O | ControlsPhotoUrl | string | water-source: any controls panel |
| P | Notes | string | free-text |
| Q | LoggedBy | string | tech name |
| R | LoggedAt | ISO ts | |
| S | Status | enum | `Active` / `Orphaned` — see Count Shrink below |

### Drive structure

New `Audit/` subfolder inside each job's existing Drive folder. Audit
photos go there with predictable filenames:

```
<Root>/
  <Customer> - <Address> - <YYYY-MM-DD>/
    Unit-001_PTAC_nameplate.jpg          ← unchanged
    Unit-001_PTAC_pre.jpg
    ...
    Audit/                                ← new
      Front_of_building.jpg
      Fire_escape_plan.jpg
      BAS_system.jpg
      WalkIn-001_model.jpg
      WalkIn-001_fans.jpg
      WalkIn-001_temp.jpg
      Therm-001_wiring.jpg
      Therm-001_location.jpg
      Therm-001_schedule-1.jpg
      Therm-001_schedule-2.jpg
      WaterSource-001_nameplate.jpg
      WaterSource-001_controls.jpg
```

The `Audit/` subfolder is created lazily on first audit upload via
`getOrCreateFolder` (same helper used elsewhere).

### ID generators

Two new IDs in `lib/id-generators.ts`:
- `nextAuditId()` → `AUD-2026-NNNN`
- `nextAuditItemId()` → `AI-2026-NNNNN`

Both follow the existing pattern (read max from sheet, increment).

## API surface

### New routes

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/audits` | Create-or-get the Audit row for a jobId (idempotent). Returns the row. |
| PATCH | `/api/audits/[auditId]` | Update audit-level fields (BasNotes, Notes). Photo writes go through /api/upload. |
| POST | `/api/audits/[auditId]/complete` | Set Status=Complete + stamp CompletedAt/CompletedBy. |
| POST | `/api/audits/[auditId]/reopen` | Set Status=Draft, clear CompletedAt/CompletedBy. No-op on data. |
| POST | `/api/audit-items` | Create one item. Body: `{auditId, jobId, itemType, itemSubtype?, itemNumber, label?}`. |
| PATCH | `/api/audit-items/[itemId]` | Update label / subtype / notes / status. |
| DELETE | `/api/audit-items/[itemId]` | Hard delete (only used by admin; tech uses count-down which sets Status=Orphaned). |
| POST | `/api/jobs/[jobId]/complete` | Run the existing finalize logic (write Pay Attribution rows, stamp Dispatches.submittedAt). Block if any covering commission period is Approved/Paid. |
| POST | `/api/jobs/[jobId]/reopen` | Delete Pay Attribution rows for the dispatch, clear submittedAt. Block if any covering commission period is Approved/Paid. |

### Modified routes

- `/api/upload` gets two new `kind` values:
  - `kind=audit-building` — uploads to `Audit/` subfolder, writes URL to `Audits` columns I/J/K based on `slot` (`front` / `fire-plan` / `bas`).
  - `kind=audit-item` — uploads to `Audit/`, writes URL to `Audit Items` columns H/I/J/K/L/M/N/O based on `slot` (`model-label` / `nameplate` / `fans` / `temp` / `wiring` / `location` / `schedule` / `controls`). For `schedule`, appends to the CSV (multi-photo support).

### Removed routes

- `/api/cron/finalize-stale-dispatches` — deleted along with its `vercel.json` entry.

### Modified logic

- `app/(app)/jobs/page.tsx` — drop the `autoFinalizeOpenDraftsForTech` call.
- `lib/data/dispatches.ts:autoFinalizeOpenDraftsForTech` — keep the function for the admin force-finalize button (renamed internally to `finalizeDispatchExplicit` if cleaner; keep public name backward-compatible).

## Tech UI

### `/jobs/[jobId]` — modifications

Order changes (top → bottom):

1. Header (unchanged)
2. `AutoUploadCard` "Earning so far" (unchanged location, copy updated — no more "auto-closes" line; new copy: "Tap Job Complete below when you're finished.")
3. `Add Unit` button (unchanged)
4. Units list (unchanged)
5. **New: `Complete Audit` entry-point button** — gold style, navigates to `/jobs/[jobId]/audit`. Subtitle shows audit status if started (`Draft · 4 of 5 sections · last edited 2:14 PM`).
6. Empty / finalized fallback (unchanged)
7. **New: bottom-pinned completion bar** — two buttons:
   - `Job Complete` — red primary. Always enabled in Draft state (audit-only visits with zero HVAC units are valid — they just write zero pay attribution rows). Shows `Complete ✓ · Reopen` after tapped.
   - `Audit Complete` — gold secondary. Shows `Complete ✓ · Reopen` after tapped.
   Each button shows an inline status icon + tooltip on hover/long-press. Reopen blocked by an Approved period: clicking shows toast with the period ID.
8. Admin-only Drive folder (unchanged)

### `/jobs/[jobId]/audit` — new page

Single-scroll form (matches the existing AddUnitForm pattern). Sticky
top header with checklist:

```
Energy audit · Job: Acme Office Tower
[✓] Building   [⏳] Walk-Ins (1/3)   [ ] Therms   [ ] Water-source   [ ] BAS
```

Each checklist chip is also a jump-link to its section.

**Sections** (in order):
1. **Building**
   - Front-of-building photo (key, required for completion checklist green-tick)
   - Fire escape / M1 plan photo (optional)
2. **Walk-ins**
   - "How many walk-in coolers / freezers?" — number stepper (0–20)
   - One card per item, numbered Walk-In 1..N. Each card:
     - Optional free-text label ("Kitchen walk-in", "Stock room freezer")
     - Model-label photo (inside the walk-in, around the back)
     - Fans photo
     - Temp setting photo
     - Notes textarea
3. **Thermostats**
   - "How many thermostats?" — stepper
   - One card per. Each card:
     - Optional label ("Lobby", "Server room")
     - Wiring photo (key)
     - Location photo (optional)
     - Schedule: 1..N photos. If tech has only one photo of the lit-up thermostat with no schedule, that's the single entry.
4. **Water-source**
   - "How many water-source pieces of equipment?" — stepper
   - One card per. Each card:
     - Subtype picker: Chiller / Cooling Tower / Boiler / Controls / Other
     - Optional label
     - Model label / nameplate photo
     - Controls panel photo (optional)
5. **BAS**
   - Single optional photo
   - Free-text note (helper text: "Usually Xavier handles BAS — capture the panel if visible.")

**Count-down (orphan)**: when the tech reduces a count from N to M
(M<N), items numbered M+1..N flip to `Status=Orphaned`. They stop
appearing in the form but the row + Drive photos persist for admin
review (audit trail). If the tech bumps the count back up, the same
orphaned items revive in order — preserves their data, common case
is "oops, I miscounted". Admin-side hard-delete of orphans is
deferred to a follow-up; until then orphans accumulate quietly with
no UI surfacing.

**Upload behavior**: identical to existing PhotoCapture pattern.
Photos hit `/api/upload` immediately, IndexedDB queues handle offline.
Stable slot element types so iOS Safari doesn't lose blob URLs on
focus change (already a learned project pattern — see
`feedback_mse_field_photo_slots`).

## Admin UI

### `/admin` — new "Stuck Drafts" panel

Replaces the cron safety net. Lists Draft dispatches older than 48
hours with:
- Job + customer name
- Tech on site
- Dispatch date
- One-click "Force finalize" button (writes Pay Attribution rows,
  same logic as Job Complete, admin's name stamped as the finalizer).

### `/admin/customers/[customerName]` and the per-customer report PDF

- Job cards show audit status badge (`Audit · Draft` / `Audit ·
  Complete`).
- Customer PDF gets an optional Audit section per job: building
  photos in a small grid, plus a unit-count summary (`2 walk-ins · 4
  thermostats · 1 chiller · BAS captured`). Audit photos are
  included in the same image fetch loop used today for unit
  thumbnails.

### `/jobs/[jobId]` (admin view of a job)

When admin opens a job, they see the same tech UI plus:
- Direct link into `/jobs/[jobId]/audit` in read-only mode (admin can
  download photos but not change counts in v1).
- The bottom-pinned Job Complete / Audit Complete buttons gain an
  admin-only "Mark as complete on tech's behalf" caption.

## Behavior / state machine

### Audit state

```
            ┌──────────────────────────────┐
            │ Audit row does not exist yet │
            └──────────────┬───────────────┘
                           │ tech opens /jobs/X/audit
                           ▼
                       ┌────────┐
                ┌──────│ Draft  │──────┐
                │      └────────┘      │
   tech edits / │                       │ tech taps Audit Complete
   uploads      │                       ▼
                │                  ┌──────────┐
                └──────────────────│ Complete │
                  tech taps Reopen │          │
                                   └──────────┘
```

Edits remain possible in both Draft and Complete states — the status
is informational only.

### Job (dispatch) state

```
   ┌─────────┐ tech taps Job Complete   ┌──────────────┐
   │  Draft  │─────────────────────────▶│ Finalized    │
   │ (open)  │                          │ (submittedAt │
   └─────────┘                          │  set, Pay    │
        ▲                               │  Attribution │
        │ tech taps Reopen              │  written)    │
        │ (blocked if covered by        └──────┬───────┘
        │  Approved/Paid period)              │
        └─────────────────────────────────────┘
```

Force-finalize from admin = same transition as Job Complete; the
"finalized by" stamp captures the admin's name instead of the tech's.

### Reopen guard

Server-side check on `POST /api/jobs/[jobId]/reopen`:

```ts
const periods = await listAllPayrollPeriods();
const dispatchDate = dispatch.dispatchDate;
const blockers = periods.filter(
  (p) =>
    (p.status === "Approved" || p.status === "Paid") &&
    p.startDate <= dispatchDate &&
    dispatchDate <= p.endDate
);
if (blockers.length > 0) {
  return 409 with body { error, blockingPeriodId, periodLabel };
}
```

Client surfaces the periodId/label in the toast so the admin knows
exactly which period to unlock from `/admin/payroll/[periodId]`.

## Migration / cleanup

One-time + recurring:

1. **Seed the new sheet tabs.** Update `seed/init-sheet.mjs` with the
   `Audits` and `Audit Items` definitions; write a one-off
   `scripts/init-audit-tabs.mjs` that creates the tabs in the live
   production sheet without disturbing any existing tab. Run it once.

2. **Remove auto-finalize wiring**:
   - Drop the `autoFinalizeOpenDraftsForTech` call in
     `app/(app)/jobs/page.tsx` (the fire-and-forget on tech landing
     on /jobs).
   - Delete `app/api/cron/finalize-stale-dispatches/route.ts`.
   - Remove the cron entry in `vercel.json`.
   - Keep the `autoFinalizeOpenDraftsForTech` helper function in
     `lib/data/dispatches.ts` — it's what the admin force-finalize
     button calls. Rename comments/JSDoc to reflect the new caller.

3. **Update AutoUploadCard copy** in `components/JobDetail.tsx` to
   replace "Auto-closes when you head to your next job, or by 8 PM
   ET" with "Tap Job Complete below when you're finished."

## Open / deferred items

- **Admin-side audit editing** — v1 admin is read-only on audit data.
  If admin wants to fix a tech's typo or delete an orphaned item,
  they go through the Sheet. Follow-up scope.
- **Audit data in commission reports** — audit items don't pay. If
  the org later decides walk-ins/thermostats are billable, we'll add
  a per-item-type pay rate. Out of scope.
- **Offline audit creation** — v1 only supports editing an existing
  audit offline; creating one requires online (so the AuditID gets
  reserved server-side). Most tech workflows hit a job server-first,
  so this is acceptable. IndexedDB queue covers photo uploads while
  offline.
- **Per-section quick-photo capture** — the audit photo slots reuse
  PhotoCapture's iOS-safe stable-slot pattern. No new component.

## Acceptance / done criteria

The feature ships when:

1. A tech can open a job, tap Complete Audit, fill in some sections,
   leave, come back, finish, tap Audit Complete. Data and photos all
   round-trip through the Sheet + Drive.
2. A tech can tap Job Complete and see Pay Attribution rows appear
   on the next commission report period (admin verifies).
3. The auto-finalize fire-and-forget call and the 8pm cron are
   removed; no Pay Attribution rows are written without an explicit
   Job Complete or admin force-finalize.
4. A tech who tries to Reopen a dispatch covered by an
   Approved/Paid period sees the lock message with the period ID.
5. The admin Stuck Drafts panel surfaces dispatches older than 48h
   and the force-finalize button works end-to-end.
6. The customer report PDF (per-customer rollup) renders the audit
   section for any job that has audit data.
7. Tsc, lint, and Next build all pass.
