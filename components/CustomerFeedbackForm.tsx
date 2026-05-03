"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Loader2, Star, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Job } from "@/lib/types";

/**
 * Step 3 of the submit flow — quick post-service screening. We ask the
 * customer how the visit went on a 1–5 scale. A 5-star tap routes them
 * to the public Google review page (where they can leave a real review).
 * Anything below stays private — we capture the comment in-app so the
 * team can address it without a public bad review.
 *
 * Either way we POST the rating + optional comment to /api/dispatches/feedback
 * before navigating away.
 */
export function CustomerFeedbackForm({
  job,
  dispatchId,
  googleReviewUrl,
}: {
  job: Job;
  dispatchId: string;
  googleReviewUrl: string;
}) {
  const router = useRouter();
  const [rating, setRating] = useState<number>(0);
  const [feedback, setFeedback] = useState("");
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
      console.warn("[feedback] initial save failed:", e);
    }
    setSubmitting(false);
    setStage(nextStage);
  };

  const onPickStar = (n: number) => {
    if (submitting) return;
    setRating(n);
    if (n === 5) {
      saveAndContinue("fiveStar", 5);
    } else {
      saveAndContinue("lowRating", n);
    }
  };

  const submitWrittenFeedback = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await fetch("/api/dispatches/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dispatchId,
          rating,
          feedback: feedback.trim(),
        }),
      });
    } catch (e) {
      console.warn("[feedback] write save failed:", e);
    }
    finishToJobs();
  };

  const goToGoogleReview = () => {
    // Open in a new tab so the tech can still finish the flow on this
    // device. We immediately route the in-app shell to /jobs so the
    // device is ready for the next stop.
    if (typeof window !== "undefined") {
      window.open(googleReviewUrl, "_blank", "noopener,noreferrer");
    }
    finishToJobs();
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
        <FiveStarStage
          onShare={goToGoogleReview}
          onSkip={finishToJobs}
        />
      )}

      {stage === "lowRating" && (
        <LowRatingStage
          rating={rating}
          feedback={feedback}
          setFeedback={setFeedback}
          submitting={submitting}
          onSubmit={submitWrittenFeedback}
          onSkip={finishToJobs}
        />
      )}
    </div>
  );
}

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
          Did you enjoy your service today?
        </div>
        <div className="text-sm text-mse-muted mt-1">
          Tap a star to let us know.
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

function FiveStarStage({
  onShare,
  onSkip,
}: {
  onShare: () => void;
  onSkip: () => void;
}) {
  return (
    <>
      <section className="rounded-2xl border-2 border-mse-gold/40 bg-mse-gold/5 p-5">
        <div className="flex items-center gap-2 text-mse-navy font-bold text-lg">
          <Sparkles className="w-5 h-5 text-mse-gold" />
          Awesome — thank you!
        </div>
        <div className="text-sm text-mse-text/90 mt-2 leading-relaxed">
          Would you mind sharing that on Google? It helps a small Maryland
          team like ours more than you&apos;d believe — takes about 30 seconds.
        </div>
      </section>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-mse-light p-4 safe-bottom z-10">
        <div className="max-w-2xl mx-auto space-y-2">
          <button
            type="button"
            onClick={onShare}
            className={cn(
              "w-full font-bold rounded-2xl py-4 text-center transition-[background-color,transform]",
              "bg-mse-red hover:bg-mse-red-hover active:scale-[0.98] text-white shadow-card",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mse-red focus-visible:ring-offset-2"
            )}
          >
            <span className="inline-flex items-center gap-2">
              Leave a Google review <ArrowRight className="w-4 h-4" />
            </span>
          </button>
          <button
            type="button"
            onClick={onSkip}
            className="w-full text-sm text-mse-muted py-2 underline-offset-4 hover:underline"
          >
            Maybe later
          </button>
        </div>
      </div>
    </>
  );
}

function LowRatingStage({
  rating,
  feedback,
  setFeedback,
  submitting,
  onSubmit,
  onSkip,
}: {
  rating: number;
  feedback: string;
  setFeedback: (s: string) => void;
  submitting: boolean;
  onSubmit: () => void;
  onSkip: () => void;
}) {
  return (
    <>
      <section className="rounded-2xl border-2 border-mse-navy/15 bg-white p-5">
        <div className="text-mse-navy font-bold text-lg">
          Thanks for the honest rating.
        </div>
        <div className="text-sm text-mse-muted mt-1.5">
          You rated us {rating} star{rating === 1 ? "" : "s"}. What can we do
          to make it a 5-star experience next time? Stays between you and our
          team.
        </div>
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="What could have gone better?"
          rows={5}
          className="w-full mt-4 px-4 py-3 rounded-xl border border-mse-light bg-white text-base focus:outline-none focus:border-mse-navy resize-none"
        />
      </section>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-mse-light p-4 safe-bottom z-10">
        <div className="max-w-2xl mx-auto space-y-2">
          <button
            type="button"
            onClick={onSubmit}
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
                Sending…
              </span>
            ) : (
              "Send to MSE team"
            )}
          </button>
          <button
            type="button"
            onClick={onSkip}
            className="w-full text-sm text-mse-muted py-2 underline-offset-4 hover:underline"
          >
            Skip
          </button>
        </div>
      </div>
    </>
  );
}
