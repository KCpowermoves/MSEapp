"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  ExternalLink,
  FileText,
  Loader2,
  Snowflake,
  Sparkles,
  Upload,
  Wrench,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  EngineeringDocument,
  EngineeringDocumentKind,
} from "@/lib/types";

interface Props {
  projectId: string;
  documents: EngineeringDocument[];
  onExtracted: (result: OcrResult) => void;
}

/** Emitted upstream after OCR extracts values. The parent form uses
 *  this to append monthly bills / HVAC / walk-in rows and stamp them
 *  as unverified. */
export type OcrResult =
  | {
      kind: "utility-bill";
      months: Array<{
        startDate: string;
        endDate: string;
        usage: number;
        hdd: number;
        cdd: number;
        demandKw?: number;
        demandCost?: number;
      }>;
    }
  | {
      kind: "hvac-nameplate";
      unit: {
        tag: string;
        ouModel: string;
        tons: number;
        seer: number;
        supplyFanHp: number;
        heatPump: string;
        electricHeatKw: number;
        controls: string;
        notes: string;
      };
    }
  | {
      kind: "walkin-nameplate";
      unit: {
        kind: "Cooler" | "Freezer";
        tag: string;
        condenserModel: string;
        serial: string;
        evaporatorModel: string;
        tonnage: number;
        mbh: number;
        watts: number;
        awef: number;
        fanMotorHp: number;
        numFans: number;
      };
    };

const KIND_META: Record<
  EngineeringDocumentKind,
  { label: string; icon: React.ReactNode; hint: string }
> = {
  "utility-bill": {
    label: "Utility bill",
    icon: <Zap className="w-3.5 h-3.5" />,
    hint: "PDF or photo. OCR fills the monthly bills table.",
  },
  "hvac-nameplate": {
    label: "HVAC nameplate",
    icon: <Wrench className="w-3.5 h-3.5" />,
    hint: "Photo. OCR adds an HVAC unit row (make/model/tonnage/SEER).",
  },
  "walkin-nameplate": {
    label: "Walk-in nameplate",
    icon: <Snowflake className="w-3.5 h-3.5" />,
    hint: "Cooler / freezer condenser or evaporator. OCR adds a walk-in row.",
  },
  other: {
    label: "Other document",
    icon: <FileText className="w-3.5 h-3.5" />,
    hint: "Reference file only. Stored, no OCR extraction.",
  },
};

export function DocumentsSection({ projectId, documents, onExtracted }: Props) {
  const router = useRouter();
  const [uploadKind, setUploadKind] =
    useState<EngineeringDocumentKind>("utility-bill");
  const [uploadingCount, setUploadingCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busyOcrId, setBusyOcrId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setUploadingCount(files.length);
    try {
      const uploads = Array.from(files).map(async (file) => {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("kind", uploadKind);
        const res = await fetch(
          `/api/admin/engineering/${encodeURIComponent(projectId)}/upload`,
          { method: "POST", body: fd }
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? "Upload failed");
        }
      });
      await Promise.all(uploads);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploadingCount(0);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function runOcr(doc: EngineeringDocument) {
    if (doc.kind === "other") return;
    setBusyOcrId(doc.fileId);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/engineering/${encodeURIComponent(projectId)}/ocr`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileId: doc.fileId, kind: doc.kind }),
        }
      );
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        result?: OcrResult;
        summary?: string;
      };
      if (!res.ok || !body.result) {
        throw new Error(body.error ?? "OCR failed");
      }
      onExtracted(body.result);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "OCR failed");
    } finally {
      setBusyOcrId(null);
    }
  }

  return (
    <section className="rounded-2xl bg-white border border-mse-light shadow-card p-5 space-y-4">
      <div>
        <div className="flex items-center gap-1.5 text-mse-navy">
          <Upload className="w-4 h-4 text-mse-gold" />
          <h2 className="font-bold">Documents</h2>
        </div>
        <div className="text-[11px] text-mse-muted mt-0.5">
          Upload utility bills, nameplates, or other project files. OCR
          pre-fills form fields — engineer reviews before saving.
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {(Object.entries(KIND_META) as [
          EngineeringDocumentKind,
          (typeof KIND_META)[EngineeringDocumentKind]
        ][]).map(([k, meta]) => (
          <button
            key={k}
            type="button"
            onClick={() => setUploadKind(k)}
            className={cn(
              "px-2.5 py-2 rounded-lg text-[11px] font-bold border-2 flex items-center gap-1 justify-center",
              "active:scale-95",
              uploadKind === k
                ? "bg-mse-navy border-mse-navy text-white"
                : "bg-white border-mse-light text-mse-muted hover:text-mse-navy hover:border-mse-navy/30"
            )}
          >
            {meta.icon}
            {meta.label}
          </button>
        ))}
      </div>

      <div className="text-[11px] text-mse-muted italic">
        {KIND_META[uploadKind].hint}
      </div>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploadingCount > 0}
        className={cn(
          "w-full rounded-xl border-2 border-dashed p-6",
          "text-mse-muted hover:border-mse-navy/40 hover:text-mse-navy",
          "flex flex-col items-center justify-center gap-1 text-xs font-semibold",
          "transition-[border-color,color]",
          uploadingCount > 0
            ? "border-mse-navy/30 text-mse-navy cursor-wait"
            : "border-mse-light"
        )}
      >
        {uploadingCount > 0 ? (
          <>
            <Loader2 className="w-6 h-6 animate-spin" />
            Uploading {uploadingCount} file{uploadingCount === 1 ? "" : "s"}…
          </>
        ) : (
          <>
            <Upload className="w-6 h-6" />
            Tap to upload {KIND_META[uploadKind].label.toLowerCase()}
            <span className="text-[10px] font-normal text-mse-muted/80">
              PDF or image · multiple files OK
            </span>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={
            uploadKind === "utility-bill"
              ? "application/pdf,image/*"
              : "image/*"
          }
          onChange={(e) => uploadFiles(e.target.files)}
          className="hidden"
        />
      </button>

      {error && (
        <div className="text-[11px] text-mse-red bg-mse-red/5 rounded px-2 py-1">
          {error}
        </div>
      )}

      {documents.length > 0 && (
        <ul className="space-y-1">
          {documents.map((d) => (
            <li
              key={d.fileId}
              className="flex items-center gap-2 rounded-lg border border-mse-light bg-white px-2 py-1.5"
            >
              <div className="text-mse-muted shrink-0">
                {KIND_META[d.kind].icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-mse-navy truncate">
                  {d.name}
                </div>
                <div className="text-[10px] text-mse-muted flex items-center gap-1.5 flex-wrap">
                  <span>{KIND_META[d.kind].label}</span>
                  <span>·</span>
                  <OcrBadge status={d.ocrStatus} summary={d.ocrSummary} />
                  {d.uploadedBy && (
                    <>
                      <span>·</span>
                      <span>{d.uploadedBy}</span>
                    </>
                  )}
                </div>
              </div>
              {d.kind !== "other" && d.ocrStatus !== "ok" && (
                <button
                  type="button"
                  onClick={() => runOcr(d)}
                  disabled={busyOcrId !== null}
                  className={cn(
                    "shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold",
                    "bg-mse-gold text-mse-navy hover:bg-mse-gold/90",
                    busyOcrId === d.fileId && "opacity-60"
                  )}
                >
                  {busyOcrId === d.fileId ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Sparkles className="w-3 h-3" />
                  )}
                  Extract
                </button>
              )}
              {d.url && (
                <a
                  href={d.url}
                  target="_blank"
                  rel="noopener"
                  className="shrink-0 text-mse-muted hover:text-mse-navy"
                  aria-label="Open file in Drive"
                >
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function OcrBadge({
  status,
  summary,
}: {
  status: EngineeringDocument["ocrStatus"];
  summary?: string;
}) {
  if (status === "ok") {
    return (
      <span className="inline-flex items-center gap-0.5 text-emerald-700 font-semibold">
        <CheckCircle2 className="w-2.5 h-2.5" />
        {summary || "Extracted"}
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="text-mse-red font-semibold">
        OCR failed{summary ? ` · ${summary}` : ""}
      </span>
    );
  }
  if (status === "skip") {
    return <span>Reference only</span>;
  }
  return <span className="text-mse-gold font-semibold">Ready to extract</span>;
}
