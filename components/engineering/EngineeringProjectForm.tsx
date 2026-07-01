"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Calculator,
  CheckCircle2,
  Download,
  FileText,
  FlaskConical,
  Loader2,
  Minus,
  Plus,
  Receipt,
  Snowflake,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { JobLinkPicker } from "@/components/engineering/JobLinkPicker";
import {
  DocumentsSection,
  type OcrResult,
} from "@/components/engineering/DocumentsSection";
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

  function loadExampleData() {
    // Mango Grove — real values pulled from the actual preliminary
    // report PDF Kevin dropped in engineering/. Handy for smoke-testing
    // the full form + download flow end-to-end without typing.
    setCustomerName("Mango Grove (test)");
    setSiteAddress("8865 Standford Blvd, Unit 107 Columbia MD 21045");
    setUtility("BGE");
    setProjectType("Small");
    setProjectSubtype("Building Tune-up");
    setSquareFootage(4396);
    setLocation("BWI");
    setNotes(
      "Example data loaded from Mango Grove preliminary report. " +
        "Values are illustrative — clear this project before shipping to a real customer."
    );
    setMonthlyBills([
      { startDate: "2025-06-01", endDate: "2025-06-30", usage: 7584, hdd: 2.2, cdd: 630.7 },
      { startDate: "2025-07-01", endDate: "2025-07-31", usage: 10793, hdd: 0, cdd: 784.8 },
      { startDate: "2025-08-01", endDate: "2025-08-31", usage: 8801, hdd: 0.9, cdd: 548.1 },
      { startDate: "2025-09-01", endDate: "2025-09-30", usage: 6293, hdd: 1.1, cdd: 448.0 },
      { startDate: "2025-10-01", endDate: "2025-10-31", usage: 5751, hdd: 73.7, cdd: 157.4 },
      { startDate: "2025-11-01", endDate: "2025-11-30", usage: 4601, hdd: 262.6, cdd: 35.7 },
      { startDate: "2025-12-01", endDate: "2025-12-31", usage: 4790, hdd: 628.7, cdd: 0.7 },
      { startDate: "2026-01-01", endDate: "2026-01-31", usage: 4499, hdd: 749.3, cdd: 1.2 },
      { startDate: "2026-02-01", endDate: "2026-02-28", usage: 3553, hdd: 600.6, cdd: 1.0 },
      { startDate: "2026-03-01", endDate: "2026-03-31", usage: 3485, hdd: 266.3, cdd: 106.4 },
      { startDate: "2026-04-01", endDate: "2026-04-30", usage: 5362, hdd: 84.7, cdd: 214.5 },
      { startDate: "2026-05-01", endDate: "2026-05-31", usage: 5479, hdd: 28.5, cdd: 315.0 },
    ]);
    setHvacUnits([
      {
        tag: "Unit 1",
        serves: "Entire store",
        tstat: "P",
        tons: 20,
        ouModel: "48TCED24ACA5A0B0A0",
        qty: 1,
        seer: 13,
        supplyFanHp: 2,
        heatPump: "No",
        electricHeatKw: 0,
        controls: "Programmable thermostat",
        proposedSchedule: "10am–10pm Mon–Sun (11pm Fri–Sat)",
        notes: "Carrier RTU, gas heat from central furnace",
      },
    ]);
    setWalkInUnits([
      {
        kind: "Cooler",
        tag: "Cooler 1",
        condenserModel: "",
        serial: "",
        evaporatorModel: "LET075BK",
        tonnage: 0.63,
        mbh: 7.5,
        watts: 0.07,
        awef: 5.61,
        fanMotorHp: 0.07,
        numFans: 2,
      },
      {
        kind: "Cooler",
        tag: "Cooler 2",
        condenserModel: "",
        serial: "",
        evaporatorModel: "TPLP209MAS1DR6",
        tonnage: 0.75,
        mbh: 9,
        watts: 0.07,
        awef: 5.61,
        fanMotorHp: 0.07,
        numFans: 2,
      },
    ]);
    setEngineeringFeeOverride(null);
    setSensorCostOverride(null);
  }

  function applyOcr(result: OcrResult) {
    if (result.kind === "utility-bill") {
      setMonthlyBills((prev) => [...prev, ...result.months]);
    } else if (result.kind === "hvac-nameplate") {
      setHvacUnits((prev) => [
        ...prev,
        {
          tag: result.unit.tag,
          serves: "",
          tstat: "",
          tons: result.unit.tons,
          ouModel: result.unit.ouModel,
          qty: 1,
          seer: result.unit.seer,
          supplyFanHp: result.unit.supplyFanHp,
          heatPump: result.unit.heatPump,
          electricHeatKw: result.unit.electricHeatKw,
          controls: result.unit.controls,
          proposedSchedule: "",
          notes: `(OCR — verify) ${result.unit.notes}`.trim(),
        },
      ]);
    } else if (result.kind === "walkin-nameplate") {
      setWalkInUnits((prev) => [
        ...prev,
        {
          kind: result.unit.kind,
          tag: result.unit.tag
            ? `(OCR) ${result.unit.tag}`
            : "(OCR) new",
          condenserModel: result.unit.condenserModel,
          serial: result.unit.serial,
          evaporatorModel: result.unit.evaporatorModel,
          tonnage: result.unit.tonnage,
          mbh: result.unit.mbh,
          watts: result.unit.watts,
          awef: result.unit.awef,
          fanMotorHp: result.unit.fanMotorHp,
          numFans: result.unit.numFans,
        },
      ]);
    }
  }

  function isHvacUnverified(u: HvacUnitInput): boolean {
    return u.notes.trimStart().startsWith("(OCR");
  }
  function clearHvacUnverified(idx: number) {
    setHvacUnits((prev) =>
      prev.map((x, j) =>
        j === idx
          ? {
              ...x,
              notes: x.notes.replace(/^\s*\(OCR[^)]*\)\s*/i, ""),
            }
          : x
      )
    );
  }
  // Walk-in unverified check happens inline in WalkInGroup since it
  // operates on the filtered items list, not absolute indices.

  return (
    <>
      <div className="space-y-6">
        {/* ── Linked job ── */}
        <JobLinkPicker
          projectId={project.projectId}
          linkedJobId={project.linkedJobId}
        />

        {/* ── Documents ── */}
        <DocumentsSection
          projectId={project.projectId}
          documents={project.documents}
          onExtracted={applyOcr}
        />

        {/* ── Test tools banner ── */}
        <div className="rounded-2xl border-2 border-dashed border-mse-gold/50 bg-mse-gold/5 p-4 flex items-start gap-3">
          <FlaskConical className="w-5 h-5 text-mse-gold shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="font-bold text-mse-navy text-sm">Testing tools</div>
            <div className="text-[11px] text-mse-muted mt-0.5">
              Load a full set of Mango Grove example data to test the download
              + calculator flow end-to-end. Overwrites everything on this form.
            </div>
          </div>
          <button
            type="button"
            onClick={loadExampleData}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-mse-gold text-mse-navy hover:bg-mse-gold/90 active:scale-95"
          >
            <FlaskConical className="w-3.5 h-3.5" />
            Load example data
          </button>
        </div>

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
              hint="TMY3 weather data. Picks BWI (Baltimore) vs Andrews AFB template on download."
            >
              <select
                value={location}
                onChange={(e) =>
                  setLocation(e.target.value as EngineeringLocation)
                }
                className={baseInput}
              >
                <option value="BWI">BWI</option>
                <option value="Andrews">Andrews AFB</option>
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
                className={cn(
                  "rounded-xl border bg-white p-3 space-y-2",
                  isHvacUnverified(u)
                    ? "border-yellow-400 border-l-4"
                    : "border-mse-light"
                )}
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-[11px] uppercase tracking-wider font-bold text-mse-gold inline-flex items-center gap-1.5">
                    HVAC unit {i + 1}
                    {isHvacUnverified(u) && (
                      <button
                        type="button"
                        onClick={() => clearHvacUnverified(i)}
                        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-yellow-200 text-yellow-900 text-[9px] font-bold hover:bg-yellow-300"
                        title="Mark as verified — clears the (OCR) prefix from notes"
                      >
                        Unverified
                      </button>
                    )}
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
      {items.map((u, i) => {
        const unverified = u.tag.trimStart().startsWith("(OCR)");
        return (
        <div
          key={`${kind}-${i}`}
          className={cn(
            "rounded-xl border bg-white p-3 space-y-2",
            unverified
              ? "border-yellow-400 border-l-4"
              : "border-mse-light"
          )}
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-[11px] uppercase tracking-wider font-bold text-mse-gold inline-flex items-center gap-1.5">
              {kind} {i + 1}
              {unverified && (
                <button
                  type="button"
                  onClick={() =>
                    onChange(
                      items.map((x, j) =>
                        j === i
                          ? {
                              ...x,
                              tag: x.tag.replace(/^\s*\(OCR\)\s*/i, ""),
                            }
                          : x
                      )
                    )
                  }
                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-yellow-200 text-yellow-900 text-[9px] font-bold hover:bg-yellow-300"
                  title="Mark as verified — clears the (OCR) prefix from the tag"
                >
                  Unverified
                </button>
              )}
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
        );
      })}
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
