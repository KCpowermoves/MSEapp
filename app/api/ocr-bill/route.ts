import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireSession } from "@/lib/auth";
import { env } from "@/lib/env";

// POST /api/ocr-bill — sales-side bill scanner. A photo of a utility
// bill prefills the New Lead form: business name, utility, account
// number, service address. Deliberately uses ANTHROPIC_API_KEY_SALES
// (never the nameplate key) so sales OCR spend tracks separately.

export const runtime = "nodejs";
export const maxDuration = 30;

const SYSTEM_PROMPT = `You read commercial utility bills (electric and gas) from Maryland, DC, and Virginia utilities.

Given a photo or screenshot of a utility bill, extract the fields below.

Return ONLY a single JSON object with this exact shape:
{ "businessName": "...", "utility": "...", "accountNumber": "...", "address": "...", "city": "...", "zip": "...", "confidence": 0 }

Rules:
- "businessName" is the customer/account holder name on the bill.
- "utility" must be EXACTLY one of: "BGE", "PEPCO", "Delmarva", "SMECO", "Washington Gas", or "" if unclear. (Baltimore Gas and Electric = BGE; Potomac Electric Power = PEPCO; Delmarva Power = Delmarva; Southern Maryland Electric Cooperative = SMECO.)
- "accountNumber" is the utility account number, digits and dashes as printed. Not the invoice number, not the meter number.
- "address" / "city" / "zip" are the SERVICE address (where power/gas is delivered), not the mailing address, when both appear.
- If a field can't be read with reasonable confidence, use "" rather than guessing.
- "confidence" is an integer 0-100 for the overall read.
- Output JSON ONLY. No prose, no markdown fences.`;

interface BillOcrResult {
  businessName: string;
  utility: string;
  accountNumber: string;
  address: string;
  city: string;
  zip: string;
  confidence: number;
  status: "ok" | "disabled" | "error" | "rate_limited";
  error?: string;
}

const EMPTY: BillOcrResult = {
  businessName: "",
  utility: "",
  accountNumber: "",
  address: "",
  city: "",
  zip: "",
  confidence: 0,
  status: "ok",
};

function parseBillJson(raw: string): Partial<BillOcrResult> | null {
  if (!raw) return null;
  let text = raw.trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as Record<
      string,
      unknown
    >;
    let confidence = Number(parsed.confidence ?? 0);
    if (!Number.isFinite(confidence)) confidence = 0;
    return {
      businessName: String(parsed.businessName ?? "").trim(),
      utility: String(parsed.utility ?? "").trim(),
      accountNumber: String(parsed.accountNumber ?? "").trim(),
      address: String(parsed.address ?? "").trim(),
      city: String(parsed.city ?? "").trim(),
      zip: String(parsed.zip ?? "").trim(),
      confidence: Math.max(0, Math.min(100, Math.round(confidence))),
    };
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

  const apiKey = env.anthropicApiKeySales();
  if (!apiKey) {
    return NextResponse.json({ ...EMPTY, status: "disabled" });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (file.size > 8 * 1024 * 1024) {
    return NextResponse.json(
      { error: "Image too large (8 MB max)" },
      { status: 400 }
    );
  }

  const mediaType = (file.type || "image/jpeg") as
    | "image/jpeg"
    | "image/png"
    | "image/gif"
    | "image/webp";
  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");

  try {
    const client = new Anthropic({ apiKey, maxRetries: 4 });
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 300,
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
              text: "Extract the customer, utility, account number, and service address from this bill.",
            },
          ],
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    const raw = textBlock && "text" in textBlock ? textBlock.text : "";
    const parsed = parseBillJson(raw);
    if (!parsed) {
      console.warn("[ocr-bill] could not parse model output:", raw);
      return NextResponse.json({
        ...EMPTY,
        status: "error",
        error: "Could not parse bill",
      });
    }
    return NextResponse.json({ ...EMPTY, ...parsed, status: "ok" });
  } catch (e) {
    console.error("[ocr-bill] anthropic call failed:", e);
    const isRateLimit =
      e instanceof Anthropic.RateLimitError ||
      (e instanceof Anthropic.APIError && e.status === 429);
    if (isRateLimit) {
      return NextResponse.json({
        ...EMPTY,
        status: "rate_limited",
        error: "Scanner is busy — type the details in.",
      });
    }
    return NextResponse.json({
      ...EMPTY,
      status: "error",
      error: e instanceof Error ? e.message : "Bill scan failed",
    });
  }
}
