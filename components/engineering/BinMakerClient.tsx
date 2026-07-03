"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Download, RefreshCw, Clock, CalendarRange } from "lucide-react";
import { cn } from "@/lib/utils";

interface Station {
  usaf: string;
  name: string;
  state: string;
  city: string;
}

interface BinRow {
  minF: number;
  maxF: number;
  midF: number;
  hours: number;
  mcwbF: number | null;
}

interface BinResult {
  station: {
    usaf: string;
    name: string;
    state: string;
    latitude: number;
    longitude: number;
    elevation: number;
    timezone: number;
  };
  binWidthF: number;
  bins: BinRow[];
  hddBaseF: number;
  cddBaseF: number;
  hddAnnual: number;
  cddAnnual: number;
  hddMonthly: number[];
  cddMonthly: number[];
  annualAvgF: number;
  annualHighF: number;
  annualLowF: number;
  totalHours: number;
  operatingHours: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SCHEDULE_LENGTH = 168;
const MONTHS_LENGTH = 12;

type ScheduleMask = boolean[];
type MonthMask = boolean[];

interface Preset {
  key: string;
  label: string;
  hint: string;
  build: () => ScheduleMask;
}

/** Common operating schedules used in HVAC bin-method load calcs. */
const PRESETS: Preset[] = [
  {
    key: "24-7",
    label: "24 / 7",
    hint: "168 hrs/wk — continuous operation",
    build: () => new Array(SCHEDULE_LENGTH).fill(true),
  },
  {
    key: "office",
    label: "Office M-F 8-6",
    hint: "50 hrs/wk — standard business hours",
    build: () => paintHours(blank(), [1, 2, 3, 4, 5], 8, 18),
  },
  {
    key: "extended",
    label: "Extended M-F 6-8",
    hint: "70 hrs/wk — early open, late close",
    build: () => paintHours(blank(), [1, 2, 3, 4, 5], 6, 20),
  },
  {
    key: "retail",
    label: "Retail M-Sat 8-9, Sun 10-6",
    hint: "86 hrs/wk — 7-day retail schedule",
    build: () => {
      let m = paintHours(blank(), [1, 2, 3, 4, 5, 6], 8, 21);
      m = paintHours(m, [0], 10, 18);
      return m;
    },
  },
];

interface SeasonPreset {
  key: string;
  label: string;
  hint: string;
  build: () => MonthMask;
}

/** Month-range shortcuts for season-limited bin summaries. */
const SEASONS: SeasonPreset[] = [
  {
    key: "all",
    label: "All year",
    hint: "Jan–Dec, full 12 months",
    build: () => new Array(MONTHS_LENGTH).fill(true),
  },
  {
    key: "cooling",
    label: "Cooling May–Sep",
    hint: "Summer cooling season",
    build: () => MONTHS.map((_, i) => i >= 4 && i <= 8),
  },
  {
    key: "heating",
    label: "Heating Oct–Apr",
    hint: "Winter heating season",
    build: () => MONTHS.map((_, i) => i >= 9 || i <= 3),
  },
];

function blank(): ScheduleMask {
  return new Array(SCHEDULE_LENGTH).fill(false);
}

function paintHours(
  base: ScheduleMask,
  days: number[],
  startHour: number,
  endHour: number
): ScheduleMask {
  const out = base.slice();
  for (const d of days) {
    for (let h = startHour; h < endHour; h++) {
      out[d * 24 + h] = true;
    }
  }
  return out;
}

function encodeMask(mask: boolean[]): string {
  return mask.map((b) => (b ? "1" : "0")).join("");
}

function countTrue(mask: boolean[]): number {
  let n = 0;
  for (const b of mask) if (b) n++;
  return n;
}

function matchesPreset(mask: ScheduleMask): string | null {
  const enc = encodeMask(mask);
  for (const p of PRESETS) {
    if (encodeMask(p.build()) === enc) return p.key;
  }
  return null;
}

function matchesSeason(mask: MonthMask): string | null {
  const enc = encodeMask(mask);
  for (const s of SEASONS) {
    if (encodeMask(s.build()) === enc) return s.key;
  }
  return null;
}

export function BinMakerClient({ stations }: { stations: Station[] }) {
  const [stationUsaf, setStationUsaf] = useState<string>(stations[0]?.usaf ?? "724060");
  const [binWidth, setBinWidth] = useState<number>(5);
  const [hddBase, setHddBase] = useState<number>(65);
  const [cddBase, setCddBase] = useState<number>(65);
  const [schedule, setSchedule] = useState<ScheduleMask>(() => PRESETS[0].build());
  const [months, setMonths] = useState<MonthMask>(() => SEASONS[0].build());
  const [data, setData] = useState<BinResult | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const currentStation = useMemo(
    () => stations.find((s) => s.usaf === stationUsaf),
    [stations, stationUsaf]
  );
  const activePreset = useMemo(() => matchesPreset(schedule), [schedule]);
  const activeSeason = useMemo(() => matchesSeason(months), [months]);
  const weeklyHours = useMemo(() => countTrue(schedule), [schedule]);
  const monthCount = useMemo(() => countTrue(months), [months]);
  const scheduleEnc = useMemo(() => encodeMask(schedule), [schedule]);
  const monthsEnc = useMemo(() => encodeMask(months), [months]);

  async function loadData() {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        station: stationUsaf,
        binWidth: String(binWidth),
        hddBase: String(hddBase),
        cddBase: String(cddBase),
        schedule: scheduleEnc,
        months: monthsEnc,
      });
      const res = await fetch(`/api/admin/engineering/bin-maker?${qs.toString()}`, {
        signal: ac.signal,
      });
      const body = (await res.json().catch(() => ({}))) as
        | BinResult
        | { error?: string };
      if (!res.ok || !("bins" in body)) {
        throw new Error(("error" in body && body.error) || "Fetch failed");
      }
      setData(body);
    } catch (e) {
      if (ac.signal.aborted) return; // superseded by a newer request
      setError(e instanceof Error ? e.message : "Failed to load data");
    } finally {
      if (!ac.signal.aborted) setBusy(false);
    }
  }

  // Auto-recompute (debounced) whenever any input changes — including
  // individual cells toggled on the schedule grid. Also runs the
  // initial load on mount.
  useEffect(() => {
    const t = setTimeout(() => {
      void loadData();
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stationUsaf, binWidth, hddBase, cddBase, scheduleEnc, monthsEnc]);

  function toggleSlot(day: number, hour: number) {
    const idx = day * 24 + hour;
    const next = schedule.slice();
    next[idx] = !next[idx];
    setSchedule(next);
  }

  function toggleMonth(m: number) {
    const next = months.slice();
    next[m] = !next[m];
    setMonths(next);
  }

  function clearSchedule() {
    setSchedule(blank());
  }

  function exportCsv() {
    if (!data) return;
    const monthList = MONTHS.filter((_, i) => months[i]).join(" ");
    const lines: string[] = [];
    lines.push(`Bin Maker Pro — ${data.station.name}, ${data.station.state}`);
    lines.push(`USAF: ${data.station.usaf}`);
    lines.push(`Lat: ${data.station.latitude}, Lon: ${data.station.longitude}, Elev: ${data.station.elevation} m`);
    lines.push(`Bin width: ${data.binWidthF} °F`);
    lines.push(`Months: ${monthCount === 12 ? "All" : monthList}`);
    lines.push(`Operating hours: ${data.operatingHours} / ${data.totalHours} (${weeklyHours} hrs/wk)`);
    lines.push("");
    lines.push("Min F,Max F,Mid F,MCWB F,Hours,% of operating hours");
    for (const b of data.bins) {
      const pct = data.operatingHours > 0
        ? (b.hours / data.operatingHours) * 100
        : 0;
      lines.push(
        `${b.minF},${b.maxF},${b.midF.toFixed(1)},${b.mcwbF === null ? "" : b.mcwbF.toFixed(1)},${b.hours},${pct.toFixed(2)}`
      );
    }
    lines.push("");
    lines.push(`HDD (base ${data.hddBaseF} F),${Math.round(data.hddAnnual)}`);
    lines.push(`CDD (base ${data.cddBaseF} F),${Math.round(data.cddAnnual)}`);
    lines.push("");
    lines.push("Month,HDD,CDD");
    for (let i = 0; i < 12; i++) {
      if (!months[i]) continue;
      lines.push(
        `${MONTHS[i]},${Math.round(data.hddMonthly[i])},${Math.round(data.cddMonthly[i])}`
      );
    }
    const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bin-maker-${data.station.usaf}-${data.binWidthF}F.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const maxHours = data ? Math.max(...data.bins.map((b) => b.hours)) : 0;
  const nothingSelected = weeklyHours === 0 || monthCount === 0;

  return (
    <div className="space-y-5">
      {/* ── Controls ─────────────────────────────────────────────────── */}
      <section className="bg-white rounded-2xl border border-mse-light p-4 sm:p-5 shadow-card space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Weather station">
            <select
              value={stationUsaf}
              onChange={(e) => setStationUsaf(e.target.value)}
              className={baseInput}
            >
              {stations.map((s) => (
                <option key={s.usaf} value={s.usaf}>
                  {s.name} — {s.city}, {s.state} ({s.usaf})
                </option>
              ))}
            </select>
          </Field>
          <Field label={`Bin width — ${binWidth} °F`}>
            <input
              type="range"
              min={1}
              max={10}
              step={1}
              value={binWidth}
              onChange={(e) => setBinWidth(Number(e.target.value))}
              className="w-full"
            />
          </Field>
          <Field label="HDD base temp (°F)">
            <input
              type="number"
              min={40}
              max={80}
              step={1}
              value={hddBase}
              onChange={(e) => setHddBase(Number(e.target.value))}
              className={baseInput}
            />
          </Field>
          <Field label="CDD base temp (°F)">
            <input
              type="number"
              min={40}
              max={90}
              step={1}
              value={cddBase}
              onChange={(e) => setCddBase(Number(e.target.value))}
              className={baseInput}
            />
          </Field>
        </div>

        {/* ── Month filter ─────────────────────────────────────────── */}
        <div>
          <div className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-2 flex items-center gap-1.5">
            <CalendarRange className="w-3.5 h-3.5" />
            Months — {monthCount === 12 ? "all year" : `${monthCount} of 12`}
          </div>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {SEASONS.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setMonths(s.build())}
                title={s.hint}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-bold border-2",
                  "active:scale-95 transition-[background-color,border-color,color]",
                  activeSeason === s.key
                    ? "bg-mse-navy border-mse-navy text-white"
                    : "bg-white border-mse-light text-mse-muted hover:text-mse-navy hover:border-mse-navy/30"
                )}
              >
                {s.label}
              </button>
            ))}
            {!activeSeason && (
              <span className="px-3 py-1.5 rounded-lg text-xs font-bold bg-mse-gold/15 text-mse-navy border-2 border-mse-gold/30">
                Custom
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {MONTHS.map((label, i) => (
              <button
                key={label}
                type="button"
                onClick={() => toggleMonth(i)}
                className={cn(
                  "px-2.5 py-1 rounded-md text-xs font-bold border transition-colors active:scale-95",
                  months[i]
                    ? "bg-mse-navy border-mse-navy text-white hover:bg-mse-navy-soft"
                    : "bg-mse-light/60 border-mse-light text-mse-muted hover:text-mse-navy"
                )}
                aria-pressed={months[i]}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Operating schedule picker ────────────────────────────── */}
        <div>
          <div className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-2 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            Operating schedule — {weeklyHours} hrs/wk
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setSchedule(p.build())}
                title={p.hint}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-bold border-2",
                  "active:scale-95 transition-[background-color,border-color,color]",
                  activePreset === p.key
                    ? "bg-mse-navy border-mse-navy text-white"
                    : "bg-white border-mse-light text-mse-muted hover:text-mse-navy hover:border-mse-navy/30"
                )}
              >
                {p.label}
              </button>
            ))}
            <button
              type="button"
              onClick={clearSchedule}
              className="px-3 py-1.5 rounded-lg text-xs font-bold border-2 border-mse-light text-mse-muted hover:text-mse-red hover:border-mse-red/30 active:scale-95"
            >
              Clear
            </button>
            {!activePreset && (
              <span className="px-3 py-1.5 rounded-lg text-xs font-bold bg-mse-gold/15 text-mse-navy border-2 border-mse-gold/30">
                Custom
              </span>
            )}
          </div>

          {/* 7×24 grid */}
          <div className="mt-3 overflow-x-auto">
            <div className="inline-block min-w-full">
              <div className="grid grid-cols-[auto_repeat(24,minmax(1.35rem,1fr))] gap-[2px] text-[10px] font-mono">
                <div />
                {Array.from({ length: 24 }, (_, h) => (
                  <div
                    key={h}
                    className={cn(
                      "text-center text-mse-muted select-none",
                      h % 6 === 0 ? "font-bold text-mse-navy" : ""
                    )}
                  >
                    {h}
                  </div>
                ))}
                {DAY_LABELS.map((label, d) => (
                  <div key={label} className="contents">
                    <div className="pr-2 text-right font-bold text-mse-navy self-center select-none">
                      {label}
                    </div>
                    {Array.from({ length: 24 }, (_, h) => {
                      const on = schedule[d * 24 + h];
                      return (
                        <button
                          key={h}
                          type="button"
                          onClick={() => toggleSlot(d, h)}
                          className={cn(
                            "h-5 rounded-sm transition-colors",
                            on
                              ? "bg-mse-navy hover:bg-mse-navy-soft"
                              : "bg-mse-light hover:bg-mse-gold/30"
                          )}
                          aria-label={`${label} ${h}:00 ${on ? "on" : "off"}`}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
            <p className="text-[11px] text-mse-muted mt-2">
              Click any cell to toggle — the table recomputes automatically.
              Presets snap the grid; edits switch you to Custom.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => loadData()}
            disabled={busy}
            className={cn(
              "inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold shadow-card",
              "active:scale-95 transition-transform",
              busy
                ? "bg-mse-light text-mse-muted cursor-not-allowed"
                : "bg-mse-navy text-white hover:bg-mse-navy-soft"
            )}
          >
            {busy ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            {busy ? "Fetching…" : "Recompute"}
          </button>
          <button
            type="button"
            onClick={exportCsv}
            disabled={!data || busy}
            className={cn(
              "inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold border-2 border-mse-navy",
              "active:scale-95 transition-transform",
              !data || busy
                ? "text-mse-muted border-mse-light cursor-not-allowed"
                : "text-mse-navy hover:bg-mse-navy hover:text-white"
            )}
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
          {currentStation && (
            <div className="text-xs text-mse-muted ml-auto hidden sm:block">
              {currentStation.name} • USAF {currentStation.usaf}
            </div>
          )}
        </div>
      </section>

      {nothingSelected && (
        <div className="rounded-xl border border-mse-gold/40 bg-mse-gold/10 text-mse-navy text-sm px-4 py-3">
          {weeklyHours === 0
            ? "The schedule grid is empty — every bin will show zero hours. Click cells or pick a preset."
            : "No months are selected — every bin will show zero hours. Pick at least one month."}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-mse-red/30 bg-mse-red/5 text-mse-red text-sm px-4 py-3">
          {error}
        </div>
      )}

      {data && (
        <>
          {/* ── Summary ──────────────────────────────────────────────── */}
          <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Annual avg" value={`${data.annualAvgF.toFixed(1)} °F`} />
            <StatCard label="Annual low" value={`${data.annualLowF.toFixed(0)} °F`} />
            <StatCard label="Annual high" value={`${data.annualHighF.toFixed(0)} °F`} />
            <StatCard
              label="Operating hours"
              value={`${data.operatingHours.toLocaleString()} / ${data.totalHours.toLocaleString()}`}
            />
            <StatCard
              label={`HDD (base ${data.hddBaseF} °F)`}
              value={Math.round(data.hddAnnual).toLocaleString()}
              tone="cool"
            />
            <StatCard
              label={`CDD (base ${data.cddBaseF} °F)`}
              value={Math.round(data.cddAnnual).toLocaleString()}
              tone="warm"
            />
            <StatCard
              label="Station lat/lon"
              value={`${data.station.latitude.toFixed(2)}, ${data.station.longitude.toFixed(2)}`}
            />
            <StatCard
              label="Elevation"
              value={`${data.station.elevation.toFixed(0)} m`}
            />
          </section>

          {/* ── Bin table ────────────────────────────────────────────── */}
          <section className="bg-white rounded-2xl border border-mse-light shadow-card overflow-hidden">
            <div className="px-4 py-3 border-b border-mse-light flex items-center justify-between">
              <div>
                <div className="font-bold text-mse-navy">
                  Temperature bins ({data.binWidthF} °F width)
                </div>
                <div className="text-xs text-mse-muted">
                  {data.operatingHours === data.totalHours
                    ? "Hours per year in each bin with mean coincident wet bulb, coldest first"
                    : `Hours within schedule${monthCount < 12 ? " + selected months" : ""} (${data.operatingHours.toLocaleString()} hrs) in each bin, coldest first`}
                </div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-mse-muted border-b border-mse-light">
                    <th className="px-3 py-2 font-semibold">Range (°F)</th>
                    <th className="px-3 py-2 font-semibold">Midpoint</th>
                    <th className="px-3 py-2 font-semibold" title="Mean coincident wet bulb — average wet-bulb temperature of the hours in this bin">
                      MCWB (°F)
                    </th>
                    <th className="px-3 py-2 font-semibold text-right">Hours</th>
                    <th className="px-3 py-2 font-semibold text-right">
                      {data.operatingHours === data.totalHours ? "% of year" : "% of op hrs"}
                    </th>
                    <th className="px-3 py-2 font-semibold w-1/3">Distribution</th>
                  </tr>
                </thead>
                <tbody>
                  {data.bins.map((b) => {
                    const denom = data.operatingHours || 1;
                    const pct = (b.hours / denom) * 100;
                    const barPct = maxHours > 0 ? (b.hours / maxHours) * 100 : 0;
                    const tone = binTone(b.midF, data.hddBaseF, data.cddBaseF);
                    return (
                      <tr key={b.minF} className="border-b border-mse-light/60 last:border-0">
                        <td className="px-3 py-1.5 font-mono">
                          {b.minF} to {b.maxF}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-mse-muted">
                          {b.midF.toFixed(1)}
                        </td>
                        <td className="px-3 py-1.5 font-mono">
                          {b.mcwbF === null ? (
                            <span className="text-mse-muted">—</span>
                          ) : (
                            b.mcwbF.toFixed(1)
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono">
                          {b.hours.toLocaleString()}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-mse-muted">
                          {pct.toFixed(2)}%
                        </td>
                        <td className="px-3 py-1.5">
                          <div className="h-2 rounded-full bg-mse-light overflow-hidden">
                            <div
                              className={cn("h-full", tone)}
                              style={{ width: `${barPct}%` }}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── Monthly HDD / CDD ────────────────────────────────────── */}
          <section className="bg-white rounded-2xl border border-mse-light shadow-card overflow-hidden">
            <div className="px-4 py-3 border-b border-mse-light">
              <div className="font-bold text-mse-navy">Monthly HDD / CDD</div>
              <div className="text-xs text-mse-muted">
                Based on HDD base {data.hddBaseF} °F, CDD base {data.cddBaseF} °F
                {data.operatingHours < data.totalHours &&
                  " · filtered to operating schedule"}
                {monthCount < 12 && " · deselected months excluded"}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-mse-muted border-b border-mse-light">
                    <th className="px-3 py-2 font-semibold">Month</th>
                    <th className="px-3 py-2 font-semibold text-right">HDD</th>
                    <th className="px-3 py-2 font-semibold text-right">CDD</th>
                  </tr>
                </thead>
                <tbody>
                  {MONTHS.map((m, i) => (
                    <tr
                      key={m}
                      className={cn(
                        "border-b border-mse-light/60 last:border-0",
                        !months[i] && "opacity-40"
                      )}
                    >
                      <td className="px-3 py-1.5 font-semibold">{m}</td>
                      <td className="px-3 py-1.5 text-right font-mono">
                        {months[i] ? Math.round(data.hddMonthly[i]).toLocaleString() : "—"}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono">
                        {months[i] ? Math.round(data.cddMonthly[i]).toLocaleString() : "—"}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-mse-light/40 font-bold">
                    <td className="px-3 py-1.5">Total</td>
                    <td className="px-3 py-1.5 text-right font-mono">
                      {Math.round(data.hddAnnual).toLocaleString()}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono">
                      {Math.round(data.cddAnnual).toLocaleString()}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

/** Cold bins → blue, warm bins → gold, comfort band → neutral. */
function binTone(midF: number, hddBase: number, cddBase: number): string {
  if (midF < hddBase - 15) return "bg-sky-500";
  if (midF < hddBase) return "bg-sky-300";
  if (midF > cddBase + 15) return "bg-amber-500";
  if (midF > cddBase) return "bg-amber-300";
  return "bg-mse-gold/50";
}

const baseInput =
  "w-full px-3 py-2 rounded-lg border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1">
        {label}
      </div>
      {children}
    </label>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "cool" | "warm";
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-3 shadow-card",
        tone === "cool"
          ? "bg-sky-50 border-sky-100"
          : tone === "warm"
          ? "bg-amber-50 border-amber-100"
          : "bg-white border-mse-light"
      )}
    >
      <div className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted">
        {label}
      </div>
      <div className="text-xl font-bold text-mse-navy mt-0.5 font-mono">
        {value}
      </div>
    </div>
  );
}
