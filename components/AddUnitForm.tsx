"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2, X } from "lucide-react";
import { UnitTypePicker } from "@/components/UnitTypePicker";
import { PhotoCapture, type CapturedPhoto } from "@/components/PhotoCapture";
import {
  enqueueDraftUnit,
  enqueuePhoto,
  listDraftsForJob,
  listStagedPhotos,
  promoteStagedPhoto,
  removePhoto,
  stagePhoto,
} from "@/lib/upload-queue";
import { kickWorker } from "@/lib/upload-worker";
import { captureLocationEvent } from "@/lib/location";
import { useOcrAutoFill } from "@/hooks/useOcrAutoFill";
import { OcrStatusBanner } from "@/components/OcrStatusBanner";
import { cn } from "@/lib/utils";
import type { Job, PhotoSlot, UnitType } from "@/lib/types";
import { slotsForType, flatSlots } from "@/lib/unit-slots";

const TYPE_SHORT: Record<UnitType, string> = {
  "PTAC / Ductless": "PTAC",
  "Split System": "Split",
  "Outdoor Split System": "Outdoor",
  "Indoor Split System": "Indoor",
  "RTU-S": "RTU-S",
  "RTU-M": "RTU-M",
  "RTU-L": "RTU-L",
};

function defaultLabel(unitType: UnitType, n: number): string {
  return `${TYPE_SHORT[unitType]} ${n}`;
}

// === Crash protection ======================================================
// Everything the tech enters used to live only in React state until Save
// — iOS killing a backgrounded tab wiped up to 35 photos with no trace.
// Now every captured photo is staged to IndexedDB the moment it exists,
// and the text fields mirror to localStorage. Reopening Add Unit for the
// same job restores the whole form. Save promotes staged photos into the
// real upload queue; removing a photo deletes its staged copy.

function stagingKeyFor(jobId: string): string {
  return `unit-form:${jobId}`;
}

function textDraftKeyFor(jobId: string): string {
  return `mse-addunit-draft:${jobId}`;
}

interface TextDraft {
  unitType: UnitType | null;
  customLabel: string | null;
  make: string;
  model: string;
  serial: string;
  notes: string;
}

function loadTextDraft(jobId: string): TextDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(textDraftKeyFor(jobId));
    if (!raw) return null;
    return JSON.parse(raw) as TextDraft;
  } catch {
    return null;
  }
}

function saveTextDraft(jobId: string, draft: TextDraft): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(textDraftKeyFor(jobId), JSON.stringify(draft));
  } catch {
    // Quota/private-mode failures are non-fatal — photos still stage.
  }
}

function clearTextDraft(jobId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(textDraftKeyFor(jobId));
  } catch {}
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

  // OCR auto-fill — shared hook handles status/result + only fills empty fields
  const ocr = useOcrAutoFill({
    make,
    model,
    serial,
    setMake,
    setModel,
    setSerial,
  });

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

  // Restore an interrupted form: staged photos from IndexedDB + text
  // fields from localStorage. Runs once per mount.
  const [restoredCount, setRestoredCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const draft = loadTextDraft(job.jobId);
      const staged = await listStagedPhotos(stagingKeyFor(job.jobId)).catch(
        () => []
      );
      if (cancelled || (!draft && staged.length === 0)) return;

      if (draft) {
        if (draft.unitType) setUnitType(draft.unitType);
        setCustomLabel(draft.customLabel);
        setMake(draft.make);
        setModel(draft.model);
        setSerial(draft.serial);
        setNotes(draft.notes);
      }
      if (staged.length > 0) {
        const restoredSlots: Partial<Record<PhotoSlot, CapturedPhoto>> = {};
        const restoredAdditional: CapturedPhoto[] = [];
        for (const p of staged) {
          const photo: CapturedPhoto = {
            blob: p.blob,
            thumbnailUrl: URL.createObjectURL(p.blob),
            capturedAt: p.capturedAt,
            filename: p.filename,
            stagedId: p.id,
          };
          if (p.photoSlot === "additional") {
            restoredAdditional.push(photo);
          } else {
            restoredSlots[p.photoSlot as PhotoSlot] = photo;
          }
        }
        setPhotos((prev) => ({ ...restoredSlots, ...prev }));
        if (restoredAdditional.length > 0) {
          setAdditionalPhotos((prev) => [...restoredAdditional, ...prev]);
        }
        setRestoredCount(staged.length);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.jobId]);

  // Mirror text fields to localStorage so a killed tab loses nothing.
  // Skipped until the tech actually picks a type (nothing to protect).
  useEffect(() => {
    if (!unitType && customLabel === null && !make && !model && !serial && !notes) {
      return;
    }
    saveTextDraft(job.jobId, {
      unitType,
      customLabel,
      make,
      model,
      serial,
      notes,
    });
  }, [job.jobId, unitType, customLabel, make, model, serial, notes]);

  // Stage a photo to IndexedDB the moment it's captured; returns the
  // photo with its stagedId attached so removal can clean up.
  async function stageCaptured(
    slotKey: string,
    photo: CapturedPhoto
  ): Promise<CapturedPhoto> {
    try {
      const stagedId = await stagePhoto({
        stagingKey: stagingKeyFor(job.jobId),
        jobId: job.jobId,
        photoSlot: slotKey,
        blob: photo.blob,
        filename: photo.filename,
        capturedAt: photo.capturedAt,
      });
      return { ...photo, stagedId };
    } catch (e) {
      // Staging is belt-and-suspenders — never block a capture on it.
      console.warn("[AddUnit] photo staging failed:", e);
      return photo;
    }
  }

  function dropStaged(photo: CapturedPhoto | null | undefined): void {
    if (photo?.stagedId) {
      removePhoto(photo.stagedId).catch(() => {});
    }
  }

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
  const modelOk = model.trim().length > 0;
  const canSubmit =
    unitType !== null && allRequiredReady && modelOk && !submitting;

  // Slots whose capture should trigger nameplate OCR. Whichever
  // nameplate the tech captures first kicks off the read; subsequent
  // captures don't re-trigger so we don't stomp on values they may
  // have already corrected.
  const isNameplateSlot = (slot: PhotoSlot) =>
    slot === "nameplate" || slot === "out_nameplate" || slot === "in_nameplate";

  const setSlot = (slot: PhotoSlot) => (next: CapturedPhoto | null) => {
    // Replacing or clearing a slot orphans its staged copy — drop it.
    dropStaged(photos[slot]);
    setPhotos((prev) => {
      const copy = { ...prev };
      if (next === null) delete copy[slot];
      else copy[slot] = next;
      return copy;
    });

    if (next) {
      // Stage to IndexedDB immediately so a killed tab can't lose it.
      void (async () => {
        const staged = await stageCaptured(slot, next);
        if (staged.stagedId) {
          setPhotos((prev) =>
            prev[slot] === next ? { ...prev, [slot]: staged } : prev
          );
        }
      })();
    }

    // Fire-and-forget OCR when a nameplate is captured. Skips if a
    // read is already running or has already populated the fields.
    if (next && isNameplateSlot(slot)) {
      void ocr.run(next.blob);
    }
  };

  const addExtrasToAdditional = (extras: CapturedPhoto[]) => {
    setAdditionalPhotos((prev) => [...prev, ...extras]);
    // Stage each new photo; swap in the stagedId-carrying copy once done.
    for (const extra of extras) {
      void (async () => {
        const staged = await stageCaptured("additional", extra);
        if (staged.stagedId) {
          setAdditionalPhotos((prev) =>
            prev.map((p) => (p === extra ? staged : p))
          );
        }
      })();
    }
  };

  const replaceAdditionalAt = (i: number, photo: CapturedPhoto) => {
    dropStaged(additionalPhotos[i]);
    setAdditionalPhotos((prev) => prev.map((p, idx) => (idx === i ? photo : p)));
    void (async () => {
      const staged = await stageCaptured("additional", photo);
      if (staged.stagedId) {
        setAdditionalPhotos((prev) =>
          prev.map((p) => (p === photo ? staged : p))
        );
      }
    })();
  };

  const removeAdditional = (i: number) => {
    dropStaged(additionalPhotos[i]);
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
    setRestoredCount(0);
    clearTextDraft(job.jobId);
    ocr.reset();
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

      // ── Phase 3: Move photos into the upload queue. Staged photos
      // (persisted at capture time) are promoted in place; anything
      // that somehow skipped staging is enqueued fresh. Works for both
      // online and offline paths — if unitId is local-, the worker
      // rewrites it after the draft syncs.
      const typeTag = submittingType.replace(/[\s/]+/g, "-");
      for (const { slot } of submittingSlots) {
        const photo = submittingPhotos[slot];
        if (!photo) continue;
        const filename = `Unit-${unitNumber}_${typeTag}_${slot}.jpg`;
        if (photo.stagedId) {
          await promoteStagedPhoto(photo.stagedId, {
            jobId: job.jobId,
            unitId,
            photoSlot: slot,
            filename,
          });
        } else {
          await enqueuePhoto({
            id: `${unitId}-${slot}-${Date.now()}`,
            jobId: job.jobId,
            unitId,
            serviceId: null,
            photoSlot: slot,
            blob: photo.blob,
            filename,
            capturedAt: photo.capturedAt,
          });
        }
      }
      for (let i = 0; i < submittingAdditional.length; i++) {
        const photo = submittingAdditional[i];
        if (!photo) continue;
        const filename = `${unitNumber}_additional_${i + 1}.jpg`;
        if (photo.stagedId) {
          await promoteStagedPhoto(photo.stagedId, {
            jobId: job.jobId,
            unitId,
            photoSlot: "additional",
            filename,
          });
        } else {
          await enqueuePhoto({
            id: `${unitId}-additional-${i}-${Date.now()}`,
            jobId: job.jobId,
            unitId,
            serviceId: null,
            photoSlot: "additional",
            blob: photo.blob,
            filename,
            capturedAt: photo.capturedAt,
          });
        }
      }

      // The unit is saved — the crash-protection draft has served its
      // purpose and must not restore into the next blank form.
      clearTextDraft(job.jobId);

      kickWorker();

      // Best-effort geo-stamp on the unit save. Real unitId for online
      // path; local- temp id for offline path (still useful for the
      // office to see where the tech was).
      captureLocationEvent(
        "unit-save",
        { jobId: job.jobId, unitId },
        { force: true }
      ).catch(() => {});

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
      {/* Compliance banner — pulses gently to catch the tech's eye
          before they start photographing a unit that won't qualify.
          motion-reduce drops the animation entirely for users with
          the OS-level reduced-motion preference. */}
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

      {restoredCount > 0 && (
        <div className="rounded-xl bg-mse-gold/15 border border-mse-gold/30 px-4 py-3 text-sm text-mse-navy flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-mse-gold shrink-0" />
          <div className="flex-1">
            <span className="font-bold">
              Restored {restoredCount} photo{restoredCount === 1 ? "" : "s"}
            </span>{" "}
            from your last session — nothing was lost. Review and tap Save
            when ready.
          </div>
        </div>
      )}

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

      <Field label="Unit type" required>
        <UnitTypePicker
          value={unitType}
          onChange={(next) => {
            setUnitType(next);
            // Slot photos don't carry across types — drop their staged
            // copies too so they can't restore into the wrong layout.
            for (const p of Object.values(photos)) dropStaged(p);
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
          <OcrStatusBanner status={ocr.status} result={ocr.result} />
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
          <Field label="Model" required>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="from the nameplate"
              className="w-full px-4 py-3 rounded-xl border border-mse-light bg-white text-base focus:outline-none focus:border-mse-navy"
            />
            {!modelOk && (
              <div className="text-xs text-mse-muted mt-1">
                Required — read it from the nameplate (the OCR usually fills
                this in for you).
              </div>
            )}
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
            onReplaceAt={replaceAdditionalAt}
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
              !allRequiredReady
                ? `Save unit · ${filledRequired}/${requiredCount} required photos`
                : !modelOk
                ? "Save unit · model number required"
                : "Save unit"
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

// Cap how many additional photos a single unit can carry. Hard upper
// bound — past ~20 it's no longer "additional context," it's a
// separate unit or a notes problem.
const ADDITIONAL_PHOTOS_MAX = 20;

// Additional photos reuse the same PhotoCapture component as the
// required slots, in a structurally identical layout: a single stable
// map producing `photos.length + 1` slots. When a slot captures a
// photo, the SAME PhotoCapture instance at that index just transitions
// its `value` prop from null to the photo (exactly like the required
// slots do). A fresh empty slot mounts beneath it. This avoids the
// iOS Safari race where unmounting a PhotoCapture mid-capture caused
// its blob URL to never paint.
function AdditionalPhotosPicker({
  photos,
  onAdd,
  onReplaceAt,
  onRemove,
}: {
  photos: CapturedPhoto[];
  onAdd: (photos: CapturedPhoto[]) => void;
  onReplaceAt: (i: number, photo: CapturedPhoto) => void;
  onRemove: (i: number) => void;
}) {
  const atMax = photos.length >= ADDITIONAL_PHOTOS_MAX;
  // Render exactly photos.length + 1 slot positions (capped at MAX).
  // The trailing position is the "next empty" slot.
  const slotCount = Math.min(photos.length + 1, ADDITIONAL_PHOTOS_MAX);

  return (
    <div className="space-y-2">
      {photos.length > 0 && (
        <div className="flex items-center gap-2 px-1">
          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-mse-gold/15 text-mse-navy text-[11px] font-bold uppercase tracking-wide">
            {photos.length} of {ADDITIONAL_PHOTOS_MAX}
          </span>
          <span className="text-[11px] text-mse-muted">
            Tap any photo to retake · tap × to remove
          </span>
        </div>
      )}
      {Array.from({ length: slotCount }).map((_, i) => {
        const photo = photos[i] ?? null;
        const isTrailingEmpty = i === photos.length;
        return (
          <div
            key={`additional-${i}`}
            className={cn(
              "relative",
              // Animate only the freshly-appended empty slot — never
              // animate filled slots (they were just captured in place).
              isTrailingEmpty && i > 0 && "animate-slot-reveal"
            )}
          >
            <PhotoCapture
              label={`Additional photo ${i + 1}`}
              hint={
                photo
                  ? undefined
                  : i === 0
                  ? "Tap to capture — refrigerant gauges, problem areas, anything else worth documenting."
                  : "Tap to capture another."
              }
              value={photo}
              onChange={(next) => {
                if (!next) return;
                if (photo) onReplaceAt(i, next);
                else onAdd([next]);
              }}
            />
            {photo && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(i);
                }}
                className={cn(
                  "absolute top-2 right-2 w-9 h-9 rounded-full",
                  "bg-black/55 hover:bg-black/75 active:scale-95",
                  "flex items-center justify-center z-10 shadow-elevated",
                  "transition-[background-color,transform]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mse-red focus-visible:ring-offset-2"
                )}
                aria-label={`Remove additional photo ${i + 1}`}
              >
                <X className="w-4 h-4 text-white" strokeWidth={2.5} />
              </button>
            )}
          </div>
        );
      })}
      {atMax && (
        <div className="text-xs text-mse-muted px-1 pt-1">
          Max {ADDITIONAL_PHOTOS_MAX} additional photos reached.
        </div>
      )}
    </div>
  );
}
