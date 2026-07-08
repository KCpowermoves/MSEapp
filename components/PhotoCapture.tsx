"use client";

import { useId, useRef, useState } from "react";
import imageCompression from "browser-image-compression";
import { Camera, Check, Image as ImageIcon, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CapturedPhoto {
  blob: Blob;
  thumbnailUrl: string;
  capturedAt: number;
  filename: string;
  /** Set when the photo has been staged to IndexedDB by the parent
   *  form (crash protection before Save). Lets the form promote or
   *  delete the staged record when the photo is saved or removed. */
  stagedId?: string;
}

interface Props {
  label: string;
  hint?: string;
  required?: boolean;
  value: CapturedPhoto | null;
  onChange: (next: CapturedPhoto | null) => void;
  filenameSuffix?: string;
  /** When provided, the input accepts multiple files. First fills the slot; rest passed here. */
  onExtras?: (photos: CapturedPhoto[]) => void;
}

function compressionOptions() {
  // preserveExif disabled — the EXIF parser in browser-image-compression
  // throws uncaught DataView errors on JPEGs without complete EXIF
  // segments (camera roll exports, screenshots, downloaded images, etc.),
  // leaving the capture stuck in busy state. Server-side timestamp in
  // the Sheet's "Logged At" column is the canonical record instead.
  return {
    maxSizeMB: 1.5,
    maxWidthOrHeight: 1600,
    initialQuality: 0.78,
    useWebWorker: false,
    preserveExif: false,
    fileType: "image/jpeg" as const,
  };
}

async function compressToPhoto(
  file: File,
  filename: string
): Promise<CapturedPhoto> {
  const compressed = await imageCompression(file, compressionOptions());
  // Use the full compressed image for the in-app preview so the tech
  // sees the actual quality of the photo they just took, not a tiny
  // pixelated thumb. The compressed blob is ~1.5MB max which is fine
  // to hold in memory while the form is open.
  return {
    blob: compressed,
    thumbnailUrl: URL.createObjectURL(compressed),
    capturedAt: Date.now(),
    filename,
  };
}

export function PhotoCapture({
  label,
  hint,
  required,
  value,
  onChange,
  filenameSuffix,
  onExtras,
}: Props) {
  const inputId = useId();
  // Two inputs, one intent each: the camera input carries
  // capture="environment" (straight to the rear camera on both iOS
  // and Android); the library input omits it, opening the system
  // photo picker so techs can upload shots already on their device.
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const [first, ...rest] = files;
      const filename = filenameSuffix ? `${filenameSuffix}.jpg` : `photo_${Date.now()}.jpg`;
      const photo = await compressToPhoto(first, filename);
      onChange(photo);
      if (onExtras && rest.length > 0) {
        const extras = await Promise.all(
          rest.map((f, i) => compressToPhoto(f, `photo_${Date.now()}_${i}.jpg`))
        );
        onExtras(extras);
      }
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Couldn't process photo. Try a different file.";
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  const openCamera = () => cameraRef.current?.click();
  const openLibrary = () => libraryRef.current?.click();

  return (
    <div className="space-y-1">
      <input
        ref={cameraRef}
        id={inputId}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onInputChange}
      />
      <input
        ref={libraryRef}
        type="file"
        accept="image/*"
        {...(onExtras ? { multiple: true } : {})}
        className="hidden"
        onChange={onInputChange}
      />

      {value ? (
        /* ── CAPTURED STATE: large image preview ──────────────────────── */
        <div
          className="relative w-full rounded-2xl overflow-hidden border-2 border-mse-gold"
          data-photo-captured="true"
          style={{ aspectRatio: "4/3" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value.thumbnailUrl}
            alt={label}
            className="w-full h-full object-cover"
          />

          {/* Bottom gradient overlay. Retake and Upload are separate
              sibling buttons — no nesting, so a tap on one can never
              also trigger the other. */}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/30 to-transparent pt-12 px-3 pb-3">
            <div className="flex items-center justify-between">
              <span className="text-white font-bold text-sm flex items-center gap-1.5 drop-shadow min-w-0">
                <Check className="w-4 h-4 text-mse-gold shrink-0" />
                <span className="truncate">{label}{required && <span className="text-mse-red ml-0.5">*</span>}</span>
              </span>
              <span className="flex items-center gap-1.5 shrink-0 ml-2">
                <button
                  type="button"
                  onClick={openLibrary}
                  disabled={busy}
                  className={cn(
                    "text-white text-xs font-semibold flex items-center gap-1 px-2 py-1 rounded-lg",
                    "bg-white/15 hover:bg-white/25 active:scale-95 transition-[background-color,transform]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  )}
                  aria-label={`Replace ${label} from photo library`}
                >
                  <ImageIcon className="w-3 h-3" />
                  Upload
                </button>
                <button
                  type="button"
                  onClick={openCamera}
                  disabled={busy}
                  className={cn(
                    "text-white text-xs font-semibold flex items-center gap-1 px-2 py-1 rounded-lg",
                    "bg-white/15 hover:bg-white/25 active:scale-95 transition-[background-color,transform]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  )}
                  aria-label={`Retake ${label} with camera`}
                >
                  <RefreshCw className="w-3 h-3" />
                  Retake
                </button>
              </span>
            </div>
          </div>

          {/* Processing overlay */}
          {busy && (
            <div className="absolute inset-0 bg-white/70 flex items-center justify-center rounded-2xl">
              <Loader2 className="w-8 h-8 text-mse-navy animate-spin" />
            </div>
          )}
        </div>
      ) : (
        /* ── EMPTY STATE: label row + two equal action buttons ─────────── */
        <div
          className={cn(
            "w-full rounded-2xl border-2 border-dashed border-mse-light bg-white p-3",
            "focus-within:border-mse-navy/30 hover:border-mse-navy/30",
            "transition-[border-color]"
          )}
        >
          <div className="min-w-0 mb-2.5">
            <div className="font-bold text-mse-navy">
              {label}
              {required && <span className="text-mse-red ml-1">*</span>}
            </div>
            {hint && (
              <div className="text-xs text-mse-muted mt-0.5">{hint}</div>
            )}
          </div>
          {/* Two independent, equal-weight choices — tapping one can
              never open the other. */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={openCamera}
              disabled={busy}
              className={cn(
                "flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold",
                "bg-mse-navy text-white hover:bg-mse-navy-soft active:scale-[0.98]",
                "transition-[background-color,transform]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mse-red focus-visible:ring-offset-2",
                busy && "opacity-60 cursor-wait"
              )}
            >
              {busy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Camera className="w-4 h-4" />
              )}
              Take photo
            </button>
            <button
              type="button"
              onClick={openLibrary}
              disabled={busy}
              className={cn(
                "flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold",
                "bg-white border-2 border-mse-light text-mse-navy",
                "hover:border-mse-navy/30 active:scale-[0.98]",
                "transition-[border-color,transform]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mse-red focus-visible:ring-offset-2",
                busy && "opacity-60 cursor-wait"
              )}
            >
              <ImageIcon className="w-4 h-4" />
              Upload{onExtras ? " (multi)" : ""}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="text-xs text-mse-red px-1">{error}</div>
      )}
    </div>
  );
}
