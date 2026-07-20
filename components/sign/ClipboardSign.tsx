"use client";
/* eslint-disable @typescript-eslint/no-explicit-any --
   registry.mjs is untyped JS data; shapes are validated by the fill
   engine and calibration tests. */

import { useEffect, useMemo, useRef, useState } from "react";
import SignatureCanvas from "react-signature-canvas";
import {
  CheckCircle2,
  ChevronDown,
  Eraser,
  Loader2,
  PenLine,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DOCS,
  PACKETS,
  PRIMARY_USE_OPTIONS,
  CUSTOMER_TYPE_OPTIONS,
  resolveSource,
} from "@/lib/agreements/registry.mjs";
import manifest from "@/lib/agreements/pages-manifest.json";
import type { Lead } from "@/lib/types";

// The clipboard: the agent (or customer) fills the fields at the top,
// and every value appears live on the ACTUAL agreement pages below —
// exactly where it will be stamped in the signed PDF. One signature at
// the bottom lands in every "Sign here" spot.

interface FieldState {
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

const FIELD_DEFS: Array<{ key: keyof FieldState; label: string; type?: string; placeholder: string; half?: boolean }> = [
  { key: "businessName", label: "Business name", placeholder: "Business on the utility account" },
  { key: "contactName", label: "Contact name", placeholder: "Who signs", half: true },
  { key: "title", label: "Title", placeholder: "Owner / Manager", half: true },
  { key: "phone", label: "Phone", type: "tel", placeholder: "(410) 555-0100", half: true },
  { key: "email", label: "Email", type: "email", placeholder: "owner@business.com", half: true },
  { key: "address", label: "Street address", placeholder: "Service address" },
  { key: "city", label: "City", placeholder: "City", half: true },
  { key: "zip", label: "Zip", placeholder: "21201", half: true },
  { key: "accountNumber", label: "Utility account #", placeholder: "From the bill", half: true },
  { key: "hvacUnits", label: "# of HVAC units", placeholder: "e.g. 4", half: true },
];

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

export function ClipboardSign({
  token,
  lead,
}: {
  token: string;
  lead: Lead;
}) {
  const packet = (PACKETS as Record<string, { label: string; docs: string[] }>)[
    lead.utility
  ];
  const [fields, setFields] = useState<FieldState>({
    businessName: lead.businessName,
    contactName: lead.contactName,
    title: lead.title,
    email: lead.email,
    phone: lead.phone,
    address: lead.address,
    city: lead.city,
    zip: lead.zip,
    accountNumber: lead.accountNumber,
    hvacUnits: lead.hvacUnits,
  });
  const [primaryUse, setPrimaryUse] = useState(lead.primaryUse);
  const [customerType, setCustomerType] = useState(lead.customerType);
  const [fieldsOpen, setFieldsOpen] = useState(true);
  const [signedName, setSignedName] = useState(lead.contactName);
  const [consent, setConsent] = useState(false);
  const [sigDataUrl, setSigDataUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sigRef = useRef<SignatureCanvas | null>(null);

  // Live px scale for overlay font sizes: pages render at column width,
  // coordinates are in 612pt page space.
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

  const isSmecoSmall = lead.utility === "SMECO-SMALL";

  const submit = async () => {
    if (submitting) return;
    setError(null);
    if (!fields.businessName.trim() && !fields.contactName.trim()) {
      setError("Business or contact name is required.");
      return;
    }
    if (!signedName.trim()) {
      setError("Please type the signer's full name.");
      return;
    }
    if (!consent) {
      setError("Please check the e-sign consent box.");
      return;
    }
    if (!sigRef.current || sigRef.current.isEmpty()) {
      setError("Please sign in the signature box.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/sign/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fields,
          primaryUse,
          customerType,
          signedName: signedName.trim(),
          consent: true,
          signatureDataUrl: sigRef.current.toDataURL("image/png"),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Server error ${res.status}`);
      setDone(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit");
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
          A copy of the signed paperwork is on file with Maryland Smart
          Energy. {lead.agentName || "Your agent"} will reach out to schedule
          your visit.
        </p>
      </div>
    );
  }

  const input =
    "w-full px-3 py-2.5 rounded-lg border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy";

  return (
    <div className="space-y-4">
      {/* ── Fill panel ── */}
      <div className="bg-white rounded-2xl border border-mse-light shadow-card">
        <button
          type="button"
          onClick={() => setFieldsOpen((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-3.5"
        >
          <span className="font-bold text-mse-navy text-sm">
            1 · Fill in the details
          </span>
          <ChevronDown
            className={cn(
              "w-4 h-4 text-mse-muted transition-transform",
              fieldsOpen && "rotate-180"
            )}
          />
        </button>
        {fieldsOpen && (
          <div className="px-5 pb-5 grid grid-cols-2 gap-2.5">
            {FIELD_DEFS.map((f) => (
              <label key={f.key} className={cn("block", !f.half && "col-span-2")}>
                <span className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1 block">
                  {f.label}
                </span>
                <input
                  type={f.type ?? "text"}
                  value={fields[f.key]}
                  onChange={(e) =>
                    setFields((prev) => ({ ...prev, [f.key]: e.target.value }))
                  }
                  placeholder={f.placeholder}
                  className={input}
                />
              </label>
            ))}
            {isSmecoSmall && (
              <>
                <label className="block">
                  <span className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1 block">
                    Primary use
                  </span>
                  <select
                    value={primaryUse}
                    onChange={(e) => setPrimaryUse(e.target.value)}
                    className={input}
                  >
                    <option value="">Pick…</option>
                    {PRIMARY_USE_OPTIONS.map((o: string) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1 block">
                    Customer type
                  </span>
                  <select
                    value={customerType}
                    onChange={(e) => setCustomerType(e.target.value)}
                    className={input}
                  >
                    <option value="">Pick…</option>
                    {CUSTOMER_TYPE_OPTIONS.map((o: string) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                </label>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── The actual forms, live-filled ── */}
      <div>
        <div className="font-bold text-mse-navy text-sm px-1 mb-2">
          2 · Review your paperwork
        </div>
        <div ref={colRef} className="space-y-4">
          {packet.docs.map((docKey) => {
            const def = (DOCS as Record<string, any>)[docKey];
            const pageMeta = (manifest as Record<string, any>)[docKey].pages;
            const overlays = [
              ...(def.fill ?? []),
              ...(def.acroDisplay ?? []),
            ];
            return (
              <div key={docKey}>
                <div className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1.5 px-1">
                  {def.label}
                </div>
                <div className="space-y-2">
                  {pageMeta.map((pm: { page: number; width: number; height: number }) => (
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
                      {/* live values */}
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
                      {/* SMECO-Small pick marks */}
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
                      {/* signature spots */}
                      {(def.sigs ?? [])
                        .filter((sg: any) => sg.page === pm.page)
                        .map((sg: any, i: number) => (
                          <div
                            key={`sig-${i}`}
                            className={cn(
                              "absolute rounded flex items-center justify-center overflow-hidden",
                              sigDataUrl
                                ? ""
                                : "border-2 border-dashed border-mse-gold bg-mse-gold/10"
                            )}
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
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Sign ── */}
      <div className="bg-white rounded-2xl border border-mse-light shadow-card p-5 space-y-4">
        <div className="font-bold text-mse-navy text-sm">3 · Sign</div>
        <label className="block">
          <span className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1 block">
            Signer&apos;s full name
          </span>
          <input
            value={signedName}
            onChange={(e) => setSignedName(e.target.value)}
            placeholder="Type your name"
            className={input}
          />
        </label>

        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted">
              Signature — lands in every &quot;Sign here&quot; spot above
            </span>
            {sigDataUrl && (
              <button
                type="button"
                onClick={() => {
                  sigRef.current?.clear();
                  setSigDataUrl(null);
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
              onEnd={() => {
                if (sigRef.current && !sigRef.current.isEmpty()) {
                  setSigDataUrl(sigRef.current.toDataURL("image/png"));
                }
              }}
              penColor="#1A2332"
              clearOnResize={false}
              canvasProps={{ className: "w-full h-52 block" }}
              backgroundColor="rgba(255,255,255,0)"
            />
            {!sigDataUrl && (
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
            I agree to sign these documents electronically, my signature will
            be applied to each signature line shown above, and I confirm I am
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
          {submitting ? "Submitting…" : "Agree and sign all documents"}
        </button>
      </div>
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
