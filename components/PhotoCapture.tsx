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
        <button
          type="button"
          onClick={openCamera}
          disabled={busy}
          data-photo-captured="true"
          className={cn(
            "relative w-full rounded-2xl overflow-hidden border-2 border-mse-gold",
            "active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mse-red focus-visible:ring-offset-2",
            "transition-transform"
          )}
          style={{ aspectRatio: "4/3" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value.thumbnailUrl}
            alt={label}
            className="w-full h-full object-cover"
          />

          {/* Bottom gradient overlay */}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/30 to-transparent pt-12 px-3 pb-3">
            <div className="flex items-center justify-between">
              <span className="text-white font-bold text-sm flex items-center gap-1.5 drop-shadow">
                <Check className="w-4 h-4 text-mse-gold shrink-0" />
                <span className="truncate">{label}{required && <span className="text-mse-red ml-0.5">*</span>}</span>
              </span>
              <span className="flex items-center gap-2 shrink-0 ml-2">
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    openLibrary();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.stopPropagation();
                      e.preventDefault();
                      openLibrary();
                    }
                  }}
                  className="text-white/80 text-xs font-semibold flex items-center gap-1 hover:text-white"
                  aria-label={`Replace ${label} from photo library`}
                >
                  <ImageIcon className="w-3 h-3" />
                  Upload
                </span>
                <span className="text-white/80 text-xs font-semibold flex items-center gap-1">
                  <RefreshCw className="w-3 h-3" />
                  Retake
                </span>
              </span>
            </div>
          </div>

          {/* Processing overlay */}
          {busy && (
            <div className="absolute inset-0 bg-white/70 flex items-center justify-center rounded-2xl">
              <Loader2 className="w-8 h-8 text-mse-navy animate-spin" />
            </div>
          )}
        </button>
      ) : (
        /* ── EMPTY STATE: tap-to-capture row + library affordance ──────── */
        <div
          className={cn(
            "w-full rounded-2xl border-2 border-dashed border-mse-light bg-white",
            "focus-within:border-mse-navy/30 hover:border-mse-navy/30",
            "transition-[border-color]"
          )}
        >
          <button
            type="button"
            onClick={openCamera}
            disabled={busy}
            className={cn(
              "w-full text-left active:scale-[0.99] transition-transform",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mse-red focus-visible:ring-offset-2 rounded-t-2xl"
            )}
          >
            <div className="flex items-center gap-3 p-3">
              <div className="w-14 h-14 rounded-xl bg-mse-light shrink-0 flex items-center justify-center">
                {busy ? (
                  <Loader2 className="w-6 h-6 text-mse-navy animate-spin" />
                ) : (
                  <Camera className="w-6 h-6 text-mse-muted" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-mse-navy">
                  {label}
                  {required && <span className="text-mse-red ml-1">*</span>}
                </div>
                {hint && (
                  <div className="text-xs text-mse-muted mt-0.5">{hint}</div>
                )}
              </div>
            </div>
          </button>
          <button
            type="button"
            onClick={openLibrary}
            disabled={busy}
            className={cn(
              "w-full flex items-center gap-1.5 px-3 pb-2.5 pt-0.5 text-xs font-semibold text-mse-muted",
              "hover:text-mse-navy active:scale-[0.99] transition-[color,transform]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mse-red rounded-b-2xl"
            )}
          >
            <ImageIcon className="w-3.5 h-3.5" />
            or upload from device
            {onExtras && " (multiple ok)"}
          </button>
        </div>
      )}

      {error && (
        <div className="text-xs text-mse-red px-1">{error}</div>
      )}
    </div>
  );
}
