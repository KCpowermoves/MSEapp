"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Eraser, Loader2, PenLine } from "lucide-react";
import SignatureCanvas from "react-signature-canvas";
import { cn } from "@/lib/utils";
import type { Job } from "@/lib/types";

/**
 * Step 1 of the submit flow — customer confirmation. The tech hands the
 * device to the customer (or property manager), who signs and prints
 * their name. Both fields are optional — the tech can tap "Continue
 * without signature" to skip.
 *
 * On Continue, if the pad has ink, we upload the signature PNG to the
 * job's Drive folder and stamp the URL on the dispatch row before
 * navigating to the pay-calc step.
 */
export function CustomerConfirmForm({
  job,
  dispatchId,
}: {
  job: Job;
  dispatchId: string;
}) {
  const router = useRouter();
  const sigRef = useRef<SignatureCanvas | null>(null);
  const [signedByName, setSignedByName] = useState(job.customerName);
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

  const goToPayCalc = () => {
    router.replace(`/jobs/${encodeURIComponent(job.jobId)}/submit`);
  };

  const continueWithSignature = async () => {
    if (submitting) return;
    if (!sigRef.current || sigRef.current.isEmpty()) {
      goToPayCalc();
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const dataUrl = sigRef.current.toDataURL("image/png");
      const blob = await (await fetch(dataUrl)).blob();
      const formData = new FormData();
      formData.append("file", blob, "signature.png");
      formData.append("jobId", job.jobId);
      formData.append("dispatchId", dispatchId);
      formData.append("kind", "signature");
      formData.append("signedByName", signedByName.trim());
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        // Don't block on a signature-upload failure — proceed to pay calc
        // and the tech can still finalize the dispatch. Log for diagnosis.
        const data = await res.json().catch(() => ({}));
        console.warn("[confirm] signature upload failed:", data);
      }
      goToPayCalc();
    } catch (e) {
      console.warn("[confirm] signature error:", e);
      setError(
        "Could not save the signature. Continuing to pay step — you can submit anyway."
      );
      // Brief pause so the tech sees the message, then push through.
      setTimeout(goToPayCalc, 1500);
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
          Step 1 of 2
        </div>
        <div className="font-bold text-mse-navy mt-0.5">
          {job.customerName}
        </div>
        {job.siteAddress && (
          <div className="text-sm text-mse-muted">{job.siteAddress}</div>
        )}
      </section>

      <div>
        <div className="text-sm font-semibold text-mse-navy mb-2">
          Have the customer sign
        </div>
        <div className="text-xs text-mse-muted mb-3">
          Hand the device to the customer (or property manager). Optional —
          if no one&apos;s available to sign, skip below.
        </div>

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

      {error && (
        <div className="text-mse-red text-sm bg-mse-red/5 border border-mse-red/20 rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-mse-light p-4 safe-bottom z-10">
        <div className="max-w-2xl mx-auto space-y-2">
          <button
            type="button"
            onClick={continueWithSignature}
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
                Saving signature…
              </span>
            ) : hasSignature ? (
              <span className="inline-flex items-center gap-2">
                Continue to pay <ArrowRight className="w-4 h-4" />
              </span>
            ) : (
              <span className="inline-flex items-center gap-2">
                Continue without signature{" "}
                <ArrowRight className="w-4 h-4" />
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
