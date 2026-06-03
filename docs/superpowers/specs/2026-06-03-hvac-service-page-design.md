# HVAC Service Page — Design

**Date:** 2026-06-03
**Owner:** Kevin
**Status:** Approved (pending spec review)

## Goal

Mirror the audit-page UX onto HVAC unit servicing so techs can manage
a batch of units on a job — add/remove types, jump in and out, edit
incrementally — without being locked into a single-unit save form.

The audit feature shipped 2026-06-02 introduced the count-and-cards
pattern that techs liked. This applies the same pattern to HVAC tune-up
units (PTAC, RTU, Splits) and retires the single-unit
`/jobs/[jobId]/units/new` form.

The HVAC page and the Audit page stay deliberately separate — same
visual pattern, different data, different sheets.

## Spec reference

Builds on the work in
[2026-06-02-energy-audit-design.md](2026-06-02-energy-audit-design.md).
Reuse what's proven; don't re-litigate decisions there.

## Out of scope (v1)

- No new sheets. Reuses existing `Units Serviced` table.
- No bulk-add (e.g. "8 PTACs at once") — count stepper handles it
  fine one card at a time, no need to optimize until proven slow.
- No reopen flow for prior-day units — admin still owns that via
  the existing dispatch-side unlock path.
- No bulk photo drag-and-drop assignment.
- The legacy offline-only path (`local-job-…` jobIds via
  `OfflineAddUnit`) stays unchanged. The new page redirects to
  `/jobs/[jobId]` for offline-only jobs so the existing IndexedDB
  draft flow still works.

## Data model

**No new sheets.** Reuses `Units Serviced` with its existing schema:

- `unitType` enum supports all 7 values: PTAC / Ductless, Split System
  (legacy), Outdoor Split System, Indoor Split System, RTU-S, RTU-M,
  RTU-L
- `deleted` boolean flag — already implemented; perfect for the
  orphan/revive pattern when a tech bumps the count up then down then
  up again
- Per-slot photo URL columns G–X already model the per-type photo
  layouts (PTAC uses pre/post/nameplate/filter, RTU uses
  coil1/coil2/filter pre+post + nameplate, Outdoor Split uses 3
  outdoor pre/post + nameplate + filter + 3 indoor cols)
- `make`, `model`, `serial` already populated by the existing OCR
  auto-fill on nameplate capture

Each unit row stays attached to its originating dispatch. New units
created via the count stepper attach to today's draft dispatch
(`ensureDraftDispatch`). Prior-day units stay on their original
dispatches and render read-only.

## Tech UI

### `/jobs/[jobId]` — entry-point changes

The job page becomes a hub with **two parallel CTAs**:

- **Service HVAC units** — red, primary entry button. Replaces the
  existing red "Add unit" inline button. Subtitle shows live status:
  "No units yet" / "3 units in progress" / "5 units · all photographed".
- **Complete energy audit** — gold, secondary (unchanged from
  2026-06-02).

The existing inline units list block on the job page stays as a
read-only summary so the tech can scan what's logged without opening
the service page.

### `/jobs/[jobId]/service` — new page

**Empty state:**

Big gold "Add your first unit type" CTA. Tap opens a type picker
(modal/sheet with the 6 unit type cards). Pick one → that section
appears with `count = 1` and one empty card ready to photograph.

The legacy `"Split System"` type is NOT shown in the picker — only
the 6 current types (PTAC / Ductless, Outdoor Split System, Indoor
Split System, RTU-S, RTU-M, RTU-L). Historical Split System rows
still render in their own section if present, but new ones can't be
created.

**Populated state:**

Sticky checklist header at the top:

```
HVAC service · Job: Acme Office Tower
[⏳] PTAC (1/2)  [✓] Outdoor Split (3/3)  [⏳] RTU-M (0/1)
```

Each chip is a jump-link to its section. Chip turns ✓ green when every
unit in that section has all required photos captured.

**Below the checklist, one section per unit-type that has at least
one active unit:**

```
PTAC / Ductless              [−] 2 [+]
┌─────────────────────────────────────┐
│ PTAC 1 · ⏳ 2/4 photos              │
│ [nameplate]  [pre-service]          │
│ [post-service] [filter]             │
│ Make · Model · Serial · Notes       │
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│ PTAC 2 · ✓ Complete                 │
│ ...                                 │
└─────────────────────────────────────┘

Outdoor Split System         [−] 3 [+]
...
```

Each card:

- Header: `<Type> <N>` plus a small status pill (`✓ Complete` when
  all required photos uploaded, `⏳ N/M photos` otherwise, `✓
  Submitted · <date>` for prior-day read-only cards)
- **Nameplate photo slot FIRST** — drives the existing OCR auto-fill
  on capture (`useOcrAutoFill` hook). Same UX techs already know.
- Per-type photo slots in the existing order from the legacy
  `slotsForType` helper in AddUnitForm.tsx (kept as the source of
  truth — extract to a shared utility if needed during
  implementation)
- Make / Model / Serial inputs — controlled state, blur-saves via
  `PATCH /api/units`. Model is required (matches existing API
  validation).
- Free-text Notes textarea, blur-saves
- Optional unit label input (e.g. "Roof unit east", "Suite 200
  PTAC")

**Count stepper behavior:**

- `+` POSTs `/api/units` to create a new unit on today's dispatch
  with `unitType` matching the section's type and an incremented
  `unitNumberOnJob`
- `−` DELETEs the highest-numbered active unit in this section
  (soft-delete via `deleted=TRUE`)
- Existing `/api/units` DELETE handler already blocks deletion when
  the underlying dispatch is `submittedAt` set — this is correct;
  surfaces a clear error to the tech
- Bumping back up after a delete creates a new unit (does NOT revive
  the soft-deleted one — same model as the audit's orphan flow,
  where reviving was a "nice to have" but not strictly required)

**Multi-day handling:**

- Page reads `listUnitsForJob(jobId)` (existing helper) filtered to
  `deleted === false`
- Cards from prior dispatches render read-only with `✓ Submitted ·
  <YYYY-MM-DD>` badge — no `−` button for those, photos non-editable
  in this view
- Count stepper only operates on today's draft dispatch units. So
  if PTAC count shows 4 (1 from yesterday + 3 from today), `−` only
  bumps today's count down to 2.
- New units always land on today's dispatch via
  `ensureDraftDispatch`

**Bottom of page:**

"+ Add another unit type" CTA — re-opens the type picker, filtering
out the types that already have an active section.

**Pay hint:**

Sticky header includes a small "$X estimated for today" tile —
same calc currently used by `AutoUploadCard` (sum of
`estimatedInstallPayForTech` across today's draft units), so the
tech sees their earning estimate updating live.

### iOS stable-slot rule reminder

The PhotoCapture component (and its single-slot cousin
`AuditPhotoSlot`) maintain stable input elements across renders so
iOS Safari doesn't lose the blob URL on focus change. Reuse this
pattern verbatim — every photo slot in a card must use the same
element identity across renders. This is project memory
[[project-mse-field-photo-slots]].

## API surface

### Existing routes — reused as-is

- `POST /api/units` — creates a new unit on today's draft dispatch.
  **Currently has a bug**: the `UNIT_TYPES` validation array on
  `app/api/units/route.ts:14` is missing `"Outdoor Split System"`
  and `"Indoor Split System"`. The new HVAC page POSTs all 7 types
  directly (not through IndexedDB queue), so this MUST be fixed as
  part of this work. **Treat as a Task in the plan, not a "nice to
  have."**
- `PATCH /api/units` — already supports updating unitType / label /
  make / model / serial / notes. Same bug applies — `UNIT_TYPES`
  array needs all 7 values.
- `DELETE /api/units?unitId=…` — already in place; soft-deletes;
  refuses on submitted dispatches. No change needed.
- `POST /api/upload` with `unitId` + `slot` — existing flow,
  unchanged. The new card just calls it the same way the legacy
  AddUnitForm does.

### New routes

**None.** All operations covered by the existing endpoints.

## Page placement

- **Create:** `app/(app)/jobs/[jobId]/service/page.tsx` — server
  component shell mirroring `app/(app)/jobs/[jobId]/audit/page.tsx`
- **Create:** `components/ServiceUnitsForm.tsx` — top-level client
  component mirroring `AuditForm`
- **Create:** `components/ServiceUnitTypeSection.tsx` — one-per-type
  card section mirroring `AuditItemSection`
- **Reuse:** `components/PhotoCapture.tsx` — existing component
  with iOS stable-slot handling (NOT AuditPhotoSlot — PhotoCapture
  handles N+1 dynamic slots which is what each card needs)
- **Reuse:** `hooks/useOcrAutoFill.ts` — existing OCR hook
- **Reuse:** `lib/data/units.ts:requiredPhotoSlots` and the per-type
  photo slot layout from the existing `slotsForType` in
  `AddUnitForm.tsx`. Implementation choice: either extract
  `slotsForType` into `lib/unit-slots.ts` (shared between
  AddUnitForm and the new card) OR re-import it from
  `components/AddUnitForm.tsx`. Either is acceptable; extraction is
  marginally cleaner but not required for correctness.
- **Modify:** `components/JobDetail.tsx` — replace the red "Add
  unit" button with a "Service HVAC units" entry button linking to
  `/jobs/[jobId]/service` (parallel to the gold audit entry button
  added 2026-06-02). Keep the inline units list below as a
  read-only summary.
- **Modify:** `app/(app)/jobs/[jobId]/page.tsx` — compute a
  per-job-unit-count summary for the new entry button subtitle
- **Delete or redirect:** `app/(app)/jobs/[jobId]/units/new/page.tsx`
  — redirect to `/jobs/[jobId]/service` so any cached deep links
  still work. Don't hard-delete since `OfflineAddUnit` still uses
  this path for offline-only `local-job-…` jobs.

## Behavior / state machine

### Unit lifecycle (unchanged from current)

```
   ┌───────────────┐  tech submits dispatch / admin force-finalize
   │  Draft (active │ ───────────────────────────────────────────►
   │   dispatch)    │
   └───────────────┘
         │
         │ tech taps − on count stepper
         ▼
   ┌────────────┐
   │  deleted   │  (kept for audit; not surfaced anywhere)
   └────────────┘
```

### Page state machine (new)

```
   ┌──────────────────┐
   │  Empty (no units)│
   └────┬─────────────┘
        │ tap "Add your first unit type" → pick type
        ▼
   ┌──────────────────────────────────────┐
   │  Populated (1+ active type sections) │◄──┐
   └────┬─────────────────────────────────┘   │
        │  tap "+" on a section, or          │  count
        │  "Add another unit type"           │  changes
        ▼                                    │
   (creates / removes cards)──────────────────┘
```

## Migration

- One-off check needed: confirm the production `/api/units` POST
  validation has been patched to include `Outdoor Split System` and
  `Indoor Split System`. If techs have been creating these types
  via the offline queue (which bypasses the POST validation),
  there's no data migration needed — existing rows are fine.
- The legacy `/jobs/[jobId]/units/new` page redirects to
  `/jobs/[jobId]/service` for server-known jobs. Offline jobs
  (`local-job-…`) still hit the offline component directly. The
  OfflineAddUnit flow stays as-is — those jobs need to sync to a
  real jobId before the multi-card view will work.

## Acceptance / done criteria

1. A tech opens an active job, taps "Service HVAC units," lands on
   the empty state, picks PTAC, adds nameplate + before + after +
   filter photos, sees the card flip to "✓ Complete," leaves the
   page, returns, the work is still there.
2. The same tech bumps the PTAC count from 1 to 3, fills out 2 of
   the new cards, bumps back to 2 — the 3rd unit is soft-deleted in
   the sheet, no longer renders.
3. A tech on day 3 of a multi-day job opens the page and sees their
   day-1 and day-2 units as read-only cards with "✓ Submitted ·
   2026-06-01" badges, plus today's draft cards as editable.
4. The legacy `/jobs/[jobId]/units/new` URL redirects to
   `/jobs/[jobId]/service` for server-known jobs; offline-only jobs
   still hit `OfflineAddUnit`.
5. `POST /api/units` accepts all 7 unit types (bug fix).
6. Make/model/serial OCR auto-fill still works on nameplate
   capture.
7. Pay-estimate hint at the top of the page updates live as cards
   complete.
8. `tsc --noEmit`, `next lint`, and `next build` all pass clean.

## Open / deferred items

- **Reviving soft-deleted units on count-up** — current plan creates
  a new row when bumping back up after a delete. The audit feature
  considered reviving but didn't implement it; same simplification
  here.
- **In-card type picker** — could let the tech change a unit's type
  after creation. Not in v1 — the legacy single-unit form supported
  it via PATCH but it's a rare workflow.
- **Cross-dispatch view tabs** — could split the page into "Today"
  / "Yesterday" / "Day before" tabs for multi-day jobs. Not in v1;
  the read-only badge on prior-day cards covers the common case.
