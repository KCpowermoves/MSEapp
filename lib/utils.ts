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

export function ageInDays(iso: string): number {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return Infinity;
  const ms = Date.now() - then;
  return ms / (1000 * 60 * 60 * 24);
}
