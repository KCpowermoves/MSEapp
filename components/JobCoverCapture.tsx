"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, RotateCcw, Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  /** Pre-existing cover photo Drive file ID (edit mode). When set,
   *  shows the current photo via /api/photo and lets the user
   *  re-pick. Empty means we're still in pre-create mode. */
  existingFileId?: string;
  /** Held file (pre-create). Parent controls so the form can hand it
   *  to /api/upload after the job row exists. */
  file: File | null;
  onChange: (file: File | null) => void;
  /** Optional uploading state — when true, the preview is locked. */
  uploading?: boolean;
  /** Visual size class. Defaults to a 96px square, but `tall` makes
   *  it a 128px banner-style tile for the admin form which has more
   *  vertical room. */
  variant?: "compact" | "tall";
}

/**
 * One-shot cover photo picker for a job. Held as a File until the job
 * row exists, then the parent POSTs to /api/upload with
 * kind=job-cover&jobId=NEW. Renders the existing cover (if any) or a
 * local preview from the held File. Falling back to a dashed
 * placeholder when nothing has been picked yet.
 *
 * iOS Safari note: keeps a single stable input element across renders
 * so the camera blob URL survives, mirroring PhotoCapture's stable-
 * slot pattern from the unit grids.
 */
export function JobCoverCapture({
  existingFileId,
  file,
  onChange,
  uploading,
  variant = "compact",
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Generate / revoke the object URL for the held File. Revoke on
  // unmount + on each new file so we don't leak blobs (Safari is
  // particularly stingy with these).
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const handlePick = () => {
    inputRef.current?.click();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    onChange(f);
    // Clear the input so picking the same file twice still re-fires.
    if (inputRef.current) inputRef.current.value = "";
  };

  const remoteUrl = existingFileId
    ? `/api/photo?fileId=${encodeURIComponent(existingFileId)}&w=480`
    : null;
  const displayUrl = previewUrl ?? remoteUrl;
  const hasPhoto = Boolean(displayUrl);

  const size =
    variant === "tall" ? "h-32 w-full" : "h-24 w-24 sm:h-28 sm:w-28";

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handlePick}
        disabled={uploading}
        className={cn(
          "relative rounded-xl overflow-hidden border-2 border-dashed",
          "flex items-center justify-center text-mse-muted",
          "transition-[border-color,background-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mse-red",
          size,
          hasPhoto
            ? "border-mse-navy/20 bg-white"
            : "border-mse-light bg-mse-light/40 hover:border-mse-navy/30 hover:text-mse-navy",
          uploading && "opacity-60 cursor-wait"
        )}
        aria-label={hasPhoto ? "Change cover photo" : "Add cover photo"}
      >
        {hasPhoto && displayUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={displayUrl}
              alt="Job cover"
              className="absolute inset-0 w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" />
            <div className="absolute bottom-1.5 left-1.5 right-1.5 inline-flex items-center gap-1 text-[10px] font-bold text-white uppercase tracking-wider">
              {uploading ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <RotateCcw className="w-3 h-3" />
              )}
              {uploading ? "Uploading…" : "Change"}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-1 text-xs font-semibold">
            <Camera className="w-5 h-5" />
            <span>Add cover photo</span>
            <span className="text-[10px] font-normal text-mse-muted/80 flex items-center gap-1">
              <ImageIcon className="w-3 h-3" />
              optional
            </span>
          </div>
        )}
        {/* No capture attr: the OS offers BOTH "Take Photo" and "Photo
            Library" for the cover shot. */}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          onChange={handleChange}
          className="hidden"
        />
      </button>
      {file && !uploading && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="text-[11px] text-mse-muted hover:text-mse-red font-semibold"
        >
          Remove
        </button>
      )}
    </div>
  );
}
