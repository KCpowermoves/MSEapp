"use client";

/** Hidden engineering specs read off the same nameplate photo. Not shown
 *  to the tech — the form stores them behind the scenes so a building
 *  tune-up can carry them across without a second scan. */
export interface NameplateSpecs {
  tons: number;
  seer: number;
  supplyFanHp: number;
  heatPump: string;
  electricHeatKw: number;
}

export interface OcrResult {
  make: string;
  model: string;
  serial: string;
  confidence: number;
  specs?: NameplateSpecs;
  status: "ok" | "disabled" | "error" | "rate_limited";
  error?: string;
}

/**
 * Send a nameplate photo to the server and get back parsed make/model/serial
 * fields. Best-effort — never throws to the caller. On any failure, returns
 * a status === "error" result so the form silently falls back to manual entry.
 */
export async function readNameplate(blob: Blob): Promise<OcrResult> {
  try {
    const formData = new FormData();
    formData.append("file", blob, "nameplate.jpg");
    const res = await fetch("/api/ocr-nameplate", {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      return {
        make: "",
        model: "",
        serial: "",
        confidence: 0,
        status: "error",
        error: `HTTP ${res.status}`,
      };
    }
    const data = (await res.json()) as OcrResult;
    return data;
  } catch (e) {
    return {
      make: "",
      model: "",
      serial: "",
      confidence: 0,
      status: "error",
      error: e instanceof Error ? e.message : "OCR failed",
    };
  }
}
