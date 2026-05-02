"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronDown, Loader2, Plus } from "lucide-react";
import { UnitTypePicker } from "@/components/UnitTypePicker";
import { PhotoCapture, type CapturedPhoto } from "@/components/PhotoCapture";
import { enqueuePhoto } from "@/lib/upload-queue";
import { kickWorker } from "@/lib/upload-worker";
import { cn } from "@/lib/utils";
import type { Job, PhotoSlot, UnitType } from "@/lib/types";

interface SlotDef {
  slot: PhotoSlot;
  label: string;
  hint: string;
  required: boolean;
}

const SIMPLE_TYPES: UnitType[] = ["PTAC / Ductless"];
const RTU_TYPES: UnitType[] = ["RTU-S", "RTU-M", "RTU-L"];

function slotsForType(unitType: UnitType | null): SlotDef[] {
  if (!unitType) return [];
  if (SIMPLE_TYPES.includes(unitType)) {
    return [
      { slot: "pre", label: "Pre-service", hint: "Before you start", required: true },
      { slot: "post", label: "Post-service", hint: "After tune-up", required: true },
      { slot: "nameplate", label: "Nameplate", hint: "Make / model / serial label", required: true },
      { slot: "filter", label: "Filter", hint: "New filter installed (optional)", required: false },
    ];
  }
  if (RTU_TYPES.includes(unitType)) {
    return [
      { slot: "coil1_pre", label: "Coil 1 · before", hint: "First coil before tune-up", required: true },
      { slot: "coil1_post", label: "Coil 1 · after", hint: "First coil after tune-up", required: true },
      { slot: "coil2_pre", label: "Coil 2 · before", hint: "Second coil before tune-up", required: true },
      { slot: "coil2_post", label: "Coil 2 · after", hint: "Second coil after tune-up", required: true },
      { slot: "nameplate", label: "Nameplate", hint: "Make / model / serial label", required: true },
      { slot: "filter_pre", label: "Filter · before", hint: "Filter condition before cleaning", required: true },
      { slot: "filter_post", label: "Filter · after", hint: "Filter after replacement", required: true },
    ];
  }
  // Split System — 11 required
  return [
    { slot: "out_pre_1", label: "Outdoor · side 1 · before", hint: "Outdoor unit, first angle", required: true },
    { slot: "out_pre_2", label: "Outdoor · side 2 · before", hint: "Different angle", required: true },
    { slot: "out_pre_3", label: "Outdoor · side 3 · before", hint: "Third angle", required: true },
    { slot: "out_post_1", label: "Outdoor · side 1 · after", hint: "After tune-up", required: true },
    { slot: "out_post_2", label: "Outdoor · side 2 · after", hint: "After tune-up", required: true },
    { slot: "out_post_3", label: "Outdoor · side 3 · after", hint: "After tune-up", required: true },
    { slot: "out_nameplate", label: "Outdoor nameplate", hint: "Outdoor unit make / model / serial", required: true },
    { slot: "in_pre", label: "Air handler · before", hint: "Indoor unit before service", required: true },
    { slot: "in_post", label: "Air handler · after", hint: "Indoor unit after service", required: true },
    { slot: "in_nameplate", label: "Air handler nameplate", hint: "Indoor unit make / model / serial", required: true },
    { slot: "filter", label: "Filter", hint: "Filter condition / replacement", required: true },
  ];
}

export function AddUnitForm({ job }: { job: Job }) {
  const router = useRouter();
  const [unitType, setUnitType] = useState<UnitType | null>(null);
  const [photos, setPhotos] = useState<Partial<Record<PhotoSlot, CapturedPhoto>>>({});
  const [additionalPhotos, setAdditionalPhotos] = useState<CapturedPhoto[]>([]);
  const [showOptional, setShowOptional] = useState(false);
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [serial, setSerial] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slots = useMemo(() => slotsForType(unitType), [unitType]);
  const requiredSlots = slots.filter((s) => s.required);
  const filledRequired = requiredSlots.filter((s) => photos[s.slot]).length;
  const requiredCount = requiredSlots.length;
  const allRequiredReady =
    unitType !== null && filledRequired === requiredCount;
  const canSubmit = unitType !== null && allRequiredReady && !submitting;

  const setSlot = (slot: PhotoSlot) => (next: CapturedPhoto | null) => {
    setPhotos((prev) => {
      const copy = { ...prev };
      if (next === null) delete copy[slot];
      else copy[slot] = next;
      return copy;
    });
  };

  const setAdditionalAt = (i: number) => (next: CapturedPhoto | null) => {
    setAdditionalPhotos((prev) => {
      const copy = [...prev];
      if (next === null) {
        copy.splice(i, 1);
      } else {
        copy[i] = next;
      }
      return copy;
    });
  };

  const submit = async () => {
    if (!canSubmit || !unitType) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/units", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: job.jobId,
          unitType,
          make,
          model,
          serial,
          notes,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not save unit");
      }
      const data = await res.json();
      const unitId = data.unit.unitId as string;
      const unitNumber = String(data.unit.unitNumberOnJob).padStart(3, "0");
      const typeTag = unitType!.replace(/[\s/]+/g, "-");

      // Enqueue all the slot photos that the user actually captured
      for (const { slot } of slots) {
        const photo = photos[slot];
        if (!photo) continue;
        await enqueuePhoto({
          id: `${unitId}-${slot}-${Date.now()}`,
          jobId: job.jobId,
          unitId,
          serviceId: null,
          photoSlot: slot,
          blob: photo.blob,
          filename: `Unit-${unitNumber}_${typeTag}_${slot}.jpg`,
          capturedAt: photo.capturedAt,
        });
      }
      // Enqueue any additional photos
      for (let i = 0; i < additionalPhotos.length; i++) {
        const photo = additionalPhotos[i];
        if (!photo) continue;
        await enqueuePhoto({
          id: `${unitId}-additional-${i}-${Date.now()}`,
          jobId: job.jobId,
          unitId,
          serviceId: null,
          photoSlot: "additional",
          blob: photo.blob,
          filename: `${unitNumber}_additional_${i + 1}.jpg`,
          capturedAt: photo.capturedAt,
        });
      }
      kickWorker();
      router.replace(`/jobs/${encodeURIComponent(job.jobId)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save unit");
      setSubmitting(false);
    }
  };

  const additionalSlotCount = Math.max(additionalPhotos.length + 1, 1);

  return (
    <div className="space-y-6 pb-24">
      <div className="flex items-center gap-2">
        <Link
          href={`/jobs/${encodeURIComponent(job.jobId)}`}
          className="p-2 -ml-2 text-mse-muted hover:text-mse-navy"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-2xl font-bold text-mse-navy">Add unit</h1>
      </div>

      {job.selfSold && job.soldBy && (
        <div className="rounded-xl bg-mse-gold/15 border border-mse-gold/30 px-4 py-3 text-sm text-mse-navy">
          Self-sold by <span className="font-bold">{job.soldBy}</span> — every
          unit on this job credits their sales bonus.
        </div>
      )}

      <Field label="Unit type" required>
        <UnitTypePicker
          value={unitType}
          onChange={(next) => {
            setUnitType(next);
            setPhotos({});
          }}
        />
      </Field>

      {unitType && (
        <Field label="Photos" required>
          <div className="space-y-2">
            {slots.map((p) => (
              <PhotoCapture
                key={p.slot}
                label={p.label}
                hint={p.hint}
                required={p.required}
                value={photos[p.slot] ?? null}
                onChange={setSlot(p.slot)}
              />
            ))}
          </div>
        </Field>
      )}

      {unitType && (
        <Field label="Additional photos">
          <div className="text-xs text-mse-muted mb-2">
            Any extras — refrigerant gauges, before/after of a problem area,
            anything that helps document the work. Add as many as you like.
          </div>
          <div className="space-y-2">
            {Array.from({ length: additionalSlotCount }).map((_, i) => (
              <PhotoCapture
                key={i}
                label={i === 0 ? "Additional photo" : `Additional photo ${i + 1}`}
                value={additionalPhotos[i] ?? null}
                onChange={setAdditionalAt(i)}
              />
            ))}
          </div>
          {additionalPhotos.length > 0 && (
            <div className="text-xs text-mse-muted mt-2 inline-flex items-center gap-1">
              <Plus className="w-3 h-3" />
              {additionalPhotos.length} extra photo
              {additionalPhotos.length === 1 ? "" : "s"}
            </div>
          )}
        </Field>
      )}

      <button
        type="button"
        onClick={() => setShowOptional((v) => !v)}
        className="w-full text-left text-sm font-semibold text-mse-muted flex items-center justify-between p-3 rounded-xl bg-mse-light/40 hover:bg-mse-light"
      >
        <span>Make / model / serial / notes (optional)</span>
        <ChevronDown
          className={cn(
            "w-4 h-4 transition-transform",
            showOptional && "rotate-180"
          )}
        />
      </button>

      {showOptional && (
        <div className="space-y-4 animate-fade-in">
          <Field label="Make">
            <input
              type="text"
              value={make}
              onChange={(e) => setMake(e.target.value)}
              autoCapitalize="words"
              className="w-full px-4 py-3 rounded-xl border border-mse-light bg-white text-base focus:outline-none focus:border-mse-navy"
            />
          </Field>
          <Field label="Model">
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-mse-light bg-white text-base focus:outline-none focus:border-mse-navy"
            />
          </Field>
          <Field label="Serial">
            <input
              type="text"
              value={serial}
              onChange={(e) => setSerial(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-mse-light bg-white text-base focus:outline-none focus:border-mse-navy"
            />
          </Field>
          <Field label="Notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full px-4 py-3 rounded-xl border border-mse-light bg-white text-base focus:outline-none focus:border-mse-navy resize-none"
            />
          </Field>
        </div>
      )}

      {error && (
        <div className="text-mse-red text-sm bg-mse-red/5 border border-mse-red/20 rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-mse-light p-4 safe-bottom z-10">
        <div className="max-w-2xl mx-auto">
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className={cn(
              "w-full font-bold rounded-2xl py-4 text-center transition-[background-color,transform]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mse-red focus-visible:ring-offset-2",
              canSubmit
                ? "bg-mse-red hover:bg-mse-red-hover active:scale-[0.98] text-white shadow-card"
                : "bg-mse-light text-mse-muted cursor-not-allowed"
            )}
          >
            {submitting ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin" />
                Saving...
              </span>
            ) : (
              `Save unit${
                allRequiredReady
                  ? ""
                  : ` · ${filledRequired}/${requiredCount} required photos`
              }`
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  required,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <div>
      <div className="text-sm font-semibold text-mse-navy mb-2">
        {label}
        {required && <span className="text-mse-red ml-1">*</span>}
      </div>
      {children}
    </div>
  );
}
