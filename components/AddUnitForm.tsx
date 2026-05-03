"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Camera, CheckCircle2, Loader2, X } from "lucide-react";
import imageCompression from "browser-image-compression";
import { UnitTypePicker } from "@/components/UnitTypePicker";
import { PhotoCapture, type CapturedPhoto } from "@/components/PhotoCapture";
import {
  enqueueDraftUnit,
  enqueuePhoto,
  listDraftsForJob,
} from "@/lib/upload-queue";
import { kickWorker } from "@/lib/upload-worker";
import { cn } from "@/lib/utils";
import type { Job, PhotoSlot, UnitType } from "@/lib/types";

const TYPE_SHORT: Record<UnitType, string> = {
  "PTAC / Ductless": "PTAC",
  "Split System": "Split",
  "RTU-S": "RTU-S",
  "RTU-M": "RTU-M",
  "RTU-L": "RTU-L",
};

function defaultLabel(unitType: UnitType, n: number): string {
  return `${TYPE_SHORT[unitType]} ${n}`;
}

interface SlotDef {
  slot: PhotoSlot;
  label: string;
  hint: string;
  required: boolean;
}

interface SlotGroups {
  /** Nameplate photo(s) — rendered FIRST so the tech captures Make/Model/Serial
   *  before anything else. Future OCR auto-fill will read these. */
  nameplate: SlotDef[];
  /** Before/after work photos, plus filter etc. — rendered after the
   *  Make/Model/Serial fields. */
  body: SlotDef[];
}

const SIMPLE_TYPES: UnitType[] = ["PTAC / Ductless"];
const RTU_TYPES: UnitType[] = ["RTU-S", "RTU-M", "RTU-L"];

function slotsForType(unitType: UnitType | null): SlotGroups {
  if (!unitType) return { nameplate: [], body: [] };

  if (SIMPLE_TYPES.includes(unitType)) {
    return {
      nameplate: [
        { slot: "nameplate", label: "Nameplate", hint: "Make / model / serial label — capture this first", required: true },
      ],
      body: [
        { slot: "pre", label: "Pre-service", hint: "Before you start", required: true },
        { slot: "post", label: "Post-service", hint: "After tune-up", required: true },
        { slot: "filter", label: "Filter", hint: "New filter installed (optional)", required: false },
      ],
    };
  }

  if (RTU_TYPES.includes(unitType)) {
    return {
      nameplate: [
        { slot: "nameplate", label: "Nameplate", hint: "Make / model / serial label — capture this first", required: true },
      ],
      body: [
        // All befores
        { slot: "coil1_pre", label: "Coil 1 · before", hint: "First coil before tune-up", required: true },
        { slot: "coil2_pre", label: "Coil 2 · before", hint: "Second coil before tune-up", required: true },
        { slot: "filter_pre", label: "Filter · before", hint: "Filter condition before cleaning", required: true },
        // All afters
        { slot: "coil1_post", label: "Coil 1 · after", hint: "First coil after tune-up", required: true },
        { slot: "coil2_post", label: "Coil 2 · after", hint: "Second coil after tune-up", required: true },
        { slot: "filter_post", label: "Filter · after", hint: "Filter after replacement", required: true },
      ],
    };
  }

  // Split System — 11 required photos. Order:
  //   nameplates (outdoor + air handler, captured first)
  //   then make/model/serial fields (between the slot groups)
  //   outdoor before x3
  //   outdoor after x3
  //   air handler before + after (kept paired since the tech moves indoors once)
  //   filter
  return {
    nameplate: [
      { slot: "out_nameplate", label: "Outdoor nameplate", hint: "Outdoor unit make / model / serial — capture this first", required: true },
      { slot: "in_nameplate", label: "Air handler nameplate", hint: "Indoor unit make / model / serial", required: true },
    ],
    body: [
      { slot: "out_pre_1", label: "Outdoor · side 1 · before", hint: "Outdoor unit, first angle", required: true },
      { slot: "out_pre_2", label: "Outdoor · side 2 · before", hint: "Different angle", required: true },
      { slot: "out_pre_3", label: "Outdoor · side 3 · before", hint: "Third angle", required: true },
      { slot: "out_post_1", label: "Outdoor · side 1 · after", hint: "After tune-up", required: true },
      { slot: "out_post_2", label: "Outdoor · side 2 · after", hint: "After tune-up", required: true },
      { slot: "out_post_3", label: "Outdoor · side 3 · after", hint: "After tune-up", required: true },
      { slot: "in_pre", label: "Air handler · before", hint: "Indoor unit before service", required: true },
      { slot: "in_post", label: "Air handler · after", hint: "Indoor unit after service", required: true },
      { slot: "filter", label: "Filter", hint: "Filter condition / replacement", required: true },
    ],
  };
}

/** Flat list helper — used everywhere we previously assumed slotsForType
 *  returned a single array (submission, photo enqueueing, validation). */
function flatSlots(groups: SlotGroups): SlotDef[] {
  return [...groups.nameplate, ...groups.body];
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
  const [customLabel, setCustomLabel] = useState<string | null>(null);
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [serial, setSerial] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedOfflineCount, setSavedOfflineCount] = useState(0);
  const [draftCount, setDraftCount] = useState(0);

  // Load existing offline drafts for this job so the auto-numbered label
  // accounts for units saved offline that the server doesn't know about yet.
  useEffect(() => {
    let cancelled = false;
    listDraftsForJob(job.jobId)
      .then((d) => {
        if (!cancelled) setDraftCount(d.length);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [job.jobId]);

  const effectiveNextNumber = nextUnitNumber + draftCount;

  // The label shown in the input. If the tech has typed a custom value,
  // use that. Otherwise the label tracks unitType + effectiveNextNumber
  // automatically — guarantees the second offline-saved unit defaults to
  // "PTAC 2" rather than re-using "PTAC 1".
  const displayLabel = useMemo(() => {
    if (customLabel !== null) return customLabel;
    if (!unitType) return "";
    return defaultLabel(unitType, effectiveNextNumber);
  }, [customLabel, unitType, effectiveNextNumber]);

  const slotGroups = useMemo(() => slotsForType(unitType), [unitType]);
  const slots = useMemo(() => flatSlots(slotGroups), [slotGroups]);
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

  const resetFormForNextUnit = () => {
    setUnitType(null);
    setPhotos({});
    setAdditionalPhotos([]);
    setCustomLabel(null);
    setMake("");
    setModel("");
    setSerial("");
    setNotes("");
    setError(null);
  };

  const submit = async () => {
    if (!canSubmit || !unitType) return;
    setSubmitting(true);
    setError(null);

    // Snapshot the type before any state resets so async work (and
    // logging) sees the right value.
    const submittingType = unitType;
    const submittingLabel = displayLabel;
    const submittingPhotos = photos;
    const submittingAdditional = additionalPhotos;
    const submittingMake = make;
    const submittingModel = model;
    const submittingSerial = serial;
    const submittingNotes = notes;
    const submittingSlots = slots;

    try {
      // ── Phase 1: Try online API. Distinguish network error from HTTP error.
      // Critical: iOS Safari does NOT immediately fail fetch when offline —
      // it can hang for 30+ seconds. Pre-check navigator.onLine and use
      // AbortController to bound the wait.
      let httpResponse: Response | null = null;
      let networkErrored = false;

      const explicitlyOffline =
        typeof navigator !== "undefined" && navigator.onLine === false;
      if (explicitlyOffline) {
        console.log("[AddUnit] navigator.onLine=false → offline path");
        networkErrored = true;
      } else {
        const ctrl = new AbortController();
        const timeoutId = setTimeout(() => ctrl.abort(), 8000);
        try {
          httpResponse = await fetch("/api/units", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jobId: job.jobId,
              unitType: submittingType,
              label: submittingLabel,
              make: submittingMake,
              model: submittingModel,
              serial: submittingSerial,
              notes: submittingNotes,
            }),
            signal: ctrl.signal,
          });
        } catch (netErr) {
          networkErrored = true;
          console.warn("[AddUnit] fetch failed/aborted, going offline:", netErr);
        } finally {
          clearTimeout(timeoutId);
        }
      }

      // ── Phase 2: Decide path
      let unitId: string;
      let unitNumber: string;
      let wentOffline = false;

      if (networkErrored) {
        wentOffline = true;
        const draftId = `local-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`;
        await enqueueDraftUnit({
          id: draftId,
          jobId: job.jobId,
          unitType: submittingType,
          label: submittingLabel,
          make: submittingMake,
          model: submittingModel,
          serial: submittingSerial,
          notes: submittingNotes,
          fallbackUnitNumber: effectiveNextNumber,
          createdAt: Date.now(),
        });
        unitId = draftId;
        unitNumber = String(effectiveNextNumber).padStart(3, "0");
      } else if (!httpResponse!.ok) {
        const data = await httpResponse!.json().catch(() => ({}));
        throw new Error(data.error ?? `Server error ${httpResponse!.status}`);
      } else {
        const data = await httpResponse!.json();
        unitId = data.unit.unitId as string;
        unitNumber = String(data.unit.unitNumberOnJob).padStart(3, "0");
      }

      // ── Phase 3: Enqueue photos (works for both online and offline paths;
      // if unitId is local-, the worker rewrites it after the draft syncs).
      const typeTag = submittingType.replace(/[\s/]+/g, "-");
      for (const { slot } of submittingSlots) {
        const photo = submittingPhotos[slot];
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
      for (let i = 0; i < submittingAdditional.length; i++) {
        const photo = submittingAdditional[i];
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

      // ── Phase 4: Either navigate (online) or reset for another unit (offline)
      if (wentOffline) {
        // Don't navigate offline — dynamic routes aren't always in the
        // SW cache after a SW update. Reset the form, bump the saved
        // counter, and let the tech keep adding units in place.
        setSavedOfflineCount((c) => c + 1);
        setDraftCount((c) => c + 1);
        resetFormForNextUnit();
        setSubmitting(false);
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        setSubmitting(false);
        router.replace(`/jobs/${encodeURIComponent(job.jobId)}`);
        router.refresh();
      }
    } catch (e) {
      console.error("[AddUnit] save failed:", e);
      setError(e instanceof Error ? e.message : "Could not save unit");
      setSubmitting(false);
    }
  };


  return (
    <div className="space-y-6 pb-24">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            const dest = `/jobs/${encodeURIComponent(job.jobId)}`;
            // Full-page nav so SW handles offline. Online, browser is fast.
            if (typeof window !== "undefined") window.location.assign(dest);
          }}
          className="p-2 -ml-2 text-mse-muted hover:text-mse-navy"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-2xl font-bold text-mse-navy">Add unit</h1>
      </div>

      {savedOfflineCount > 0 && (
        <div className="rounded-xl bg-mse-gold/15 border border-mse-gold/30 px-4 py-3 text-sm text-mse-navy flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-mse-gold shrink-0" />
          <div className="flex-1">
            <span className="font-bold">
              {savedOfflineCount} unit{savedOfflineCount === 1 ? "" : "s"}{" "}
              saved offline
            </span>{" "}
            — will sync when you&apos;re back online. Add another below or
            tap the back arrow when finished.
          </div>
        </div>
      )}

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
            // Drop any custom label so the auto-default kicks in for
            // the new type.
            setCustomLabel(null);
          }}
        />
      </Field>

      {unitType && (
        <Field label="Unit name">
          <input
            type="text"
            value={displayLabel}
            onChange={(e) => setCustomLabel(e.target.value)}
            placeholder={defaultLabel(unitType, effectiveNextNumber)}
            autoCapitalize="words"
            className="w-full px-4 py-3 rounded-xl border border-mse-light bg-white text-base focus:outline-none focus:border-mse-navy"
          />
          <div className="text-xs text-mse-muted mt-1">
            Defaults to{" "}
            <span className="font-semibold">
              {defaultLabel(unitType, effectiveNextNumber)}
            </span>{" "}
            — change to a location like &quot;Rooftop East&quot; or &quot;Suite
            201&quot;.
          </div>
        </Field>
      )}

      {unitType && (
        <Field label="Nameplate photo(s)" required>
          <div className="text-xs text-mse-muted mb-2">
            Capture this first — make / model / serial below will auto-fill
            from this photo (coming soon).
          </div>
          <div className="space-y-2">
            {slotGroups.nameplate.map((p) => (
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
        <div className="space-y-4">
          <Field label="Make">
            <input
              type="text"
              value={make}
              onChange={(e) => setMake(e.target.value)}
              autoCapitalize="words"
              placeholder="e.g. Carrier, Trane, Lennox"
              className="w-full px-4 py-3 rounded-xl border border-mse-light bg-white text-base focus:outline-none focus:border-mse-navy"
            />
          </Field>
          <Field label="Model">
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="from the nameplate"
              className="w-full px-4 py-3 rounded-xl border border-mse-light bg-white text-base focus:outline-none focus:border-mse-navy"
            />
          </Field>
          <Field label="Serial">
            <input
              type="text"
              value={serial}
              onChange={(e) => setSerial(e.target.value)}
              placeholder="from the nameplate"
              className="w-full px-4 py-3 rounded-xl border border-mse-light bg-white text-base focus:outline-none focus:border-mse-navy"
            />
          </Field>
        </div>
      )}

      {unitType && slotGroups.body.length > 0 && (
        <Field label="Before / after photos" required>
          <div className="space-y-2">
            {slotGroups.body.map((p) => (
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
        <Field label="Notes">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Anything worth flagging — issues found, recommendations, parts needed."
            className="w-full px-4 py-3 rounded-xl border border-mse-light bg-white text-base focus:outline-none focus:border-mse-navy resize-none"
          />
        </Field>
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
          return {
            blob: compressed,
            // Full compressed image for preview — sharp on phone screens.
            thumbnailUrl: URL.createObjectURL(compressed),
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
        capture="environment"
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
