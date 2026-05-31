"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  CheckCircle2,
  Crown,
  Loader2,
  MapPin,
  ScrollText,
  ShoppingBag,
  Truck,
  Users,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { UtilityTerritory } from "@/lib/types";

const TERRITORIES: UtilityTerritory[] = ["BGE", "PEPCO", "Delmarva", "SMECO"];

interface Props {
  /** Techs eligible to go on-site (crewEligible=TRUE). */
  crewEligibleTechs: string[];
  /** All active tech names, including office admins. Used for the
   *  project-lead + sales-rep dropdowns where office admins are
   *  allowed. */
  allTechs: string[];
}

export function NewProjectForm({ crewEligibleTechs, allTechs }: Props) {
  const router = useRouter();
  const [customerName, setCustomerName] = useState("");
  const [siteAddress, setSiteAddress] = useState("");
  const [territory, setTerritory] = useState<UtilityTerritory>("BGE");
  const [projectLead, setProjectLead] = useState("");
  const [salesRep, setSalesRep] = useState("");
  const [crew, setCrew] = useState<string[]>([]);
  const [drivers, setDrivers] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const crewSplit = useMemo(() => {
    if (crew.length <= 1) return "Solo";
    if (crew.length === 2) return "50-50";
    return "33-33-33";
  }, [crew.length]);

  // Keep drivers consistent — anyone removed from crew gets pulled
  // out of the drivers list too.
  useEffect(() => {
    setDrivers((prev) => prev.filter((d) => crew.includes(d)));
  }, [crew]);

  const toggleCrew = (name: string) => {
    setCrew((prev) =>
      prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name]
    );
  };

  const toggleDriver = (name: string) => {
    setDrivers((prev) =>
      prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name]
    );
  };

  const canSubmit =
    customerName.trim().length > 0 &&
    TERRITORIES.includes(territory) &&
    !submitting;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: customerName.trim(),
          siteAddress: siteAddress.trim(),
          utilityTerritory: territory,
          projectLead,
          salesRep,
          crew,
          drivers,
          notes: notes.trim(),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        job?: { jobId?: string };
      };
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? `Server error ${res.status}`);
      }
      const newJobId = body.job?.jobId;
      if (!newJobId) throw new Error("Project created but no jobId returned");
      router.push(`/jobs/${encodeURIComponent(newJobId)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create project");
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      {/* ── The basics ─────────────────────────────────────────── */}
      <Section
        icon={<Building2 className="w-4 h-4 text-mse-gold" />}
        title="The basics"
        hint="Who is this for and where."
      >
        <Field label="Customer name" required>
          <input
            type="text"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="Acme Office Tower"
            autoCapitalize="words"
            className={baseInput}
            autoFocus
          />
        </Field>

        <Field label="Site address">
          <div className="relative">
            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-mse-muted" />
            <input
              type="text"
              value={siteAddress}
              onChange={(e) => setSiteAddress(e.target.value)}
              placeholder="123 Main St, Baltimore, MD"
              className={cn(baseInput, "pl-9")}
            />
          </div>
        </Field>

        <Field label="Utility territory" required>
          <div className="grid grid-cols-4 gap-1.5">
            {TERRITORIES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTerritory(t)}
                className={cn(
                  "px-2 py-2 rounded-lg text-sm font-bold border-2 transition-[background-color,border-color,color]",
                  "active:scale-[0.97]",
                  territory === t
                    ? "bg-mse-navy border-mse-navy text-white"
                    : "bg-white border-mse-light text-mse-muted hover:text-mse-navy hover:border-mse-navy/30"
                )}
              >
                <Zap className="w-3 h-3 inline mr-1 -mt-0.5" />
                {t}
              </button>
            ))}
          </div>
        </Field>
      </Section>

      {/* ── Role assignments ───────────────────────────────────── */}
      <Section
        icon={<Crown className="w-4 h-4 text-mse-gold" />}
        title="Roles"
        hint="Who runs the project and who's on-site."
      >
        <div className="grid sm:grid-cols-2 gap-3">
          <Field
            label="Project Lead"
            hint="The tech in charge of this project end-to-end."
            iconBefore={<Crown className="w-3.5 h-3.5 text-mse-gold" />}
          >
            <select
              value={projectLead}
              onChange={(e) => setProjectLead(e.target.value)}
              className={baseInput}
            >
              <option value="">— None —</option>
              {allTechs.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Sales Rep"
            hint="Setting a rep flags this as self-sold and credits them on commission."
            iconBefore={
              <ShoppingBag className="w-3.5 h-3.5 text-mse-gold" />
            }
          >
            <select
              value={salesRep}
              onChange={(e) => setSalesRep(e.target.value)}
              className={baseInput}
            >
              <option value="">— None / not self-sold —</option>
              {allTechs.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field
          label="Initial crew"
          hint={`Pick the techs going on-site. Pay split is derived from headcount: ${crewSplit}.`}
          iconBefore={<Users className="w-3.5 h-3.5 text-mse-gold" />}
        >
          <div className="flex flex-wrap gap-1.5">
            {crewEligibleTechs.map((t) => {
              const picked = crew.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleCrew(t)}
                  className={cn(
                    "px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-[background-color,border-color,color]",
                    "active:scale-95",
                    picked
                      ? "bg-mse-navy border-mse-navy text-white"
                      : "bg-white border-mse-light text-mse-muted hover:border-mse-navy/30 hover:text-mse-navy"
                  )}
                >
                  {picked && <CheckCircle2 className="w-3 h-3 inline mr-1 -mt-0.5" />}
                  {t}
                </button>
              );
            })}
          </div>
          {crew.length > 0 && (
            <div className="text-[11px] text-mse-muted mt-2">
              <strong className="text-mse-navy">{crew.length}</strong> on
              crew · split <strong className="text-mse-navy">{crewSplit}</strong>
            </div>
          )}
        </Field>

        {crew.length >= 1 && (
          <Field
            label="Drivers (optional)"
            hint="Pick everyone who's driving to the site. Multiple drivers split the travel pay evenly. Only relevant for travel territories (Delmarva / SMECO)."
            iconBefore={<Truck className="w-3.5 h-3.5 text-mse-gold" />}
          >
            <div className="flex flex-wrap gap-1.5">
              {crew.map((c) => {
                const picked = drivers.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => toggleDriver(c)}
                    className={cn(
                      "px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-[background-color,border-color,color]",
                      "active:scale-95",
                      picked
                        ? "bg-mse-gold/20 border-mse-gold text-mse-navy"
                        : "bg-white border-mse-light text-mse-muted hover:border-mse-navy/30 hover:text-mse-navy"
                    )}
                  >
                    {picked && (
                      <Truck className="w-3 h-3 inline mr-1 -mt-0.5" />
                    )}
                    {c}
                  </button>
                );
              })}
            </div>
            {drivers.length > 1 && (
              <div className="text-[11px] text-mse-muted mt-2">
                <strong className="text-mse-navy">{drivers.length}</strong>{" "}
                drivers — travel pay will split evenly.
              </div>
            )}
          </Field>
        )}
      </Section>

      {/* ── Notes ──────────────────────────────────────────────── */}
      <Section
        icon={<ScrollText className="w-4 h-4 text-mse-gold" />}
        title="Notes"
        hint="Anything worth flagging on the project."
      >
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Access details, key contact, urgency, anything to call out."
          className={cn(baseInput, "resize-none")}
        />
      </Section>

      {error && (
        <div className="text-sm text-mse-red bg-mse-red/5 border border-mse-red/20 rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={() => router.back()}
          className="px-4 py-2.5 rounded-xl text-sm font-bold text-mse-muted hover:text-mse-navy"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!canSubmit}
          className={cn(
            "inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-bold",
            "transition-[background-color,transform] active:scale-95",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mse-red focus-visible:ring-offset-2",
            canSubmit
              ? "bg-mse-navy hover:bg-mse-navy-soft text-white shadow-card"
              : "bg-mse-light text-mse-muted cursor-not-allowed"
          )}
        >
          {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
          {submitting ? "Creating…" : "Create project"}
        </button>
      </div>
    </form>
  );
}

// ─── Layout primitives ─────────────────────────────────────────

const baseInput =
  "w-full px-3 py-2 rounded-lg border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy";

function Section({
  icon,
  title,
  hint,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-white border border-mse-light shadow-card p-5 space-y-4">
      <div>
        <div className="flex items-center gap-1.5 text-mse-navy">
          {icon}
          <h2 className="font-bold">{title}</h2>
        </div>
        {hint && (
          <div className="text-[11px] text-mse-muted mt-0.5">{hint}</div>
        )}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  hint,
  required,
  iconBefore,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  iconBefore?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1 flex items-center gap-1">
        {iconBefore}
        {label}
        {required && <span className="text-mse-red">*</span>}
      </div>
      {children}
      {hint && (
        <div className="text-[11px] text-mse-muted mt-1">{hint}</div>
      )}
    </label>
  );
}
