import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";
import { getDriveClient } from "@/lib/google/auth";
import type {
  EngineeringDocumentKind,
  HvacUnitInput,
  MonthlyBill,
  WalkInUnitInput,
} from "@/lib/types";

// Engineering-document OCR core. Shared by the on-demand OCR route
// (/api/admin/engineering/[id]/ocr) and the job linker, so the Claude
// prompts + parsing live in exactly one place. Reads a Drive file and
// returns the extracted, shape-normalized result plus a short summary.

export type OcrKind = Exclude<EngineeringDocumentKind, "other">;

/** Fields OCR can fill on an HVAC row. make/model/serial are already
 *  carried from the tech-side capture, so the linker keeps those and
 *  merges only the engineering specs from here. */
export type HvacOcrUnit = Pick<
  HvacUnitInput,
  | "tag"
  | "ouModel"
  | "tons"
  | "seer"
  | "supplyFanHp"
  | "heatPump"
  | "electricHeatKw"
  | "controls"
  | "notes"
>;

export type OcrResult =
  | { kind: "utility-bill"; months: MonthlyBill[] }
  | { kind: "hvac-nameplate"; unit: HvacOcrUnit }
  | { kind: "walkin-nameplate"; unit: WalkInUnitInput };

export const ENGINEERING_OCR_PROMPTS: Record<OcrKind, string> = {
  "utility-bill": `You read commercial electric utility bills for HVAC energy audits.

Given an image or PDF of a utility bill (any US utility, most often BGE, PEPCO, Delmarva, or SMECO for Maryland), extract every billing period on the document. Some bills include multiple months on one page (year-in-review statements); some are a single month; some may include a comparison to a prior year — extract only the current statement's periods, not the historical comparison.

Return ONLY a single JSON object with this exact shape:
{
  "months": [
    {
      "startDate": "YYYY-MM-DD",
      "endDate": "YYYY-MM-DD",
      "usage": 12345,
      "hdd": 0.0,
      "cdd": 0.0,
      "demandKw": 0.0,
      "demandCost": 0.00
    }
  ],
  "confidence": 0
}

Rules:
- "startDate" / "endDate" are the billing period start and end. Use ISO YYYY-MM-DD.
- "usage" is the total kWh consumption for that period. Number, no commas.
- "hdd" and "cdd" are heating and cooling degree-days if printed. If absent, use 0.
- "demandKw" is peak demand (kW) if listed. Optional — omit the field if not present.
- "demandCost" is the demand charge in dollars for that period. Optional.
- "confidence" is 0-100 for your overall extraction confidence.
- If the document is not a utility bill or you can't extract at least one period, return {"months": [], "confidence": 0}.
- Output JSON ONLY. No prose, no markdown code fences.`,

  "hvac-nameplate": `You read HVAC unit data plates (nameplates).

Given a photo of an HVAC unit's nameplate (RTU, package unit, air handler, split system, PTAC), extract the specs needed for an engineering audit.

Return ONLY a single JSON object with this exact shape:
{
  "make": "",
  "model": "",
  "serial": "",
  "tons": 0.0,
  "seer": 0.0,
  "supplyFanHp": 0.0,
  "heatPump": "No",
  "electricHeatKw": 0.0,
  "confidence": 0
}

Rules:
- "make" is the manufacturer (Carrier, Trane, Lennox, etc.).
- "model" is the model number.
- "serial" is the serial number.
- "tons" is the cooling capacity in tons (if labeled BTU/h, divide by 12000; if labeled MBH, divide by 12).
- "seer" is the SEER rating if printed. 0 if absent.
- "supplyFanHp" is supply fan horsepower if printed. 0 if absent.
- "heatPump" is "Yes" if the unit is a heat pump, else "No".
- "electricHeatKw" is any auxiliary electric heat kW if listed. 0 if absent.
- "confidence" is 0-100.
- Output JSON ONLY.`,

  "walkin-nameplate": `You read walk-in cooler / freezer refrigeration nameplates.

Given a photo of a walk-in cooler or freezer's condenser or evaporator nameplate, extract the specs needed for an engineering audit.

Return ONLY a single JSON object with this exact shape:
{
  "kind": "Cooler",
  "tag": "",
  "condenserModel": "",
  "serial": "",
  "evaporatorModel": "",
  "tonnage": 0.0,
  "mbh": 0.0,
  "watts": 0.0,
  "awef": 0.0,
  "fanMotorHp": 0.0,
  "numFans": 0,
  "confidence": 0
}

Rules:
- "kind" is "Cooler" (35-40 deg F) or "Freezer" (-10 to 0 deg F). Guess from the model type if unlabeled.
- "tag" left blank unless clearly identified.
- "condenserModel" for compressor/condenser unit; "evaporatorModel" for the coil in the walk-in. Fill whichever is visible.
- "serial" is the serial number.
- "tonnage" is refrigeration tonnage if labeled.
- "mbh" is capacity in thousand BTU/h.
- "watts" is fan or unit watts if listed.
- "awef" is Annual Walk-in Energy Factor (efficiency rating).
- "fanMotorHp" is fan motor horsepower.
- "numFans" is number of fans.
- Fields not visible: use 0 or empty string.
- "confidence" is 0-100.
- Output JSON ONLY.`,
};

function parseJson(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  let text = raw.trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function num(v: unknown, def = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : String(v ?? "").trim();
}

async function fetchDriveFileBytes(
  fileId: string
): Promise<{ bytes: Buffer; mimeType: string }> {
  const drive = getDriveClient();
  const meta = await drive.files.get({
    fileId,
    fields: "mimeType",
    supportsAllDrives: true,
  });
  const mimeType = String(meta.data.mimeType ?? "application/octet-stream");
  const media = await drive.files.get(
    {
      fileId,
      alt: "media",
      supportsAllDrives: true,
      acknowledgeAbuse: true,
    },
    { responseType: "arraybuffer" }
  );
  const bytes = Buffer.from(media.data as ArrayBuffer);
  return { bytes, mimeType };
}

function toClaudeContent(
  bytes: Buffer,
  mimeType: string
):
  | { type: "image"; source: { type: "base64"; media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; data: string } }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } } {
  const base64 = bytes.toString("base64");
  if (mimeType === "application/pdf") {
    return {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: base64 },
    };
  }
  const imageType = ([
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
  ] as const).includes(mimeType as never)
    ? (mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp")
    : "image/jpeg";
  return {
    type: "image",
    source: { type: "base64", media_type: imageType, data: base64 },
  };
}

/** Whether OCR is available (API key present). Callers can short-circuit
 *  the whole flow — e.g. the linker skips auto-OCR entirely. */
export function engineeringOcrConfigured(): boolean {
  return Boolean(env.anthropicApiKey());
}

/**
 * Run OCR on one engineering document (utility bill / HVAC nameplate /
 * walk-in nameplate). Throws on network / parse / config failure so the
 * caller can decide whether that's fatal (the route) or best-effort
 * (the linker). Returns the normalized result plus a one-line summary.
 */
export async function ocrEngineeringDocument(
  fileId: string,
  kind: OcrKind
): Promise<{ result: OcrResult; summary: string }> {
  const apiKey = env.anthropicApiKey();
  if (!apiKey) throw new Error("OCR not configured");

  const { bytes, mimeType } = await fetchDriveFileBytes(fileId);
  if (bytes.byteLength > 8 * 1024 * 1024) {
    console.warn(
      `[engineering ocr] large file ${fileId} (${bytes.byteLength} bytes) — proceeding but slow`
    );
  }

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    system: ENGINEERING_OCR_PROMPTS[kind],
    messages: [
      {
        role: "user",
        content: [
          toClaudeContent(bytes, mimeType),
          { type: "text", text: `Extract the ${kind} data as specified.` },
        ],
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const raw = textBlock && "text" in textBlock ? textBlock.text : "";
  const parsed = parseJson(raw);
  if (!parsed) throw new Error("Could not parse OCR response");

  if (kind === "utility-bill") {
    const rawMonths = Array.isArray(parsed.months) ? parsed.months : [];
    const months: MonthlyBill[] = rawMonths.map((m) => {
      const mo = m as Record<string, unknown>;
      return {
        startDate: str(mo.startDate),
        endDate: str(mo.endDate),
        usage: num(mo.usage),
        hdd: num(mo.hdd),
        cdd: num(mo.cdd),
        ...(mo.demandKw !== undefined ? { demandKw: num(mo.demandKw) } : {}),
        ...(mo.demandCost !== undefined
          ? { demandCost: num(mo.demandCost) }
          : {}),
      };
    });
    return {
      result: { kind, months },
      summary: `${months.length} month${months.length === 1 ? "" : "s"} added`,
    };
  }

  if (kind === "hvac-nameplate") {
    const make = str(parsed.make);
    const model = str(parsed.model);
    const unit: HvacOcrUnit = {
      tag: "",
      ouModel: [make, model].filter(Boolean).join(" "),
      tons: num(parsed.tons),
      seer: num(parsed.seer),
      supplyFanHp: num(parsed.supplyFanHp),
      heatPump: str(parsed.heatPump) || "No",
      electricHeatKw: num(parsed.electricHeatKw),
      controls: "",
      notes: parsed.serial ? `Serial: ${str(parsed.serial)}` : "",
    };
    return {
      result: { kind, unit },
      summary: [make, model].filter(Boolean).join(" ") || "HVAC unit added",
    };
  }

  // walkin-nameplate
  const kindGuess = str(parsed.kind) === "Freezer" ? "Freezer" : "Cooler";
  const unit: WalkInUnitInput = {
    kind: kindGuess,
    tag: str(parsed.tag),
    condenserModel: str(parsed.condenserModel),
    serial: str(parsed.serial),
    evaporatorModel: str(parsed.evaporatorModel),
    tonnage: num(parsed.tonnage),
    mbh: num(parsed.mbh),
    watts: num(parsed.watts),
    awef: num(parsed.awef),
    fanMotorHp: num(parsed.fanMotorHp),
    numFans: num(parsed.numFans),
  };
  return {
    result: { kind, unit },
    summary: `${kindGuess}${
      str(parsed.evaporatorModel) ? ` ${str(parsed.evaporatorModel)}` : ""
    }`,
  };
}
