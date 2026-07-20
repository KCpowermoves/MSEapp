"use client";
/* eslint-disable @typescript-eslint/no-explicit-any --
   registry.mjs is untyped JS data; shapes are validated by the fill
   engine and calibration tests. */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DOCS,
  PACKETS,
  resolveSource,
} from "@/lib/agreements/registry.mjs";
import manifest from "@/lib/agreements/pages-manifest.json";
import type { UtilityProgram } from "@/lib/types";

// The clipboard preview: renders the ACTUAL agreement pages for a
// packet with the entered values overlaid live, exactly where they'll
// be stamped in the signed PDF. Shared by the agent's New Lead
// workspace and the customer's remote signing page.

export interface PreviewFields {
  businessName: string;
  contactName: string;
  title: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  zip: string;
  accountNumber: string;
  hvacUnits: string;
}

function dateCtx() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    monthName: get("month"),
    day: get("day"),
    year: get("year"),
    dateLong: `${get("month")} ${get("day")}, ${get("year")}`,
  };
}

export function FormsPreview({
  packetKey,
  fields,
  primaryUse,
  customerType,
  sigDataUrl,
}: {
  packetKey: UtilityProgram;
  fields: PreviewFields;
  primaryUse: string;
  customerType: string;
  sigDataUrl: string | null;
}) {
  const packet = (PACKETS as Record<string, { label: string; docs: string[] }>)[
    packetKey
  ];
  const colRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.6);
  useEffect(() => {
    const el = colRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / 612));
    ro.observe(el);
    setScale(el.clientWidth / 612);
    return () => ro.disconnect();
  }, []);

  const ctx = useMemo(
    () => ({ fields: fields as unknown as Record<string, string>, ...dateCtx() }),
    [fields]
  );

  if (!packet) return null;

  return (
    <div ref={colRef} className="space-y-4">
      {packet.docs.map((docKey) => {
        const def = (DOCS as Record<string, any>)[docKey];
        const pageMeta = (manifest as Record<string, any>)[docKey].pages;
        const overlays = [...(def.fill ?? []), ...(def.acroDisplay ?? [])];
        return (
          <div key={docKey}>
            <div className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1.5 px-1">
              {def.label}
            </div>
            <div className="space-y-2">
              {pageMeta.map(
                (pm: { page: number; width: number; height: number }) => (
                  <div
                    key={pm.page}
                    className="relative bg-white rounded-lg shadow-card overflow-hidden border border-mse-light"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/forms/${docKey}/page-${pm.page}.png`}
                      alt={`${def.label} page ${pm.page}`}
                      className="w-full h-auto block select-none"
                      draggable={false}
                    />
                    {overlays
                      .filter((o: any) => o.page === pm.page)
                      .map((o: any, i: number) => {
                        const v = resolveSource(o.source, ctx);
                        if (!v) return null;
                        return (
                          <span
                            key={i}
                            className="absolute whitespace-nowrap font-medium"
                            style={{
                              left: `${(o.x / pm.width) * 100}%`,
                              top: `${(o.yTop / pm.height) * 100}%`,
                              fontSize: Math.max(6, (o.size ?? 9.5) * scale),
                              color: "#1a1e4d",
                              lineHeight: 1,
                            }}
                          >
                            {v}
                          </span>
                        );
                      })}
                    {def.marks && pm.page === 3 && (
                      <>
                        {primaryUse && def.marks.primaryUse[primaryUse] && (
                          <MarkX spot={def.marks.primaryUse[primaryUse]} pm={pm} scale={scale} />
                        )}
                        {customerType && def.marks.customerType[customerType] && (
                          <MarkX spot={def.marks.customerType[customerType]} pm={pm} scale={scale} />
                        )}
                      </>
                    )}
                    {(def.sigs ?? [])
                      .filter((sg: any) => sg.page === pm.page)
                      .map((sg: any, i: number) => (
                        <div
                          key={`sig-${i}`}
                          className={
                            "absolute rounded flex items-center justify-center overflow-hidden" +
                            (sigDataUrl
                              ? ""
                              : " border-2 border-dashed border-mse-gold bg-mse-gold/10")
                          }
                          style={{
                            left: `${(sg.x / pm.width) * 100}%`,
                            top: `${(sg.yTop / pm.height) * 100}%`,
                            width: `${(sg.w / pm.width) * 100}%`,
                            height: `${(sg.h / pm.height) * 100}%`,
                          }}
                        >
                          {sigDataUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={sigDataUrl}
                              alt="signature"
                              className="max-w-full max-h-full object-contain"
                            />
                          ) : (
                            <span
                              className="text-mse-navy/70 font-semibold"
                              style={{ fontSize: Math.max(6, 8 * scale) }}
                            >
                              Sign here
                            </span>
                          )}
                        </div>
                      ))}
                  </div>
                )
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MarkX({
  spot,
  pm,
  scale,
}: {
  spot: { x: number; yTop: number };
  pm: { width: number; height: number };
  scale: number;
}) {
  return (
    <span
      className="absolute font-bold"
      style={{
        left: `${(spot.x / pm.width) * 100}%`,
        top: `${(spot.yTop / pm.height) * 100}%`,
        fontSize: Math.max(6, 9 * scale),
        color: "#1a1e4d",
        lineHeight: 1,
      }}
    >
      X
    </span>
  );
}
