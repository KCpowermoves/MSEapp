"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Camera,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  Mail,
  MessageSquare,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ELECTRIC_OPTIONS,
  programsForElectric,
  UTILITY_PROGRAM_LABELS,
} from "@/lib/programs";
import type { Lead, UtilityProgram } from "@/lib/types";

// Sales-side lead capture. Replaces the Paperform: the agent is the
// logged-in user, the utility picker is a two-step (no 12-option
// dropdown), and a bill photo can prefill everything via OCR.
// On save the lead gets a signing token; the success screen offers the
// native /sign/[token] agreement — Sign-now / Text / Email / Copy.

interface BillScan {
  businessName: string;
  utility: string;
  accountNumber: string;
  address: string;
  city: string;
  zip: string;
  confidence: number;
  status: "ok" | "disabled" | "error" | "rate_limited";
}

export function NewLeadForm({
  crewTechs,
}: {
  /** Crew-eligible tech names for the optional at-sale assignment. */
  crewTechs: string[];
}) {
  const router = useRouter();

  const [businessName, setBusinessName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [zip, setZip] = useState("");
  const [electric, setElectric] =
    useState<(typeof ELECTRIC_OPTIONS)[number]>("BGE");
  const [utility, setUtility] = useState<UtilityProgram>("BGE");
  const [accountNumber, setAccountNumber] = useState("");
  const [hvacUnits, setHvacUnits] = useState("");
  const [notes, setNotes] = useState("");
  const [assignTech, setAssignTech] = useState("");
  const [assignDate, setAssignDate] = useState("");

  const [scanState, setScanState] = useState<
    "idle" | "scanning" | "done" | "unreadable" | "busy"
  >("idle");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedLead, setSavedLead] = useState<Lead | null>(null);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const programs = programsForElectric(electric);

  const pickElectric = (e: (typeof ELECTRIC_OPTIONS)[number]) => {
    setElectric(e);
    setUtility(programsForElectric(e)[0]);
  };

  const scanBill = async (file: File) => {
    setScanState("scanning");
    try {
      const fd = new FormData();
      fd.append("file", file, "bill.jpg");
      const res = await fetch("/api/ocr-bill", { method: "POST", body: fd });
      const data = (await res.json()) as BillScan;
      if (data.status === "rate_limited") {
        setScanState("busy");
        return;
      }
      if (data.status !== "ok" || data.confidence < 40) {
        setScanState("unreadable");
        return;
      }
      // Fill only empty fields — the agent's typing wins.
      if (data.businessName && !businessName) setBusinessName(data.businessName);
      if (data.accountNumber && !accountNumber) setAccountNumber(data.accountNumber);
      if (data.address && !address) setAddress(data.address);
      if (data.city && !city) setCity(data.city);
      if (data.zip && !zip) setZip(data.zip);
      if (data.utility) {
        if (data.utility === "Washington Gas") {
          pickElectric("None (gas only)");
        } else if (
          (ELECTRIC_OPTIONS as readonly string[]).includes(data.utility)
        ) {
          pickElectric(data.utility as (typeof ELECTRIC_OPTIONS)[number]);
        }
      }
      setScanState("done");
    } catch {
      setScanState("unreadable");
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName,
          contactName,
          email,
          phone,
          address,
          city,
          zip,
          utility,
          accountNumber,
          hvacUnits,
          notes,
          assignTech,
          assignDate,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        lead?: Lead;
      };
      if (!res.ok || !data.lead) {
        throw new Error(data.error ?? `Server error ${res.status}`);
      }
      setSavedLead(data.lead);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save lead");
      setSubmitting(false);
    }
  };

  // ── Success screen: deliver the agreement ─────────────────────────
  if (savedLead) {
    const url = `${window.location.origin}/sign/${savedLead.signToken}`;
    const smsBody = encodeURIComponent(
      `Hi ${savedLead.contactName || ""}! Here's your no-cost HVAC tune-up agreement from Maryland Smart Energy. Sign here: ${url}`
    );
    const emailSubject = encodeURIComponent(
      "Your HVAC Tune-Up Agreement — Maryland Smart Energy"
    );
    const emailBody = encodeURIComponent(
      `Hi ${savedLead.contactName || ""},\n\nGreat speaking with you. Here's the agreement for the no-cost HVAC tune-up program. Sign online here:\n\n${url}\n\nQuestions? Just reply or call me.\n\n${savedLead.agentName}`
    );
    const smsDigits = savedLead.phone.replace(/\D+/g, "");

    return (
      <div className="space-y-4">
        <div className="rounded-2xl bg-emerald-600/10 border-2 border-emerald-600/25 p-4 flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
          <div>
            <div className="font-bold text-mse-navy">
              Lead saved — {savedLead.leadId}
            </div>
            <p className="text-xs text-mse-muted mt-0.5">
              Agreement link is ready. When it&apos;s signed, the job creates
              itself{savedLead.assignTech ? ` and goes to ${savedLead.assignTech}` : " (unassigned)"}.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl py-3 px-4 font-bold text-sm bg-mse-navy hover:bg-mse-navy-soft text-white shadow-card active:scale-[0.98]"
          >
            <ExternalLink className="w-4 h-4" />
            Sign now on this phone
          </a>
          <div className="grid grid-cols-2 gap-2">
            {smsDigits.length >= 10 && (
              <a
                href={`sms:${smsDigits}?&body=${smsBody}`}
                className="inline-flex items-center justify-center gap-2 rounded-xl py-2.5 px-3 font-bold text-xs border-2 border-mse-navy text-mse-navy hover:bg-mse-navy hover:text-white active:scale-[0.98]"
              >
                <MessageSquare className="w-4 h-4" />
                Text to customer
              </a>
            )}
            {savedLead.email && (
              <a
                href={`mailto:${savedLead.email}?subject=${emailSubject}&body=${emailBody}`}
                className="inline-flex items-center justify-center gap-2 rounded-xl py-2.5 px-3 font-bold text-xs border-2 border-mse-navy text-mse-navy hover:bg-mse-navy hover:text-white active:scale-[0.98]"
              >
                <Mail className="w-4 h-4" />
                Email to customer
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
            {copied ? "Copied" : "Copy agreement link"}
          </button>
        </div>

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

  // ── The form ───────────────────────────────────────────────────────
  const input =
    "w-full px-3 py-2.5 rounded-lg border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy";
  const label =
    "text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1 block";

  return (
    <form onSubmit={submit} className="space-y-4">
      {/* Bill scan */}
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

      <div>
        <span className={label}>Business name</span>
        <input value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Patterson Deli" className={input} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <span className={label}>Contact name</span>
          <input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Who signs" className={input} />
        </div>
        <div>
          <span className={label}>Phone</span>
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(410) 555-0100" className={input} />
        </div>
      </div>
      <div>
        <span className={label}>Email</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="owner@business.com" className={input} />
      </div>
      <div>
        <span className={label}>Street address</span>
        <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="2711 Eastern Ave" className={input} />
      </div>
      <div className="grid grid-cols-[1.5fr_1fr] gap-2">
        <div>
          <span className={label}>City</span>
          <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Baltimore" className={input} />
        </div>
        <div>
          <span className={label}>Zip</span>
          <input inputMode="numeric" value={zip} onChange={(e) => setZip(e.target.value)} placeholder="21224" className={input} />
        </div>
      </div>

      {/* Two-step utility picker → exact agreement template */}
      <div>
        <span className={label}>Electric utility</span>
        <div className="flex flex-wrap gap-1.5">
          {ELECTRIC_OPTIONS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => pickElectric(e)}
              className={cn(
                "px-3 py-2 rounded-lg text-xs font-bold border-2 active:scale-95",
                electric === e
                  ? "border-mse-navy bg-mse-navy text-white"
                  : "border-mse-light text-mse-muted hover:text-mse-navy"
              )}
            >
              {e}
            </button>
          ))}
        </div>
      </div>
      <div>
        <span className={label}>Program / agreement</span>
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

      <div className="grid grid-cols-2 gap-2">
        <div>
          <span className={label}>Account number</span>
          <input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} placeholder="From the bill" className={input} />
        </div>
        <div>
          <span className={label}># of HVAC units</span>
          <input inputMode="numeric" value={hvacUnits} onChange={(e) => setHvacUnits(e.target.value)} placeholder="e.g. 4" className={input} />
        </div>
      </div>
      <div>
        <span className={label}>Notes (customer won&apos;t see this)</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Follow-up notes, best time to call…" className={cn(input, "resize-none")} />
      </div>

      {/* Optional at-sale assignment */}
      <div className="rounded-xl border border-mse-light p-3 space-y-2">
        <div className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted">
          Assign the job now (optional)
        </div>
        <div className="grid grid-cols-2 gap-2">
          <select value={assignTech} onChange={(e) => setAssignTech(e.target.value)} className={input}>
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
        <p className="text-[11px] text-mse-muted">
          When the agreement is signed, the job is created and this visit
          lands on the schedule automatically.
        </p>
      </div>

      {error && (
        <div className="text-xs text-mse-red bg-mse-red/5 border border-mse-red/20 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className={cn(
          "w-full inline-flex items-center justify-center gap-2 rounded-xl py-3 px-4 font-bold text-sm",
          "transition-[background-color,transform] active:scale-[0.98]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mse-navy focus-visible:ring-offset-2",
          submitting
            ? "bg-mse-light text-mse-muted cursor-not-allowed"
            : "bg-mse-navy hover:bg-mse-navy-soft text-white shadow-card"
        )}
      >
        {submitting ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Check className="w-4 h-4" />
        )}
        {submitting ? "Saving…" : "Save lead and get agreement link"}
      </button>
    </form>
  );
}
