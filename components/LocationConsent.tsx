"use client";

import { useEffect, useState } from "react";
import { MapPin, Shield } from "lucide-react";
import {
  captureLocationEvent,
  getConsent,
  setConsent,
} from "@/lib/location";

/**
 * One-time disclosure modal that explains location tracking and gets
 * the tech's explicit OK before we start posting events. Result is
 * persisted in localStorage so it only ever shows once per device.
 *
 * After consent is granted, fires an "app-open" capture immediately
 * so the office sees the tech checked in.
 */
export function LocationConsent({ techName }: { techName: string }) {
  const [needsConsent, setNeedsConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const consent = getConsent();
    if (consent === "unset") {
      setNeedsConsent(true);
      return;
    }
    if (consent === "granted") {
      // Best-effort capture on every authenticated mount; the lib
      // throttles itself so we don't spam the sheet.
      captureLocationEvent("app-open").catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [techName]);

  const allow = async () => {
    setSubmitting(true);
    setConsent("granted");
    setNeedsConsent(false);
    // First capture is forced (skips the throttle) so the office
    // immediately sees the tech opted in.
    await captureLocationEvent("app-open", {}, { force: true });
    setSubmitting(false);
  };

  const deny = () => {
    setConsent("denied");
    setNeedsConsent(false);
    // Log the explicit decline once so we know it wasn't a glitch.
    captureLocationEvent("app-open").catch(() => {});
  };

  if (!needsConsent) return null;

  return (
    <div className="fixed inset-0 z-50 bg-mse-navy/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 animate-fade-in">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-elevated p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-mse-navy/10 flex items-center justify-center shrink-0">
            <MapPin className="w-5 h-5 text-mse-navy" />
          </div>
          <h2 className="text-lg font-bold text-mse-navy">
            Location check-ins
          </h2>
        </div>

        <p className="text-sm text-mse-text leading-relaxed">
          MSE Field records your device location at a few moments while
          you use the app: when you log in, when you open the app, and
          when you save a unit or submit a job.
        </p>

        <p className="text-sm text-mse-text leading-relaxed">
          This helps the office verify on-site work and resolve
          dispatch questions quickly. We do <span className="font-semibold">not</span>{" "}
          track you in the background or when the app is closed.
        </p>

        <div className="rounded-xl bg-mse-light/40 p-3 text-xs text-mse-muted flex items-start gap-2">
          <Shield className="w-4 h-4 text-mse-navy shrink-0 mt-0.5" />
          <span>
            You can decline now or change permission later in your
            phone&apos;s settings. The app still works either way.
          </span>
        </div>

        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={deny}
            className="flex-1 rounded-xl border-2 border-mse-light text-mse-muted font-semibold py-3 text-sm hover:bg-mse-light/40 transition-colors"
          >
            Not now
          </button>
          <button
            type="button"
            onClick={allow}
            disabled={submitting}
            className="flex-1 rounded-xl bg-mse-red text-white font-bold py-3 text-sm hover:bg-mse-red-hover disabled:opacity-50 transition-colors"
          >
            {submitting ? "Allowing…" : "Allow location"}
          </button>
        </div>
      </div>
    </div>
  );
}
