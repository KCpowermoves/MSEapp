import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import Anthropic from "@anthropic-ai/sdk";
import { requireAdmin } from "@/lib/payroll/auth";
import { env } from "@/lib/env";
import {
  getEngineeringProject,
  updateEngineeringProject,
} from "@/lib/data/engineering-projects";
import { getDriveClient } from "@/lib/google/auth";
import { nowIso } from "@/lib/utils";
import type { EngineeringDocumentKind } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PROMPTS: Record<
  Exclude<EngineeringDocumentKind, "other">,
  string
> = {
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

async function fetchDriveFileBytes(fileId: string): Promise<{
  bytes: Buffer;
  mimeType: string;
}> {
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
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: base64,
      },
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
    source: {
      type: "base64",
      media_type: imageType,
      data: base64,
    },
  };
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const guard = await requireAdmin();
  if ("response" in guard) return guard.response;
  const id = decodeURIComponent(params.id);

  const project = await getEngineeringProject(id);
  if (!project)
    return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const body = await request.json().catch(() => null);
  if (!body)
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const fileId = String(body.fileId ?? "").trim();
  const kind = String(body.kind ?? "") as EngineeringDocumentKind;
  if (!fileId)
    return NextResponse.json({ error: "Missing fileId" }, { status: 400 });
  if (kind === "other" || !(kind in PROMPTS)) {
    return NextResponse.json({ error: "OCR not supported for this kind" }, { status: 400 });
  }

  const doc = project.documents.find((d) => d.fileId === fileId);
  if (!doc)
    return NextResponse.json({ error: "Document not found on project" }, { status: 404 });

  const apiKey = env.anthropicApiKey();
  if (!apiKey) {
    return NextResponse.json({ error: "OCR not configured" }, { status: 503 });
  }

  try {
    const { bytes, mimeType } = await fetchDriveFileBytes(fileId);
    // 8 MB soft cap — Anthropic's per-message ceiling is comfortable up
    // to a few tens of MB, but very large PDFs slow the call. Bail if
    // the file is huge and log for the operator.
    if (bytes.byteLength > 8 * 1024 * 1024) {
      console.warn(
        `[engineering ocr] large file ${fileId} (${bytes.byteLength} bytes) — proceeding but slow`
      );
    }

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      system: PROMPTS[kind as keyof typeof PROMPTS],
      messages: [
        {
          role: "user",
          content: [
            toClaudeContent(bytes, mimeType),
            {
              type: "text",
              text: `Extract the ${kind} data as specified.`,
            },
          ],
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    const raw = textBlock && "text" in textBlock ? textBlock.text : "";
    const parsed = parseJson(raw);
    if (!parsed) {
      await markDocStatus(
        id,
        fileId,
        "failed",
        "Could not parse OCR response"
      );
      return NextResponse.json(
        { error: "Could not parse OCR response" },
        { status: 500 }
      );
    }

    let result;
    let summary = "";
    if (kind === "utility-bill") {
      const rawMonths = Array.isArray(parsed.months) ? parsed.months : [];
      const months = rawMonths.map((m) => {
        const mo = m as Record<string, unknown>;
        return {
          startDate: str(mo.startDate),
          endDate: str(mo.endDate),
          usage: num(mo.usage),
          hdd: num(mo.hdd),
          cdd: num(mo.cdd),
          ...(mo.demandKw !== undefined
            ? { demandKw: num(mo.demandKw) }
            : {}),
          ...(mo.demandCost !== undefined
            ? { demandCost: num(mo.demandCost) }
            : {}),
        };
      });
      result = { kind, months };
      summary = `${months.length} month${months.length === 1 ? "" : "s"} added`;
    } else if (kind === "hvac-nameplate") {
      const make = str(parsed.make);
      const model = str(parsed.model);
      result = {
        kind,
        unit: {
          tag: "",
          ouModel: [make, model].filter(Boolean).join(" "),
          tons: num(parsed.tons),
          seer: num(parsed.seer),
          supplyFanHp: num(parsed.supplyFanHp),
          heatPump: str(parsed.heatPump) || "No",
          electricHeatKw: num(parsed.electricHeatKw),
          controls: "",
          notes: parsed.serial ? `Serial: ${str(parsed.serial)}` : "",
        },
      };
      summary = [make, model].filter(Boolean).join(" ") || "HVAC unit added";
    } else {
      // walkin-nameplate
      const kindGuess = str(parsed.kind) === "Freezer" ? "Freezer" : "Cooler";
      result = {
        kind,
        unit: {
          kind: kindGuess as "Cooler" | "Freezer",
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
        },
      };
      summary = `${kindGuess}${str(parsed.evaporatorModel) ? ` ${str(parsed.evaporatorModel)}` : ""}`;
    }

    await markDocStatus(id, fileId, "ok", summary);
    revalidatePath(`/admin/engineering/${id}`);
    return NextResponse.json({ ok: true, result, summary });
  } catch (e) {
    console.error("[engineering ocr] failed:", e);
    await markDocStatus(
      id,
      fileId,
      "failed",
      e instanceof Error ? e.message : "OCR error"
    );
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}

async function markDocStatus(
  projectId: string,
  fileId: string,
  status: "ok" | "failed",
  summary: string
): Promise<void> {
  const fresh = await getEngineeringProject(projectId, { fresh: true });
  if (!fresh) return;
  const documents = fresh.documents.map((d) =>
    d.fileId === fileId
      ? {
          ...d,
          ocrStatus: status,
          ocrExtractedAt: nowIso(),
          ...(status === "ok" ? { ocrSummary: summary } : { ocrError: summary }),
        }
      : d
  );
  await updateEngineeringProject({ projectId, documents });
}
