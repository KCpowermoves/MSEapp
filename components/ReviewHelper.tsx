"use client";

import { useState } from "react";
import Image from "next/image";
import { ArrowRight, Check, Copy, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Public-facing review helper. Customer scans the tech's QR with their
 * own phone, lands here, taps Copy, then continues to Google Reviews
 * with the suggested text already on their clipboard.
 *
 * Branded as Maryland Smart Energy so customers don't think it's a
 * sketchy redirect.
 */
export function ReviewHelper({
  reviewText,
  googleReviewUrl,
}: {
  reviewText: string;
  googleReviewUrl: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reviewText);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch (e) {
      console.warn("[review-helper] copy failed:", e);
    }
  };

  return (
    <div className="min-h-screen bg-mse-light/30 px-4 py-8 sm:py-12">
      <div className="max-w-md mx-auto space-y-6">
        <div className="flex items-center gap-3 justify-center">
          <Image
            src="/logo.png"
            alt="Maryland Smart Energy"
            width={48}
            height={48}
            className="rounded-full"
          />
          <div className="font-bold text-mse-navy">Maryland Smart Energy</div>
        </div>

        <section className="rounded-2xl bg-white shadow-elevated p-6 space-y-4">
          <div className="flex items-center gap-2 text-mse-navy font-bold text-xl">
            <Sparkles className="w-5 h-5 text-mse-gold" />
            Thanks for the 5 stars!
          </div>
          <p className="text-sm text-mse-text leading-relaxed">
            We&apos;ve drafted something for you to start with — feel free to
            tweak it. Tap <strong>Copy</strong>, then <strong>Continue to
            Google</strong> and paste it in.
          </p>

          <div className="rounded-xl bg-mse-light/50 p-4 text-sm text-mse-text leading-relaxed">
            {reviewText}
          </div>

          <button
            type="button"
            onClick={copy}
            className={cn(
              "w-full font-bold rounded-xl py-3 text-center transition-[background-color,transform]",
              "active:scale-[0.99] inline-flex items-center justify-center gap-2",
              copied
                ? "bg-mse-gold/20 text-mse-navy border-2 border-mse-gold"
                : "bg-mse-navy text-white hover:bg-mse-navy-soft"
            )}
          >
            {copied ? (
              <>
                <Check className="w-4 h-4" />
                Copied — paste it on Google
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                Copy review text
              </>
            )}
          </button>
        </section>

        <a
          href={googleReviewUrl}
          target="_blank"
          rel="noopener"
          className={cn(
            "block w-full font-bold rounded-2xl py-4 text-center transition-[background-color,transform]",
            "bg-mse-red hover:bg-mse-red-hover active:scale-[0.98] text-white shadow-card"
          )}
        >
          <span className="inline-flex items-center gap-2">
            Continue to Google Reviews <ArrowRight className="w-4 h-4" />
          </span>
        </a>

        <p className="text-xs text-mse-muted text-center leading-relaxed px-4">
          Google&apos;s form opens in a new tab — paste your review and tap
          Post. Thanks again for taking the time.
        </p>
      </div>
    </div>
  );
}
