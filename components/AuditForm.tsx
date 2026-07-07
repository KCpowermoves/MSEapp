"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";
import { AuditPhotoSlot } from "@/components/AuditPhotoSlot";
import { AuditItemSection } from "@/components/AuditItemSection";
import { uploadAuditPhotoWithFallback } from "@/lib/audit-photo-fallback";
import { cn } from "@/lib/utils";
import type {
  Audit,
  AuditItem,
  AuditItemType,
  Job,
} from "@/lib/types";

interface Props {
  job: Job;
  audit: Audit;
  initialItems: AuditItem[];
  currentUserName: string;
}

const SECTIONS: { key: AuditItemType | "Building" | "BAS"; label: string }[] = [
  { key: "Building", label: "Building" },
  { key: "Walk-In", label: "Walk-Ins" },
  { key: "Thermostat", label: "Thermostats" },
  { key: "Water-Source", label: "Water-source" },
  { key: "BAS", label: "BAS" },
];

export function AuditForm({ job, audit: initialAudit, initialItems }: Props) {
  const [audit, setAudit] = useState(initialAudit);
  const [items, setItems] = useState(initialItems);
  const [busyMarkComplete, setBusyMarkComplete] = useState(false);
  const [basNotes, setBasNotes] = useState(audit.basNotes);
  const [notes, setNotes] = useState(audit.notes);

  // Upload helpers — every audit photo goes through /api/upload with
  // kind=audit-building or kind=audit-item. On direct success the
  // Drive URL is spliced into local state so the slot re-renders with
  // the cloud copy. On a network/server failure the photo is queued in
  // IndexedDB and retried in the background instead of being lost —
  // the slot keeps its local preview meanwhile.
  async function uploadBuilding(slot: "front" | "fire-plan" | "bas", file: File) {
    const { url } = await uploadAuditPhotoWithFallback({
      file,
      jobId: job.jobId,
      auditId: audit.auditId,
      kind: "audit-building",
      slot,
    });
    if (!url) return; // queued — the background worker will deliver it
    setAudit((prev) => ({
      ...prev,
      ...(slot === "front" && { frontPhotoUrl: url }),
      ...(slot === "fire-plan" && { firePlanPhotoUrl: url }),
      ...(slot === "bas" && { basPhotoUrl: url }),
    }));
  }

  async function patchAuditField(field: "basNotes" | "notes", value: string) {
    const res = await fetch(`/api/audits/${encodeURIComponent(audit.auditId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? "Patch failed");
    }
  }

  async function markComplete() {
    setBusyMarkComplete(true);
    try {
      const res = await fetch(
        `/api/audits/${encodeURIComponent(audit.auditId)}/complete`,
        { method: "POST" }
      );
      if (!res.ok) throw new Error("Could not mark complete");
      setAudit((prev) => ({
        ...prev,
        status: "Complete",
        completedAt: new Date().toISOString(),
      }));
    } finally {
      setBusyMarkComplete(false);
    }
  }

  async function reopen() {
    setBusyMarkComplete(true);
    try {
      const res = await fetch(
        `/api/audits/${encodeURIComponent(audit.auditId)}/reopen`,
        { method: "POST" }
      );
      if (!res.ok) throw new Error("Could not reopen");
      setAudit((prev) => ({
        ...prev,
        status: "Draft",
        completedAt: "",
        completedBy: "",
      }));
    } finally {
      setBusyMarkComplete(false);
    }
  }

  // Checklist tick logic — Building: front photo present? Sections
  // with items: at least one active item? BAS: optional, always green.
  const tickedSections = new Set<typeof SECTIONS[number]["key"]>();
  if (audit.frontPhotoUrl) tickedSections.add("Building");
  const activeItems = items.filter((i) => i.status === "Active");
  for (const t of ["Walk-In", "Thermostat", "Water-Source"] as const) {
    if (activeItems.some((i) => i.itemType === t)) tickedSections.add(t);
  }
  // BAS is always optional — tick when either photo or notes present.
  if (audit.basPhotoUrl || audit.basNotes) tickedSections.add("BAS");

  return (
    <div className="space-y-6 pb-24">
      <div className="flex items-center gap-2">
        <Link
          href={`/jobs/${encodeURIComponent(job.jobId)}`}
          className="p-2 -ml-2 text-mse-muted hover:text-mse-navy"
          aria-label="Back to job"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-mse-muted">Energy audit</div>
          <h1 className="text-2xl font-bold text-mse-navy truncate">
            {job.customerName}
          </h1>
        </div>
        <span
          className={cn(
            "px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
            audit.status === "Complete"
              ? "bg-emerald-500 text-white"
              : "bg-mse-gold text-mse-navy"
          )}
        >
          {audit.status}
        </span>
      </div>

      {/* Sticky checklist header */}
      <div className="sticky top-0 z-10 -mx-4 px-4 py-2 bg-white/95 backdrop-blur border-b border-mse-light">
        <div className="flex gap-1.5 overflow-x-auto">
          {SECTIONS.map((s) => (
            <a
              key={s.key}
              href={`#section-${s.key.toLowerCase()}`}
              className={cn(
                "px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider whitespace-nowrap",
                tickedSections.has(s.key)
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-mse-light text-mse-muted"
              )}
            >
              {tickedSections.has(s.key) ? "✓ " : "○ "}
              {s.label}
            </a>
          ))}
        </div>
      </div>

      {/* ─── Building ─── */}
      <section id="section-building" className="space-y-4">
        <h2 className="text-sm font-bold text-mse-navy uppercase tracking-wider">
          Building
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <AuditPhotoSlot
            label="Front of building"
            hint="Wide shot for context"
            required
            existingUrl={audit.frontPhotoUrl}
            onPick={(f) => uploadBuilding("front", f)}
          />
          <AuditPhotoSlot
            label="Fire escape / M1 plan"
            hint="Optional"
            existingUrl={audit.firePlanPhotoUrl}
            onPick={(f) => uploadBuilding("fire-plan", f)}
          />
        </div>
      </section>

      {/* ─── Walk-Ins ─── */}
      <AuditItemSection
        anchorId="section-walk-in"
        title="Walk-Ins"
        itemType="Walk-In"
        audit={audit}
        job={job}
        items={items}
        onItemsChange={setItems}
      />

      {/* ─── Thermostats ─── */}
      <AuditItemSection
        anchorId="section-thermostat"
        title="Thermostats"
        itemType="Thermostat"
        audit={audit}
        job={job}
        items={items}
        onItemsChange={setItems}
      />

      {/* ─── Water-Source ─── */}
      <AuditItemSection
        anchorId="section-water-source"
        title="Water-source"
        itemType="Water-Source"
        audit={audit}
        job={job}
        items={items}
        onItemsChange={setItems}
      />

      {/* ─── BAS ─── */}
      <section id="section-bas" className="space-y-4">
        <h2 className="text-sm font-bold text-mse-navy uppercase tracking-wider">
          BAS
        </h2>
        <p className="text-xs text-mse-muted">
          Usually Xavier handles BAS — capture the panel if visible.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <AuditPhotoSlot
            label="BAS system"
            hint="Optional"
            existingUrl={audit.basPhotoUrl}
            onPick={(f) => uploadBuilding("bas", f)}
          />
          <div className="space-y-1">
            <div className="text-[11px] uppercase tracking-wider font-bold text-mse-muted">
              BAS notes
            </div>
            <textarea
              value={basNotes}
              onChange={(e) => setBasNotes(e.target.value)}
              onBlur={() => patchAuditField("basNotes", basNotes)}
              rows={4}
              placeholder="Any notes for Xavier"
              className="w-full px-3 py-2 rounded-lg border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy resize-none"
            />
          </div>
        </div>
      </section>

      {/* ─── Audit notes ─── */}
      <section className="space-y-2">
        <div className="text-[11px] uppercase tracking-wider font-bold text-mse-muted">
          Overall audit notes
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => patchAuditField("notes", notes)}
          rows={4}
          placeholder="Anything worth flagging on the building"
          className="w-full px-3 py-2 rounded-lg border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy resize-none"
        />
      </section>

      {/* ─── Footer action ─── */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-mse-light p-4 safe-bottom z-10">
        <div className="max-w-2xl mx-auto">
          {audit.status === "Complete" ? (
            <button
              type="button"
              onClick={reopen}
              disabled={busyMarkComplete}
              className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-2xl font-bold bg-mse-gold/20 text-mse-navy border border-mse-gold hover:bg-mse-gold/30"
            >
              {busyMarkComplete && <Loader2 className="w-4 h-4 animate-spin" />}
              Audit complete · Reopen
            </button>
          ) : (
            <button
              type="button"
              onClick={markComplete}
              disabled={busyMarkComplete}
              className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-2xl font-bold bg-mse-gold text-mse-navy hover:bg-mse-gold/90 active:scale-[0.98]"
            >
              {busyMarkComplete ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
              Mark audit complete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
