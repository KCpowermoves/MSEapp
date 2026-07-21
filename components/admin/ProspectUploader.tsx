"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  FileUp,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Admin upload for the prospect list: drop a CSV exported from any
// spreadsheet; columns are matched by header name. Shows how many rows
// imported and which columns mapped.

export function ProspectUploader({
  available,
  used,
}: {
  available: number;
  used: number;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listName, setListName] = useState("");
  const [result, setResult] = useState<{
    added: number;
    skipped: number;
    listName: string;
    matchedColumns: Record<string, string>;
  } | null>(null);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("listName", listName.trim());
      const res = await fetch("/api/admin/prospects", {
        method: "POST",
        body: fd,
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        added?: number;
        skipped?: number;
        listName?: string;
        matchedColumns?: Record<string, string>;
      };
      if (!res.ok) throw new Error(data.error ?? `Server error ${res.status}`);
      setResult({
        added: data.added ?? 0,
        skipped: data.skipped ?? 0,
        listName: data.listName ?? "",
        matchedColumns: data.matchedColumns ?? {},
      });
      setListName("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const clearList = async () => {
    if (
      !window.confirm(
        `Clear all ${available} available prospect${available === 1 ? "" : "s"} from the reps' picker? (Rows stay in the sheet for the record.)`
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/prospects", { method: "DELETE" });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Clear failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Stat label="Available to reps" value={available} accent="navy" />
        <Stat label="Already used" value={used} />
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
          e.target.value = "";
        }}
      />
      <label className="block">
        <span className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1 block">
          List name
        </span>
        <input
          value={listName}
          onChange={(e) => setListName(e.target.value)}
          placeholder='e.g. "Baltimore — July" or "Dundalk batch 2"'
          className="w-full px-3 py-2.5 rounded-lg border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy"
        />
        <span className="text-[11px] text-mse-muted mt-1 block">
          Name this batch so you can tell a rep which list to work — e.g. by
          city or drop. Blank = today&apos;s date.
        </span>
      </label>

      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        className={cn(
          "w-full inline-flex items-center justify-center gap-2 rounded-xl py-4 px-4 font-bold text-sm border-2 border-dashed active:scale-[0.99]",
          busy
            ? "border-mse-light text-mse-muted cursor-wait"
            : "border-mse-navy/40 bg-mse-navy/5 text-mse-navy hover:bg-mse-navy/10"
        )}
      >
        {busy ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          <FileUp className="w-5 h-5" />
        )}
        {busy ? "Importing…" : "Upload a prospect list (CSV)"}
      </button>

      <p className="text-xs text-mse-muted">
        Export your spreadsheet as <strong>CSV</strong> and upload it. The first
        row must be column headers — common names like Business, Contact, Phone,
        Email, Address, City, Zip, Utility, Account, Units are matched
        automatically. Add an <strong>Agent</strong> column to route rows to a
        specific rep; leave it blank to share with everyone.
      </p>

      {result && (
        <div className="rounded-xl bg-emerald-600/10 border border-emerald-600/25 px-4 py-3 space-y-1">
          <div className="text-sm font-bold text-mse-navy inline-flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-700" />
            Imported {result.added} prospect{result.added === 1 ? "" : "s"}
            {result.listName && ` into "${result.listName}"`}
            {result.skipped > 0 && ` (skipped ${result.skipped} with no name)`}.
          </div>
          {Object.keys(result.matchedColumns).length > 0 && (
            <div className="text-[11px] text-mse-muted">
              Matched columns:{" "}
              {Object.entries(result.matchedColumns)
                .map(([k, v]) => `${v} → ${k}`)
                .join(", ")}
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="text-xs text-mse-red bg-mse-red/5 border border-mse-red/20 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {available > 0 && (
        <button
          type="button"
          onClick={clearList}
          disabled={busy}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-mse-muted hover:text-mse-red"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Clear the current list
        </button>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  accent = "muted",
}: {
  label: string;
  value: number;
  accent?: "navy" | "muted";
}) {
  return (
    <div
      className={cn(
        "rounded-xl px-4 py-2.5 min-w-[130px]",
        accent === "navy"
          ? "bg-mse-navy text-white"
          : "bg-white border border-mse-light text-mse-navy"
      )}
    >
      <div
        className={cn(
          "text-[10px] uppercase tracking-[0.12em] font-bold",
          accent === "navy" ? "text-mse-gold" : "text-mse-muted"
        )}
      >
        {label}
      </div>
      <div className="text-2xl font-bold tabular-nums mt-0.5 inline-flex items-center gap-1.5">
        <Upload className="w-4 h-4 opacity-40" />
        {value}
      </div>
    </div>
  );
}
