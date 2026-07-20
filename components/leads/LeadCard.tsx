"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  Clock,
  Copy,
  FileText,
  Loader2,
  Mail,
  MessageSquare,
  PenLine,
  ShieldAlert,
  UserPlus,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { packetLabel } from "@/lib/programs";
import type { Lead, LeadStatus } from "@/lib/types";

// One lead on the My Sales page. Open leads are AWAITING SIGNATURE —
// the card shows how the link was delivered and never implies the deal
// is done. A job only comes from a real customer e-signature (via the
// signing page), or an admin override for a paper-signed deal.

const STATUS_STYLE: Record<LeadStatus, string> = {
  Sent: "bg-mse-gold/15 text-mse-navy border-mse-gold/40",
  Signed: "bg-emerald-600/10 text-emerald-700 border-emerald-600/25",
  Converted: "bg-emerald-600/10 text-emerald-700 border-emerald-600/25",
  Cancelled: "bg-mse-light text-mse-muted border-mse-light",
};

// Open leads read "Awaiting signature" instead of the bare "Sent".
const STATUS_LABEL: Partial<Record<LeadStatus, string>> = {
  Sent: "Awaiting signature",
};

function deliveryChip(method: string): { label: string; icon: React.ReactNode } | null {
  if (method === "text") return { label: "Texted", icon: <MessageSquare className="w-3 h-3" /> };
  if (method === "email") return { label: "Emailed", icon: <Mail className="w-3 h-3" /> };
  if (method === "in-person") return { label: "In person", icon: <PenLine className="w-3 h-3" /> };
  return null;
}

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
  isAdmin,
}: {
  lead: Lead;
  crewTechs: string[];
  showAgent: boolean;
  isAdmin: boolean;
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
                "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border",
                STATUS_STYLE[lead.status]
              )}
            >
              {open && <Clock className="w-3 h-3" />}
              {STATUS_LABEL[lead.status] ?? lead.status}
            </span>
            {open && deliveryChip(lead.deliveryMethod) && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-mse-light text-mse-muted border border-mse-light">
                {deliveryChip(lead.deliveryMethod)!.icon}
                {deliveryChip(lead.deliveryMethod)!.label}
              </span>
            )}
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
                title="Signed documents (Drive folder)"
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
          <button
            type="button"
            title="Copy signing link to resend"
            onClick={() => {
              void navigator.clipboard
                .writeText(`${window.location.origin}/sign/${lead.signToken}`)
                .then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
            }}
            className="shrink-0 inline-flex items-center gap-1 px-2.5 py-2 rounded-lg border border-mse-light text-xs font-semibold text-mse-muted hover:text-mse-navy hover:border-mse-navy/30 active:scale-95"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied ? "Copied" : "Copy link"}
          </button>
        ) : null}
      </div>

      {open && (
        <div className="mt-3 pt-3 border-t border-mse-light space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <a
              href={`/sign/${encodeURIComponent(lead.signToken)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold bg-mse-navy text-white hover:bg-mse-navy-soft active:scale-95"
            >
              <PenLine className="w-3.5 h-3.5" />
              Open to sign
            </a>
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
          {/* Admin-only: create the job for a paper-signed deal, with no
              customer e-signature on file. Regular agents can't. */}
          {isAdmin && (
            <button
              type="button"
              onClick={() => {
                if (
                  window.confirm(
                    "Create a job for this lead WITHOUT a customer e-signature? Use this only for a deal that's already signed on paper — it will be logged as an admin override."
                  )
                ) {
                  void patch({ action: "mark-signed" }, "sign");
                }
              }}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-mse-muted hover:text-mse-navy"
            >
              {busy === "sign" ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <ShieldAlert className="w-3 h-3" />
              )}
              Admin: create job without e-signature
            </button>
          )}
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
