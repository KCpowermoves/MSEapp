"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import {
  ArrowLeft,
  ArrowRight,
  Gift,
  Loader2,
  Smartphone,
  Sparkles,
  Star,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Job } from "@/lib/types";

/**
 * Step 3 of the submit flow — short customer feedback step.
 *
 * Framing: "share your honest feedback — we'll send a thank-you gift
 * either way." This keeps it Google-policy-safe (the gift isn't tied
 * to a 5★ rating, just to completing the survey).
 *
 * 5★ flow:
 *   - Pre-generated review text suggestion (rotates per dispatch so
 *     Google's spam filter doesn't catch identical wording).
 *   - QR code on the tech's screen → customer scans with their own
 *     phone → opens Google Reviews already signed in. Avoids the
 *     awkward "log into Google on someone else's device" moment.
 *
 * 1–4★ flow:
 *   - No on-device text input (customer would sandbag with the tech
 *     standing there). Just confirms we'll follow up by email and
 *     records the rating.
 */
export function CustomerFeedbackForm({
  job,
  dispatchId,
}: {
  job: Job;
  dispatchId: string;
}) {
  const router = useRouter();
  const [rating, setRating] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);
  const [stage, setStage] = useState<"rate" | "lowRating" | "fiveStar">("rate");

  const finishToJobs = () => {
    router.replace("/jobs?submitted=1");
  };

  const saveAndContinue = async (
    nextStage: "lowRating" | "fiveStar",
    chosenRating: number
  ) => {
    setSubmitting(true);
    try {
      await fetch("/api/dispatches/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dispatchId,
          rating: chosenRating,
          feedback: "",
        }),
      });
    } catch (e) {
      console.warn("[feedback] rating save failed:", e);
    }
    setSubmitting(false);
    setStage(nextStage);
  };

  const onPickStar = (n: number) => {
    if (submitting) return;
    setRating(n);
    if (n === 5) saveAndContinue("fiveStar", 5);
    else saveAndContinue("lowRating", n);
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
        <h1 className="text-2xl font-bold text-mse-navy">How did we do?</h1>
      </div>

      <section className="bg-mse-light/60 rounded-2xl p-4">
        <div className="text-xs text-mse-muted uppercase tracking-wide font-semibold">
          Step 3 of 3
        </div>
        <div className="font-bold text-mse-navy mt-0.5">
          {job.customerName}
        </div>
      </section>

      {stage === "rate" && (
        <RateStage rating={rating} onPick={onPickStar} submitting={submitting} />
      )}

      {stage === "fiveStar" && (
        <FiveStarStage dispatchId={dispatchId} onDone={finishToJobs} />
      )}

      {stage === "lowRating" && (
        <LowRatingStage rating={rating} onDone={finishToJobs} />
      )}
    </div>
  );
}

// ── Stage: rating ─────────────────────────────────────────────────────

function RateStage({
  rating,
  onPick,
  submitting,
}: {
  rating: number;
  onPick: (n: number) => void;
  submitting: boolean;
}) {
  return (
    <>
      <section className="rounded-2xl border-2 border-mse-navy/15 bg-white p-5">
        <div className="text-lg font-bold text-mse-navy">
          Share your honest feedback
        </div>
        <div className="text-sm text-mse-muted mt-1.5 leading-relaxed">
          Tap a star — we&apos;ll email you a thank-you gift either way.
          Takes about 10 seconds.
        </div>
        <div className="flex justify-between items-center gap-1 mt-5">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onPick(n)}
              disabled={submitting}
              aria-label={`${n} star${n === 1 ? "" : "s"}`}
              className={cn(
                "flex-1 aspect-square rounded-2xl border-2 transition-[transform,background-color]",
                "active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mse-red focus-visible:ring-offset-2",
                rating >= n
                  ? "border-mse-gold bg-mse-gold/10"
                  : "border-mse-light bg-white hover:border-mse-gold/50",
                submitting && "opacity-60 cursor-not-allowed"
              )}
            >
              <Star
                className={cn(
                  "w-7 h-7 mx-auto",
                  rating >= n
                    ? "text-mse-gold fill-mse-gold"
                    : "text-mse-muted"
                )}
              />
            </button>
          ))}
        </div>
      </section>

      <button
        type="button"
        className="w-full text-sm text-mse-muted underline-offset-4 hover:underline"
        onClick={() => (window.location.href = "/jobs?submitted=1")}
      >
        Skip
      </button>
    </>
  );
}

// ── Stage: 5★ ─────────────────────────────────────────────────────────

function FiveStarStage({
  dispatchId,
  onDone,
}: {
  dispatchId: string;
  onDone: () => void;
}) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    // Build the helper-page URL on the client so we get the right
    // origin (vercel preview / production / local). The helper page is
    // public, no auth — customer scans, gets pre-filled review text on
    // their own device, taps through to Google.
    if (typeof window === "undefined") return;
    const helperUrl = `${window.location.origin}/review/${encodeURIComponent(
      dispatchId
    )}`;
    let cancelled = false;
    QRCode.toDataURL(helperUrl, {
      width: 240,
      margin: 1,
      color: { dark: "#1A2332", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch((e) => console.warn("[feedback] QR gen failed:", e));
    return () => {
      cancelled = true;
    };
  }, [dispatchId]);

  return (
    <>
      <section className="rounded-2xl border-2 border-mse-gold/40 bg-mse-gold/5 p-5">
        <div className="flex items-center gap-2 text-mse-navy font-bold text-lg">
          <Sparkles className="w-5 h-5 text-mse-gold" />
          Awesome — thank you!
        </div>
        <div className="text-sm text-mse-text/90 mt-2 leading-relaxed">
          Would you mind sharing that on Google? Scan the code below with
          your own phone — we&apos;ll suggest some words to start with so
          it only takes a few seconds.
        </div>
      </section>

      <section className="rounded-2xl border-2 border-mse-navy/15 bg-white p-5 space-y-4">
        <div className="flex items-center gap-2 text-sm font-bold text-mse-navy">
          <Smartphone className="w-4 h-4" />
          Scan with your phone
        </div>
        <div className="flex justify-center">
          {qrDataUrl ? (
            <div className="rounded-2xl bg-white p-3 border border-mse-light shadow-card">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrDataUrl}
                alt="Google review QR code"
                width={240}
                height={240}
                className="block"
              />
            </div>
          ) : (
            <div className="w-[240px] h-[240px] flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-mse-muted" />
            </div>
          )}
        </div>
        <div className="text-xs text-mse-muted text-center leading-relaxed">
          Open your camera, point at the code, and tap the link. We&apos;ll
          drop a suggested review on your clipboard so you can paste it
          straight into Google.
        </div>
      </section>

      <section className="rounded-2xl border border-mse-gold/30 bg-mse-gold/5 p-4">
        <div className="flex items-start gap-3">
          <Gift className="w-5 h-5 text-mse-gold shrink-0 mt-0.5" />
          <div className="text-sm text-mse-text leading-relaxed">
            <span className="font-bold text-mse-navy">A thank-you from MSE.</span>{" "}
            Watch your inbox — we&apos;re sending a small token of
            appreciation for the honest feedback.
          </div>
        </div>
      </section>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-mse-light p-4 safe-bottom z-10">
        <div className="max-w-2xl mx-auto">
          <button
            type="button"
            onClick={onDone}
            className={cn(
              "w-full font-bold rounded-2xl py-4 text-center transition-[background-color,transform]",
              "bg-mse-red hover:bg-mse-red-hover active:scale-[0.98] text-white shadow-card",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mse-red focus-visible:ring-offset-2"
            )}
          >
            <span className="inline-flex items-center gap-2">
              All done <ArrowRight className="w-4 h-4" />
            </span>
          </button>
        </div>
      </div>
    </>
  );
}

// ── Stage: 1–4★ ───────────────────────────────────────────────────────

function LowRatingStage({
  rating,
  onDone,
}: {
  rating: number;
  onDone: () => void;
}) {
  return (
    <>
      <section className="rounded-2xl border-2 border-mse-navy/15 bg-white p-5">
        <div className="text-mse-navy font-bold text-lg">
          Thanks for the honest rating.
        </div>
        <div className="text-sm text-mse-muted mt-2 leading-relaxed">
          You rated us {rating} star{rating === 1 ? "" : "s"}. We&apos;ll
          follow up by email shortly so you can share what would&apos;ve
          made it a 5-star visit. Stays between you and our team — the
          tech doesn&apos;t see your reply.
        </div>
      </section>

      <section className="rounded-2xl border border-mse-gold/30 bg-mse-gold/5 p-4">
        <div className="flex items-start gap-3">
          <Gift className="w-5 h-5 text-mse-gold shrink-0 mt-0.5" />
          <div className="text-sm text-mse-text leading-relaxed">
            <span className="font-bold text-mse-navy">Thank-you gift on its way.</span>{" "}
            Keep an eye on your inbox — even when we miss the mark, we
            appreciate honest feedback.
          </div>
        </div>
      </section>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-mse-light p-4 safe-bottom z-10">
        <div className="max-w-2xl mx-auto">
          <button
            type="button"
            onClick={onDone}
            className={cn(
              "w-full font-bold rounded-2xl py-4 text-center transition-[background-color,transform]",
              "bg-mse-red hover:bg-mse-red-hover active:scale-[0.98] text-white shadow-card",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mse-red focus-visible:ring-offset-2"
            )}
          >
            <span className="inline-flex items-center gap-2">
              All done <ArrowRight className="w-4 h-4" />
            </span>
          </button>
        </div>
      </div>
    </>
  );
}
