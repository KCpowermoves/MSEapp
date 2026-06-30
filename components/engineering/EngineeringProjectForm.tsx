"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Calculator,
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  Minus,
  Plus,
  Receipt,
  Snowflake,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  EngineeringLocation,
  EngineeringProject,
  EngineeringProjectStatus,
  EngineeringProjectType,
  EngineeringUtility,
  HvacUnitInput,
  MonthlyBill,
  WalkInUnitInput,
} from "@/lib/types";

const UTILITIES: EngineeringUtility[] = ["BGE", "PEPCO", "Delmarva", "SMECO"];
const PROJECT_TYPES: EngineeringProjectType[] = ["Small", "Medium", "Large"];

interface Props {
  project: EngineeringProject;
}

function blankBill(): MonthlyBill {
  return { startDate: "", endDate: "", usage: 0, hdd: 0, cdd: 0 };
}
function blankHvac(): HvacUnitInput {
  return {
    tag: "",
    serves: "",
    tstat: "",
    tons: 0,
    ouModel: "",
    qty: 1,
    seer: 0,
    supplyFanHp: 0,
    heatPump: "No",
    electricHeatKw: 0,
    controls: "",
    proposedSchedule: "",
    notes: "",
  };
}

export function EngineeringProjectForm({ project }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<
    "save" | "xlsx" | "sow" | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  // Top-level state
  const [customerName, setCustomerName] = useState(project.customerName);
  const [siteAddress, setSiteAddress] = useState(project.siteAddress);
  const [utility, setUtility] = useState(project.utility);
  const [projectType, setProjectType] = useState(project.projectType);
  const [projectSubtype, setProjectSubtype] = useState(project.projectSubtype);
  const [squareFootage, setSquareFootage] = useState(project.squareFootage);
  const [location, setLocation] = useState(project.location);
  const [engineeringFeeOverride, setEngineeringFeeOverride] = useState<
    number | null
  >(project.engineeringFeeOverride);
  const [sensorCostOverride, setSensorCostOverride] = useState<number | null>(
    project.sensorCostOverride
  );
  const [notes, setNotes] = useState(project.notes);
  const [status, setStatus] = useState<EngineeringProjectStatus>(
    project.status
  );

  // Equipment arrays
  const [monthlyBills, setMonthlyBills] = useState<MonthlyBill[]>(
    project.monthlyBills
  );
  const [hvacUnits, setHvacUnits] = useState<HvacUnitInput[]>(
    project.hvacUnits
  );
  const [walkInUnits, setWalkInUnits] = useState<WalkInUnitInput[]>(
    project.walkInUnits
  );

  const annualKwh = useMemo(
    () => monthlyBills.reduce((sum, b) => sum + (Number(b.usage) || 0), 0),
    [monthlyBills]
  );

  const coolers = walkInUnits.filter((w) => w.kind === "Cooler");
  const freezers = walkInUnits.filter((w) => w.kind === "Freezer");

  async function save() {
    setBusy("save");
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/engineering/${encodeURIComponent(project.projectId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customerName,
            siteAddress,
            utility,
            projectType,
            projectSubtype,
            squareFootage,
            location,
            engineeringFeeOverride,
            sensorCostOverride,
            monthlyBills,
            hvacUnits,
            walkInUnits,
            annualKwh,
            status,
            notes,
          }),
        }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Save failed");
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(null);
    }
  }

  async function download(kind: "xlsx" | "sow") {
    setBusy(kind);
    setError(null);
    try {
      // Save first so the download uses the latest data.
      await save();
      window.location.assign(
        `/api/admin/engineering/${encodeURIComponent(project.projectId)}/${kind}`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="space-y-6">
        {/* ── Project info ── */}
        <Section
          icon={<Building2 className="w-4 h-4 text-mse-gold" />}
          title="Project info"
        >
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Customer / project name" required>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className={baseInput}
              />
            </Field>
            <Field label="Site address">
              <input
                type="text"
                value={siteAddress}
                onChange={(e) => setSiteAddress(e.target.value)}
                placeholder="e.g. 6801 Riverdale Rd, Riverdale, MD 20737"
                className={baseInput}
              />
            </Field>
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            <Field label="Utility">
              <select
                value={utility}
                onChange={(e) =>
                  setUtility(e.target.value as EngineeringUtility)
                }
                className={baseInput}
              >
                {UTILITIES.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Project type"
              hint="Drives rebate cap (Small/Medium/Large)"
            >
              <select
                value={projectType}
                onChange={(e) =>
                  setProjectType(e.target.value as EngineeringProjectType)
                }
                className={baseInput}
              >
                {PROJECT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Project subtype">
              <input
                type="text"
                value={projectSubtype}
                onChange={(e) => setProjectSubtype(e.target.value)}
                placeholder="e.g. Building Tune-up"
                className={baseInput}
              />
            </Field>
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            <Field label="Square footage">
              <input
                type="number"
                value={squareFootage || ""}
                onChange={(e) => setSquareFootage(Number(e.target.value) || 0)}
                className={baseInput}
              />
            </Field>
            <Field
              label="Location"
              hint="TMY3 weather data. v1 supports BWI only."
            >
              <select
                value={location}
                onChange={(e) =>
                  setLocation(e.target.value as EngineeringLocation)
                }
                className={baseInput}
              >
                <option value="BWI">BWI</option>
                <option value="Andrews" disabled>
                  Andrews (coming soon)
                </option>
              </select>
            </Field>
            <Field label="Status">
              <select
                value={status}
                onChange={(e) =>
                  setStatus(e.target.value as EngineeringProjectStatus)
                }
                className={baseInput}
              >
                <option value="Draft">Draft</option>
                <option value="Final">Final</option>
              </select>
            </Field>
          </div>
        </Section>

        {/* ── Utility bills ── */}
        <Section
          icon={<Receipt className="w-4 h-4 text-mse-gold" />}
          title="Utility bills"
          hint={`Monthly utility data. Annual total auto-calculates from kWh column.`}
        >
          <div className="text-xs text-mse-muted">
            <strong className="text-mse-navy">{monthlyBills.length}</strong>{" "}
            month{monthlyBills.length === 1 ? "" : "s"} entered · annual ≈{" "}
            <strong className="text-mse-navy tabular-nums">
              {annualKwh.toLocaleString()}
            </strong>{" "}
            kWh
          </div>
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-mse-muted">
                  <th className="text-left p-1">Start</th>
                  <th className="text-left p-1">End</th>
                  <th className="text-right p-1">kWh</th>
                  <th className="text-right p-1">HDD</th>
                  <th className="text-right p-1">CDD</th>
                  <th className="text-right p-1">Demand</th>
                  <th className="text-right p-1">Dmd Cost</th>
                  <th className="p-1" />
                </tr>
              </thead>
              <tbody>
                {monthlyBills.map((b, i) => (
                  <tr key={i} className="border-t border-mse-light/60">
                    <td className="p-1">
                      <input
                        type="date"
                        value={b.startDate}
                        onChange={(e) =>
                          setMonthlyBills(
                            monthlyBills.map((x, j) =>
                              j === i ? { ...x, startDate: e.target.value } : x
                            )
                          )
                        }
                        className={tableInput}
                      />
                    </td>
                    <td className="p-1">
                      <input
                        type="date"
                        value={b.endDate}
                        onChange={(e) =>
                          setMonthlyBills(
                            monthlyBills.map((x, j) =>
                              j === i ? { ...x, endDate: e.target.value } : x
                            )
                          )
                        }
                        className={tableInput}
                      />
                    </td>
                    <td className="p-1">
                      <input
                        type="number"
                        value={b.usage || ""}
                        onChange={(e) =>
                          setMonthlyBills(
                            monthlyBills.map((x, j) =>
                              j === i
                                ? { ...x, usage: Number(e.target.value) || 0 }
                                : x
                            )
                          )
                        }
                        className={cn(tableInput, "text-right tabular-nums")}
                      />
                    </td>
                    <td className="p-1">
                      <input
                        type="number"
                        value={b.hdd || ""}
                        step="0.1"
                        onChange={(e) =>
                          setMonthlyBills(
                            monthlyBills.map((x, j) =>
                              j === i
                                ? { ...x, hdd: Number(e.target.value) || 0 }
                                : x
                            )
                          )
                        }
                        className={cn(tableInput, "text-right tabular-nums")}
                      />
                    </td>
                    <td className="p-1">
                      <input
                        type="number"
                        value={b.cdd || ""}
                        step="0.1"
                        onChange={(e) =>
                          setMonthlyBills(
                            monthlyBills.map((x, j) =>
                              j === i
                                ? { ...x, cdd: Number(e.target.value) || 0 }
                                : x
                            )
                          )
                        }
                        className={cn(tableInput, "text-right tabular-nums")}
                      />
                    </td>
                    <td className="p-1">
                      <input
                        type="number"
                        value={b.demandKw ?? ""}
                        step="0.1"
                        onChange={(e) =>
                          setMonthlyBills(
                            monthlyBills.map((x, j) =>
                              j === i
                                ? {
                                    ...x,
                                    demandKw:
                                      e.target.value === ""
                                        ? undefined
                                        : Number(e.target.value),
                                  }
                                : x
                            )
                          )
                        }
                        className={cn(tableInput, "text-right tabular-nums")}
                      />
                    </td>
                    <td className="p-1">
                      <input
                        type="number"
                        value={b.demandCost ?? ""}
                        step="0.01"
                        onChange={(e) =>
                          setMonthlyBills(
                            monthlyBills.map((x, j) =>
                              j === i
                                ? {
                                    ...x,
                                    demandCost:
                                      e.target.value === ""
                                        ? undefined
                                        : Number(e.target.value),
                                  }
                                : x
                            )
                          )
                        }
                        className={cn(tableInput, "text-right tabular-nums")}
                      />
                    </td>
                    <td className="p-1 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          setMonthlyBills(
                            monthlyBills.filter((_, j) => j !== i)
                          )
                        }
                        className="p-1 rounded text-mse-muted hover:text-mse-red hover:bg-mse-red/10"
                        aria-label="Remove month"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            onClick={() => setMonthlyBills([...monthlyBills, blankBill()])}
            className={addBtn}
          >
            <Plus className="w-3 h-3" /> Add month
          </button>
        </Section>

        {/* ── HVAC ── */}
        <Section
          icon={<Wrench className="w-4 h-4 text-mse-gold" />}
          title="HVAC units"
          hint="Each row = one unit. Goes into the Unit List sheet."
        >
          <div className="space-y-2">
            {hvacUnits.map((u, i) => (
              <div
                key={i}
                className="rounded-xl border border-mse-light bg-white p-3 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] uppercase tracking-wider font-bold text-mse-gold">
                    HVAC unit {i + 1}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setHvacUnits(hvacUnits.filter((_, j) => j !== i))
                    }
                    className="text-[11px] text-mse-muted hover:text-mse-red"
                  >
                    Remove
                  </button>
                </div>
                <div className="grid sm:grid-cols-3 gap-2 text-xs">
                  <SmallField label="Tag">
                    <input
                      type="text"
                      value={u.tag}
                      onChange={(e) =>
                        setHvacUnits(
                          hvacUnits.map((x, j) =>
                            j === i ? { ...x, tag: e.target.value } : x
                          )
                        )
                      }
                      placeholder="Unit 1"
                      className={smallInput}
                    />
                  </SmallField>
                  <SmallField label="Serves">
                    <input
                      type="text"
                      value={u.serves}
                      onChange={(e) =>
                        setHvacUnits(
                          hvacUnits.map((x, j) =>
                            j === i ? { ...x, serves: e.target.value } : x
                          )
                        )
                      }
                      placeholder="Common space"
                      className={smallInput}
                    />
                  </SmallField>
                  <SmallField label="Tstat">
                    <input
                      type="text"
                      value={u.tstat}
                      onChange={(e) =>
                        setHvacUnits(
                          hvacUnits.map((x, j) =>
                            j === i ? { ...x, tstat: e.target.value } : x
                          )
                        )
                      }
                      placeholder="P"
                      className={smallInput}
                    />
                  </SmallField>
                  <SmallField label="Tons">
                    <input
                      type="number"
                      value={u.tons || ""}
                      step="0.1"
                      onChange={(e) =>
                        setHvacUnits(
                          hvacUnits.map((x, j) =>
                            j === i
                              ? { ...x, tons: Number(e.target.value) || 0 }
                              : x
                          )
                        )
                      }
                      className={smallInput}
                    />
                  </SmallField>
                  <SmallField label="OU Model">
                    <input
                      type="text"
                      value={u.ouModel}
                      onChange={(e) =>
                        setHvacUnits(
                          hvacUnits.map((x, j) =>
                            j === i ? { ...x, ouModel: e.target.value } : x
                          )
                        )
                      }
                      placeholder="48TCED24ACA5A0B0A0"
                      className={smallInput}
                    />
                  </SmallField>
                  <SmallField label="QTY">
                    <input
                      type="number"
                      value={u.qty || ""}
                      onChange={(e) =>
                        setHvacUnits(
                          hvacUnits.map((x, j) =>
                            j === i
                              ? { ...x, qty: Number(e.target.value) || 0 }
                              : x
                          )
                        )
                      }
                      className={smallInput}
                    />
                  </SmallField>
                  <SmallField label="SEER">
                    <input
                      type="number"
                      value={u.seer || ""}
                      step="0.1"
                      onChange={(e) =>
                        setHvacUnits(
                          hvacUnits.map((x, j) =>
                            j === i
                              ? { ...x, seer: Number(e.target.value) || 0 }
                              : x
                          )
                        )
                      }
                      className={smallInput}
                    />
                  </SmallField>
                  <SmallField label="Fan HP">
                    <input
                      type="number"
                      value={u.supplyFanHp || ""}
                      step="0.1"
                      onChange={(e) =>
                        setHvacUnits(
                          hvacUnits.map((x, j) =>
                            j === i
                              ? {
                                  ...x,
                                  supplyFanHp: Number(e.target.value) || 0,
                                }
                              : x
                          )
                        )
                      }
                      className={smallInput}
                    />
                  </SmallField>
                  <SmallField label="Heat Pump">
                    <select
                      value={u.heatPump}
                      onChange={(e) =>
                        setHvacUnits(
                          hvacUnits.map((x, j) =>
                            j === i ? { ...x, heatPump: e.target.value } : x
                          )
                        )
                      }
                      className={smallInput}
                    >
                      <option>No</option>
                      <option>Yes</option>
                    </select>
                  </SmallField>
                  <SmallField label="Electric Heat kW">
                    <input
                      type="number"
                      value={u.electricHeatKw ?? ""}
                      step="0.1"
                      onChange={(e) =>
                        setHvacUnits(
                          hvacUnits.map((x, j) =>
                            j === i
                              ? {
                                  ...x,
                                  electricHeatKw:
                                    e.target.value === ""
                                      ? 0
                                      : Number(e.target.value),
                                }
                              : x
                          )
                        )
                      }
                      className={smallInput}
                    />
                  </SmallField>
                  <SmallField label="Controls">
                    <input
                      type="text"
                      value={u.controls}
                      onChange={(e) =>
                        setHvacUnits(
                          hvacUnits.map((x, j) =>
                            j === i ? { ...x, controls: e.target.value } : x
                          )
                        )
                      }
                      placeholder="Programmable thermostat"
                      className={smallInput}
                    />
                  </SmallField>
                  <SmallField label="Schedule">
                    <input
                      type="text"
                      value={u.proposedSchedule}
                      onChange={(e) =>
                        setHvacUnits(
                          hvacUnits.map((x, j) =>
                            j === i
                              ? { ...x, proposedSchedule: e.target.value }
                              : x
                          )
                        )
                      }
                      placeholder="10am-10pm Mon-Sun"
                      className={smallInput}
                    />
                  </SmallField>
                </div>
                <SmallField label="Notes">
                  <textarea
                    value={u.notes}
                    onChange={(e) =>
                      setHvacUnits(
                        hvacUnits.map((x, j) =>
                          j === i ? { ...x, notes: e.target.value } : x
                        )
                      )
                    }
                    rows={1}
                    className={cn(smallInput, "resize-none")}
                  />
                </SmallField>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setHvacUnits([...hvacUnits, blankHvac()])}
              className={addBtn}
            >
              <Plus className="w-3 h-3" /> Add HVAC unit
            </button>
          </div>
        </Section>

        {/* ── Walk-ins ── */}
        <Section
          icon={<Snowflake className="w-4 h-4 text-mse-gold" />}
          title="Walk-in units"
          hint="Coolers + freezers. Goes into the Walk-in Units List sheet."
        >
          <WalkInGroup
            kind="Cooler"
            items={coolers}
            onChange={(next) =>
              setWalkInUnits([...next, ...freezers])
            }
          />
          <WalkInGroup
            kind="Freezer"
            items={freezers}
            onChange={(next) =>
              setWalkInUnits([...coolers, ...next])
            }
          />
        </Section>

        {/* ── Engineering settings ── */}
        <Section
          icon={<Calculator className="w-4 h-4 text-mse-gold" />}
          title="Engineering settings"
          hint="Optional overrides. Leave blank to use the calculator's defaults."
        >
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Engineering fee override ($)">
              <input
                type="number"
                value={engineeringFeeOverride ?? ""}
                step="0.01"
                onChange={(e) =>
                  setEngineeringFeeOverride(
                    e.target.value === "" ? null : Number(e.target.value)
                  )
                }
                placeholder="(default)"
                className={baseInput}
              />
            </Field>
            <Field label="Sensor cost override ($)">
              <input
                type="number"
                value={sensorCostOverride ?? ""}
                step="0.01"
                onChange={(e) =>
                  setSensorCostOverride(
                    e.target.value === "" ? null : Number(e.target.value)
                  )
                }
                placeholder="(default)"
                className={baseInput}
              />
            </Field>
          </div>
          <Field label="Project notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Anything worth flagging on this project"
              className={cn(baseInput, "resize-none")}
            />
          </Field>
        </Section>

        {error && (
          <div className="text-sm text-mse-red bg-mse-red/5 border border-mse-red/20 rounded-xl px-4 py-3">
            {error}
          </div>
        )}
      </div>

      {/* Bottom action bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-mse-light p-4 z-10 safe-bottom">
        <div className="max-w-2xl mx-auto flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={save}
            disabled={busy !== null}
            className={cn(
              "inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold",
              "bg-mse-navy text-white hover:bg-mse-navy-soft shadow-card active:scale-95",
              busy === "save" && "opacity-70"
            )}
          >
            {busy === "save" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <CheckCircle2 className="w-4 h-4" />
            )}
            Save
          </button>
          <div className="grow" />
          <button
            type="button"
            onClick={() => download("xlsx")}
            disabled={busy !== null}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold",
              "bg-mse-gold text-mse-navy hover:bg-mse-gold/90 active:scale-95",
              busy === "xlsx" && "opacity-70"
            )}
          >
            {busy === "xlsx" ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            Calculator .xlsx
          </button>
          <button
            type="button"
            onClick={() => download("sow")}
            disabled={busy !== null}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold",
              "bg-white border border-mse-light text-mse-navy hover:border-mse-navy/30 active:scale-95",
              busy === "sow" && "opacity-70"
            )}
          >
            {busy === "sow" ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FileText className="w-3.5 h-3.5" />
            )}
            SOW .docx
          </button>
        </div>
      </div>
    </>
  );
}

function WalkInGroup({
  kind,
  items,
  onChange,
}: {
  kind: "Cooler" | "Freezer";
  items: WalkInUnitInput[];
  onChange: (next: WalkInUnitInput[]) => void;
}) {
  function blank(): WalkInUnitInput {
    return {
      kind,
      tag: "",
      condenserModel: "",
      serial: "",
      evaporatorModel: "",
      tonnage: 0,
      mbh: 0,
      watts: 0,
      awef: 0,
      fanMotorHp: 0,
      numFans: 0,
    };
  }
  return (
    <div className="space-y-2">
      <div className="text-[11px] uppercase tracking-wider font-bold text-mse-muted">
        {kind}s ({items.length})
      </div>
      {items.map((u, i) => (
        <div
          key={`${kind}-${i}`}
          className="rounded-xl border border-mse-light bg-white p-3 space-y-2"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] uppercase tracking-wider font-bold text-mse-gold">
              {kind} {i + 1}
            </div>
            <button
              type="button"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              className="text-[11px] text-mse-muted hover:text-mse-red"
            >
              Remove
            </button>
          </div>
          <div className="grid sm:grid-cols-3 gap-2 text-xs">
            <SmallField label="Tag">
              <input
                type="text"
                value={u.tag}
                onChange={(e) =>
                  onChange(
                    items.map((x, j) =>
                      j === i ? { ...x, tag: e.target.value } : x
                    )
                  )
                }
                className={smallInput}
              />
            </SmallField>
            <SmallField label="Condenser Model">
              <input
                type="text"
                value={u.condenserModel}
                onChange={(e) =>
                  onChange(
                    items.map((x, j) =>
                      j === i ? { ...x, condenserModel: e.target.value } : x
                    )
                  )
                }
                className={smallInput}
              />
            </SmallField>
            <SmallField label="Serial">
              <input
                type="text"
                value={u.serial}
                onChange={(e) =>
                  onChange(
                    items.map((x, j) =>
                      j === i ? { ...x, serial: e.target.value } : x
                    )
                  )
                }
                className={smallInput}
              />
            </SmallField>
            <SmallField label="Evaporator Model">
              <input
                type="text"
                value={u.evaporatorModel}
                onChange={(e) =>
                  onChange(
                    items.map((x, j) =>
                      j === i
                        ? { ...x, evaporatorModel: e.target.value }
                        : x
                    )
                  )
                }
                className={smallInput}
              />
            </SmallField>
            <SmallField label="Tonnage">
              <input
                type="number"
                step="0.01"
                value={u.tonnage || ""}
                onChange={(e) =>
                  onChange(
                    items.map((x, j) =>
                      j === i
                        ? { ...x, tonnage: Number(e.target.value) || 0 }
                        : x
                    )
                  )
                }
                className={smallInput}
              />
            </SmallField>
            <SmallField label="MBH">
              <input
                type="number"
                step="0.01"
                value={u.mbh || ""}
                onChange={(e) =>
                  onChange(
                    items.map((x, j) =>
                      j === i ? { ...x, mbh: Number(e.target.value) || 0 } : x
                    )
                  )
                }
                className={smallInput}
              />
            </SmallField>
            <SmallField label="Watts">
              <input
                type="number"
                value={u.watts || ""}
                onChange={(e) =>
                  onChange(
                    items.map((x, j) =>
                      j === i
                        ? { ...x, watts: Number(e.target.value) || 0 }
                        : x
                    )
                  )
                }
                className={smallInput}
              />
            </SmallField>
            <SmallField label="AWEF">
              <input
                type="number"
                step="0.01"
                value={u.awef || ""}
                onChange={(e) =>
                  onChange(
                    items.map((x, j) =>
                      j === i ? { ...x, awef: Number(e.target.value) || 0 } : x
                    )
                  )
                }
                className={smallInput}
              />
            </SmallField>
            <SmallField label="Fan Motor HP">
              <input
                type="number"
                step="0.01"
                value={u.fanMotorHp || ""}
                onChange={(e) =>
                  onChange(
                    items.map((x, j) =>
                      j === i
                        ? { ...x, fanMotorHp: Number(e.target.value) || 0 }
                        : x
                    )
                  )
                }
                className={smallInput}
              />
            </SmallField>
            <SmallField label="# Fans">
              <input
                type="number"
                value={u.numFans || ""}
                onChange={(e) =>
                  onChange(
                    items.map((x, j) =>
                      j === i
                        ? { ...x, numFans: Number(e.target.value) || 0 }
                        : x
                    )
                  )
                }
                className={smallInput}
              />
            </SmallField>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...items, blank()])}
        className={addBtn}
      >
        <Plus className="w-3 h-3" /> Add {kind.toLowerCase()}
      </button>
    </div>
  );
}

const baseInput =
  "w-full px-3 py-2 rounded-lg border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy";
const smallInput =
  "w-full px-2 py-1.5 rounded-md border border-mse-light bg-white text-xs focus:outline-none focus:border-mse-navy";
const tableInput =
  "w-full px-1.5 py-1 rounded border border-mse-light bg-white text-xs focus:outline-none focus:border-mse-navy";
const addBtn =
  "inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-mse-navy text-white hover:bg-mse-navy-soft active:scale-95";

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
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1">
        {label}
        {required && <span className="text-mse-red ml-1">*</span>}
      </div>
      {children}
      {hint && (
        <div className="text-[11px] text-mse-muted mt-1">{hint}</div>
      )}
    </label>
  );
}

function SmallField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-wider font-semibold text-mse-muted mb-0.5">
        {label}
      </div>
      {children}
    </label>
  );
}
