import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Today's date in Eastern time (YYYY-MM-DD). The crew, the office, and
 * the Mon–Sun pay weeks all live in Maryland — using UTC here would
 * roll a Sunday-evening action into the NEXT pay week (UTC is 4-5
 * hours ahead). en-CA locale renders ISO order directly.
 */
export function todayIsoEastern(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
}

/**
 * ISO date (YYYY-MM-DD) of the Monday of the calendar week that
 * contains the given date. Uses local time so the boundary aligns
 * with how people read a paper calendar — a Sunday-evening dispatch
 * lands in the Sunday-evening week, not the next-day Monday.
 *
 * Defaults to today.
 */
export function startOfWeekIso(date: Date = new Date()): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay(); // 0 = Sunday, 1 = Monday, ... 6 = Saturday
  const daysSinceMonday = (dow + 6) % 7; // 0 if Mon, ..., 6 if Sun
  d.setDate(d.getDate() - daysSinceMonday);
  return localIso(d);
}

/**
 * ISO date of the Sunday that closes the week containing the given
 * date (Mon-Sun week). Defaults to today.
 */
export function endOfWeekIso(date: Date = new Date()): string {
  const d = new Date(startOfWeekIso(date));
  d.setDate(d.getDate() + 6);
  return localIso(d);
}

/** YYYY-MM-DD in local time (not UTC) — needed for date math that
 *  respects the user's calendar instead of drifting across midnight
 *  for negative-UTC-offset zones. */
function localIso(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function ageInDays(iso: string): number {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return Infinity;
  const ms = Date.now() - then;
  return ms / (1000 * 60 * 60 * 24);
}

/**
 * Pulls the Drive fileId out of any common Drive URL shape.
 *   https://drive.google.com/file/d/{ID}/view  → ID
 *   https://drive.google.com/uc?id={ID}        → ID
 *   https://drive.google.com/open?id={ID}      → ID
 */
export function extractDriveFileId(url: string): string | null {
  if (!url) return null;
  const m1 = url.match(/\/d\/([A-Za-z0-9_-]+)/);
  if (m1) return m1[1];
  const m2 = url.match(/[?&]id=([A-Za-z0-9_-]+)/);
  if (m2) return m2[1];
  return null;
}
