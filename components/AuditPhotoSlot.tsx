"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Image as ImageIcon, Loader2, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  label: string;
  hint?: string;
  required?: boolean;
  /** Pre-existing Drive URL (empty when nothing uploaded yet). */
  existingUrl: string;
  /** Called with the picked File; parent owns the upload. */
  onPick: (file: File) => Promise<void>;
}

export function AuditPhotoSlot({
  label,
  hint,
  required,
  existingUrl,
  onPick,
}: Props) {
  // Camera input goes straight to the rear camera; library input opens
  // the device photo picker so already-taken shots can be uploaded.
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const libraryRef = useRef<HTMLInputElement | null>(null);
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (localUrl) URL.revokeObjectURL(localUrl);
    };
  }, [localUrl]);

  const handlePick = () => {
    if (busy) return;
    cameraRef.current?.click();
  };

  const handleLibrary = () => {
    if (busy) return;
    libraryRef.current?.click();
  };

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const f = input.files?.[0];
    if (!f) return;
    setError(null);
    if (localUrl) URL.revokeObjectURL(localUrl);
    setLocalUrl(URL.createObjectURL(f));
    setBusy(true);
    try {
      await onPick(f);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
      input.value = "";
    }
  };

  const remoteUrl = existingUrl
    ? `/api/photo?fileId=${encodeURIComponent(extractFileId(existingUrl))}&w=320`
    : null;
  const displayUrl = localUrl ?? remoteUrl;
  const hasPhoto = Boolean(displayUrl);

  return (
    <div className="space-y-1">
      {/* Hidden inputs live at the ROOT — never inside a button. A
          programmatic input.click() bubbles; nesting them in the camera
          button made "Upload from device" open the camera first. */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleChange}
        onClick={(e) => e.stopPropagation()}
        className="hidden"
      />
      <input
        ref={libraryRef}
        type="file"
        accept="image/*"
        onChange={handleChange}
        onClick={(e) => e.stopPropagation()}
        className="hidden"
      />
      <div className="text-[11px] uppercase tracking-wider font-bold text-mse-muted">
        {label}
        {required && <span className="text-mse-red ml-1">*</span>}
      </div>
      {hint && (
        <div className="text-[10px] text-mse-muted/80 leading-tight">{hint}</div>
      )}
      <button
        type="button"
        onClick={handlePick}
        disabled={busy}
        className={cn(
          "relative w-full aspect-[4/3] rounded-xl overflow-hidden border-2",
          "flex items-center justify-center text-mse-muted",
          "transition-[border-color,background-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mse-red",
          hasPhoto
            ? "border-mse-navy/20 bg-white"
            : "border-dashed border-mse-light bg-mse-light/30 hover:border-mse-navy/30 hover:text-mse-navy",
          busy && "opacity-70 cursor-wait"
        )}
      >
        {hasPhoto && displayUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={displayUrl}
              alt={label}
              className="absolute inset-0 w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" />
            <div className="absolute bottom-1.5 left-1.5 right-1.5 inline-flex items-center gap-1 text-[10px] font-bold text-white uppercase tracking-wider">
              {busy ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <RotateCcw className="w-3 h-3" />
              )}
              {busy ? "Uploading…" : "Retake"}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-1 text-xs font-semibold">
            <Camera className="w-5 h-5" />
            <span>Take photo</span>
          </div>
        )}
      </button>
      <button
        type="button"
        onClick={handleLibrary}
        disabled={busy}
        className={cn(
          "w-full inline-flex items-center justify-center gap-1 text-[11px] font-semibold text-mse-muted",
          "hover:text-mse-navy py-1 transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mse-red rounded",
          busy && "opacity-60 cursor-wait"
        )}
      >
        <ImageIcon className="w-3 h-3" />
        or upload from device
      </button>
      {error && (
        <div className="text-[11px] text-mse-red bg-mse-red/5 rounded px-2 py-1">
          {error}
        </div>
      )}
    </div>
  );
}

// Extract the Drive file ID from a Drive URL — handles both the
// folder/{id} and uc?id={id} formats already in the schema.
function extractFileId(url: string): string {
  const match =
    url.match(/[?&]id=([A-Za-z0-9_-]+)/) ||
    url.match(/\/d\/([A-Za-z0-9_-]+)/) ||
    url.match(/\/file\/d\/([A-Za-z0-9_-]+)/);
  return match?.[1] ?? "";
}
