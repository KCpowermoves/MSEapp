"use client";

import type { LocationEventType } from "@/lib/data/locations";

const CONSENT_KEY = "mse-location-consent";
const LAST_CAPTURE_KEY = "mse-last-location-capture";
const MIN_INTERVAL_MS = 5 * 60 * 1000; // throttle: at most one auto-capture per 5 min

export type LocationConsent = "granted" | "denied" | "unset";

export function getConsent(): LocationConsent {
  if (typeof window === "undefined") return "unset";
  const v = localStorage.getItem(CONSENT_KEY);
  if (v === "granted" || v === "denied") return v;
  return "unset";
}

export function setConsent(value: "granted" | "denied"): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(CONSENT_KEY, value);
}

interface ReadResult {
  lat?: number;
  lng?: number;
  accuracy?: number;
  type: LocationEventType;
  notes?: string;
}

async function readPosition(): Promise<ReadResult> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return { type: "unsupported", notes: "Geolocation API not available" };
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          type: "app-open", // placeholder, overridden by caller
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
      },
      (err) => {
        // PERMISSION_DENIED = 1, POSITION_UNAVAILABLE = 2, TIMEOUT = 3
        if (err.code === 1) {
          resolve({ type: "permission-denied", notes: err.message });
        } else {
          resolve({
            type: "unsupported",
            notes: `geo error code ${err.code}: ${err.message}`,
          });
        }
      },
      // Don't sit on this for long — best-effort only.
      { maximumAge: 60_000, timeout: 8_000, enableHighAccuracy: false }
    );
  });
}

async function postEvent(
  payload: ReadResult & {
    eventType: LocationEventType;
    jobId?: string;
    unitId?: string;
  }
): Promise<void> {
  try {
    await fetch("/api/locations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: payload.eventType,
        lat: payload.lat ?? null,
        lng: payload.lng ?? null,
        accuracy: payload.accuracy ?? null,
        jobId: payload.jobId,
        unitId: payload.unitId,
        notes: payload.notes,
      }),
      keepalive: true,
    });
  } catch {
    // Silent — location is best-effort.
  }
}

/**
 * Read the device location and post an event. Honors user consent — if
 * the user has explicitly denied, we don't even prompt; we just log a
 * "permission-denied" event so the office knows location is off.
 */
export async function captureLocationEvent(
  eventType: LocationEventType,
  context: { jobId?: string; unitId?: string } = {},
  options: { force?: boolean } = {}
): Promise<void> {
  if (typeof window === "undefined") return;

  const consent = getConsent();
  if (consent === "denied") {
    await postEvent({
      type: "permission-denied",
      eventType,
      notes: "User has location disabled in app settings",
      ...context,
    });
    return;
  }

  // Throttle automatic captures (login, app-open). Action-based captures
  // (job-create, unit-save, dispatch-submit) bypass with `force`.
  if (!options.force) {
    const last = Number(localStorage.getItem(LAST_CAPTURE_KEY) ?? 0);
    if (Date.now() - last < MIN_INTERVAL_MS) return;
  }

  const result = await readPosition();
  localStorage.setItem(LAST_CAPTURE_KEY, String(Date.now()));

  // Override the placeholder type with the real event type, but preserve
  // any error type that came from readPosition (denied/unsupported).
  const finalType: LocationEventType =
    result.type === "permission-denied" || result.type === "unsupported"
      ? result.type
      : eventType;

  await postEvent({
    ...result,
    eventType: finalType,
    ...context,
  });
}
