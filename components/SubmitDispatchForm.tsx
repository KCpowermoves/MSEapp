"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Pencil } from "lucide-react";
import { CrewPicker } from "@/components/CrewPicker";
import { useTodaysCrew } from "@/hooks/useTodaysCrew";
import { captureLocationEvent } from "@/lib/location";
import { INSTALL_PAY, SERVICE_PAY, crewSize } from "@/lib/pay-rates";
import { cn, formatCurrency } from "@/lib/utils";
import type {
  AdditionalService,
  CrewSplit,
  Job,
  UnitServiced,
} from "@/lib/types";

interface Props {
  job: Job;
  dispatchId: string;
  /** Crew already chosen at job creation (or via earlier "edit crew"
   *  on this page). Pre-fills the form so the tech doesn't re-pick. */
  initialCrew: string[];
  initialSplit: CrewSplit;
  units: UnitServiced[];
  services: AdditionalService[];
  activeTechs: string[];
  currentUserName: string;
}

export function SubmitDispatchForm({
  job,
  dispatchId,
  initialCrew,
  initialSplit,
  units,
  services,
  activeTechs,
  currentUserName,
}: Props) {
  const router = useRouter();
  // Today's crew is now seeded at job creation; useTodaysCrew is the
  // localStorage cache that keeps it warm across reloads. If the
  // tech updates the crew here, we sync both the local cache and the
  // server-side dispatch row.
  const { crew, setCrew } = useTodaysCrew(
    job.jobId,
    currentUserName,
    initialCrew
  );
  const [crewSplit, setCrewSplit] = useState<CrewSplit>(initialSplit);
  // Crew was already chosen at job creation — show as read-only text
  // unless the tech taps Edit. Auto-expands to picker mode when the
  // initial crew is empty (e.g. older jobs created before this change).
  const [editingCrew, setEditingCrew] = useState(initialCrew.length === 0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-select split based on crew size when editing
  useEffect(() => {
    if (!editingCrew) return;
    if (crew.length === 1) setCrewSplit("Solo");
    else if (crew.length === 2) setCrewSplit("50-50");
    else if (crew.length >= 3) setCrewSplit("33-33-33");
  }, [crew.length, editingCrew]);

  // Pay preview hidden 2026-05-05 per Kevin — totals stay computed
  // so we can re-enable the panel without rebuilding the math.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const totals = useMemo(
    () => computePayPreview({ job, units, services, crewSplit, crew }),
    [job, units, services, crewSplit, crew]
  );

  const SIMPLE_TYPES = ["PTAC / Ductless"];
  const allPhotosUploaded = units.every((u) => {
    if (SIMPLE_TYPES.includes(u.unitType))
      return Boolean(u.pre1Url && u.pre2Url && u.nameplateUrl);
    if (u.unitType === "Split System")
      return Boolean(
        u.pre1Url && u.pre2Url && u.pre3Url &&
        u.post1Url && u.post2Url && u.post3Url &&
        u.nameplateUrl && u.filterUrl &&
        u.inPreUrl && u.inPostUrl && u.inNameplateUrl
      );
    // RTU types
    return Boolean(
      u.pre1Url && u.pre2Url && u.post1Url && u.post2Url &&
      u.nameplateUrl && u.filterUrl && u.pre3Url
    );
  });

  // Split is auto-derived from crew size now (the picker is hidden)
  // so crew length always matches the split — no need to gate
  // submission on it.
  const canSubmit = crew.length > 0 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/dispatches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dispatchId,
          techsOnSite: crew,
          crewSplit,
          driver: "",
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not submit");
      }

      // Dispatch is finalized server-side here (submittedAt + pay
      // attributions). The customer signature, email, and rating are
      // captured on the next two screens. PDF render is fired from the
      // server but stays idempotent — final upload may happen during
      // the customer steps. No matter who wins the race, the PDF only
      // generates once.

      captureLocationEvent(
        "dispatch-submit",
        { jobId: job.jobId },
        { force: true }
      ).catch(() => {});
      // Hand off to the customer confirmation step (signature + email).
      router.replace(
        `/jobs/${encodeURIComponent(job.jobId)}/submit/confirm`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit");
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 pb-24">
      <div className="flex items-center gap-2">
        <Link
          href={`/jobs/${encodeURIComponent(job.jobId)}`}
          className="p-2 -ml-2 text-mse-muted hover:text-mse-navy"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-2xl font-bold text-mse-navy">Submit</h1>
      </div>

      <section className="bg-mse-light/60 rounded-2xl p-4">
        <div className="text-xs text-mse-muted uppercase tracking-wide font-semibold">
          Step 1 of 3
        </div>
        <div className="font-bold text-mse-navy mt-0.5">{job.customerName}</div>
        <div className="text-sm text-mse-muted">{job.siteAddress}</div>
        <div className="text-xs text-mse-muted mt-2">
          {units.length} unit{units.length === 1 ? "" : "s"} ·{" "}
          {services.length} service{services.length === 1 ? "" : "s"} ·{" "}
          {job.utilityTerritory}
        </div>
        {!allPhotosUploaded && units.length > 0 && (
          <div className="mt-3 text-xs text-mse-navy bg-mse-gold/15 border border-mse-gold/30 rounded-lg px-3 py-2">
            Some photos haven&apos;t finished uploading yet. You can still
            submit — they&apos;ll keep uploading in the background. Photos
            Complete will flip to TRUE when they all land.
          </div>
        )}
      </section>

      {/* Crew — set at job creation. Show as read-only text with an
          inline Edit affordance unless we're already editing (e.g.
          older job that didn't capture crew at creation). Pay-split
          picker hidden 2026-05-05 per Kevin; split is auto-derived
          from crew size in the underlying state and the pay-preview
          card is hidden too. */}
      {!editingCrew ? (
        <section className="rounded-2xl border border-mse-light bg-white p-4 shadow-card">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-xs text-mse-muted uppercase tracking-wide font-semibold">
                Crew on site
              </div>
              <div className="font-semibold text-mse-navy mt-0.5">
                {crew.length === 0 ? "—" : crew.join(", ")}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setEditingCrew(true)}
              className="text-xs font-semibold text-mse-navy hover:underline inline-flex items-center gap-1"
            >
              <Pencil className="w-3.5 h-3.5" />
              Edit
            </button>
          </div>
        </section>
      ) : (
        <>
          <Field label="Crew on site" required>
            {activeTechs.length === 0 ? (
              <div className="text-sm text-mse-muted">
                No active techs in the system. Add some via the Sheet.
              </div>
            ) : (
              <>
                <div className="text-xs text-mse-muted mb-2">
                  Pick everyone who was on site today.
                </div>
                <CrewPicker
                  multi
                  options={activeTechs}
                  value={crew}
                  onChange={setCrew}
                />
              </>
            )}
          </Field>

          {initialCrew.length > 0 && (
            <button
              type="button"
              onClick={() => setEditingCrew(false)}
              className="text-xs text-mse-muted hover:text-mse-navy underline-offset-2 hover:underline"
            >
              Done editing
            </button>
          )}
        </>
      )}

      {/* Pay preview hidden 2026-05-05 per Kevin. Logic preserved
          (totals, computePayPreview) so the panel can come back
          without rebuilding. */}
      {false && (
      <section className="bg-white rounded-2xl border border-mse-light p-4 space-y-3 shadow-card">
        <div className="font-bold text-mse-navy">Pay preview</div>
        <ul className="space-y-2 text-sm">
          {totals.lines.map((line, i) => (
            <li key={i} className="flex items-center justify-between">
              <span className="text-mse-text">
                <span className="font-semibold">{line.tech}</span>{" "}
                <span className="text-mse-muted">· {line.label}</span>
              </span>
              <span className="font-mono">{formatCurrency(line.amount)}</span>
            </li>
          ))}
          {totals.lines.length === 0 && (
            <li className="text-mse-muted text-center py-2">
              No pay yet — pick a crew and add a unit or service.
            </li>
          )}
        </ul>
        {totals.byTech.length > 0 && (
          <div className="border-t border-mse-light pt-3 space-y-1.5">
            {totals.byTech.map((t) => (
              <div
                key={t.tech}
                className="flex items-center justify-between text-sm"
              >
                <span className="font-bold text-mse-navy">{t.tech}</span>
                <span className="font-mono font-bold">
                  {formatCurrency(t.total)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
      )}

      {error && (
        <div className="text-mse-red text-sm bg-mse-red/5 border border-mse-red/20 rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-mse-light p-4 safe-bottom z-10">
        <div className="max-w-2xl mx-auto">
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className={cn(
              "w-full font-bold rounded-2xl py-4 text-center transition-[background-color,transform]",
              canSubmit
                ? "bg-mse-red hover:bg-mse-red-hover active:scale-[0.98] text-white shadow-card"
                : "bg-mse-light text-mse-muted cursor-not-allowed"
            )}
          >
            {submitting ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin" />
                Submitting...
              </span>
            ) : (
              "Submit and hand to customer"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  required,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <div>
      <div className="text-sm font-semibold text-mse-navy mb-2">
        {label}
        {required && <span className="text-mse-red ml-1">*</span>}
      </div>
      {children}
    </div>
  );
}

interface PayLine {
  tech: string;
  label: string;
  amount: number;
}
interface PayTotal {
  tech: string;
  total: number;
}

function computePayPreview(opts: {
  job: Job;
  units: UnitServiced[];
  services: AdditionalService[];
  crewSplit: CrewSplit;
  crew: string[];
}): { lines: PayLine[]; byTech: PayTotal[] } {
  const { units, services, crewSplit, crew } = opts;
  const lines: PayLine[] = [];
  if (crew.length === 0) return { lines, byTech: [] };
  const cSize = crewSize(crewSplit);

  for (const u of units) {
    const totalInstall = INSTALL_PAY[u.unitType];
    const perTech = totalInstall / cSize;
    for (const t of crew) {
      lines.push({
        tech: t,
        label: `Install · Unit ${String(u.unitNumberOnJob).padStart(3, "0")} ${u.unitType}`,
        amount: perTech,
      });
    }
    // Self-sold sales bonus removed from pay preview 2026-05-05 —
    // self-sold concept retired in the new-job flow.
  }

  for (const s of services) {
    const rate = SERVICE_PAY[s.serviceType] ?? 0;
    if (rate > 0 && s.quantity > 0) {
      lines.push({
        tech: s.loggedBy,
        label: `${s.serviceType} · qty ${s.quantity}`,
        amount: rate * s.quantity,
      });
    }
  }

  const totals = new Map<string, number>();
  for (const line of lines) {
    totals.set(line.tech, (totals.get(line.tech) ?? 0) + line.amount);
  }
  const byTech = Array.from(totals.entries()).map(([tech, total]) => ({
    tech,
    total,
  }));

  return { lines, byTech };
}
