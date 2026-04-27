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

export function PhotoCapture({
  label,
  hint,
  required,
  value,
  onChange,
  filenameSuffix,
}: Props) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const compressed = await imageCompression(file, compressionOptions());
      let thumb: Blob;
      try {
        thumb = await imageCompression(file, THUMB_OPTIONS);
      } catch (e2) {
        console.warn("Thumb compression failed, using compressed as thumb:", e2);
        thumb = compressed;
      }
      const thumbnailUrl = URL.createObjectURL(thumb);
      const filename = filenameSuffix
        ? `${filenameSuffix}.jpg`
        : `photo_${Date.now()}.jpg`;
      onChange({
        blob: compressed,
        thumbnailUrl,
        capturedAt: Date.now(),
        filename,
      });
    } catch (e) {
      console.error("Photo processing failed:", e, "input file:", {
        name: file.name,
        type: file.type,
        size: file.size,
      });
      const message =
        e instanceof Error
          ? e.message
          : typeof e === "string"
          ? e
          : "Couldn't process photo. Try a different file.";
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  const onInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await handleFile(file);
  };

  const open = () => inputRef.current?.click();

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onInputChange}
      />
      <button
        type="button"
        onClick={open}
        disabled={busy}
        className={cn(
          "w-full rounded-2xl border-2 transition-[border-color,background-color,transform]",
          "active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mse-red focus-visible:ring-offset-2",
          value
            ? "border-mse-gold bg-mse-gold/5"
            : "border-dashed border-mse-light bg-white hover:border-mse-navy/30"
        )}
      >
        <div className="flex items-center gap-3 p-3">
          <div className="relative w-16 h-16 rounded-xl overflow-hidden bg-mse-light shrink-0 flex items-center justify-center">
            {busy ? (
              <Loader2 className="w-6 h-6 text-mse-navy animate-spin" />
            ) : value ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={value.thumbnailUrl}
                  alt=""
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                <div className="absolute bottom-1 right-1 w-5 h-5 rounded-full bg-mse-gold flex items-center justify-center">
                  <Check className="w-3 h-3 text-mse-navy" />
                </div>
              </>
            ) : (
              <Camera className="w-6 h-6 text-mse-muted" />
            )}
          </div>
          <div className="flex-1 min-w-0 text-left">
            <div className="font-bold text-mse-navy">
              {label}
              {required && <span className="text-mse-red ml-1">*</span>}
            </div>
            {hint && !value && (
              <div className="text-xs text-mse-muted mt-0.5">{hint}</div>
            )}
            {value && (
              <div className="text-xs text-mse-muted mt-0.5 flex items-center gap-1">
                <Check className="w-3 h-3 text-mse-gold" />
                Captured
              </div>
            )}
          </div>
          {value && !busy && (
            <span
              className="p-2 text-mse-muted hover:text-mse-navy"
              aria-hidden
            >
              <RefreshCw className="w-4 h-4" />
            </span>
          )}
        </div>
        {error && (
          <div className="text-xs text-mse-red px-3 pb-2">{error}</div>
        )}
      </button>
    </div>
  );
}
