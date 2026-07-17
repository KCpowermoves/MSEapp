"use client";

import { useRef, useState } from "react";
import SignatureCanvas from "react-signature-canvas";
import {
  CheckCircle2,
  Eraser,
  Loader2,
  PenLine,
} from "lucide-react";
import { cn } from "@/lib/utils";

// The interactive half of the public signing page: typed name,
// e-sign consent, signature pad, submit. On success the agreement is
// executed — the server stamps the PDF and creates the job.

export function SignAgreementClient({
  token,
  defaultName,
}: {
  token: string;
  defaultName: string;
}) {
  const sigRef = useRef<SignatureCanvas | null>(null);
  const [hasSignature, setHasSignature] = useState(false);
  const [signedName, setSignedName] = useState(defaultName);
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (submitting) return;
    setError(null);
    if (!signedName.trim()) {
      setError("Please type your full name.");
      return;
    }
    if (!consent) {
      setError("Please check the box to agree to sign electronically.");
      return;
    }
    if (!sigRef.current || sigRef.current.isEmpty()) {
      setError("Please sign in the box above.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/sign/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signedName: signedName.trim(),
          consent: true,
          signatureDataUrl: sigRef.current.toDataURL("image/png"),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Server error ${res.status}`);
      setDone(true);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not submit the signature"
      );
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="bg-white rounded-2xl border-2 border-emerald-600/25 shadow-card p-6 text-center space-y-2">
        <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto" />
        <div className="font-bold text-mse-navy text-lg">
          Agreement signed — you&apos;re enrolled!
        </div>
        <p className="text-sm text-mse-muted">
          A copy of the signed agreement is on file. Your agent will reach
          out to schedule your no-cost tune-up visit.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-mse-light shadow-card p-5 space-y-4">
      <div>
        <label className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1 block">
          Your full name
        </label>
        <input
          value={signedName}
          onChange={(e) => setSignedName(e.target.value)}
          placeholder="Type your name"
          className="w-full px-3 py-2.5 rounded-lg border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted">
            Sign here
          </span>
          {hasSignature && (
            <button
              type="button"
              onClick={() => {
                sigRef.current?.clear();
                setHasSignature(false);
              }}
              className="text-xs font-semibold inline-flex items-center gap-1 text-mse-muted hover:text-mse-navy"
            >
              <Eraser className="w-3.5 h-3.5" />
              Clear
            </button>
          )}
        </div>
        <div className="rounded-2xl border-2 border-mse-navy bg-white relative overflow-hidden touch-none shadow-card">
          <SignatureCanvas
            ref={sigRef}
            onEnd={() => setHasSignature(!sigRef.current?.isEmpty())}
            penColor="#1A2332"
            // Defaults to true, which clears the pad on every window
            // resize — including the iOS soft keyboard opening. Same
            // fix as the dispatch sign-off pad.
            clearOnResize={false}
            canvasProps={{ className: "w-full h-56 block" }}
            backgroundColor="rgba(255,255,255,0)"
          />
          {!hasSignature && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-mse-navy/40 text-sm font-medium">
              <PenLine className="w-4 h-4 mr-1.5" />
              Sign with your finger or stylus
            </div>
          )}
        </div>
      </div>

      <label className="flex items-start gap-2.5 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5 w-4 h-4 accent-[#1A2332]"
        />
        <span className="text-xs text-mse-navy leading-relaxed">
          I agree to sign this agreement electronically, and I confirm I am
          authorized to sign on behalf of the business named above.
        </span>
      </label>

      {error && (
        <div className="text-xs text-mse-red bg-mse-red/5 border border-mse-red/20 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={submitting}
        className={cn(
          "w-full inline-flex items-center justify-center gap-2 rounded-xl py-3.5 px-4 font-bold text-sm",
          "transition-[background-color,transform] active:scale-[0.98]",
          submitting
            ? "bg-mse-light text-mse-muted cursor-not-allowed"
            : "bg-mse-navy hover:bg-mse-navy-soft text-white shadow-card"
        )}
      >
        {submitting ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <CheckCircle2 className="w-4 h-4" />
        )}
        {submitting ? "Submitting…" : "Agree and sign"}
      </button>
    </div>
  );
}
