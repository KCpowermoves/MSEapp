"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  ClipboardList,
  Eraser,
  Loader2,
  PenLine,
} from "lucide-react";
import SignatureCanvas from "react-signature-canvas";
import { cn } from "@/lib/utils";
import type { Job } from "@/lib/types";

interface PreviewUnit {
  unitNumberOnJob: number;
  unitType: string;
  label: string;
  make: string;
  model: string;
}

interface ReportPreview {
  dispatchDate: string;
  techsOnSite: string[];
  unitsServiced: PreviewUnit[];
}

/**
 * Step 2 of the submit flow — customer confirmation. By the time we get
 * here, the tech has already entered crew + pay info on /submit and the
 * dispatch is finalized server-side. The customer signs and (optionally)
 * provides an email so we can send the auto-generated PDF report.
 *
 * Tech can hit "Skip" if no one's available to sign or the customer
 * doesn't want to give an email — we still proceed to the feedback
 * screen and the dispatch stays submitted.
 */
export function CustomerConfirmForm({
  job,
  dispatchId,
  defaultEmail,
  preview,
}: {
  job: Job;
  dispatchId: string;
  defaultEmail: string;
  preview: ReportPreview;
}) {
  const router = useRouter();
  const sigRef = useRef<SignatureCanvas | null>(null);
  const [signedByName, setSignedByName] = useState(job.customerName);
  const [customerEmail, setCustomerEmail] = useState(defaultEmail);
  const [hasSignature, setHasSignature] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSignatureChange = () => {
    if (sigRef.current) setHasSignature(!sigRef.current.isEmpty());
  };
  const clearSignature = () => {
    sigRef.current?.clear();
    setHasSignature(false);
  };

  const goToFeedback = () => {
    router.replace(`/jobs/${encodeURIComponent(job.jobId)}/submit/feedback`);
  };

  const onContinue = async () => {
    if (submitting) return;
    const email = customerEmail.trim();
    const hasInk = sigRef.current && !sigRef.current.isEmpty();

    // Nothing to upload — skip straight to feedback.
    if (!hasInk && !email) {
      goToFeedback();
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("jobId", job.jobId);
      formData.append("dispatchId", dispatchId);
      formData.append("kind", "signature");
      formData.append("signedByName", signedByName.trim());
      if (email) formData.append("customerEmail", email);
      if (hasInk) {
        const dataUrl = sigRef.current!.toDataURL("image/png");
        const blob = await (await fetch(dataUrl)).blob();
        formData.append("file", blob, "signature.png");
      } else {
        // /api/upload requires a file. Send a 1-pixel transparent PNG
        // when only the email needs to land — we'll still get the email
        // saved, but won't pollute the Drive folder with a blank sig.
        // Easier: hit a separate path that takes only email. Skip the
        // /api/upload route in this case and PUT to a thin endpoint.
        const res = await fetch("/api/dispatches/email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dispatchId, customerEmail: email }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          console.warn("[confirm] email-only save failed:", data);
        }
        goToFeedback();
        return;
      }

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        // Don't block on a signature-upload failure. The pay/dispatch
        // is already finalized; the tech can still complete the flow.
        const data = await res.json().catch(() => ({}));
        console.warn("[confirm] signature upload failed:", data);
      }
      goToFeedback();
    } catch (e) {
      console.warn("[confirm] error:", e);
      setError(
        "Could not save signature. Continuing — the dispatch is already submitted."
      );
      setTimeout(goToFeedback, 1500);
    }
  };

  return (
    <div className="space-y-6 pb-24">
      <div className="flex items-center gap-2">
        <a
          href={`/jobs/${encodeURIComponent(job.jobId)}`}
          className="p-2 -ml-2 text-mse-muted hover:text-mse-navy"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5" />
        </a>
        <h1 className="text-2xl font-bold text-mse-navy">
          Customer confirmation
        </h1>
      </div>

      <section className="bg-mse-light/60 rounded-2xl p-4">
        <div className="text-xs text-mse-muted uppercase tracking-wide font-semibold">
          Step 2 of 3
        </div>
        <div className="font-bold text-mse-navy mt-0.5">
          {job.customerName}
        </div>
        {job.siteAddress && (
          <div className="text-sm text-mse-muted">{job.siteAddress}</div>
        )}
      </section>

      <section className="rounded-2xl border-2 border-mse-navy/15 bg-white p-4">
        <div className="font-bold text-mse-navy text-base">
          Please confirm our technician was here and completed the work.
        </div>
        <div className="text-sm text-mse-muted mt-1.5">
          Sign below to confirm. Optional — skip if no one&apos;s available.
        </div>
      </section>

      <ReportSummary preview={preview} job={job} />

      <div>
        <div className="rounded-2xl border-2 border-dashed border-mse-light bg-white relative overflow-hidden touch-none">
          <SignatureCanvas
            ref={sigRef}
            onEnd={onSignatureChange}
            penColor="#1A2332"
            canvasProps={{ className: "w-full h-56 block" }}
            backgroundColor="rgba(255,255,255,0)"
          />
          {!hasSignature && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-mse-muted text-sm">
              <PenLine className="w-4 h-4 mr-1.5" />
              Sign here
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 mt-3">
          <input
            type="text"
            value={signedByName}
            onChange={(e) => setSignedByName(e.target.value)}
            placeholder="Print name"
            className="flex-1 px-4 py-3 rounded-xl border border-mse-light bg-white text-base focus:outline-none focus:border-mse-navy"
          />
          <button
            type="button"
            onClick={clearSignature}
            disabled={!hasSignature}
            className={cn(
              "px-3 py-3 rounded-xl text-xs font-semibold inline-flex items-center gap-1 shrink-0",
              "border border-mse-light text-mse-muted hover:text-mse-navy hover:border-mse-navy/40",
              !hasSignature && "opacity-50 cursor-not-allowed"
            )}
          >
            <Eraser className="w-3.5 h-3.5" />
            Clear
          </button>
        </div>
      </div>

      <div>
        <label className="block text-sm font-semibold text-mse-navy mb-1.5">
          Where should we send your service report?
        </label>
        <div className="text-xs text-mse-muted mb-2">
          We&apos;ll email a copy of the photos and work summary once it&apos;s ready.
        </div>
        <input
          type="email"
          inputMode="email"
          autoCapitalize="off"
          autoCorrect="off"
          value={customerEmail}
          onChange={(e) => setCustomerEmail(e.target.value)}
          placeholder="customer@example.com"
          className="w-full px-4 py-3 rounded-xl border border-mse-light bg-white text-base focus:outline-none focus:border-mse-navy"
        />
      </div>

      {error && (
        <div className="text-mse-red text-sm bg-mse-red/5 border border-mse-red/20 rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-mse-light p-4 safe-bottom z-10">
        <div className="max-w-2xl mx-auto space-y-2">
          <button
            type="button"
            onClick={onContinue}
            disabled={submitting}
            className={cn(
              "w-full font-bold rounded-2xl py-4 text-center transition-[background-color,transform]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mse-red focus-visible:ring-offset-2",
              !submitting
                ? "bg-mse-red hover:bg-mse-red-hover active:scale-[0.98] text-white shadow-card"
                : "bg-mse-light text-mse-muted cursor-not-allowed"
            )}
          >
            {submitting ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin" />
                Saving…
              </span>
            ) : (
              <span className="inline-flex items-center gap-2">
                Continue <ArrowRight className="w-4 h-4" />
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function ReportSummary({
  preview,
  job,
}: {
  preview: ReportPreview;
  job: Job;
}) {
  const techList =
    preview.techsOnSite.length === 0
      ? "—"
      : preview.techsOnSite.length === 1
      ? preview.techsOnSite[0]
      : preview.techsOnSite.slice(0, -1).join(", ") +
        " and " +
        preview.techsOnSite[preview.techsOnSite.length - 1];

  return (
    <section className="rounded-2xl border border-mse-light bg-white shadow-card overflow-hidden">
      <div className="px-4 py-3 border-b border-mse-light bg-mse-light/40 flex items-center gap-2">
        <ClipboardList className="w-4 h-4 text-mse-navy" />
        <div className="text-xs uppercase tracking-wide font-semibold text-mse-navy">
          What you&apos;re confirming
        </div>
      </div>
      <dl className="divide-y divide-mse-light text-sm">
        <Row label="Date" value={preview.dispatchDate} />
        <Row label="Site" value={job.siteAddress || "—"} />
        <Row label="Technician" value={techList} />
        <Row
          label="Units serviced"
          value={
            preview.unitsServiced.length === 0
              ? "—"
              : `${preview.unitsServiced.length} unit${
                  preview.unitsServiced.length === 1 ? "" : "s"
                }`
          }
        />
      </dl>
      {preview.unitsServiced.length > 0 && (
        <ul className="divide-y divide-mse-light bg-white">
          {preview.unitsServiced.map((u) => {
            const display = u.label?.trim()
              ? u.label
              : `Unit ${String(u.unitNumberOnJob).padStart(3, "0")}`;
            const detail = [u.unitType, u.make, u.model]
              .filter(Boolean)
              .join(" · ");
            return (
              <li
                key={u.unitNumberOnJob}
                className="px-4 py-2.5 text-sm flex items-start justify-between gap-3"
              >
                <span className="font-semibold text-mse-navy truncate">
                  {display}
                </span>
                <span className="text-mse-muted text-xs text-right shrink-0">
                  {detail}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <div className="px-4 py-2.5 text-[11px] text-mse-muted bg-mse-light/30 border-t border-mse-light">
        We&apos;ll email you the full report (with all the photos and a
        work summary) right after you finish.
      </div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-2.5 flex items-center justify-between gap-3">
      <dt className="text-mse-muted text-xs uppercase tracking-wide font-semibold">
        {label}
      </dt>
      <dd className="text-mse-navy font-semibold text-right truncate">
        {value}
      </dd>
    </div>
  );
}
