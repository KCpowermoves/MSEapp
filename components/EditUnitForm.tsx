"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Camera, Loader2, RefreshCw, Trash2 } from "lucide-react";
import imageCompression from "browser-image-compression";
import { UnitTypePicker } from "@/components/UnitTypePicker";
import { OcrStatusBanner } from "@/components/OcrStatusBanner";
import { enqueuePhoto } from "@/lib/upload-queue";
import { kickWorker } from "@/lib/upload-worker";
import { useOcrAutoFill } from "@/hooks/useOcrAutoFill";
import { cn, extractDriveFileId } from "@/lib/utils";
import type { Job, UnitServiced, UnitType, PhotoSlot } from "@/lib/types";

const SIMPLE_TYPES: UnitType[] = ["PTAC / Ductless"];
const RTU_TYPES: UnitType[] = ["RTU-S", "RTU-M", "RTU-L"];

interface SlotInfo {
  slot: PhotoSlot;
  label: string;
  url: string;
}

function photosForUnit(unit: UnitServiced): SlotInfo[] {
  const entries: SlotInfo[] = [];
  const add = (slot: PhotoSlot, label: string, url: string) => {
    entries.push({ slot, label, url });
  };

  if (SIMPLE_TYPES.includes(unit.unitType)) {
    add("pre", "Pre-service", unit.pre1Url);
    add("post", "Post-service", unit.pre2Url);
    add("nameplate", "Nameplate", unit.nameplateUrl);
    add("filter", "Filter", unit.filterUrl);
  } else if (RTU_TYPES.includes(unit.unitType)) {
    add("coil1_pre", "Coil 1 · before", unit.pre1Url);
    add("coil2_pre", "Coil 2 · before", unit.pre2Url);
    add("filter_post", "Filter · before", unit.pre3Url);
    add("coil1_post", "Coil 1 · after", unit.post1Url);
    add("coil2_post", "Coil 2 · after", unit.post2Url);
    add("nameplate", "Nameplate", unit.nameplateUrl);
    add("filter_pre", "Filter · after", unit.filterUrl);
  } else {
    // Split System
    add("out_pre_1", "Outdoor · side 1 · before", unit.pre1Url);
    add("out_pre_2", "Outdoor · side 2 · before", unit.pre2Url);
    add("out_pre_3", "Outdoor · side 3 · before", unit.pre3Url);
    add("out_post_1", "Outdoor · side 1 · after", unit.post1Url);
    add("out_post_2", "Outdoor · side 2 · after", unit.post2Url);
    add("out_post_3", "Outdoor · side 3 · after", unit.post3Url);
    add("out_nameplate", "Outdoor nameplate", unit.nameplateUrl);
    add("filter", "Filter", unit.filterUrl);
    add("in_pre", "Air handler · before", unit.inPreUrl);
    add("in_post", "Air handler · after", unit.inPostUrl);
    add("in_nameplate", "Air handler nameplate", unit.inNameplateUrl);
  }

  return entries;
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

export function EditUnitForm({ job, unit }: { job: Job; unit: UnitServiced }) {
  const router = useRouter();
  const [unitType, setUnitType] = useState<UnitType>(unit.unitType);
  const [label, setLabel] = useState(unit.label ?? "");
  const [make, setMake] = useState(unit.make ?? "");
  const [model, setModel] = useState(unit.model ?? "");
  const [serial, setSerial] = useState(unit.serial ?? "");
  const [notes, setNotes] = useState(unit.notes ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Local optimistic overrides (slot → local thumbnail blob URL while reupload pends)
  const [localOverrides, setLocalOverrides] = useState<
    Partial<Record<PhotoSlot, string>>
  >({});
  const [replacingSlot, setReplacingSlot] = useState<PhotoSlot | null>(null);

  const replaceInputRef = useRef<HTMLInputElement>(null);
  const pendingSlotRef = useRef<PhotoSlot | null>(null);

  const ocr = useOcrAutoFill({
    make,
    model,
    serial,
    setMake,
    setModel,
    setSerial,
  });

  const displayName = unit.label?.trim()
    ? unit.label
    : `Unit ${String(unit.unitNumberOnJob).padStart(3, "0")}`;
  const unitNumber = String(unit.unitNumberOnJob).padStart(3, "0");
  const typeTag = unitType.replace(/[\s/]+/g, "-");

  const photos = photosForUnit(unit);
  const additionalList = unit.additionalUrls
    ? unit.additionalUrls.split(",").map((u) => u.trim()).filter(Boolean)
    : [];

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/units", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          unitId: unit.unitId,
          unitType,
          label,
          make,
          model,
          serial,
          notes,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not save");
      }
      router.replace(`/jobs/${encodeURIComponent(job.jobId)}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
      setSubmitting(false);
    }
  };

  const deleteThisUnit = async () => {
    if (deleting || submitting) return;
    const confirmed = window.confirm(
      `Delete ${displayName}? This removes the unit from the app. ` +
        `Photos already in Drive aren't deleted. Cannot be undone from the app.`
    );
    if (!confirmed) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/units?unitId=${encodeURIComponent(unit.unitId)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not delete");
      }
      router.replace(`/jobs/${encodeURIComponent(job.jobId)}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete unit");
      setDeleting(false);
    }
  };

  const requestReplace = (slot: PhotoSlot) => {
    pendingSlotRef.current = slot;
    replaceInputRef.current?.click();
  };

  const onReplaceFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    const slot = pendingSlotRef.current;
    pendingSlotRef.current = null;
    if (!file || !slot) return;
    setReplacingSlot(slot);
    try {
      const compressed = await imageCompression(file, COMPRESSION_OPTS);
      let thumb: Blob;
      try {
        thumb = await imageCompression(file, THUMB_OPTS);
      } catch {
        thumb = compressed;
      }
      const thumbUrl = URL.createObjectURL(thumb);
      setLocalOverrides((prev) => ({ ...prev, [slot]: thumbUrl }));
      await enqueuePhoto({
        id: `${unit.unitId}-${slot}-replace-${Date.now()}`,
        jobId: job.jobId,
        unitId: unit.unitId,
        serviceId: null,
        photoSlot: slot,
        blob: compressed,
        filename: `Unit-${unitNumber}_${typeTag}_${slot}.jpg`,
        capturedAt: Date.now(),
      });
      kickWorker();

      // If a nameplate was replaced, run OCR. Only fills make/model/serial
      // fields that are currently empty — never overwrites a value that
      // was already saved or that the tech has manually corrected.
      if (
        slot === "nameplate" ||
        slot === "out_nameplate" ||
        slot === "in_nameplate"
      ) {
        void ocr.run(compressed);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not replace photo");
    } finally {
      setReplacingSlot(null);
    }
  };

  return (
    <div className="space-y-6 pb-24">
      <input
        ref={replaceInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onReplaceFile}
      />

      <div className="flex items-center gap-2">
        <a
          href={`/jobs/${encodeURIComponent(job.jobId)}`}
          className="p-2 -ml-2 text-mse-muted hover:text-mse-navy"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5" />
        </a>
        <h1 className="text-2xl font-bold text-mse-navy">
          Edit {displayName}
        </h1>
      </div>

      <Field label="Unit type" required>
        <UnitTypePicker value={unitType} onChange={setUnitType} />
      </Field>

      <Field label="Location / zone label">
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Rooftop East, Suite 201, Lobby AHU"
          autoCapitalize="words"
          className="w-full px-4 py-3 rounded-xl border border-mse-light bg-white text-base focus:outline-none focus:border-mse-navy"
        />
      </Field>

      <OcrStatusBanner status={ocr.status} result={ocr.result} />

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

      <Field label="Photos">
        <div className="text-xs text-mse-muted mb-2">
          Tap a photo to retake it. New photos upload in the background.
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {photos.map(({ slot, label: photoLabel, url }) => (
            <PhotoTile
              key={slot}
              label={photoLabel}
              url={url}
              localOverride={localOverrides[slot]}
              busy={replacingSlot === slot}
              onClick={() => requestReplace(slot)}
            />
          ))}
        </div>
        {additionalList.length > 0 && (
          <>
            <div className="text-xs text-mse-muted uppercase tracking-wide font-semibold mt-4 mb-2">
              Additional ({additionalList.length})
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {additionalList.map((u, i) => (
                <PhotoTile
                  key={i}
                  label={`Extra ${i + 1}`}
                  url={u}
                  readOnly
                />
              ))}
            </div>
          </>
        )}
      </Field>

      {error && (
        <div className="text-mse-red text-sm bg-mse-red/5 border border-mse-red/20 rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      <div className="pt-4 border-t border-mse-light">
        <button
          type="button"
          onClick={deleteThisUnit}
          disabled={deleting || submitting}
          className={cn(
            "w-full font-semibold rounded-2xl py-3 text-center text-sm",
            "border-2 border-mse-red/40 text-mse-red bg-white",
            "hover:bg-mse-red/5 active:scale-[0.98] transition-[background-color,transform]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mse-red",
            (deleting || submitting) && "opacity-50 cursor-not-allowed"
          )}
        >
          {deleting ? (
            <span className="inline-flex items-center gap-2 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" />
              Deleting...
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 justify-center">
              <Trash2 className="w-4 h-4" />
              Delete this unit
            </span>
          )}
        </button>
        <p className="text-xs text-mse-muted text-center mt-2">
          Removes the unit from the app. Photos already uploaded to Drive
          stay there. Submitted units can&apos;t be deleted.
        </p>
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-mse-light p-4 safe-bottom z-10">
        <div className="max-w-2xl mx-auto">
          <button
            type="button"
            onClick={submit}
            disabled={submitting || deleting}
            className={cn(
              "w-full font-bold rounded-2xl py-4 text-center transition-[background-color,transform]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mse-red focus-visible:ring-offset-2",
              !submitting && !deleting
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
              "Save changes"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function PhotoTile({
  label,
  url,
  localOverride,
  busy,
  readOnly,
  onClick,
}: {
  label: string;
  url: string;
  localOverride?: string;
  busy?: boolean;
  readOnly?: boolean;
  onClick?: () => void;
}) {
  const fileId = url ? extractDriveFileId(url) : null;
  const src = localOverride ?? (fileId ? `/api/photo?fileId=${fileId}` : null);
  const hasPhoto = Boolean(src);

  const content = (
    <>
      {hasPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src!}
          alt={label}
          className="absolute inset-0 w-full h-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-mse-light">
          <Camera className="w-6 h-6 text-mse-muted" />
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent pt-6 px-2 pb-1.5">
        <div className="flex items-center justify-between gap-1">
          <span className="text-white text-[11px] font-semibold truncate drop-shadow">
            {label}
          </span>
          {!readOnly && hasPhoto && !busy && (
            <RefreshCw className="w-3 h-3 text-white/80 shrink-0" />
          )}
        </div>
      </div>
      {busy && (
        <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
          <Loader2 className="w-6 h-6 text-mse-navy animate-spin" />
        </div>
      )}
      {!hasPhoto && !readOnly && (
        <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-full bg-mse-red/90 text-white text-[10px] font-bold">
          Missing
        </div>
      )}
    </>
  );

  const baseClass = cn(
    "relative aspect-square w-full rounded-xl overflow-hidden border",
    hasPhoto ? "border-mse-light" : "border-dashed border-mse-light"
  );

  if (readOnly && hasPhoto) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener"
        className={cn(baseClass, "block")}
      >
        {content}
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={cn(
        baseClass,
        "active:scale-[0.97] hover:border-mse-navy/40 transition-[border-color,transform]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mse-red focus-visible:ring-offset-1"
      )}
    >
      {content}
    </button>
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
