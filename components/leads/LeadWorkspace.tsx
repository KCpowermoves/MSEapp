"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Camera,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  ListChecks,
  Loader2,
  Mail,
  MessageSquare,
  PenLine,
  Sparkles,
  X,
} from "lucide-react";
import type { Prospect } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  UTILITIES,
  packetsForUtility,
  UTILITY_PROGRAM_LABELS,
  REQUIRED_LEAD_FIELDS,
  type UtilityName,
} from "@/lib/programs";
import {
  PRIMARY_USE_OPTIONS,
  CUSTOMER_TYPE_OPTIONS,
} from "@/lib/agreements/registry.mjs";
import { FormsPreview, type PreviewFields } from "@/components/sign/FormsPreview";
import { SignaturePad } from "@/components/sign/SignaturePad";
import type { Lead, UtilityProgram } from "@/lib/types";

// The whole sale on one page: pick the utility, the real paperwork
// pulls up and fills live as details are entered (or bill-scanned),
// then finish by signing on the spot OR texting/emailing the link for
// the customer to sign on their own device.

interface BillScan {
  businessName: string;
  utility: string;
  accountNumber: string;
  choiceId: string;
  serviceId: string;
  address: string;
  city: string;
  zip: string;
  confidence: number;
  status: "ok" | "disabled" | "error" | "rate_limited";
}

const FIELD_DEFS: Array<{
  key: keyof PreviewFields;
  label: string;
  type?: string;
  placeholder: string;
  half?: boolean;
}> = [
  { key: "businessName", label: "Business name", placeholder: "Business on the utility account" },
  { key: "contactName", label: "Contact name", placeholder: "Who signs", half: true },
  { key: "phone", label: "Phone", type: "tel", placeholder: "(410) 555-0100", half: true },
  { key: "email", label: "Email", type: "email", placeholder: "owner@business.com", half: true },
  { key: "title", label: "Title", placeholder: "Owner / Manager", half: true },
  { key: "address", label: "Street address", placeholder: "Service address" },
  { key: "city", label: "City", placeholder: "City", half: true },
  { key: "zip", label: "Zip", placeholder: "21201", half: true },
  { key: "accountNumber", label: "Utility account #", placeholder: "From the bill", half: true },
  { key: "hvacUnits", label: "# of HVAC units", placeholder: "e.g. 4", half: true },
];

const EMPTY: PreviewFields = {
  businessName: "", contactName: "", title: "", email: "", phone: "",
  address: "", city: "", zip: "", accountNumber: "", hvacUnits: "",
};

type FinishMode = "sign" | "text" | "email";

export function LeadWorkspace({ crewTechs }: { crewTechs: string[] }) {
  const router = useRouter();

  const [utilityName, setUtilityName] = useState<UtilityName | null>(null);
  const [utility, setUtility] = useState<UtilityProgram | null>(null);
  const [fields, setFields] = useState<PreviewFields>(EMPTY);
  const [primaryUse, setPrimaryUse] = useState("");
  const [customerType, setCustomerType] = useState("");
  const [choiceId, setChoiceId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [notes, setNotes] = useState("");
  const [assignTech, setAssignTech] = useState("");
  const [assignDate, setAssignDate] = useState("");

  const [finishMode, setFinishMode] = useState<FinishMode>("sign");
  const [signedName, setSignedName] = useState("");
  const [consent, setConsent] = useState(false);
  const [sigDataUrl, setSigDataUrl] = useState<string | null>(null);

  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [prospectId, setProspectId] = useState("");

  const [scanState, setScanState] = useState<
    "idle" | "scanning" | "done" | "unreadable" | "busy"
  >("idle");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentLead, setSentLead] = useState<Lead | null>(null);
  const [signedDone, setSignedDone] = useState(false);
  const [copied, setCopied] = useState(false);
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  const setField = (k: keyof PreviewFields, v: string) => {
    setFields((prev) => ({ ...prev, [k]: v }));
    if (v.trim()) setMissing((m) => (m.has(k) ? new Set(Array.from(m).filter((x) => x !== k)) : m));
  };

  // All customer fields except account #/Choice ID/Service ID must be
  // filled before signing; SMECO-Small also needs its two picks.
  const findMissing = (): Set<string> => {
    const m = new Set<string>();
    for (const k of REQUIRED_LEAD_FIELDS) {
      if (!String(fields[k as keyof PreviewFields] ?? "").trim()) m.add(k);
    }
    if (utility === "SMECO-SMALL") {
      if (!primaryUse.trim()) m.add("primaryUse");
      if (!customerType.trim()) m.add("customerType");
    }
    return m;
  };

  const pickUtility = (u: UtilityName) => {
    setUtilityName(u);
    setUtility(packetsForUtility(u)[0]);
  };

  // Load the admin-uploaded prospect list (if any) for the quick-pick.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/prospects")
      .then((r) => (r.ok ? r.json() : { prospects: [] }))
      .then((d: { prospects?: Prospect[] }) => {
        if (!cancelled) setProspects(d.prospects ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const pickProspect = (id: string) => {
    setProspectId(id);
    const p = prospects.find((x) => x.prospectId === id);
    if (!p) return;
    setFields({
      businessName: p.businessName,
      contactName: p.contactName,
      title: p.title,
      email: p.email,
      phone: p.phone,
      address: p.address,
      city: p.city,
      zip: p.zip,
      accountNumber: p.accountNumber,
      hvacUnits: p.hvacUnits,
    });
    if ((UTILITIES as readonly string[]).includes(p.utility)) {
      pickUtility(p.utility as UtilityName);
    }
  };

  const programs = utilityName ? packetsForUtility(utilityName) : [];
  const isSmecoSmall = utility === "SMECO-SMALL";

  const scanBill = async (file: File) => {
    setScanState("scanning");
    try {
      const fd = new FormData();
      fd.append("file", file, "bill.jpg");
      const res = await fetch("/api/ocr-bill", { method: "POST", body: fd });
      const data = (await res.json()) as BillScan;
      if (data.status === "rate_limited") return setScanState("busy");
      if (data.status !== "ok" || data.confidence < 40) return setScanState("unreadable");
      setFields((prev) => ({
        ...prev,
        businessName: prev.businessName || data.businessName,
        accountNumber: prev.accountNumber || data.accountNumber,
        address: prev.address || data.address,
        city: prev.city || data.city,
        zip: prev.zip || data.zip,
      }));
      if (data.choiceId) setChoiceId((v) => v || data.choiceId);
      if (data.serviceId) setServiceId((v) => v || data.serviceId);
      setScanState("done");
    } catch {
      setScanState("unreadable");
    }
  };

  const leadPayload = () => ({
    businessName: fields.businessName,
    contactName: fields.contactName,
    title: fields.title,
    email: fields.email,
    phone: fields.phone,
    address: fields.address,
    city: fields.city,
    zip: fields.zip,
    utility,
    accountNumber: fields.accountNumber,
    hvacUnits: fields.hvacUnits,
    primaryUse,
    customerType,
    choiceId,
    serviceId,
    notes,
    assignTech,
    assignDate,
    prospectId,
  });

  const createLead = async (deliveryMethod: string): Promise<Lead> => {
    const res = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...leadPayload(), deliveryMethod }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      lead?: Lead;
    };
    if (!res.ok || !data.lead) {
      throw new Error(data.error ?? `Server error ${res.status}`);
    }
    return data.lead;
  };

  const validateShared = (): string | null => {
    if (!utility) return "Pick a utility first.";
    if (!fields.businessName.trim() && !fields.contactName.trim()) {
      return "Add the business or contact name.";
    }
    return null;
  };

  const handleSignNow = async () => {
    if (submitting) return;
    setError(null);
    const shared = validateShared();
    if (shared) return setError(shared);
    const miss = findMissing();
    if (miss.size > 0) {
      setMissing(miss);
      return setError(
        "Fill in the highlighted fields before signing — everything except the account number is required."
      );
    }
    if (!signedName.trim()) return setError("Type the signer's full name.");
    if (!consent) return setError("Check the e-sign consent box.");
    if (!sigDataUrl) return setError("Sign in the signature box.");

    setSubmitting(true);
    try {
      const lead = await createLead("in-person");
      const res = await fetch(`/api/sign/${encodeURIComponent(lead.signToken)}`, {
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
      setSignedDone(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not sign");
      setSubmitting(false);
    }
  };

  const handleSend = async (mode: "text" | "email") => {
    if (submitting) return;
    setError(null);
    const shared = validateShared();
    if (shared) return setError(shared);
    if (mode === "text" && fields.phone.replace(/\D+/g, "").length < 10) {
      return setError("Add the customer's mobile number to text the link.");
    }
    if (mode === "email" && !fields.email.trim()) {
      return setError("Add the customer's email to send the link.");
    }
    setSubmitting(true);
    try {
      const lead = await createLead(mode);
      const url = `${window.location.origin}/sign/${lead.signToken}`;
      if (mode === "text") {
        const body = encodeURIComponent(
          `Hi ${lead.contactName || ""}! Here's your no-cost HVAC tune-up agreement from Maryland Smart Energy. Review and sign here: ${url}`
        );
        window.location.href = `sms:${fields.phone.replace(/\D+/g, "")}?&body=${body}`;
      } else {
        const subject = encodeURIComponent(
          "Your HVAC Tune-Up Agreement — Maryland Smart Energy"
        );
        const body = encodeURIComponent(
          `Hi ${lead.contactName || ""},\n\nHere's the paperwork for the no-cost HVAC tune-up program. Review and sign online here:\n\n${url}\n\nQuestions? Just reply or call me.\n\n${lead.agentName}`
        );
        window.location.href = `mailto:${fields.email}?subject=${subject}&body=${body}`;
      }
      setSentLead(lead);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save lead");
      setSubmitting(false);
    }
  };

  const input =
    "w-full px-3 py-2.5 rounded-lg border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy";
  const labelCls =
    "text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1 block";

  // ── Signed success ──
  if (signedDone) {
    return (
      <div className="bg-white rounded-2xl border-2 border-emerald-600/25 shadow-card p-6 text-center space-y-3">
        <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto" />
        <div className="font-bold text-mse-navy text-lg">
          Signed — job created!
        </div>
        <p className="text-sm text-mse-muted">
          The completed paperwork is on file and the job is in the system
          {assignTech ? ` for ${assignTech}` : " (unassigned)"}.
        </p>
        <div className="flex items-center justify-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => router.push("/sales")}
            className="px-4 py-2.5 rounded-xl text-sm font-bold bg-mse-navy text-white hover:bg-mse-navy-soft active:scale-95"
          >
            Go to My Sales
          </button>
          <button
            type="button"
            onClick={() => router.refresh()}
            className="px-4 py-2.5 rounded-xl text-sm font-bold border-2 border-mse-light text-mse-navy hover:border-mse-navy/30 active:scale-95"
          >
            New lead
          </button>
        </div>
      </div>
    );
  }

  // ── Sent (text/email) confirmation with fallback delivery ──
  if (sentLead) {
    const url = `${window.location.origin}/sign/${sentLead.signToken}`;
    const smsDigits = sentLead.phone.replace(/\D+/g, "");
    const smsBody = encodeURIComponent(
      `Hi ${sentLead.contactName || ""}! Here's your no-cost HVAC tune-up agreement from Maryland Smart Energy. Review and sign here: ${url}`
    );
    const emailBody = encodeURIComponent(
      `Hi ${sentLead.contactName || ""},\n\nHere's the paperwork for the no-cost HVAC tune-up program. Review and sign online here:\n\n${url}\n\nQuestions? Just reply or call me.\n\n${sentLead.agentName}`
    );
    return (
      <div className="space-y-4">
        <div className="rounded-2xl bg-emerald-600/10 border-2 border-emerald-600/25 p-4 flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
          <div>
            <div className="font-bold text-mse-navy">
              Lead saved — {sentLead.leadId}
            </div>
            <p className="text-xs text-mse-muted mt-0.5">
              The signing link is on its way. When it&apos;s signed, the job
              creates itself
              {sentLead.assignTech ? ` for ${sentLead.assignTech}` : " (unassigned)"}.
              Didn&apos;t open? Use a button below.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {smsDigits.length >= 10 && (
            <a
              href={`sms:${smsDigits}?&body=${smsBody}`}
              className="inline-flex items-center justify-center gap-2 rounded-xl py-2.5 px-3 font-bold text-xs border-2 border-mse-navy text-mse-navy hover:bg-mse-navy hover:text-white active:scale-[0.98]"
            >
              <MessageSquare className="w-4 h-4" />
              Text again
            </a>
          )}
          {sentLead.email && (
            <a
              href={`mailto:${sentLead.email}?subject=${encodeURIComponent("Your HVAC Tune-Up Agreement — Maryland Smart Energy")}&body=${emailBody}`}
              className="inline-flex items-center justify-center gap-2 rounded-xl py-2.5 px-3 font-bold text-xs border-2 border-mse-navy text-mse-navy hover:bg-mse-navy hover:text-white active:scale-[0.98]"
            >
              <Mail className="w-4 h-4" />
              Email again
            </a>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(url).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl py-2.5 px-3 font-bold text-xs border border-mse-light text-mse-muted hover:text-mse-navy hover:border-mse-navy/30 active:scale-[0.98]"
        >
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          {copied ? "Copied" : "Copy signing link"}
        </button>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl py-2.5 px-3 font-bold text-xs text-mse-navy hover:underline"
        >
          <ExternalLink className="w-4 h-4" />
          Or open it here to sign in person
        </a>
        <button
          type="button"
          onClick={() => router.push("/sales")}
          className="w-full text-center text-sm font-bold text-mse-navy hover:underline py-2"
        >
          Done — go to My Sales
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Quick-pick from the admin-uploaded prospect list ── */}
      {prospects.length > 0 && (
        <div className="bg-white rounded-2xl border border-mse-light shadow-card p-5 space-y-2">
          <span className={cn(labelCls, "flex items-center gap-1.5")}>
            <ListChecks className="w-3.5 h-3.5" />
            Start from a saved prospect
          </span>
          <select
            value={prospectId}
            onChange={(e) => pickProspect(e.target.value)}
            className={input}
          >
            <option value="">Choose a prospect to prefill…</option>
            {prospects.map((p) => (
              <option key={p.prospectId} value={p.prospectId}>
                {[p.businessName || p.contactName, p.address, p.city]
                  .filter(Boolean)
                  .join(" · ")}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-mse-muted">
            {prospects.length} prospect{prospects.length === 1 ? "" : "s"} loaded
            by your admin. Picking one fills the form below.
          </p>
        </div>
      )}

      {/* ── Pick the utility ── */}
      <div className="bg-white rounded-2xl border border-mse-light shadow-card p-5 space-y-3">
        <span className={labelCls}>Utility</span>
        <div className="flex flex-wrap gap-1.5">
          {UTILITIES.map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => pickUtility(u)}
              className={cn(
                "px-3.5 py-2 rounded-lg text-sm font-bold border-2 active:scale-95",
                utilityName === u
                  ? "border-mse-navy bg-mse-navy text-white"
                  : "border-mse-light text-mse-muted hover:text-mse-navy"
              )}
            >
              {u}
            </button>
          ))}
        </div>
        {programs.length > 1 && (
          <div>
            <span className={labelCls}>Program size</span>
            <div className="space-y-1">
              {programs.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setUtility(p)}
                  aria-pressed={utility === p}
                  className={cn(
                    "w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-left text-sm font-semibold active:scale-[0.99]",
                    utility === p
                      ? "border-mse-navy bg-mse-navy/5 text-mse-navy"
                      : "border-mse-light text-mse-navy hover:border-mse-navy/30"
                  )}
                >
                  {UTILITY_PROGRAM_LABELS[p]}
                  {utility === p && <Check className="w-4 h-4 shrink-0" />}
                </button>
              ))}
            </div>
          </div>
        )}
        {!utility && (
          <p className="text-xs text-mse-muted">
            Pick the utility to pull up the right paperwork.
          </p>
        )}
      </div>

      {utility && (
        <>
          {/* ── Details ── */}
          <div className="bg-white rounded-2xl border border-mse-light shadow-card p-5 space-y-4">
            <div className="font-bold text-mse-navy text-sm">
              1 · Customer details
            </div>

            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void scanBill(f);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={scanState === "scanning"}
              className={cn(
                "w-full inline-flex items-center justify-center gap-2 rounded-xl py-3 px-4 font-bold text-sm border-2 border-dashed active:scale-[0.98]",
                scanState === "scanning"
                  ? "border-mse-light text-mse-muted cursor-wait"
                  : "border-mse-gold/60 bg-mse-gold/10 text-mse-navy hover:bg-mse-gold/20"
              )}
            >
              {scanState === "scanning" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Camera className="w-4 h-4" />
              )}
              {scanState === "scanning"
                ? "Reading the bill…"
                : "Scan a utility bill to auto-fill"}
            </button>
            {scanState === "done" && (
              <div className="rounded-xl bg-mse-gold/15 border border-mse-gold/30 px-3 py-2 text-xs text-mse-navy flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-mse-gold shrink-0" />
                Auto-filled from the bill — double-check before sending.
              </div>
            )}
            {(scanState === "unreadable" || scanState === "busy") && (
              <div className="rounded-xl bg-mse-light/40 border border-mse-light px-3 py-2 text-xs text-mse-muted flex items-center gap-2">
                <X className="w-3.5 h-3.5 shrink-0" />
                {scanState === "busy"
                  ? "Scanner is busy — type the details in."
                  : "Couldn't read that bill clearly. Type the details in."}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2.5">
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

            {/* Utility enrollment IDs — captured from the bill (esp.
                PEPCO/BGE), stored for the office. Optional. */}
            <div className="grid grid-cols-2 gap-2.5">
              <label className="block">
                <span className={labelCls}>Choice ID</span>
                <input
                  value={choiceId}
                  onChange={(e) => setChoiceId(e.target.value)}
                  placeholder="From the bill (optional)"
                  className={input}
                />
              </label>
              <label className="block">
                <span className={labelCls}>Service ID</span>
                <input
                  value={serviceId}
                  onChange={(e) => setServiceId(e.target.value)}
                  placeholder="From the bill (optional)"
                  className={input}
                />
              </label>
            </div>

            <label className="block">
              <span className={labelCls}>Notes (customer won&apos;t see this)</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Follow-up notes, best time to call…"
                className={cn(input, "resize-none")}
              />
            </label>

            <div className="rounded-xl border border-mse-light p-3 space-y-2">
              <div className={labelCls}>Assign the job now (optional)</div>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={assignTech}
                  onChange={(e) => setAssignTech(e.target.value)}
                  className={input}
                >
                  <option value="">Leave unassigned</option>
                  {crewTechs.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <input
                  type="date"
                  value={assignDate}
                  onChange={(e) => setAssignDate(e.target.value)}
                  disabled={!assignTech}
                  className={cn(input, !assignTech && "opacity-50")}
                />
              </div>
            </div>
          </div>

          {/* ── Live paperwork ── */}
          <div>
            <div className="font-bold text-mse-navy text-sm px-1 mb-2">
              2 · Review the paperwork
            </div>
            <FormsPreview
              packetKey={utility}
              fields={fields}
              primaryUse={primaryUse}
              customerType={customerType}
              sigDataUrl={finishMode === "sign" ? sigDataUrl : null}
            />
          </div>

          {/* ── Finish ── */}
          <div className="bg-white rounded-2xl border border-mse-light shadow-card p-5 space-y-4">
            <div className="font-bold text-mse-navy text-sm">3 · Finish</div>

            <div className="grid grid-cols-3 gap-1.5">
              {(
                [
                  { m: "sign", label: "Sign now", icon: <PenLine className="w-3.5 h-3.5" /> },
                  { m: "text", label: "Text link", icon: <MessageSquare className="w-3.5 h-3.5" /> },
                  { m: "email", label: "Email link", icon: <Mail className="w-3.5 h-3.5" /> },
                ] as const
              ).map((t) => (
                <button
                  key={t.m}
                  type="button"
                  onClick={() => setFinishMode(t.m)}
                  className={cn(
                    "inline-flex items-center justify-center gap-1.5 px-2 py-2.5 rounded-xl text-xs font-bold border-2 active:scale-[0.98]",
                    finishMode === t.m
                      ? "border-mse-navy bg-mse-navy/5 text-mse-navy"
                      : "border-mse-light text-mse-muted hover:text-mse-navy"
                  )}
                >
                  {t.icon}
                  {t.label}
                </button>
              ))}
            </div>

            {finishMode === "sign" ? (
              <>
                <p className="text-xs text-mse-muted">
                  Customer signs on this device — your signature drops into
                  every &quot;Sign here&quot; spot above.
                </p>
                <SignaturePad
                  signedName={signedName}
                  onSignedName={setSignedName}
                  consent={consent}
                  onConsent={setConsent}
                  sigDataUrl={sigDataUrl}
                  onSignatureChange={setSigDataUrl}
                />
              </>
            ) : (
              <p className="text-xs text-mse-muted">
                We&apos;ll save this lead and open{" "}
                {finishMode === "text" ? "a text message" : "an email"} to the
                customer with a secure link. They review the same paperwork and
                sign on their own device. The job creates itself once signed.
              </p>
            )}

            {error && (
              <div className="text-xs text-mse-red bg-mse-red/5 border border-mse-red/20 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={() =>
                finishMode === "sign" ? handleSignNow() : handleSend(finishMode)
              }
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
              ) : finishMode === "sign" ? (
                <CheckCircle2 className="w-4 h-4" />
              ) : finishMode === "text" ? (
                <MessageSquare className="w-4 h-4" />
              ) : (
                <Mail className="w-4 h-4" />
              )}
              {submitting
                ? "Working…"
                : finishMode === "sign"
                ? "Agree and sign all documents"
                : finishMode === "text"
                ? "Save and text the link"
                : "Save and email the link"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
