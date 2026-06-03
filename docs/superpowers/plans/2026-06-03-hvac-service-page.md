# HVAC Service Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mirror the audit-page count-and-cards UX onto HVAC tune-up units so techs can manage a batch of PTAC / Split / RTU units on a job — add/remove types, jump in and out, edit incrementally — without being locked into a single-unit save form.

**Architecture:** New `/jobs/[jobId]/service` page (parallel to `/audit`) backed entirely by the existing `Units Serviced` sheet and `/api/units` endpoints. Two new client components (`ServiceUnitsForm`, `ServiceUnitTypeSection`) mirror `AuditForm` / `AuditItemSection`. The legacy single-unit `/jobs/[jobId]/units/new` form gets redirected for server-known jobs. One small bug fix on `/api/units` validators to accept the two newer Split System variants.

**Tech Stack:** Next.js 14 App Router, existing `lib/data/units.ts` helpers, existing `/api/units` POST/PATCH/DELETE, existing `useOcrAutoFill` hook for nameplate-driven make/model/serial fill-in, existing `AuditPhotoSlot` component for individual photo upload slots.

**Spec reference:** [docs/superpowers/specs/2026-06-03-hvac-service-page-design.md](../specs/2026-06-03-hvac-service-page-design.md)

**Reference implementation:** the audit feature shipped 2026-06-02 introduced the patterns this plan mirrors. Read `components/AuditForm.tsx`, `components/AuditItemSection.tsx`, and `app/(app)/jobs/[jobId]/audit/page.tsx` first — those files are the model for the parallel HVAC versions in this plan.

**One spec correction**: the spec said "use PhotoCapture" but PhotoCapture is the legacy offline-queue blob component. The real-time upload behavior we want comes from `components/AuditPhotoSlot.tsx`. This plan uses `AuditPhotoSlot` per individual photo slot, matching the audit page's flow.

**Verification convention:** Each task ends in `npm run build` (catches tsc + lint + next compile) and a `git commit`. No unit tests — this codebase doesn't have a unit test framework; build + the end-of-plan browser smoke covers verification. Local commits only — do NOT push unless Kevin explicitly says.

---

## Phase 0 — API validator fix (1 task)

### Task 1: Add the two newer Split System types to `/api/units` validators

**Files:**
- Modify: `app/api/units/route.ts:14-16`

- [ ] **Step 1: Update the `UNIT_TYPES` array**

Open `app/api/units/route.ts`. The current declaration is:

```ts
const UNIT_TYPES: UnitType[] = [
  "PTAC / Ductless", "Split System", "RTU-S", "RTU-M", "RTU-L",
];
```

Replace with:

```ts
const UNIT_TYPES: UnitType[] = [
  "PTAC / Ductless",
  // "Split System" is the legacy combined-side type kept in the
  // union for historical rows. New units choose between the
  // Outdoor / Indoor split variants below.
  "Split System",
  "Outdoor Split System",
  "Indoor Split System",
  "RTU-S",
  "RTU-M",
  "RTU-L",
];
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add app/api/units/route.ts
git commit -m "HVAC: /api/units validator accepts Outdoor/Indoor Split System types"
```

---

## Phase 1 — Shared slot helper (1 task)

### Task 2: Extract `slotsForType` into a reusable utility

**Files:**
- Create: `lib/unit-slots.ts`
- Modify: `components/AddUnitForm.tsx` — replace the local `slotsForType` + `flatSlots` with re-exports from `lib/unit-slots.ts`

The existing `slotsForType` function in `components/AddUnitForm.tsx` (lines 53–147) is the source of truth for per-type photo slots (PTAC has nameplate + pre + post + filter; RTU has nameplate + 7 coil/filter slots; Outdoor Split has nameplate + 3 outdoor pre + 3 outdoor post + filter; etc.). Both the legacy single-unit form and the new `ServiceUnitTypeSection` need this helper.

- [ ] **Step 1: Read the current helper**

Open `components/AddUnitForm.tsx` and read lines 34–153 to understand the `SlotDef`, `SlotGroups`, `slotsForType`, and `flatSlots` shapes. Note that `SlotDef` references `PhotoSlot` from `@/lib/types`.

- [ ] **Step 2: Create the new utility file**

Create `lib/unit-slots.ts` with the contents below. Copy `SlotDef`, `SlotGroups`, `slotsForType`, and `flatSlots` from AddUnitForm.tsx verbatim:

```ts
import type { PhotoSlot, UnitType } from "@/lib/types";

export interface SlotDef {
  slot: PhotoSlot;
  label: string;
  hint: string;
  required: boolean;
}

export interface SlotGroups {
  /** Nameplate photo(s) — rendered FIRST so the tech captures Make/Model/Serial
   *  before anything else. Drives the OCR auto-fill. */
  nameplate: SlotDef[];
  /** Before/after work photos, plus filter etc. — rendered after the
   *  Make/Model/Serial fields. */
  body: SlotDef[];
}

const SIMPLE_TYPES: UnitType[] = ["PTAC / Ductless"];
const RTU_TYPES: UnitType[] = ["RTU-S", "RTU-M", "RTU-L"];

export function slotsForType(unitType: UnitType | null): SlotGroups {
  // ... copy verbatim from AddUnitForm.tsx lines 53–147 ...
}

/** Flat list helper — used by completeness checks (any unit with all
 *  required slots set is "Complete"). */
export function flatSlots(groups: SlotGroups): SlotDef[] {
  return [...groups.nameplate, ...groups.body];
}
```

When copying `slotsForType`, preserve EVERY branch — PTAC / Ductless, RTU (Small/Medium/Large), Outdoor Split System, Indoor Split System, and any fallback. The legacy `"Split System"` value should fall through to whichever default the source code uses (verify by reading the file).

- [ ] **Step 3: Update `components/AddUnitForm.tsx` to import from the shared utility**

Remove the local `SlotDef` / `SlotGroups` / `SIMPLE_TYPES` / `RTU_TYPES` / `slotsForType` / `flatSlots` definitions. Add an import:

```ts
import {
  slotsForType,
  flatSlots,
  type SlotDef,
  type SlotGroups,
} from "@/lib/unit-slots";
```

Leave all other code in AddUnitForm.tsx untouched. The component should still compile and behave identically — only the source of `slotsForType` changed.

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: build succeeds. The legacy `/jobs/[jobId]/units/new` page (which renders AddUnitForm) must still compile and render the same way.

- [ ] **Step 5: Commit**

```bash
git add lib/unit-slots.ts components/AddUnitForm.tsx
git commit -m "HVAC: extract slotsForType into lib/unit-slots.ts (shared with AddUnitForm)"
```

---

## Phase 2 — New components (2 tasks, bottom-up so build stays green)

### Task 3: `components/ServiceUnitTypeSection.tsx` — per-type card section

**Files:**
- Create: `components/ServiceUnitTypeSection.tsx`

This is the biggest component in the plan. Models `components/AuditItemSection.tsx` closely. Key differences from AuditItemSection:

- Six unit types instead of three audit-item types (PTAC / Outdoor Split / Indoor Split / RTU-S / RTU-M / RTU-L)
- Each card uses the legacy slot layout from `lib/unit-slots.ts` (different per type)
- Each card wires the `useOcrAutoFill` hook so the nameplate photo drives make/model/serial fields
- Each card shows make / model / serial / notes inputs (model required, matches API validation)
- Cards from prior dispatches render read-only with a "✓ Submitted · <YYYY-MM-DD>" badge
- Delete uses `DELETE /api/units?unitId=X` (query-param, not path-param like audit-items)
- Photo upload uses `kind=...` not needed — the legacy slot upload path uses `unitId` + `slot` (no `kind` field; the route branches on `unitId` presence)

- [ ] **Step 1: Write the component**

Read `components/AuditItemSection.tsx` for the section + card pattern. Read `components/AddUnitForm.tsx:165–650` for the OCR hook integration + photo upload pattern + make/model/serial input layout.

```tsx
"use client";

import { useMemo, useState } from "react";
import { Plus, Minus, Loader2, CheckCircle2 } from "lucide-react";
import { AuditPhotoSlot } from "@/components/AuditPhotoSlot";
import { useOcrAutoFill } from "@/hooks/useOcrAutoFill";
import { slotsForType, flatSlots, type SlotDef } from "@/lib/unit-slots";
import { cn } from "@/lib/utils";
import type { Job, UnitServiced, UnitType, PhotoSlot } from "@/lib/types";

type UnitWithDispatchMeta = UnitServiced & {
  dispatchDate: string;
  dispatchSubmittedAt: string;
};

interface Props {
  anchorId: string;
  title: string;
  unitType: UnitType;
  job: Job;
  /** All active units for this job, prefiltered to this type. Includes
   *  prior-day dispatch units (render read-only) + today's draft
   *  dispatch units (editable). */
  units: UnitWithDispatchMeta[];
  /** dispatchId of today's draft dispatch — new units land here. */
  todaysDispatchId: string;
  onUnitsChange: (next: UnitWithDispatchMeta[]) => void;
}

export function ServiceUnitTypeSection({
  anchorId,
  title,
  unitType,
  job,
  units,
  todaysDispatchId,
  onUnitsChange,
}: Props) {
  // Sort by unitNumberOnJob (ascending) — units already filtered to
  // this type by the parent.
  const sorted = useMemo(
    () => units.slice().sort((a, b) => a.unitNumberOnJob - b.unitNumberOnJob),
    [units]
  );
  // Today's draft units are editable. Prior dispatches are read-only.
  const todaysUnits = sorted.filter((u) => u.dispatchId === todaysDispatchId);
  const priorUnits = sorted.filter((u) => u.dispatchId !== todaysDispatchId);
  const [busyCount, setBusyCount] = useState(false);

  async function bumpCount(direction: "up" | "down") {
    if (busyCount) return;
    setBusyCount(true);
    try {
      if (direction === "up") {
        const res = await fetch("/api/units", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobId: job.jobId,
            unitType,
            // Model is required server-side. Use a placeholder that
            // the tech will overwrite on nameplate OCR or manual entry.
            // The card UI shows the placeholder field as the canonical
            // signal that this card is incomplete.
            model: "(pending)",
          }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          unit?: UnitServiced;
          dispatchId?: string;
          error?: string;
        };
        if (!res.ok || !body.unit) {
          throw new Error(body.error ?? "Add failed");
        }
        onUnitsChange([
          ...units,
          {
            ...body.unit,
            dispatchDate: "", // server doesn't return — refresh from parent
            dispatchSubmittedAt: "",
          },
        ]);
      } else {
        const last = todaysUnits.at(-1);
        if (!last) return;
        const res = await fetch(
          `/api/units?unitId=${encodeURIComponent(last.unitId)}`,
          { method: "DELETE" }
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? "Could not delete unit");
        }
        onUnitsChange(units.filter((u) => u.unitId !== last.unitId));
      }
    } finally {
      setBusyCount(false);
    }
  }

  async function uploadPhoto(
    unitId: string,
    slot: PhotoSlot,
    file: File
  ): Promise<void> {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("jobId", job.jobId);
    fd.append("unitId", unitId);
    fd.append("slot", slot);
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    const body = (await res.json().catch(() => ({}))) as {
      url?: string;
      error?: string;
    };
    if (!res.ok || !body.url) {
      throw new Error(body.error ?? "Upload failed");
    }
    // Splice the URL into the matching unit's slot. Use the
    // mapping from PhotoSlot → photo-URL column already exercised
    // by lib/data/units.ts:setUnitPhotoUrl. For local state, just
    // mirror that mapping inline.
    onUnitsChange(
      units.map((u) => {
        if (u.unitId !== unitId) return u;
        const updated = { ...u };
        applyPhotoUrl(updated, slot, body.url ?? "");
        return updated;
      })
    );
  }

  async function patchUnit(
    unitId: string,
    patch: Partial<UnitServiced>
  ): Promise<void> {
    const res = await fetch("/api/units", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unitId, ...patch }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      throw new Error(body.error ?? "Patch failed");
    }
    onUnitsChange(
      units.map((u) => (u.unitId === unitId ? { ...u, ...patch } : u))
    );
  }

  return (
    <section id={anchorId} className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-mse-navy uppercase tracking-wider">
          {title}
        </h2>
        <div className="inline-flex items-center gap-2">
          <button
            type="button"
            onClick={() => bumpCount("down")}
            disabled={busyCount || todaysUnits.length === 0}
            className="w-8 h-8 inline-flex items-center justify-center rounded-full bg-mse-light text-mse-muted disabled:opacity-40"
            aria-label="Remove last"
          >
            <Minus className="w-4 h-4" />
          </button>
          <span className="w-8 text-center font-bold text-mse-navy tabular-nums">
            {sorted.length}
          </span>
          <button
            type="button"
            onClick={() => bumpCount("up")}
            disabled={busyCount}
            className="w-8 h-8 inline-flex items-center justify-center rounded-full bg-mse-navy text-white"
            aria-label="Add"
          >
            {busyCount ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {priorUnits.map((u) => (
          <PriorDayCard key={u.unitId} unit={u} unitType={unitType} />
        ))}
        {todaysUnits.map((u) => (
          <EditableCard
            key={u.unitId}
            unit={u}
            unitType={unitType}
            onPhoto={(slot, file) => uploadPhoto(u.unitId, slot, file)}
            onPatch={(patch) => patchUnit(u.unitId, patch)}
          />
        ))}
        {sorted.length === 0 && (
          <p className="text-xs text-mse-muted italic px-3 py-4 border-2 border-dashed border-mse-light rounded-xl text-center">
            None — tap + to add the first.
          </p>
        )}
      </div>
    </section>
  );
}

function PriorDayCard({
  unit,
  unitType,
}: {
  unit: UnitWithDispatchMeta;
  unitType: UnitType;
}) {
  return (
    <div className="rounded-2xl border border-mse-light bg-mse-light/30 p-4 space-y-2 opacity-80">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] uppercase tracking-wider font-bold text-mse-muted">
          {unitType} {unit.unitNumberOnJob}
        </div>
        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 uppercase tracking-wider">
          <CheckCircle2 className="w-3 h-3" />
          Submitted · {unit.dispatchDate || "prior visit"}
        </span>
      </div>
      <div className="text-xs text-mse-muted">
        {[unit.make, unit.model, unit.serial]
          .filter((s) => s && s !== "(pending)")
          .join(" · ") || "—"}
      </div>
    </div>
  );
}

function EditableCard({
  unit,
  unitType,
  onPhoto,
  onPatch,
}: {
  unit: UnitWithDispatchMeta;
  unitType: UnitType;
  onPhoto: (slot: PhotoSlot, file: File) => Promise<void>;
  onPatch: (patch: Partial<UnitServiced>) => Promise<void>;
}) {
  const [make, setMake] = useState(unit.make || "");
  const [model, setModel] = useState(
    unit.model === "(pending)" ? "" : unit.model || ""
  );
  const [serial, setSerial] = useState(unit.serial || "");
  const [notes, setNotes] = useState(unit.notes || "");
  const [label, setLabel] = useState(unit.label || "");

  // OCR wiring — same hook used by AddUnitForm. When the nameplate
  // photo lands, the hook reads it and fills make/model/serial state.
  // Each card has its own scoped fields so updates don't leak across
  // cards.
  const ocr = useOcrAutoFill({
    make,
    setMake: (v) => {
      setMake(v);
      onPatch({ make: v }).catch(() => {});
    },
    model,
    setModel: (v) => {
      setModel(v);
      if (v) onPatch({ model: v }).catch(() => {});
    },
    serial,
    setSerial: (v) => {
      setSerial(v);
      onPatch({ serial: v }).catch(() => {});
    },
  });

  const slots = useMemo(() => slotsForType(unitType), [unitType]);
  const allSlots = useMemo(() => flatSlots(slots), [slots]);
  const filled = allSlots.filter((s) => Boolean(photoUrlForSlot(unit, s.slot)));
  const requiredFilled = allSlots
    .filter((s) => s.required)
    .filter((s) => Boolean(photoUrlForSlot(unit, s.slot)));
  const allRequired = allSlots.filter((s) => s.required).length;
  const complete = requiredFilled.length === allRequired;

  return (
    <div className="rounded-2xl border border-mse-light bg-white p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] uppercase tracking-wider font-bold text-mse-gold">
          {unitType} {unit.unitNumberOnJob}
        </div>
        <span
          className={cn(
            "text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full",
            complete
              ? "bg-emerald-100 text-emerald-800"
              : "bg-mse-gold/15 text-mse-navy"
          )}
        >
          {complete
            ? "✓ Complete"
            : `⏳ ${filled.length}/${allSlots.length} photos`}
        </span>
      </div>

      <input
        type="text"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => {
          if (label !== unit.label) onPatch({ label });
        }}
        placeholder="Label (optional, e.g. Roof unit east)"
        className="w-full px-3 py-2 rounded-lg border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy"
      />

      {/* Nameplate slot first — drives OCR */}
      <div className="grid grid-cols-2 gap-3">
        {slots.nameplate.map((s) => (
          <AuditPhotoSlot
            key={s.slot}
            label={s.label}
            hint={s.hint}
            required={s.required}
            existingUrl={photoUrlForSlot(unit, s.slot)}
            onPick={async (file) => {
              await onPhoto(s.slot, file);
              // Kick OCR after the URL is persisted. The hook reads
              // the latest blob from the file passed in, not the
              // remote URL.
              ocr.run(file).catch((e) =>
                console.warn("[service] OCR failed:", e)
              );
            }}
          />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <input
          type="text"
          value={make}
          onChange={(e) => setMake(e.target.value)}
          onBlur={() => {
            if (make !== unit.make) onPatch({ make });
          }}
          placeholder="Make"
          className="px-2 py-1.5 rounded-md border border-mse-light bg-white focus:outline-none focus:border-mse-navy"
        />
        <input
          type="text"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          onBlur={() => {
            if (model && model !== unit.model) onPatch({ model });
          }}
          placeholder="Model (required)"
          className="px-2 py-1.5 rounded-md border border-mse-light bg-white focus:outline-none focus:border-mse-navy"
        />
        <input
          type="text"
          value={serial}
          onChange={(e) => setSerial(e.target.value)}
          onBlur={() => {
            if (serial !== unit.serial) onPatch({ serial });
          }}
          placeholder="Serial"
          className="px-2 py-1.5 rounded-md border border-mse-light bg-white focus:outline-none focus:border-mse-navy"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        {slots.body.map((s) => (
          <AuditPhotoSlot
            key={s.slot}
            label={s.label}
            hint={s.hint}
            required={s.required}
            existingUrl={photoUrlForSlot(unit, s.slot)}
            onPick={(file) => onPhoto(s.slot, file)}
          />
        ))}
      </div>

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => {
          if (notes !== unit.notes) onPatch({ notes });
        }}
        rows={2}
        placeholder="Notes (optional)"
        className="w-full px-3 py-2 rounded-lg border border-mse-light bg-white text-xs focus:outline-none focus:border-mse-navy resize-none"
      />
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────

/** Mirrors lib/data/units.ts:setUnitPhotoUrl — column letter → URL
 *  field name on UnitServiced. Used locally to splice the freshly
 *  uploaded URL into local state without a full refetch. */
function applyPhotoUrl(
  u: UnitServiced,
  slot: PhotoSlot,
  url: string
): void {
  const map: Record<PhotoSlot, keyof UnitServiced> = {
    pre: "pre1Url",
    post: "post1Url",
    coil1_pre: "pre1Url",
    coil1_post: "post1Url",
    coil2_pre: "pre2Url",
    coil2_post: "post2Url",
    filter_pre: "pre3Url",
    filter_post: "post3Url",
    out_pre_1: "pre1Url",
    out_pre_2: "pre2Url",
    out_pre_3: "pre3Url",
    out_post_1: "post1Url",
    out_post_2: "post2Url",
    out_post_3: "post3Url",
    out_nameplate: "nameplateUrl",
    in_pre: "inPreUrl",
    in_post: "inPostUrl",
    in_nameplate: "inNameplateUrl",
    nameplate: "nameplateUrl",
    filter: "filterUrl",
    additional: "additionalUrls",
  };
  const key = map[slot];
  if (!key) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (u as any)[key] = url;
}

function photoUrlForSlot(u: UnitServiced, slot: PhotoSlot): string {
  const map: Record<PhotoSlot, keyof UnitServiced> = {
    pre: "pre1Url",
    post: "post1Url",
    coil1_pre: "pre1Url",
    coil1_post: "post1Url",
    coil2_pre: "pre2Url",
    coil2_post: "post2Url",
    filter_pre: "pre3Url",
    filter_post: "post3Url",
    out_pre_1: "pre1Url",
    out_pre_2: "pre2Url",
    out_pre_3: "pre3Url",
    out_post_1: "post1Url",
    out_post_2: "post2Url",
    out_post_3: "post3Url",
    out_nameplate: "nameplateUrl",
    in_pre: "inPreUrl",
    in_post: "inPostUrl",
    in_nameplate: "inNameplateUrl",
    nameplate: "nameplateUrl",
    filter: "filterUrl",
    additional: "additionalUrls",
  };
  const key = map[slot];
  if (!key) return "";
  return String((u as unknown as Record<string, string>)[key as string] ?? "");
}
```

**Implementer notes on the OCR hook signature:**

The `useOcrAutoFill` hook signature should match how it's called in `AddUnitForm.tsx:176`. Read that file first to confirm the exact prop shape (it may pass `setMake`, `setModel`, `setSerial` setters directly, or it may take a single `onFill` callback). If the existing signature differs from the destructured form above, adjust the call site here to match. The hook's `.run(file)` method should accept a File and return a Promise; if the existing hook uses a different invocation pattern (e.g., a hidden `<input ref>` it pokes), adjust accordingly. **Read `hooks/useOcrAutoFill.ts` before writing this card to confirm the API.**

**Implementer notes on the PhotoSlot → URL column mapping:**

The two helper functions (`applyPhotoUrl`, `photoUrlForSlot`) duplicate the mapping baked into `lib/data/units.ts:setUnitPhotoUrl` and `photoUrlForSlot` (the lib export). If the lib already exports `photoUrlForSlot` with the same semantics, import + reuse it instead of duplicating. **Verify** — `grep -n "photoUrlForSlot" lib/data/units.ts`. If the export exists with the right signature, drop the local helper and import. If not, the local helpers stand as-is.

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: build succeeds. The component has no external consumers yet so it must self-compile cleanly.

- [ ] **Step 3: Commit**

```bash
git add components/ServiceUnitTypeSection.tsx
git commit -m "HVAC: ServiceUnitTypeSection — per-type card section with OCR + count steppers"
```

---

### Task 4: `components/ServiceUnitsForm.tsx` — top-level form

**Files:**
- Create: `components/ServiceUnitsForm.tsx`

Models `components/AuditForm.tsx`. Key differences:

- Six unit types instead of three audit item types
- Empty state shows a type picker (modal sheet) on tap
- Sections render only for types that have at least one active unit
- "+ Add another unit type" CTA at the bottom that re-opens the type picker, filtered to types not already present
- No top-level "Mark complete" action — that lives on the parent job page's `JobCompletionBar` (already shipped 2026-06-02)
- Pay estimate hint at top — sum of `estimatedInstallPayForTech` across today's draft units

- [ ] **Step 1: Write the form**

```tsx
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, X } from "lucide-react";
import { ServiceUnitTypeSection } from "@/components/ServiceUnitTypeSection";
import { estimatedInstallPayForTech } from "@/lib/pay-rates";
import { cn, formatCurrency } from "@/lib/utils";
import type {
  Dispatch,
  Job,
  UnitServiced,
  UnitType,
} from "@/lib/types";

type UnitWithDispatchMeta = UnitServiced & {
  dispatchDate: string;
  dispatchSubmittedAt: string;
};

interface Props {
  job: Job;
  /** Active (non-deleted) units across every dispatch for this job,
   *  joined with their parent dispatch's date + submittedAt for
   *  rendering read-only badges on prior-day cards. */
  initialUnits: UnitWithDispatchMeta[];
  todaysDispatch: Dispatch;
  currentUserName: string;
}

// New units are picked from this list. "Split System" (legacy
// combined-side type) is excluded — new installs must pick the
// Outdoor or Indoor variant. Historical Split System rows still
// render if present (their section header reads "Split System").
const PICKABLE_TYPES: UnitType[] = [
  "PTAC / Ductless",
  "Outdoor Split System",
  "Indoor Split System",
  "RTU-S",
  "RTU-M",
  "RTU-L",
];

const TYPE_SHORT_LABEL: Record<UnitType, string> = {
  "PTAC / Ductless": "PTAC / Ductless",
  "Split System": "Split System (legacy)",
  "Outdoor Split System": "Outdoor Split",
  "Indoor Split System": "Indoor Split",
  "RTU-S": "RTU-Small (under 3 tons)",
  "RTU-M": "RTU-Medium (3–20 tons)",
  "RTU-L": "RTU-Large (20+ tons)",
};

export function ServiceUnitsForm({
  job,
  initialUnits,
  todaysDispatch,
  currentUserName,
}: Props) {
  const [units, setUnits] = useState(initialUnits);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Group by unit type to drive section rendering. Any type with
  // at least one active unit (today's or prior) gets a section.
  const sectionsForType = useMemo(() => {
    const map = new Map<UnitType, UnitWithDispatchMeta[]>();
    for (const u of units) {
      const list = map.get(u.unitType) ?? [];
      list.push(u);
      map.set(u.unitType, list);
    }
    return map;
  }, [units]);

  const presentTypes = useMemo(
    () => Array.from(sectionsForType.keys()).sort(),
    [sectionsForType]
  );

  // Pay estimate hint — sum estimatedInstallPayForTech across today's
  // dispatch units only. Pay attributes per-dispatch, so prior-day
  // units already counted in their own dispatch's pay rows.
  const todaysUnits = units.filter(
    (u) => u.dispatchId === todaysDispatch.dispatchId
  );
  const estimatedToday = useMemo(
    () =>
      estimatedInstallPayForTech({
        units: todaysUnits.map((u) => ({ unitType: u.unitType })),
        crewSplit: todaysDispatch.crewSplit,
        techsOnSite: todaysDispatch.techsOnSite,
        techName: currentUserName,
      }),
    [todaysUnits, todaysDispatch, currentUserName]
  );

  function addType(type: UnitType): void {
    // Optimistic: open the section with the first card created
    // via the section's bumpCount. Easier: just close the picker
    // and let the section's onUnitsChange add the new row. To
    // trigger the section to mount, prepopulate with a placeholder
    // — but cleaner is to POST here.
    setPickerOpen(false);
    fetch("/api/units", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId: job.jobId,
        unitType: type,
        model: "(pending)",
      }),
    })
      .then((res) => res.json().catch(() => ({})))
      .then((body: { unit?: UnitServiced; error?: string }) => {
        if (!body.unit) throw new Error(body.error ?? "Add failed");
        setUnits((prev) => [
          ...prev,
          {
            ...body.unit!,
            dispatchDate: todaysDispatch.dispatchDate,
            dispatchSubmittedAt: todaysDispatch.submittedAt,
          },
        ]);
      })
      .catch((e) => {
        console.warn("[service] addType failed:", e);
        // Re-open the picker so the tech can retry; alternatively
        // surface an error toast.
        setPickerOpen(true);
      });
  }

  const pickableForAdd = useMemo(
    () => PICKABLE_TYPES.filter((t) => !presentTypes.includes(t)),
    [presentTypes]
  );

  return (
    <div className="space-y-6 pb-24">
      <div className="flex items-center gap-2">
        <Link
          href={`/jobs/${encodeURIComponent(job.jobId)}`}
          className="p-2 -ml-2 text-mse-muted hover:text-mse-navy"
          aria-label="Back to job"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-mse-muted">HVAC service</div>
          <h1 className="text-2xl font-bold text-mse-navy truncate">
            {job.customerName}
          </h1>
        </div>
      </div>

      {/* Pay-estimate hint */}
      <div className="rounded-2xl bg-mse-navy text-white p-4 shadow-elevated">
        <div className="text-[11px] uppercase tracking-[0.12em] text-mse-gold font-bold">
          Estimated for today
        </div>
        <div className="text-3xl font-bold tracking-tight mt-0.5 tabular-nums">
          {formatCurrency(estimatedToday)}
        </div>
        <div className="mt-1 text-[11px] text-white/70">
          {todaysUnits.length} unit{todaysUnits.length === 1 ? "" : "s"} ·
          locks in at Job Complete
        </div>
      </div>

      {/* Sticky checklist header — one chip per type with units */}
      {presentTypes.length > 0 && (
        <div className="sticky top-0 z-10 -mx-4 px-4 py-2 bg-white/95 backdrop-blur border-b border-mse-light">
          <div className="flex gap-1.5 overflow-x-auto">
            {presentTypes.map((t) => {
              const list = sectionsForType.get(t)!;
              return (
                <a
                  key={t}
                  href={`#section-${slugify(t)}`}
                  className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider whitespace-nowrap bg-mse-light text-mse-muted"
                >
                  {TYPE_SHORT_LABEL[t]} · {list.length}
                </a>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty state or sections */}
      {presentTypes.length === 0 ? (
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="w-full rounded-2xl bg-mse-gold/15 border-2 border-dashed border-mse-gold/40 hover:bg-mse-gold/25 transition-[background-color] p-8 text-center"
        >
          <Plus className="w-6 h-6 mx-auto text-mse-gold" />
          <div className="font-bold text-mse-navy mt-2">
            Add your first unit type
          </div>
          <div className="text-[11px] text-mse-muted mt-1">
            Pick PTAC, Split, or RTU to start photographing
          </div>
        </button>
      ) : (
        <>
          {presentTypes.map((t) => (
            <ServiceUnitTypeSection
              key={t}
              anchorId={`section-${slugify(t)}`}
              title={TYPE_SHORT_LABEL[t]}
              unitType={t}
              job={job}
              units={(sectionsForType.get(t) ?? []).filter(
                (u) => u.unitType === t
              )}
              todaysDispatchId={todaysDispatch.dispatchId}
              onUnitsChange={(nextOfType) => {
                setUnits((prev) => [
                  ...prev.filter((u) => u.unitType !== t),
                  ...nextOfType,
                ]);
              }}
            />
          ))}
          {pickableForAdd.length > 0 && (
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="w-full rounded-xl border-2 border-dashed border-mse-light hover:border-mse-navy/30 hover:text-mse-navy p-4 text-mse-muted inline-flex items-center justify-center gap-2 text-sm font-semibold"
            >
              <Plus className="w-4 h-4" />
              Add another unit type
            </button>
          )}
        </>
      )}

      {/* Type picker modal */}
      {pickerOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/40 flex items-end sm:items-center justify-center p-4"
          onClick={() => setPickerOpen(false)}
        >
          <div
            className="w-full max-w-md bg-white rounded-2xl shadow-elevated p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-mse-navy">Pick unit type</h3>
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                className="p-1 text-mse-muted hover:text-mse-navy"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2">
              {pickableForAdd.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => addType(t)}
                  className="text-left px-4 py-3 rounded-xl border border-mse-light hover:border-mse-navy/40 hover:bg-mse-light/40 font-semibold text-mse-navy"
                >
                  {TYPE_SHORT_LABEL[t]}
                </button>
              ))}
              {pickableForAdd.length === 0 && (
                <p className="text-xs text-mse-muted italic text-center py-4">
                  All unit types already have a section. Use the + button on
                  an existing section to add another of that type.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add components/ServiceUnitsForm.tsx
git commit -m "HVAC: ServiceUnitsForm shell — type picker + sticky checklist + pay hint"
```

---

## Phase 3 — New page (1 task)

### Task 5: `/jobs/[jobId]/service` server shell

**Files:**
- Create: `app/(app)/jobs/[jobId]/service/page.tsx`

Mirrors `app/(app)/jobs/[jobId]/audit/page.tsx`. Differences:

- Loads units (not audit) — uses `listUnitsForJob(jobId)` filtered to non-deleted
- Joins each unit with its dispatch's date + submittedAt for the prior-day badge rendering
- Calls `ensureDraftDispatch(jobId)` to get today's dispatch
- Redirects offline-only `local-job-…` jobs back to `/jobs/[jobId]` (offline can't use this new page)

- [ ] **Step 1: Write the page**

```tsx
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getJob, techCanAccessJob } from "@/lib/data/jobs";
import { ensureDraftDispatch, listAllDispatches } from "@/lib/data/dispatches";
import { listUnitsForJob } from "@/lib/data/units";
import { ServiceUnitsForm } from "@/components/ServiceUnitsForm";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export default async function ServicePage({
  params,
}: {
  params: { jobId: string };
}) {
  const jobId = decodeURIComponent(params.jobId);
  if (jobId.startsWith("local-job-")) {
    // Offline-only jobs use the legacy OfflineAddUnit flow until
    // they sync to a real jobId.
    redirect(`/jobs/${encodeURIComponent(jobId)}`);
  }
  const session = await getSession();
  const job = await getJob(jobId);
  if (!job) notFound();
  const canAccess = await techCanAccessJob({
    job,
    techName: session.name ?? "",
    isAdmin: session.isAdmin === true,
  });
  if (!canAccess) notFound();

  // Today's draft dispatch — created on-demand if none exists yet
  // for today. New units posted via /api/units land on this dispatch.
  const todaysDispatch = await ensureDraftDispatch(jobId);

  // All non-deleted units for this job, joined with their dispatch
  // metadata so the cards can show the "Submitted · date" badge for
  // prior-day units.
  const [units, dispatches] = await Promise.all([
    listUnitsForJob(jobId),
    listAllDispatches(),
  ]);
  const dispatchById = new Map(dispatches.map((d) => [d.dispatchId, d]));
  const activeUnits = units
    .filter((u) => !u.deleted)
    .map((u) => {
      const d = dispatchById.get(u.dispatchId);
      return {
        ...u,
        dispatchDate: d?.dispatchDate ?? "",
        dispatchSubmittedAt: d?.submittedAt ?? "",
      };
    });

  return (
    <ServiceUnitsForm
      job={job}
      initialUnits={activeUnits}
      todaysDispatch={todaysDispatch}
      currentUserName={session.name ?? ""}
    />
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: build succeeds, route `/jobs/[jobId]/service` appears in the summary.

- [ ] **Step 3: Commit**

```bash
git add app/\(app\)/jobs/\[jobId\]/service/page.tsx
git commit -m "HVAC: /jobs/[jobId]/service server page shell"
```

---

## Phase 4 — Job page integration (1 task)

### Task 6: Replace "Add unit" with "Service HVAC units" entry button

**Files:**
- Modify: `components/JobDetail.tsx`
- Modify: `app/(app)/jobs/[jobId]/page.tsx`

The existing red "Add unit" button (renders inside a `<div className="grid grid-cols-1 gap-3">` block) needs to become a "Service HVAC units" button that links to `/jobs/[jobId]/service`. The button shows a one-line status subtitle based on the units on the job.

The inline `<UnitsSection>` below the entry button stays as-is — read-only summary of today's units (no behavior change).

- [ ] **Step 1: Add the unit-summary computation in `app/(app)/jobs/[jobId]/page.tsx`**

In the existing data-loading section (where `audit` and `auditItemCount` are already computed from Task 17 of the previous feature), add:

```ts
// Pre-compute the HVAC service summary so the entry button on
// JobDetail can show "N units in progress" / "N units · all
// photographed" / "No units yet" inline.
const activeUnits = units.filter((u) => !u.deleted);
const allPhotographed = activeUnits.length > 0 &&
  activeUnits.every((u) => unitHasAllRequiredPhotos(u));
const hvacUnitSummary: "empty" | "in-progress" | "all-photographed" =
  activeUnits.length === 0
    ? "empty"
    : allPhotographed
    ? "all-photographed"
    : "in-progress";
const hvacUnitCount = activeUnits.length;
```

Add the imports at the top of the file:

```ts
import { unitHasAllRequiredPhotos } from "@/lib/data/units";
```

Pass both values to `<JobDetail>`:

```tsx
<JobDetail
  // ... existing props ...
  hvacUnitSummary={hvacUnitSummary}
  hvacUnitCount={hvacUnitCount}
/>
```

- [ ] **Step 2: Accept the new props in JobDetail + render the entry button**

In `components/JobDetail.tsx`:

Extend `Props`:

```ts
interface Props {
  // ... existing fields ...
  hvacUnitSummary: "empty" | "in-progress" | "all-photographed";
  hvacUnitCount: number;
}
```

Destructure in the function signature.

Find the existing inline block:

```tsx
<div className="grid grid-cols-1 gap-3">
  <a
    href={`/jobs/${encodeURIComponent(job.jobId)}/units/new`}
    className="rounded-2xl bg-mse-navy hover:bg-mse-navy-soft active:scale-[0.98] transition-[background-color,transform] p-5 flex items-center justify-center gap-2 shadow-elevated text-white"
  >
    <Wrench className="w-6 h-6" />
    <span className="font-bold text-lg">Add unit</span>
  </a>
</div>
```

Replace with:

```tsx
<a
  href={`/jobs/${encodeURIComponent(job.jobId)}/service`}
  className="block rounded-2xl bg-mse-red hover:bg-mse-red-hover active:scale-[0.98] transition-[background-color,transform] p-5 shadow-elevated text-white"
>
  <div className="flex items-center gap-3">
    <div className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center font-bold text-lg shrink-0">
      <Wrench className="w-5 h-5" />
    </div>
    <div className="flex-1 min-w-0">
      <div className="font-bold text-lg">Service HVAC units</div>
      <div className="text-[11px] text-white/80 mt-0.5">
        {hvacUnitSummary === "empty"
          ? "No units yet — tap to start"
          : hvacUnitSummary === "all-photographed"
          ? `${hvacUnitCount} unit${hvacUnitCount === 1 ? "" : "s"} · all photographed`
          : `${hvacUnitCount} unit${hvacUnitCount === 1 ? "" : "s"} in progress`}
      </div>
    </div>
  </div>
</a>
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add components/JobDetail.tsx app/\(app\)/jobs/\[jobId\]/page.tsx
git commit -m "HVAC: Service HVAC units entry button on job detail page"
```

---

## Phase 5 — Legacy redirect (1 task)

### Task 7: Redirect `/jobs/[jobId]/units/new` for server-known jobs

**Files:**
- Modify: `app/(app)/jobs/[jobId]/units/new/page.tsx`

The legacy single-unit page renders `<AddUnitForm>` for server jobs and `<OfflineAddUnit>` for offline-only jobs. After this change, server jobs get a hard redirect to `/service`; offline jobs continue to hit the offline component (which can't use the new flow until the job syncs).

- [ ] **Step 1: Read the current file**

Open `app/(app)/jobs/[jobId]/units/new/page.tsx` and review the structure. It probably looks like:

```tsx
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getJob, techCanAccessJob } from "@/lib/data/jobs";
import { nextUnitNumberOnJob } from "@/lib/data/units";
import { AddUnitForm } from "@/components/AddUnitForm";
import { OfflineAddUnit } from "@/components/OfflineAddUnit";

export const dynamic = "force-dynamic";

export default async function AddUnitPage({
  params,
}: {
  params: { jobId: string };
}) {
  const jobId = decodeURIComponent(params.jobId);
  if (jobId.startsWith("local-job-")) {
    return <OfflineAddUnit jobId={jobId} />;
  }
  // ... existing server-side logic ...
}
```

- [ ] **Step 2: Add the redirect for server-known jobs**

Replace the function body with:

```tsx
import { notFound, redirect } from "next/navigation";
import { OfflineAddUnit } from "@/components/OfflineAddUnit";

export const dynamic = "force-dynamic";

export default async function AddUnitPage({
  params,
}: {
  params: { jobId: string };
}) {
  const jobId = decodeURIComponent(params.jobId);
  if (jobId.startsWith("local-job-")) {
    // Offline-only jobs keep the legacy single-unit flow until they
    // sync to a real jobId.
    return <OfflineAddUnit jobId={jobId} />;
  }
  // Server-known jobs go to the new multi-card view.
  redirect(`/jobs/${encodeURIComponent(jobId)}/service`);
}
```

Notes:
- Drop the now-unused `getSession`, `getJob`, `techCanAccessJob`, `nextUnitNumberOnJob`, `AddUnitForm` imports — they're only needed by the (now-removed) server-job branch.
- `notFound` may also be unused now; remove if so.
- `AddUnitForm` itself is still imported by `OfflineAddUnit` (via its own internal flow), so the component file stays. Don't delete `components/AddUnitForm.tsx`.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: build succeeds. The redirect route appears as the same `/jobs/[jobId]/units/new` path in the build summary (Next sees it as a regular page; the redirect is server-side at request time).

- [ ] **Step 4: Commit**

```bash
git add app/\(app\)/jobs/\[jobId\]/units/new/page.tsx
git commit -m "HVAC: redirect legacy /units/new to /service for server-known jobs"
```

---

## Phase 6 — Final regression (1 task)

### Task 8: Final regression + browser smoke

**Files:** none (verification only)

- [ ] **Step 1: Full static gate**

```bash
npm run build
```

Expected: build succeeds. The build summary should show:
- `ƒ /jobs/[jobId]/service` (new)
- `ƒ /jobs/[jobId]/units/new` (still present — now a redirect for server jobs, OfflineAddUnit for local)
- `ƒ /jobs/[jobId]` (unchanged route, modified component)
- `ƒ /api/units` (validator fix, route still present)

- [ ] **Step 2: Browser smoke (manual)**

Start the dev server: `npm run dev` (background) and test in a real browser:

1. **Legacy redirect**: visit `/jobs/<some-existing-jobId>/units/new` — should immediately redirect to `/jobs/<id>/service`. Visit on an offline-only job (if one exists) — should still show the offline form.
2. **Empty service page**: visit `/jobs/<jobId>/service` on a job with no units — see "Add your first unit type" CTA. Tap → modal opens with 6 unit type options. Pick PTAC.
3. **Card appears with placeholder**: section "PTAC / Ductless · 1" renders. The card shows nameplate slot + before/after slots + filter slot + make/model/serial inputs. Model field shows empty (the "(pending)" placeholder is stored in the sheet but displayed as empty per the spec).
4. **OCR fill**: tap the nameplate slot → camera opens → capture a nameplate → photo uploads → make/model/serial fields auto-populate via OCR.
5. **Photo persistence**: refresh the page → all photos and field values persist.
6. **Count stepper**: tap + on the section → 2nd card appears. Tap − → it gets soft-deleted.
7. **Multi-day**: if a job has units from a prior dispatch, they should render as muted "✓ Submitted · <date>" cards without the editable inputs.
8. **Pay hint**: top of the page shows a running "$X estimated for today" figure that updates as cards complete.
9. **JobDetail entry button**: from `/jobs/<jobId>`, the red "Service HVAC units" button shows the right subtitle for the current state (no units / N in progress / all photographed).

- [ ] **Step 3: If anything fails, file a fix-up task and commit**

Each fix is its own task with the pattern: identify the issue, fix the file, verify build, commit with a clear message.

- [ ] **Step 4: Memory update (optional)**

If anything surprising came up during smoke testing (e.g., the OCR hook signature didn't match expectations, or `photoUrlForSlot` was already exported from lib and the local helper became dead code), capture a one-line lesson in the project's memory store for next time.

---

## Notes for the implementer

- **Frequent commits.** Each task ends in a commit. Don't batch.
- **Don't push.** Standing rule. Kevin will say when to push.
- **No Co-Authored-By Claude lines.** Standing rule.
- **iOS stable-slot rule** ([[project-mse-field-photo-slots]] in memory): every photo capture slot must use a stable input element across renders so Safari doesn't lose the blob URL on focus change. Both `PhotoCapture` and `AuditPhotoSlot` already follow this. The new card uses `AuditPhotoSlot` per slot — keep the AuditPhotoSlot identity stable by always rendering it (never conditionally) for each slot in the slot map.
- **Reference files** for the patterns this plan mirrors:
  - `components/AuditItemSection.tsx` — card section with count steppers + per-card photo slots
  - `components/AuditForm.tsx` — top-level form with sticky checklist + section composition
  - `app/(app)/jobs/[jobId]/audit/page.tsx` — server page that loads + composes data for a client form
  - `components/AddUnitForm.tsx:165–650` — legacy OCR + photo upload integration for HVAC units (the new card replicates this behavior per-card)
- **`/api/units` returns slightly different response shapes** depending on operation:
  - POST returns `{ unit, dispatchId }`
  - PATCH returns `{ ok: true }` (no fresh row)
  - DELETE returns `{ ok: true }` on success, `{ error }` on guard failure
  - The new card components should not assume a fresh row comes back from PATCH — patch local state from the diff sent, not the response.
- **The placeholder model value `"(pending)"`** is a small ugliness — the API requires `model` to be non-empty, but the new card creates a unit BEFORE the tech has photographed the nameplate. The card displays an empty input field; the placeholder is just there to satisfy the server validator. When OCR fills in the real model, the PATCH overwrites it. If this ends up creating noise in the sheet, a follow-up could relax the API validator or move model-required to a "block save" check rather than a "block create" check. Defer.
