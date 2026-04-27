"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronDown, Loader2 } from "lucide-react";
import { UnitTypePicker } from "@/components/UnitTypePicker";
import { CrewPicker } from "@/components/CrewPicker";
import { PhotoCapture, type CapturedPhoto } from "@/components/PhotoCapture";
import { useTodaysCrew } from "@/hooks/useTodaysCrew";
import { enqueuePhoto } from "@/lib/upload-queue";
import { kickWorker } from "@/lib/upload-worker";
import { cn } from "@/lib/utils";
import type { Job, PhotoSlot, UnitSubType, UnitType } from "@/lib/types";

const SUB_TYPES: { id: UnitSubType; label: string }[] = [
  { id: "Standard tune-up", label: "Standard tune-up" },
  { id: "Water-source heat pump", label: "Water-source heat pump" },
  { id: "VRV-VRF", label: "VRV / VRF" },
  { id: "Other building tune-up", label: "Other building tune-up" },
];

const PHOTO_SLOTS: { slot: PhotoSlot; label: string; hint: string }[] = [
  { slot: "pre", label: "Pre-service", hint: "Before you start" },
  { slot: "post", label: "Post-service", hint: "After tune-up" },
  { slot: "clean", label: "Clean", hint: "Coils + cabinet clean" },
  { slot: "nameplate", label: "Nameplate", hint: "Make / model / serial label" },
  { slot: "filter", label: "Filter", hint: "New filter installed" },
];

export function AddUnitForm({
  job,
  activeTechs,
}: {
  job: Job;
  activeTechs: string[];
}) {
  const router = useRouter();
  const { crew } = useTodaysCrew(job.jobId);
  const [unitType, setUnitType] = useState<UnitType | null>(null);
  const [subType, setSubType] = useState<UnitSubType>("Standard tune-up");
  const [selfSold, setSelfSold] = useState(false);
  const [soldBy, setSoldBy] = useState<string | null>(null);
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

  const sellerOptions = crew.length > 0 ? crew : activeTechs;
  const allPhotosReady = PHOTO_SLOTS.every((p) => photos[p.slot] !== null);
  const sellerOk = !selfSold || (selfSold && soldBy);
  const canSubmit =
    unitType !== null && subType !== null && allPhotosReady && sellerOk && !submitting;

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
          selfSold,
          soldBy: selfSold ? soldBy : "",
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

      <Field label="Unit type" required>
        <UnitTypePicker value={unitType} onChange={setUnitType} />
      </Field>

      <Field label="Sub-type">
        <div className="grid grid-cols-2 gap-2">
          {SUB_TYPES.map((s) => {
            const active = subType === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSubType(s.id)}
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

      <Field label="Self-sold">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setSelfSold((v) => !v);
              if (selfSold) setSoldBy(null);
            }}
            role="switch"
            aria-checked={selfSold}
            className={cn(
              "relative w-14 h-8 rounded-full transition-colors",
              selfSold ? "bg-mse-gold" : "bg-mse-light"
            )}
          >
            <span
              className={cn(
                "absolute top-1 left-1 w-6 h-6 bg-white rounded-full shadow-card transition-transform",
                selfSold ? "translate-x-6" : ""
              )}
            />
          </button>
          <span className="text-sm text-mse-muted">
            {selfSold ? "Yes — pick the seller below" : "No"}
          </span>
        </div>
      </Field>

      {selfSold && (
        <Field label="Sold by" required>
          {sellerOptions.length === 0 ? (
            <div className="text-sm text-mse-muted">
              Add today&apos;s crew on the job page first.
            </div>
          ) : (
            <CrewPicker
              options={sellerOptions}
              value={soldBy}
              onChange={setSoldBy}
            />
          )}
        </Field>
      )}

      <Field label="Photos" required>
        <div className="space-y-2">
          {PHOTO_SLOTS.map((p) => (
            <PhotoCapture
              key={p.slot}
              label={p.label}
              hint={p.hint}
              required
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
              `Save unit${allPhotosReady ? "" : ` · ${PHOTO_SLOTS.filter((p) => photos[p.slot]).length}/5 photos`}`
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
