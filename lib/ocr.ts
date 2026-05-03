"use client";

export interface OcrResult {
  make: string;
  model: string;
  serial: string;
  confidence: number;
  status: "ok" | "disabled" | "error";
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
