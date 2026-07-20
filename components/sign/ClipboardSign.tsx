"use client";

import { useState } from "react";
import { CheckCircle2, ChevronDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  PRIMARY_USE_OPTIONS,
  CUSTOMER_TYPE_OPTIONS,
} from "@/lib/agreements/registry.mjs";
import { REQUIRED_LEAD_FIELDS } from "@/lib/programs";
import { FormsPreview, type PreviewFields } from "@/components/sign/FormsPreview";
import { SignaturePad } from "@/components/sign/SignaturePad";
import type { Lead } from "@/lib/types";

// Remote signing: the customer opened a texted/emailed link. Same
// clipboard as the agent's workspace — details on top (editable for
// last-minute corrections), the real forms filling live, one signature
// at the bottom. Signing creates the job and stores the packet PDF.

const FIELD_DEFS: Array<{
  key: keyof PreviewFields;
  label: string;
  type?: string;
  placeholder: string;
  half?: boolean;
}> = [
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

export function ClipboardSign({ token, lead }: { token: string; lead: Lead }) {
  const [fields, setFields] = useState<PreviewFields>({
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
  const [missing, setMissing] = useState<Set<string>>(new Set());

  const isSmecoSmall = lead.utility === "SMECO-SMALL";
  const setField = (k: keyof PreviewFields, v: string) => {
    setFields((prev) => ({ ...prev, [k]: v }));
    if (v.trim()) setMissing((m) => (m.has(k) ? new Set(Array.from(m).filter((x) => x !== k)) : m));
  };

  // Every required field must be filled before signing (all but account
  // number / Choice ID / Service ID). SMECO-Small also needs the two
  // picks. Empty ones highlight red and block the signature.
  const findMissing = (): Set<string> => {
    const m = new Set<string>();
    for (const k of REQUIRED_LEAD_FIELDS) {
      if (!String(fields[k as keyof PreviewFields] ?? "").trim()) m.add(k);
    }
    if (isSmecoSmall) {
      if (!primaryUse.trim()) m.add("primaryUse");
      if (!customerType.trim()) m.add("customerType");
    }
    return m;
  };

  const submit = async () => {
    if (submitting) return;
    setError(null);
    const miss = findMissing();
    if (miss.size > 0) {
      setMissing(miss);
      setFieldsOpen(true);
      return setError(
        "Please fill in the highlighted fields before signing — everything except the account number is required."
      );
    }
    if (!signedName.trim()) return setError("Please type the signer's full name.");
    if (!consent) return setError("Please check the e-sign consent box.");
    if (!sigDataUrl) return setError("Please sign in the signature box.");

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
          signatureDataUrl: sigDataUrl,
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
  const labelCls =
    "text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1 block";

  return (
    <div className="space-y-4">
      {/* Fill panel */}
      <div className="bg-white rounded-2xl border border-mse-light shadow-card">
        <button
          type="button"
          onClick={() => setFieldsOpen((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-3.5"
        >
          <span className="font-bold text-mse-navy text-sm">
            1 · Confirm the details
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
            {FIELD_DEFS.map((f) => {
              const bad = missing.has(f.key);
              return (
                <label key={f.key} className={cn("block", !f.half && "col-span-2")}>
                  <span className={cn(labelCls, bad && "text-mse-red")}>
                    {f.label}
                    {bad && " · required"}
                  </span>
                  <input
                    type={f.type ?? "text"}
                    value={fields[f.key]}
                    onChange={(e) => setField(f.key, e.target.value)}
                    placeholder={f.placeholder}
                    className={cn(input, bad && "border-mse-red bg-mse-red/5")}
                  />
                </label>
              );
            })}
            {isSmecoSmall && (
              <>
                <label className="block">
                  <span className={cn(labelCls, missing.has("primaryUse") && "text-mse-red")}>
                    Primary use{missing.has("primaryUse") && " · required"}
                  </span>
                  <select
                    value={primaryUse}
                    onChange={(e) => {
                      setPrimaryUse(e.target.value);
                      if (e.target.value) setMissing((m) => new Set(Array.from(m).filter((x) => x !== "primaryUse")));
                    }}
                    className={cn(input, missing.has("primaryUse") && "border-mse-red bg-mse-red/5")}
                  >
                    <option value="">Pick…</option>
                    {PRIMARY_USE_OPTIONS.map((o: string) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className={cn(labelCls, missing.has("customerType") && "text-mse-red")}>
                    Customer type{missing.has("customerType") && " · required"}
                  </span>
                  <select
                    value={customerType}
                    onChange={(e) => {
                      setCustomerType(e.target.value);
                      if (e.target.value) setMissing((m) => new Set(Array.from(m).filter((x) => x !== "customerType")));
                    }}
                    className={cn(input, missing.has("customerType") && "border-mse-red bg-mse-red/5")}
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

      {/* Live forms */}
      <div>
        <div className="font-bold text-mse-navy text-sm px-1 mb-2">
          2 · Review your paperwork
        </div>
        <FormsPreview
          packetKey={lead.utility}
          fields={fields}
          primaryUse={primaryUse}
          customerType={customerType}
          sigDataUrl={sigDataUrl}
        />
      </div>

      {/* Sign */}
      <div className="bg-white rounded-2xl border border-mse-light shadow-card p-5 space-y-4">
        <div className="font-bold text-mse-navy text-sm">3 · Sign</div>
        <SignaturePad
          signedName={signedName}
          onSignedName={setSignedName}
          consent={consent}
          onConsent={setConsent}
          sigDataUrl={sigDataUrl}
          onSignatureChange={setSigDataUrl}
        />
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
