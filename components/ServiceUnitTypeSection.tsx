"use client";

import { useMemo, useState } from "react";
import { Plus, Minus, Loader2, CheckCircle2 } from "lucide-react";
import { AuditPhotoSlot } from "@/components/AuditPhotoSlot";
import { useOcrAutoFill } from "@/hooks/useOcrAutoFill";
import { photoUrlForSlot, applyPhotoUrlForSlot } from "@/lib/photo-slots";
import { slotsForType, flatSlots } from "@/lib/unit-slots";
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
  units: UnitWithDispatchMeta[];
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
  const sorted = useMemo(
    () => units.slice().sort((a, b) => a.unitNumberOnJob - b.unitNumberOnJob),
    [units]
  );
  const todaysUnits = sorted.filter((u) => u.dispatchId === todaysDispatchId);
  const priorUnits = sorted.filter((u) => u.dispatchId !== todaysDispatchId);
  const [busyCount, setBusyCount] = useState(false);
  const [bumpError, setBumpError] = useState<string | null>(null);

  async function bumpCount(direction: "up" | "down") {
    if (busyCount) return;
    setBusyCount(true);
    setBumpError(null);
    try {
      if (direction === "up") {
        const res = await fetch("/api/units", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobId: job.jobId,
            unitType,
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
            dispatchDate: "",
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
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "Could not delete unit");
        }
        onUnitsChange(units.filter((u) => u.unitId !== last.unitId));
      }
    } catch (e) {
      setBumpError(e instanceof Error ? e.message : "Add/remove failed");
    } finally {
      setBusyCount(false);
    }
  }

  async function uploadPhoto(unitId: string, slot: PhotoSlot, file: File): Promise<void> {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("jobId", job.jobId);
    fd.append("unitId", unitId);
    fd.append("slot", slot);
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!res.ok || !body.url) throw new Error(body.error ?? "Upload failed");
    onUnitsChange(
      units.map((u) => {
        if (u.unitId !== unitId) return u;
        const updated = { ...u };
        applyPhotoUrlForSlot(updated, slot, body.url ?? "");
        return updated;
      })
    );
  }

  async function patchUnit(unitId: string, patch: Partial<UnitServiced>): Promise<void> {
    const res = await fetch("/api/units", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unitId, ...patch }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? "Patch failed");
    }
    onUnitsChange(units.map((u) => (u.unitId === unitId ? { ...u, ...patch } : u)));
  }

  return (
    <section id={anchorId} className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-mse-navy uppercase tracking-wider">{title}</h2>
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
          <span className="w-8 text-center font-bold text-mse-navy tabular-nums">{sorted.length}</span>
          <button
            type="button"
            onClick={() => bumpCount("up")}
            disabled={busyCount}
            className="w-8 h-8 inline-flex items-center justify-center rounded-full bg-mse-navy text-white"
            aria-label="Add"
          >
            {busyCount ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {bumpError && (
        <div className="text-[11px] text-mse-red bg-mse-red/5 border border-mse-red/20 rounded px-3 py-2">
          {bumpError}
        </div>
      )}

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

function PriorDayCard({ unit, unitType }: { unit: UnitWithDispatchMeta; unitType: UnitType }) {
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
        {[unit.make, unit.model, unit.serial].filter((s) => s && s !== "(pending)").join(" · ") || "—"}
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
  const [model, setModel] = useState(unit.model === "(pending)" ? "" : unit.model || "");
  const [serial, setSerial] = useState(unit.serial || "");
  const [notes, setNotes] = useState(unit.notes || "");
  const [label, setLabel] = useState(unit.label || "");

  const ocr = useOcrAutoFill({
    make,
    model,
    serial,
    setMake: (v) => {
      setMake(v);
      onPatch({ make: v }).catch((e) =>
        console.warn(`[service] patch failed unit=${unit.unitId} field=make:`, e)
      );
    },
    setModel: (v) => {
      setModel(v);
      if (v) {
        onPatch({ model: v }).catch((e) =>
          console.warn(`[service] patch failed unit=${unit.unitId} field=model:`, e)
        );
      }
    },
    setSerial: (v) => {
      setSerial(v);
      onPatch({ serial: v }).catch((e) =>
        console.warn(`[service] patch failed unit=${unit.unitId} field=serial:`, e)
      );
    },
  });

  const slots = useMemo(() => slotsForType(unitType), [unitType]);
  const allSlots = useMemo(() => flatSlots(slots), [slots]);
  const filled = allSlots.filter((s) => Boolean(photoUrlForSlot(unit, s.slot)));
  const requiredFilled = allSlots.filter((s) => s.required).filter((s) => Boolean(photoUrlForSlot(unit, s.slot)));
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
            complete ? "bg-emerald-100 text-emerald-800" : "bg-mse-gold/15 text-mse-navy"
          )}
        >
          {complete ? "✓ Complete" : `⏳ ${filled.length}/${allSlots.length} photos`}
        </span>
      </div>

      <input
        type="text"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => {
          if (label !== unit.label) {
            onPatch({ label }).catch((e) =>
              console.warn(`[service] patch failed unit=${unit.unitId} field=label:`, e)
            );
          }
        }}
        placeholder="Label (optional, e.g. Roof unit east)"
        className="w-full px-3 py-2 rounded-lg border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy"
      />

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
              // OCR takes a Blob; File extends Blob so passing the File is fine.
              ocr.run(file).catch((e) => console.warn("[service] OCR failed:", e));
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
            if (make !== unit.make) {
              onPatch({ make }).catch((e) =>
                console.warn(`[service] patch failed unit=${unit.unitId} field=make:`, e)
              );
            }
          }}
          placeholder="Make"
          className="px-2 py-1.5 rounded-md border border-mse-light bg-white focus:outline-none focus:border-mse-navy"
        />
        <input
          type="text"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          onBlur={() => {
            if (model && model !== unit.model) {
              onPatch({ model }).catch((e) =>
                console.warn(`[service] patch failed unit=${unit.unitId} field=model:`, e)
              );
            }
          }}
          placeholder="Model (required)"
          className="px-2 py-1.5 rounded-md border border-mse-light bg-white focus:outline-none focus:border-mse-navy"
        />
        <input
          type="text"
          value={serial}
          onChange={(e) => setSerial(e.target.value)}
          onBlur={() => {
            if (serial !== unit.serial) {
              onPatch({ serial }).catch((e) =>
                console.warn(`[service] patch failed unit=${unit.unitId} field=serial:`, e)
              );
            }
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
          if (notes !== unit.notes) {
            onPatch({ notes }).catch((e) =>
              console.warn(`[service] patch failed unit=${unit.unitId} field=notes:`, e)
            );
          }
        }}
        rows={2}
        placeholder="Notes (optional)"
        className="w-full px-3 py-2 rounded-lg border border-mse-light bg-white text-xs focus:outline-none focus:border-mse-navy resize-none"
      />
    </div>
  );
}

