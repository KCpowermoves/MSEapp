"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Eraser, Loader2, PenLine } from "lucide-react";
import SignatureCanvas from "react-signature-canvas";
import { CrewPicker } from "@/components/CrewPicker";
import { useTodaysCrew } from "@/hooks/useTodaysCrew";
import { captureLocationEvent } from "@/lib/location";
import {
  INSTALL_PAY,
  SALES_BONUS,
  SERVICE_PAY,
  crewSize,
} from "@/lib/pay-rates";
import { cn, formatCurrency } from "@/lib/utils";
import type {
  AdditionalService,
  CrewSplit,
  Job,
  UnitServiced,
} from "@/lib/types";

const SPLITS: { id: CrewSplit; label: string; sub: string }[] = [
  { id: "Solo", label: "Solo", sub: "1 tech" },
  { id: "50-50", label: "50 / 50", sub: "2 techs" },
  { id: "33-33-33", label: "Three-way", sub: "3 techs" },
];

interface Props {
  job: Job;
  dispatchId: string;
  units: UnitServiced[];
  services: AdditionalService[];
  activeTechs: string[];
  currentUserName: string;
}

export function SubmitDispatchForm({
  job,
  dispatchId,
  units,
  services,
  activeTechs,
  currentUserName,
}: Props) {
  const router = useRouter();
  const { crew, setCrew, hydrated } = useTodaysCrew(
    job.jobId,
    currentUserName
  );
  const [crewSplit, setCrewSplit] = useState<CrewSplit>("Solo");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Customer signature pad (optional — captured when present, ignored when blank)
  const sigRef = useRef<SignatureCanvas | null>(null);
  const [signedByName, setSignedByName] = useState(job.customerName);
  const [hasSignature, setHasSignature] = useState(false);
  const onSignatureChange = () => {
    if (sigRef.current) setHasSignature(!sigRef.current.isEmpty());
  };
  const clearSignature = () => {
    sigRef.current?.clear();
    setHasSignature(false);
  };

  // Auto-select split based on crew size
  useEffect(() => {
    if (!hydrated) return;
    if (crew.length === 1) setCrewSplit("Solo");
    else if (crew.length === 2) setCrewSplit("50-50");
    else if (crew.length >= 3) setCrewSplit("33-33-33");
  }, [crew.length, hydrated]);

  const cSize = crewSize(crewSplit);
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

  const crewSizeMatches = crew.length === cSize;
  const canSubmit = crew.length > 0 && crewSizeMatches && !submitting;

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

      // If the customer signed, upload the signature PNG to Drive +
      // stamp the URL on the dispatch row. Best-effort — if the
      // signature upload fails, the dispatch is still submitted.
      if (sigRef.current && !sigRef.current.isEmpty()) {
        try {
          const dataUrl = sigRef.current.toDataURL("image/png");
          const blob = await (await fetch(dataUrl)).blob();
          const formData = new FormData();
          formData.append("file", blob, "signature.png");
          formData.append("jobId", job.jobId);
          formData.append("dispatchId", dispatchId);
          formData.append("kind", "signature");
          formData.append("signedByName", signedByName.trim());
          await fetch("/api/upload", { method: "POST", body: formData });
        } catch (sigErr) {
          console.warn("[submit] signature upload failed:", sigErr);
        }
      }

      // Trigger server-side PDF report generation. Fire-and-forget;
      // user is redirected immediately. PDF lands in the job's Drive
      // folder a few seconds later.
      fetch("/api/dispatches/render-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dispatchId }),
        keepalive: true,
      }).catch(() => {});

      captureLocationEvent(
        "dispatch-submit",
        { jobId: job.jobId },
        { force: true }
      ).catch(() => {});
      router.replace("/jobs?submitted=1");
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
        <h1 className="text-2xl font-bold text-mse-navy">Submit job</h1>
      </div>

      <section className="bg-mse-light/60 rounded-2xl p-4">
        <div className="font-bold text-mse-navy">{job.customerName}</div>
        <div className="text-sm text-mse-muted">{job.siteAddress}</div>
        <div className="text-xs text-mse-muted mt-2">
          {units.length} unit{units.length === 1 ? "" : "s"} ·{" "}
          {services.length} service{services.length === 1 ? "" : "s"} ·{" "}
          {job.utilityTerritory}
          {job.selfSold && job.soldBy ? ` · self-sold by ${job.soldBy}` : ""}
        </div>
        {!allPhotosUploaded && units.length > 0 && (
          <div className="mt-3 text-xs text-mse-navy bg-mse-gold/15 border border-mse-gold/30 rounded-lg px-3 py-2">
            Some photos haven&apos;t finished uploading yet. You can still
            submit — they&apos;ll keep uploading in the background. Photos
            Complete will flip to TRUE when they all land.
          </div>
        )}
      </section>

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

      <Field label="Pay split" required>
        <div className="grid grid-cols-3 gap-2">
          {SPLITS.map((s) => {
            const active = crewSplit === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setCrewSplit(s.id)}
                className={cn(
                  "rounded-2xl p-3 transition-[background-color,border-color,transform]",
                  "active:scale-95",
                  active
                    ? "border-2 border-mse-navy bg-mse-navy text-white"
                    : "border-2 border-mse-light bg-white text-mse-navy"
                )}
              >
                <div className="font-bold text-sm">{s.label}</div>
                <div
                  className={cn(
                    "text-xs mt-0.5",
                    active ? "text-white/70" : "text-mse-muted"
                  )}
                >
                  {s.sub}
                </div>
              </button>
            );
          })}
        </div>
        {!crewSizeMatches && crew.length > 0 && (
          <div className="text-xs text-mse-red mt-2">
            {cSize} tech{cSize === 1 ? "" : "s"} expected for this split, but
            crew has {crew.length}.
          </div>
        )}
      </Field>

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

      <Field label="Customer signature">
        <div className="text-xs text-mse-muted mb-2">
          Optional. Have the customer sign on the device to confirm the work
          was completed. Skipping is fine if no one&apos;s on site.
        </div>
        <div className="space-y-2">
          <div className="rounded-2xl border-2 border-dashed border-mse-light bg-white relative overflow-hidden touch-none">
            <SignatureCanvas
              ref={sigRef}
              onEnd={onSignatureChange}
              penColor="#1A2332"
              canvasProps={{
                className: "w-full h-44 block",
              }}
              backgroundColor="rgba(255,255,255,0)"
            />
            {!hasSignature && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-mse-muted text-sm">
                <PenLine className="w-4 h-4 mr-1.5" />
                Sign here
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={signedByName}
              onChange={(e) => setSignedByName(e.target.value)}
              placeholder="Print name"
              className="flex-1 px-3 py-2 rounded-xl border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy"
            />
            <button
              type="button"
              onClick={clearSignature}
              disabled={!hasSignature}
              className={cn(
                "px-3 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1",
                "border border-mse-light text-mse-muted hover:text-mse-navy hover:border-mse-navy/40",
                !hasSignature && "opacity-50 cursor-not-allowed"
              )}
            >
              <Eraser className="w-3.5 h-3.5" />
              Clear
            </button>
          </div>
        </div>
      </Field>

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
              "Submit"
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
  const { job, units, services, crewSplit, crew } = opts;
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
    if (job.selfSold && job.soldBy) {
      const fullBonus = SALES_BONUS[u.unitType];
      lines.push({
        tech: job.soldBy,
        label: `Sales bonus (paid) · ${u.unitType}`,
        amount: fullBonus * 0.5,
      });
      lines.push({
        tech: job.soldBy,
        label: `Sales bonus (pending) · ${u.unitType}`,
        amount: fullBonus * 0.5,
      });
    }
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
