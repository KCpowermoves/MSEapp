"use client";

import { AlertTriangle, Loader2, Sparkles } from "lucide-react";
import type { OcrResult } from "@/lib/ocr";
import type { OcrStatus } from "@/hooks/useOcrAutoFill";

/**
 * Confidence-aware status banner for nameplate OCR. Three visible states:
 *  - reading: subtle navy pill, "Reading nameplate…"
 *  - complete + confidence ≥ 80: gold pill, fields auto-filled
 *  - complete + confidence 50-79: red banner, "review for accuracy"
 *  - complete + confidence < 50: muted banner, asks tech to type
 *
 * Anything else (idle, error) renders nothing — OCR failures fall back
 * silently to manual entry.
 */
export function OcrStatusBanner({
  status,
  result,
}: {
  status: OcrStatus;
  result: OcrResult | null;
}) {
  if (status === "idle" || status === "error") return null;

  if (status === "reading") {
    return (
      <div className="rounded-xl bg-mse-navy/5 border border-mse-navy/15 px-3 py-2 text-xs text-mse-navy flex items-center gap-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
        <span>Reading nameplate…</span>
      </div>
    );
  }

  if (!result || result.status !== "ok") return null;

  if (result.confidence >= 80) {
    return (
      <div className="rounded-xl bg-mse-gold/15 border border-mse-gold/30 px-3 py-2 text-xs text-mse-navy flex items-center gap-2">
        <Sparkles className="w-3.5 h-3.5 text-mse-gold shrink-0" />
        <span>
          <span className="font-semibold">Auto-filled from photo.</span>{" "}
          Edit anything below if it&apos;s off.
        </span>
      </div>
    );
  }

  if (result.confidence >= 50) {
    return (
      <div className="rounded-xl bg-mse-red/5 border border-mse-red/20 px-3 py-2 text-xs text-mse-red flex items-start gap-2">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>
          <span className="font-semibold">
            Auto-filled — please review for accuracy.
          </span>{" "}
          Some characters may be hard to read in the photo.
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-mse-light/40 border border-mse-light px-3 py-2 text-xs text-mse-muted flex items-center gap-2">
      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
      <span>
        Couldn&apos;t read the nameplate clearly. Please type the info below.
      </span>
    </div>
  );
}
