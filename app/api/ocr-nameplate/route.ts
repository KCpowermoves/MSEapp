import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireSession } from "@/lib/auth";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 30; // seconds — Vercel hobby cap is 60

const SYSTEM_PROMPT = `You read HVAC unit data plates (nameplates).

Given a photo of an HVAC unit's nameplate (PTAC, RTU, mini-split, package unit, air handler, etc.), extract the identity fields (make/model/serial) AND the engineering specs an energy audit needs. All specs come from this same photo — the tech only cares about make/model/serial, but read the engineering fields too so they're captured once and never need a second scan.

Return ONLY a single JSON object with this exact shape:
{ "make": "...", "model": "...", "serial": "...", "tons": 0, "seer": 0, "supplyFanHp": 0, "heatPump": "No", "electricHeatKw": 0, "confidence": 0 }

Rules:
- "make" is the manufacturer brand (e.g., "Carrier", "Trane", "Lennox", "Goodman", "Mitsubishi", "Daikin", "York", "Rheem", "Bryant", "Amana", "American Standard"). Use the canonical brand name as it appears on the plate.
- "model" is the model number, often labeled MOD, MODEL, MODEL NO, MODEL NUMBER, M/N, or similar. Strip the label, keep only the number/code.
- "serial" is the serial number, often labeled SER, SERIAL, SERIAL NO, S/N, SERIAL NUMBER, or similar. Strip the label, keep only the number/code.
- "tons" is the cooling capacity in tons. If labeled BTU/h, divide by 12000; if labeled MBH, divide by 12. 0 if not readable.
- "seer" is the SEER rating if printed. 0 if absent.
- "supplyFanHp" is supply/indoor fan motor horsepower if printed. 0 if absent.
- "heatPump" is "Yes" if the unit is a heat pump, else "No".
- "electricHeatKw" is any auxiliary electric heat in kW if listed. 0 if absent.
- If a field can't be read with reasonable confidence, use "" or 0 rather than guessing. The engineering specs are frequently absent on a nameplate — leaving them 0 is expected and fine.
- "confidence" is an integer 0-100 reflecting confidence in the make/model/serial specifically:
  * 90+ when all three identity fields are crystal clear
  * 70-89 when most are clear but one is partial or you're unsure of one character
  * 50-69 when you can read some fields but not others
  * Below 50 when the image is too blurry, glare-obscured, or not actually an HVAC nameplate
- Output JSON ONLY. No prose, no explanation, no markdown code fences.`;

interface NameplateSpecs {
  tons: number;
  seer: number;
  supplyFanHp: number;
  heatPump: string;
  electricHeatKw: number;
}

interface OcrResult {
  make: string;
  model: string;
  serial: string;
  confidence: number;
  /** Hidden engineering specs read from the same plate — passed straight
   *  through to the client, which stores them behind the scenes. */
  specs?: NameplateSpecs;
  /** "ok" = real read; "disabled" = OCR not configured; "error" = read failed */
  status: "ok" | "disabled" | "error";
  error?: string;
}

const EMPTY: OcrResult = {
  make: "",
  model: "",
  serial: "",
  confidence: 0,
  status: "ok",
};

/** Permissive parser — Claude usually returns clean JSON, but occasionally
 *  wraps it in ```json fences or adds a trailing period. Strip and try. */
function parseOcrJson(
  raw: string
): Pick<OcrResult, "make" | "model" | "serial" | "confidence" | "specs"> | null {
  if (!raw) return null;
  let text = raw.trim();
  // Strip markdown fences if present
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  // Find the first { ... } block in case there's stray prose
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  const slice = text.slice(start, end + 1);
  try {
    const parsed = JSON.parse(slice) as Record<string, unknown>;
    const make = String(parsed.make ?? "").trim();
    const model = String(parsed.model ?? "").trim();
    const serial = String(parsed.serial ?? "").trim();
    let confidence = Number(parsed.confidence ?? 0);
    if (!Number.isFinite(confidence)) confidence = 0;
    confidence = Math.max(0, Math.min(100, Math.round(confidence)));
    const numOr0 = (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    const specs: NameplateSpecs = {
      tons: numOr0(parsed.tons),
      seer: numOr0(parsed.seer),
      supplyFanHp: numOr0(parsed.supplyFanHp),
      heatPump: String(parsed.heatPump ?? "No").trim() || "No",
      electricHeatKw: numOr0(parsed.electricHeatKw),
    };
    return { make, model, serial, confidence, specs };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const apiKey = env.anthropicApiKey();
  if (!apiKey) {
    // No API key configured — return a no-op result so the client
    // silently falls back to manual entry.
    return NextResponse.json({ ...EMPTY, status: "disabled" });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }

  // Cap at 5 MB to be safe — typical compressed nameplate photos are
  // around 0.5-1.5 MB after browser-side compression.
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json(
      { error: "Image too large (5 MB max)" },
      { status: 400 }
    );
  }

  const mediaType = (file.type || "image/jpeg") as
    | "image/jpeg"
    | "image/png"
    | "image/gif"
    | "image/webp";

  const buffer = Buffer.from(await file.arrayBuffer());
  const base64 = buffer.toString("base64");

  try {
    // maxRetries: the SDK retries 429s automatically, honoring the
    // Retry-After header with exponential backoff. Bumped from the
    // default 2 to 4 so a brief rate-limit spike (a tech firing several
    // nameplate reads in a row) rides out instead of surfacing an error.
    const client = new Anthropic({ apiKey, maxRetries: 4 });
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: base64 },
            },
            {
              type: "text",
              text: "Extract make, model, and serial from this HVAC nameplate.",
            },
          ],
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    const raw = textBlock && "text" in textBlock ? textBlock.text : "";
    const parsed = parseOcrJson(raw);
    if (!parsed) {
      console.warn("[ocr] could not parse model output:", raw);
      return NextResponse.json({
        ...EMPTY,
        status: "error",
        error: "Could not parse OCR response",
      });
    }
    return NextResponse.json({ ...parsed, status: "ok" });
  } catch (e) {
    console.error("[ocr] anthropic call failed:", e);
    // A 429 that survives the SDK's retries means we're genuinely over
    // the account's per-minute limit. Surface a distinct, friendly
    // status so the client tells the tech to type it in, rather than
    // leaking the raw "user rate limit exceeded" API string.
    const isRateLimit =
      e instanceof Anthropic.RateLimitError ||
      (e instanceof Anthropic.APIError && e.status === 429);
    if (isRateLimit) {
      return NextResponse.json({
        ...EMPTY,
        status: "rate_limited",
        error: "Auto-fill is busy right now — just type the details in.",
      });
    }
    return NextResponse.json({
      ...EMPTY,
      status: "error",
      error: e instanceof Error ? e.message : "OCR failed",
    });
  }
}
