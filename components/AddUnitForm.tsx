"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Camera, Loader2, X } from "lucide-react";
import imageCompression from "browser-image-compression";
import { UnitTypePicker } from "@/components/UnitTypePicker";
import { PhotoCapture, type CapturedPhoto } from "@/components/PhotoCapture";
import { enqueueDraftUnit, enqueuePhoto } from "@/lib/upload-queue";
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

export function AddUnitForm({
  job,
  nextUnitNumber,
}: {
  job: Job;
  nextUnitNumber: number;
}) {
  const router = useRouter();
  const [unitType, setUnitType] = useState<UnitType | null>(null);
  const [photos, setPhotos] = useState<Partial<Record<PhotoSlot, CapturedPhoto>>>({});
  const [additionalPhotos, setAdditionalPhotos] = useState<CapturedPhoto[]>([]);
  const [label, setLabel] = useState(`Unit ${nextUnitNumber}`);
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

  const addExtrasToAdditional = (extras: CapturedPhoto[]) => {
    setAdditionalPhotos((prev) => [...prev, ...extras]);
  };

  const removeAdditional = (i: number) => {
    setAdditionalPhotos((prev) => prev.filter((_, idx) => idx !== i));
  };

  const submit = async () => {
    if (!canSubmit || !unitType) return;
    setSubmitting(true);
    setError(null);

    let unitId: string;
    let unitNumber: string;
    let wentOffline = false;

    // Try the online path first. On network failure (offline / basement /
    // bad signal) fall back to a local draft that the worker will sync
    // when connectivity returns.
    try {
      const res = await fetch("/api/units", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: job.jobId,
          unitType,
          label,
          make,
          model,
          serial,
          notes,
        }),
      });
      if (!res.ok) {
        // HTTP error (auth, validation, 5xx) — surface and stop.
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Could not save unit");
        setSubmitting(false);
        return;
      }
      const data = await res.json();
      unitId = data.unit.unitId as string;
      unitNumber = String(data.unit.unitNumberOnJob).padStart(3, "0");
    } catch {
      // Network error — go offline. Create a draft locally; the
      // background worker will POST it to /api/units when online.
      wentOffline = true;
      const draftId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      try {
        await enqueueDraftUnit({
          id: draftId,
          jobId: job.jobId,
          unitType,
          label,
          make,
          model,
          serial,
          notes,
          fallbackUnitNumber: nextUnitNumber,
          createdAt: Date.now(),
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save offline");
        setSubmitting(false);
        return;
      }
      unitId = draftId;
      unitNumber = String(nextUnitNumber).padStart(3, "0");
    }

    const typeTag = unitType.replace(/[\s/]+/g, "-");

    // Enqueue all the slot photos that the user actually captured.
    // If unitId is a local- id, the worker will rewrite it after the
    // draft syncs.
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
    setSubmitting(false);

    // When offline, router.replace hangs because Next.js tries to fetch
    // a fresh RSC payload that never arrives. A full-page navigation
    // hits the service worker, which serves the cached job-detail
    // shell instantly. Online, the soft nav is faster.
    const dest = `/jobs/${encodeURIComponent(job.jobId)}`;
    if (wentOffline) {
      window.location.assign(dest);
    } else {
      router.replace(dest);
      router.refresh();
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
        <UnitTypePicker
          value={unitType}
          onChange={(next) => {
            setUnitType(next);
            setPhotos({});
          }}
        />
      </Field>

      {unitType && (
        <Field label="Unit name">
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={`Unit ${nextUnitNumber}`}
            autoCapitalize="words"
            className="w-full px-4 py-3 rounded-xl border border-mse-light bg-white text-base focus:outline-none focus:border-mse-navy"
          />
          <div className="text-xs text-mse-muted mt-1">
            Defaults to <span className="font-semibold">Unit {nextUnitNumber}</span> — change to a location like &quot;Rooftop East&quot; or &quot;Suite 201&quot;.
          </div>
        </Field>
      )}

      {unitType && (
        <Field label="Photos" required>
          <div className="space-y-2">
            {slots.map((p) => {
              const isFilterSlot = p.slot === "filter" || p.slot === "filter_pre" || p.slot === "filter_post";
              return (
                <PhotoCapture
                  key={p.slot}
                  label={p.label}
                  hint={p.hint}
                  required={p.required}
                  value={photos[p.slot] ?? null}
                  onChange={setSlot(p.slot)}
                  onExtras={isFilterSlot ? addExtrasToAdditional : undefined}
                />
              );
            })}
          </div>
        </Field>
      )}

      {unitType && (
        <Field label="Additional photos">
          <div className="text-xs text-mse-muted mb-2">
            Refrigerant gauges, problem areas, anything else that documents the work.
          </div>
          <AdditionalPhotosPicker
            photos={additionalPhotos}
            onAdd={addExtrasToAdditional}
            onRemove={removeAdditional}
          />
        </Field>
      )}

      {unitType && (
        <div className="space-y-4">
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

const COMPRESSION_OPTS = {
  maxSizeMB: 1.5,
  maxWidthOrHeight: 1600,
  initialQuality: 0.78,
  useWebWorker: false,
  preserveExif: false,
  fileType: "image/jpeg" as const,
};
const THUMB_OPTS = {
  maxSizeMB: 0.05,
  maxWidthOrHeight: 256,
  useWebWorker: false,
  fileType: "image/jpeg" as const,
};

function AdditionalPhotosPicker({
  photos,
  onAdd,
  onRemove,
}: {
  photos: CapturedPhoto[];
  onAdd: (photos: CapturedPhoto[]) => void;
  onRemove: (i: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const handleFiles = async (files: FileList) => {
    if (!files.length) return;
    setBusy(true);
    try {
      const results = await Promise.all(
        Array.from(files).map(async (file) => {
          const compressed = await imageCompression(file, COMPRESSION_OPTS);
          let thumb: Blob;
          try {
            thumb = await imageCompression(file, THUMB_OPTS);
          } catch {
            thumb = compressed;
          }
          return {
            blob: compressed,
            thumbnailUrl: URL.createObjectURL(thumb),
            capturedAt: Date.now(),
            filename: `photo_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`,
          } satisfies CapturedPhoto;
        })
      );
      onAdd(results);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = e.target.files;
          e.target.value = "";
          if (files) handleFiles(files);
        }}
      />
      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((p, i) => (
            <div key={i} className="relative rounded-xl overflow-hidden aspect-square bg-mse-light">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.thumbnailUrl} alt="" className="w-full h-full object-cover" />
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 flex items-center justify-center"
                aria-label="Remove photo"
              >
                <X className="w-3 h-3 text-white" />
              </button>
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className={cn(
          "w-full rounded-2xl border-2 border-dashed border-mse-light bg-white p-4",
          "flex items-center justify-center gap-2 text-sm font-semibold text-mse-muted",
          "hover:border-mse-navy/30 hover:text-mse-navy transition-[border-color,color]",
          "active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mse-red"
        )}
      >
        {busy ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Camera className="w-4 h-4" />
        )}
        {busy ? "Processing..." : photos.length === 0 ? "Add photos" : "Add more"}
        {!busy && photos.length > 0 && (
          <span className="ml-1 text-xs text-mse-muted font-normal">
            ({photos.length} added)
          </span>
        )}
      </button>
    </div>
  );
}
