"use client";

import { useState } from "react";
import { ChevronDown, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Collapsible mini map for a visit's job address. Uses the keyless
 * Google Maps embed (no API key, no quota) so admins and techs can see
 * where in Maryland a job actually is without leaving the schedule.
 * Collapsed by default — the iframe only mounts when opened, so a
 * week's board doesn't load a dozen maps up front.
 */
export function MiniMap({ address }: { address: string }) {
  const [open, setOpen] = useState(false);
  const trimmed = (address || "").trim();
  if (!trimmed) return null;

  const q = encodeURIComponent(
    // Bias the search toward Maryland when the address lacks a state.
    /\b(md|maryland)\b/i.test(trimmed) ? trimmed : `${trimmed}, MD`
  );

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-[11px] font-semibold text-mse-navy/70 hover:text-mse-navy"
      >
        <MapPin className="w-3 h-3 text-mse-gold" />
        {open ? "Hide map" : "Map"}
        <ChevronDown
          className={cn("w-3 h-3 transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <div className="mt-1.5 rounded-xl overflow-hidden border border-mse-light shadow-card">
          <iframe
            title={`Map of ${trimmed}`}
            src={`https://maps.google.com/maps?q=${q}&z=13&output=embed`}
            className="w-full h-44 block"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${q}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block px-3 py-1.5 text-[11px] font-semibold text-mse-navy bg-mse-light/40 hover:bg-mse-light"
          >
            Open in Google Maps →
          </a>
        </div>
      )}
    </div>
  );
}
