"use client";

import { useState } from "react";
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
 * Shared OCR auto-fill logic used by both AddUnitForm (new units) and
 * EditUnitForm (replacing nameplate on an existing unit). Only fills
 * fields that are currently EMPTY — never overwrites a value the tech
 * has already typed or that came from the server.
 *
 * Caller responsibility: invoke `run(blob)` whenever the tech captures
 * or replaces a nameplate photo.
 */
export function useOcrAutoFill(fields: OcrFields) {
  const [status, setStatus] = useState<OcrStatus>("idle");
  const [result, setResult] = useState<OcrResult | null>(null);

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
      if (r.make && !fields.make) fields.setMake(r.make);
      if (r.model && !fields.model) fields.setModel(r.model);
      if (r.serial && !fields.serial) fields.setSerial(r.serial);
    }
  };

  const reset = () => {
    setStatus("idle");
    setResult(null);
  };

  return { status, result, run, reset };
}
