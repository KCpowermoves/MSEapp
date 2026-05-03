"use client";

import { useRef, useState } from "react";
import { readNameplate, type OcrResult } from "@/lib/ocr";

export type OcrStatus = "idle" | "reading" | "complete" | "error";

interface OcrFields {
  make: string;
  model: string;
  serial: string;
  setMake: (v: string) => void;
  setModel: (v: string) => void;
  setSerial: (v: string) => void;
}

/**
 * Shared OCR auto-fill logic used by AddUnitForm (new units) and
 * EditUnitForm (replacing nameplate on an existing unit).
 *
 * Fill rules per field on each OCR run:
 *  - Field is empty                            → fill (no conflict)
 *  - Field still contains the previous OCR value (tech didn't edit) → OVERWRITE
 *    so a retake actually updates the data
 *  - Field has been edited away from the previous OCR value
 *    (or was non-empty before OCR ran)         → leave alone, the tech wins
 */
export function useOcrAutoFill(fields: OcrFields) {
  const [status, setStatus] = useState<OcrStatus>("idle");
  const [result, setResult] = useState<OcrResult | null>(null);

  // Tracks what the previous OCR pass wrote into each field. If a field's
  // CURRENT value still matches this, we know the tech hasn't touched it
  // and we're safe to overwrite on a re-read.
  const lastOcrRef = useRef<{ make?: string; model?: string; serial?: string }>({});

  const fillIfSafe = (
    nextValue: string,
    currentValue: string,
    lastOcrValue: string | undefined,
    setter: (v: string) => void,
    storeKey: "make" | "model" | "serial"
  ) => {
    const fieldIsEmpty = currentValue.trim() === "";
    const fieldStillMatchesLastOcr =
      lastOcrValue !== undefined && currentValue === lastOcrValue;
    if (fieldIsEmpty || fieldStillMatchesLastOcr) {
      setter(nextValue);
      lastOcrRef.current[storeKey] = nextValue;
    }
    // else: tech has manually edited away from the OCR value — leave it.
  };

  const run = async (blob: Blob) => {
    if (status === "reading") return; // ignore re-triggers while in flight
    setStatus("reading");
    const r = await readNameplate(blob);
    setResult(r);
    if (r.status !== "ok") {
      setStatus("error");
      return;
    }
    setStatus("complete");
    if (r.confidence >= 50) {
      if (r.make) {
        fillIfSafe(r.make, fields.make, lastOcrRef.current.make, fields.setMake, "make");
      }
      if (r.model) {
        fillIfSafe(r.model, fields.model, lastOcrRef.current.model, fields.setModel, "model");
      }
      if (r.serial) {
        fillIfSafe(r.serial, fields.serial, lastOcrRef.current.serial, fields.setSerial, "serial");
      }
    }
  };

  const reset = () => {
    setStatus("idle");
    setResult(null);
    lastOcrRef.current = {};
  };

  return { status, result, run, reset };
}
