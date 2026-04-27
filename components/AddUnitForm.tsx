"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronDown, Loader2 } from "lucide-react";
import { UnitTypePicker } from "@/components/UnitTypePicker";
import { PhotoCapture, type CapturedPhoto } from "@/components/PhotoCapture";
import { enqueuePhoto } from "@/lib/upload-queue";
import { kickWorker } from "@/lib/upload-worker";
import { cn } from "@/lib/utils";
import type { Job, PhotoSlot, UnitSubType, UnitType } from "@/lib/types";

// "Standard tune-up" is the implicit default — the picker only shows
// alternative sub-types. None selected = standard.
const ALT_SUB_TYPES: { id: UnitSubType; label: string }[] = [
  { id: "Water-source heat pump", label: "Water-source heat pump" },
  { id: "VRV-VRF", label: "VRV / VRF" },
  { id: "Other building tune-up", label: "Other building tune-up" },
];

const PHOTO_SLOTS: {
  slot: PhotoSlot;
  label: string;
  hint: string;
  required: boolean;
}[] = [
  { slot: "pre", label: "Pre-service", hint: "Before you start", required: true },
  { slot: "post", label: "Post-service", hint: "After tune-up", required: true },
  { slot: "clean", label: "Clean", hint: "Coils + cabinet clean", required: true },
  { slot: "nameplate", label: "Nameplate", hint: "Make / model / serial label", required: true },
  { slot: "filter", label: "Filter", hint: "New filter installed (optional)", required: false },
];

export function AddUnitForm({ job }: { job: Job }) {
  const router = useRouter();
  const [unitType, setUnitType] = useState<UnitType | null>(null);
  const [subType, setSubType] = useState<UnitSubType>("Standard tune-up");
  const [photos, setPhotos] = useState<Record<PhotoSlot, CapturedPhoto | null>>({
    pre: null,
    post: null,
    clean: null,
    nameplate: null,
    filter: null,
  });
  const [showOptional, setShowOptional] = useState(false);
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [serial, setSerial] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requiredPhotosReady = PHOTO_SLOTS.filter((p) => p.required).every(
    (p) => photos[p.slot] !== null
  );
  const requiredCount = PHOTO_SLOTS.filter((p) => p.required).length;
  const filledRequired = PHOTO_SLOTS.filter(
    (p) => p.required && photos[p.slot]
  ).length;
  const canSubmit =
    unitType !== null && subType !== null && requiredPhotosReady && !submitting;

  const setSlot = (slot: PhotoSlot) => (next: CapturedPhoto | null) => {
    setPhotos((prev) => ({ ...prev, [slot]: next }));
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
          unitSubType: subType,
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

      for (const { slot } of PHOTO_SLOTS) {
        const photo = photos[slot];
        if (!photo) continue;
        await enqueuePhoto({
          id: `${unitId}-${slot}-${Date.now()}`,
          jobId: job.jobId,
          unitId,
          serviceId: null,
          photoSlot: slot,
          blob: photo.blob,
          filename: `${unitNumber}_${slot}.jpg`,
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
        <UnitTypePicker value={unitType} onChange={setUnitType} />
      </Field>

      <Field label="Sub-type">
        <div className="text-xs text-mse-muted mb-2">
          Standard HVAC tune-up by default. Tap below only if this unit is
          one of the alternative types.
        </div>
        <div className="grid grid-cols-1 gap-2">
          {ALT_SUB_TYPES.map((s) => {
            const active = subType === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() =>
                  setSubType(active ? "Standard tune-up" : s.id)
                }
                className={cn(
                  "h-12 rounded-xl text-sm font-medium px-3 transition-[background-color,border-color,transform]",
                  "active:scale-95",
                  active
                    ? "bg-mse-navy text-white border-2 border-mse-navy"
                    : "bg-white text-mse-navy border-2 border-mse-light hover:border-mse-navy/40"
                )}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="Photos" required>
        <div className="space-y-2">
          {PHOTO_SLOTS.map((p) => (
            <PhotoCapture
              key={p.slot}
              label={p.label}
              hint={p.hint}
              required={p.required}
              value={photos[p.slot]}
              onChange={setSlot(p.slot)}
            />
          ))}
        </div>
      </Field>

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
              `Save unit${requiredPhotosReady ? "" : ` · ${filledRequired}/${requiredCount} required photos`}`
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
