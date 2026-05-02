"use client";

import { useId, useRef, useState } from "react";
import imageCompression from "browser-image-compression";
import { Camera, Check, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CapturedPhoto {
  blob: Blob;
  thumbnailUrl: string;
  capturedAt: number;
  filename: string;
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

const THUMB_OPTIONS = {
  maxSizeMB: 0.05,
  maxWidthOrHeight: 256,
  useWebWorker: false,
  fileType: "image/jpeg" as const,
};

async function compressToPhoto(
  file: File,
  filename: string
): Promise<CapturedPhoto> {
  const compressed = await imageCompression(file, compressionOptions());
  let thumb: Blob;
  try {
    thumb = await imageCompression(file, THUMB_OPTIONS);
  } catch {
    thumb = compressed;
  }
  return {
    blob: compressed,
    thumbnailUrl: URL.createObjectURL(thumb),
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
  const inputRef = useRef<HTMLInputElement>(null);
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

  const open = () => inputRef.current?.click();

  return (
    <div className="space-y-1">
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="image/*"
        {...(onExtras ? { multiple: true } : { capture: "environment" as const })}
        className="hidden"
        onChange={onInputChange}
      />

      {value ? (
        /* ── CAPTURED STATE: large image preview ──────────────────────── */
        <button
          type="button"
          onClick={open}
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
              <span className="text-white/80 text-xs font-semibold flex items-center gap-1 shrink-0 ml-2">
                <RefreshCw className="w-3 h-3" />
                Retake
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
        /* ── EMPTY STATE: compact tap-to-capture row ───────────────────── */
        <button
          type="button"
          onClick={open}
          disabled={busy}
          className={cn(
            "w-full rounded-2xl border-2 border-dashed border-mse-light bg-white",
            "hover:border-mse-navy/30 active:scale-[0.99]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mse-red focus-visible:ring-offset-2",
            "transition-[border-color,transform]"
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
            <div className="flex-1 min-w-0 text-left">
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
      )}

      {error && (
        <div className="text-xs text-mse-red px-1">{error}</div>
      )}
    </div>
  );
}
