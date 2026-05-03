import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireSession } from "@/lib/auth";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 30; // seconds — Vercel hobby cap is 60

const SYSTEM_PROMPT = `You read HVAC unit data plates (nameplates).

Given a photo of an HVAC unit's nameplate (PTAC, RTU, mini-split, package unit, air handler, etc.), extract the manufacturer, model number, and serial number.

Return ONLY a single JSON object with this exact shape:
{ "make": "...", "model": "...", "serial": "...", "confidence": 0 }

Rules:
- "make" is the manufacturer brand (e.g., "Carrier", "Trane", "Lennox", "Goodman", "Mitsubishi", "Daikin", "York", "Rheem", "Bryant", "Amana", "American Standard"). Use the canonical brand name as it appears on the plate.
- "model" is the model number, often labeled MOD, MODEL, MODEL NO, MODEL NUMBER, M/N, or similar. Strip the label, keep only the number/code.
- "serial" is the serial number, often labeled SER, SERIAL, SERIAL NO, S/N, SERIAL NUMBER, or similar. Strip the label, keep only the number/code.
- If a field can't be read with reasonable confidence, set it to "" (empty string) rather than guessing.
- "confidence" is an integer 0-100 reflecting your overall confidence:
  * 90+ when all three fields are crystal clear
  * 70-89 when most are clear but one is partial or you're unsure of one character
  * 50-69 when you can read some fields but not others
  * Below 50 when the image is too blurry, glare-obscured, or not actually an HVAC nameplate
- Output JSON ONLY. No prose, no explanation, no markdown code fences.`;

interface OcrResult {
  make: string;
  model: string;
  serial: string;
  confidence: number;
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
function parseOcrJson(raw: string): Pick<OcrResult, "make" | "model" | "serial" | "confidence"> | null {
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
    return { make, model, serial, confidence };
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
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 200,
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
    return NextResponse.json({
      ...EMPTY,
      status: "error",
      error: e instanceof Error ? e.message : "OCR failed",
    });
  }
}
