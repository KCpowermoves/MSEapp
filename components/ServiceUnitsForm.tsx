"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Plus, Save, X } from "lucide-react";
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
  const router = useRouter();
  const [units, setUnits] = useState(initialUnits);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Units + photos auto-save as they're captured, so "Save" just
  // returns to the job and forces a refresh so the tech sees the
  // HVAC card flip to green — no manual reload.
  function saveAndBack() {
    router.push(`/jobs/${encodeURIComponent(job.jobId)}`);
    router.refresh();
  }

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

  async function addType(type: UnitType): Promise<void> {
    setPickerOpen(false);
    setAddError(null);
    try {
      const res = await fetch("/api/units", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: job.jobId,
          unitType: type,
          model: "(pending)",
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        unit?: UnitServiced;
        error?: string;
      };
      if (!res.ok || !body.unit) {
        throw new Error(body.error ?? "Add failed");
      }
      setUnits((prev) => [
        ...prev,
        {
          ...body.unit!,
          dispatchDate: todaysDispatch.dispatchDate,
          dispatchSubmittedAt: todaysDispatch.submittedAt,
        },
      ]);
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "Add failed");
      // Re-open the picker so the tech can retry.
      setPickerOpen(true);
    }
  }

  const pickableForAdd = useMemo(
    () => PICKABLE_TYPES.filter((t) => !presentTypes.includes(t)),
    [presentTypes]
  );

  return (
    <div className="space-y-6 pb-28">
      {/* Compliance banner — pulses gently to catch the tech's eye
          before they start photographing a unit that won't qualify.
          motion-reduce drops the animation entirely for users with
          the OS-level reduced-motion preference. Same pattern used
          on the legacy /units/new form. */}
      <div
        role="alert"
        className={cn(
          "rounded-xl border border-yellow-400/70 px-4 py-3",
          "text-sm font-bold text-mse-navy flex items-start gap-2",
          "animate-soft-blink motion-reduce:animate-none motion-reduce:bg-yellow-200"
        )}
      >
        <AlertTriangle className="w-5 h-5 text-mse-navy shrink-0 mt-0.5" />
        <span className="leading-snug">
          HVAC units must be at least two years old to qualify for the program.
        </span>
      </div>

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

      {addError && (
        <div className="text-[11px] text-mse-red bg-mse-red/5 border border-mse-red/20 rounded px-3 py-2">
          {addError}
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

      {/* Save & go back — auto-saved, this just refreshes the job so
          the HVAC card shows its updated (green) state. */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-mse-light p-4 safe-bottom z-10">
        <div className="max-w-2xl mx-auto">
          <button
            type="button"
            onClick={saveAndBack}
            className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-2xl font-bold bg-emerald-600 text-white hover:bg-emerald-700 active:scale-[0.98]"
          >
            <Save className="w-4 h-4" />
            Save &amp; go back
          </button>
        </div>
      </div>
    </div>
  );
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
