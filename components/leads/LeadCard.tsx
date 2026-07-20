"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileText,
  Loader2,
  UserPlus,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { packetLabel } from "@/lib/programs";
import type { Lead, LeadStatus } from "@/lib/types";

// One lead on the My Sales page. Actions: open/copy the native
// signing link, Mark signed (paper fallback — converts to a job),
// Assign crew + date, Cancel.

const STATUS_STYLE: Record<LeadStatus, string> = {
  Sent: "bg-mse-gold/15 text-mse-navy border-mse-gold/40",
  Signed: "bg-emerald-600/10 text-emerald-700 border-emerald-600/25",
  Converted: "bg-emerald-600/10 text-emerald-700 border-emerald-600/25",
  Cancelled: "bg-mse-light text-mse-muted border-mse-light",
};

function fmtDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function LeadCard({
  lead,
  crewTechs,
  showAgent,
}: {
  lead: Lead;
  crewTechs: string[];
  showAgent: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignTech, setAssignTech] = useState(lead.assignTech);
  const [assignDate, setAssignDate] = useState(lead.assignDate);
  const [copied, setCopied] = useState(false);

  const patch = async (body: Record<string, unknown>, key: string) => {
    if (busy) return;
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(`/api/leads/${encodeURIComponent(lead.leadId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Server error ${res.status}`);
      setAssignOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };

  const open = lead.status === "Sent";

  return (
    <div className="bg-white rounded-2xl border-2 border-mse-light shadow-card p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={cn(
                "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border",
                STATUS_STYLE[lead.status]
              )}
            >
              {lead.status}
            </span>
            <span className="text-sm font-bold text-mse-navy truncate">
              {lead.businessName || lead.contactName || lead.leadId}
            </span>
          </div>
          <div className="text-xs text-mse-muted mt-1 flex items-center gap-2 flex-wrap">
            <span>{fmtDate(lead.createdAt)}</span>
            <span>·</span>
            <span>{packetLabel(lead.utility)}</span>
            {lead.hvacUnits && (
              <>
                <span>·</span>
                <span>{lead.hvacUnits} units</span>
              </>
            )}
            {showAgent && (
              <>
                <span>·</span>
                <span>by {lead.agentName}</span>
              </>
            )}
          </div>
          {lead.assignTech && (
            <div className="text-[11px] text-mse-muted mt-1">
              Assigned to {lead.assignTech}
              {lead.assignDate ? ` for ${lead.assignDate}` : ""}
            </div>
          )}
        </div>

        {lead.jobId ? (
          <div className="flex items-center gap-1.5 shrink-0">
            {lead.signedPdfUrl && (
              <a
                href={lead.signedPdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                title="Signed agreement PDF"
                className="p-2 rounded-lg border border-mse-light text-mse-muted hover:text-mse-navy hover:border-mse-navy/30 active:scale-95"
              >
                <FileText className="w-4 h-4" />
              </a>
            )}
            <Link
              href={`/jobs/${encodeURIComponent(lead.jobId)}`}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 active:scale-95"
            >
              Job {lead.jobId.slice(-4)}
              <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        ) : open ? (
          <div className="flex items-center gap-1.5 shrink-0">
            <a
              href={`/sign/${encodeURIComponent(lead.signToken)}`}
              target="_blank"
              rel="noopener noreferrer"
              title="Open agreement"
              className="p-2 rounded-lg border border-mse-light text-mse-muted hover:text-mse-navy hover:border-mse-navy/30 active:scale-95"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
            <button
              type="button"
              title="Copy agreement link"
              onClick={() => {
                void navigator.clipboard
                  .writeText(`${window.location.origin}/sign/${lead.signToken}`)
                  .then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  });
              }}
              className="p-2 rounded-lg border border-mse-light text-mse-muted hover:text-mse-navy hover:border-mse-navy/30 active:scale-95"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        ) : null}
      </div>

      {open && (
        <div className="flex items-center gap-2 flex-wrap mt-3 pt-3 border-t border-mse-light">
          <button
            type="button"
            onClick={() => patch({ action: "mark-signed" }, "sign")}
            disabled={busy !== null}
            className="inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold bg-mse-navy text-white hover:bg-mse-navy-soft active:scale-95"
          >
            {busy === "sign" ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5" />
            )}
            Signed — create job
          </button>
          <button
            type="button"
            onClick={() => setAssignOpen((v) => !v)}
            disabled={busy !== null}
            className="inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold border-2 border-mse-light text-mse-navy hover:border-mse-navy/30 active:scale-95"
          >
            <UserPlus className="w-3.5 h-3.5" />
            {lead.assignTech ? "Reassign" : "Assign"}
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm("Cancel this lead?")) {
                void patch({ action: "cancel" }, "cancel");
              }
            }}
            disabled={busy !== null}
            className="inline-flex items-center gap-1 px-2.5 py-2 rounded-xl text-xs font-bold text-mse-muted hover:text-mse-red active:scale-95 ml-auto"
          >
            <X className="w-3.5 h-3.5" />
            Cancel
          </button>
        </div>
      )}

      {assignOpen && (
        <div className="mt-2 rounded-xl border border-mse-light p-3 grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
          <select
            value={assignTech}
            onChange={(e) => setAssignTech(e.target.value)}
            className="px-2.5 py-2 rounded-lg border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy"
          >
            <option value="">Pick tech…</option>
            {crewTechs.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <input
            type="date"
            value={assignDate}
            onChange={(e) => setAssignDate(e.target.value)}
            className="px-2.5 py-2 rounded-lg border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy"
          />
          <button
            type="button"
            onClick={() => patch({ action: "assign", assignTech, assignDate }, "assign")}
            disabled={busy !== null || !assignTech || !assignDate}
            className="px-3 py-2 rounded-lg text-xs font-bold bg-mse-navy text-white hover:bg-mse-navy-soft active:scale-95 disabled:opacity-50"
          >
            {busy === "assign" ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              "Save"
            )}
          </button>
        </div>
      )}

      {error && (
        <div className="mt-2 text-xs text-mse-red bg-mse-red/5 border border-mse-red/20 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
    </div>
  );
}
