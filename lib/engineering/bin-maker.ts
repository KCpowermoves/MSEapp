import "server-only";
import JSZip from "jszip";
import { cToF, wetBulbFromEpwFields } from "./psychrometrics";

/**
 * TMY3 bin-method calculator. Fetches the archived TMY3 weather file
 * for a given station from climate.onebuilding.org (the community
 * mirror that replaced NREL's retired rredc.nrel.gov archive), parses
 * the 8760 hourly dry-bulb temps out of the EPW inside, and bins them
 * for HVAC load calcs.
 *
 * EPW ("EnergyPlus Weather") file format: 8 header rows, then 8760
 * comma-separated data rows. Column 6 (0-indexed) is dry-bulb °C,
 * column 7 dewpoint °C, column 8 relative humidity %, column 9
 * atmospheric pressure Pa.
 */

export interface StationDef {
  usaf: string;
  name: string;
  state: string;
  city: string;
  /** onebuilding.org path fragment — MD_Maryland, DC_Washington_D.C., etc. */
  region: string;
  /** Full filename (without .zip). */
  file: string;
}

/** Common weather stations for MSE's operating area. Filenames match
 *  climate.onebuilding.org exactly — verify with the region index page
 *  before adding a new one. Note: Reagan National is filed under VA on
 *  onebuilding, not DC. */
export const COMMON_STATIONS: StationDef[] = [
  {
    usaf: "724060",
    name: "BWI Airport",
    state: "MD",
    city: "Baltimore",
    region: "MD_Maryland",
    file: "USA_MD_Baltimore-Washington.Intl.Marshall.AP.724060_TMY3",
  },
  {
    usaf: "745940",
    name: "Andrews AFB (JB Andrews)",
    state: "MD",
    city: "Camp Springs",
    region: "MD_Maryland",
    file: "USA_MD_Camp.Springs-JB.Andrews.745940_TMY3",
  },
  {
    usaf: "724050",
    name: "Reagan National (DCA)",
    state: "VA",
    city: "Arlington",
    region: "VA_Virginia",
    file: "USA_VA_Arlington-Reagan.Washington.Natl.AP.724050_TMY3",
  },
  {
    usaf: "724030",
    name: "Dulles (IAD)",
    state: "VA",
    city: "Sterling",
    region: "VA_Virginia",
    file: "USA_VA_Dulles-Washington.Dulles.Intl.AP.724030_TMY3",
  },
  {
    usaf: "723980",
    name: "Salisbury / Ocean City",
    state: "MD",
    city: "Salisbury",
    region: "MD_Maryland",
    file: "USA_MD_Salisbury-Ocean.City-Wicomico.Rgnl.AP.723980_TMY3",
  },
  {
    usaf: "724066",
    name: "Hagerstown (Henson Field)",
    state: "MD",
    city: "Hagerstown",
    region: "MD_Maryland",
    file: "USA_MD_Hagerstown.Rgnl.AP-Henson.Field.724066_TMY3",
  },
  {
    usaf: "724040",
    name: "NAS Patuxent River",
    state: "MD",
    city: "Patuxent River",
    region: "MD_Maryland",
    file: "USA_MD_NAS.Patuxent.River.724040_TMY3",
  },
];

export interface BinRow {
  minF: number;
  maxF: number;
  midF: number;
  hours: number;
  /** Mean coincident wet bulb (°F) of the hours in this bin, or null
   *  when the bin is empty / no moisture data. */
  mcwbF: number | null;
}

export interface StationMeta {
  usaf: string;
  name: string;
  state: string;
  latitude: number;
  longitude: number;
  elevation: number;
  timezone: number;
}

export interface BinResult {
  station: StationMeta;
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
  /** Hours in the year that fall inside the operating schedule AND
   *  selected months. Always ≤ totalHours (8760) — equal for 24/7,
   *  all months. */
  operatingHours: number;
}

interface HourRec {
  dbF: number;
  wbF: number | null;
}

interface ParsedEpw {
  meta: StationMeta;
  hours: HourRec[];
}

/** A weekly operating schedule is a 168-slot boolean array indexed by
 *  `dayOfWeek * 24 + hourOfDay`. dayOfWeek is 0=Sun..6=Sat, hourOfDay
 *  is 0..23. TMY3 is a composite typical year with no real calendar,
 *  so we adopt the convention: hour_of_year 0 = Sunday 00:00, cycling
 *  chronologically through hour_of_year 8759 = Saturday 23:00 (with
 *  the natural wrap since 8760/168 = ~52.14 weeks). This matches the
 *  approach used by DOE-2 and eQuest-style bin tools. */
export type ScheduleMask = boolean[];

export const SCHEDULE_LENGTH = 168;

/** 12-slot month selector, Jan..Dec. */
export type MonthMask = boolean[];

export const MONTHS_LENGTH = 12;

const MONTH_HOURS = [744, 672, 744, 720, 744, 720, 744, 744, 720, 744, 720, 744];

/** hour_of_year (0..8759) → month index (0..11), non-leap year. */
const MONTH_OF_HOUR: number[] = (() => {
  const out: number[] = [];
  for (let m = 0; m < 12; m++) {
    for (let h = 0; h < MONTH_HOURS[m]; h++) out.push(m);
  }
  return out;
})();

/** All-hours default. */
export function scheduleAllHours(): ScheduleMask {
  return new Array(SCHEDULE_LENGTH).fill(true);
}

export function monthsAll(): MonthMask {
  return new Array(MONTHS_LENGTH).fill(true);
}

/** Build a schedule that's ON for the given hour range on the given
 *  days. `days` = subset of 0..6 (Sun..Sat). `startHour`/`endHour` are
 *  half-open — startHour ≤ h < endHour. Wrap-around (endHour < startHour)
 *  is not supported; split into two calls if you need overnight. */
export function scheduleFromHours(
  days: number[],
  startHour: number,
  endHour: number,
  base: ScheduleMask = new Array(SCHEDULE_LENGTH).fill(false)
): ScheduleMask {
  const out = base.slice();
  for (const d of days) {
    for (let h = startHour; h < endHour; h++) {
      out[d * 24 + h] = true;
    }
  }
  return out;
}

/** Encode as a 168-char "1"/"0" string for URL round-tripping. */
export function encodeSchedule(mask: ScheduleMask): string {
  return mask.map((b) => (b ? "1" : "0")).join("");
}

export function decodeSchedule(s: string | null | undefined): ScheduleMask {
  if (!s || s.length !== SCHEDULE_LENGTH) return scheduleAllHours();
  const out: ScheduleMask = new Array(SCHEDULE_LENGTH).fill(false);
  for (let i = 0; i < SCHEDULE_LENGTH; i++) {
    out[i] = s[i] === "1";
  }
  return out;
}

/** 12-char "1"/"0" string, Jan..Dec. Missing/invalid → all months. */
export function decodeMonths(s: string | null | undefined): MonthMask {
  if (!s || s.length !== MONTHS_LENGTH) return monthsAll();
  const out: MonthMask = new Array(MONTHS_LENGTH).fill(false);
  for (let i = 0; i < MONTHS_LENGTH; i++) {
    out[i] = s[i] === "1";
  }
  return out;
}

/** Per-process cache — TMY3 data is static so cache aggressively.
 *  Warm across requests on the same instance; cold restarts re-fetch. */
const epwCache = new Map<string, ParsedEpw>();

async function fetchEpw(station: StationDef): Promise<ParsedEpw> {
  const cached = epwCache.get(station.usaf);
  if (cached) return cached;
  const url = `https://climate.onebuilding.org/WMO_Region_4_North_and_Central_America/USA_United_States_of_America/${station.region}/${station.file}.zip`;
  const res = await fetch(url, { cache: "force-cache" });
  if (!res.ok) {
    throw new Error(
      `Weather fetch failed for ${station.name} (${station.usaf}): ${res.status} ${res.statusText}`
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const zip = await JSZip.loadAsync(buf);
  const epwEntry = Object.values(zip.files).find((f) =>
    f.name.toLowerCase().endsWith(".epw")
  );
  if (!epwEntry) {
    throw new Error(`No .epw file inside archive for ${station.name}`);
  }
  const epwText = await epwEntry.async("string");
  const parsed = parseEpw(epwText, station);
  epwCache.set(station.usaf, parsed);
  return parsed;
}

/** Parse EPW format. Line 1 is `LOCATION,city,state,country,source,WMO,
 *  latitude,longitude,timezone,elevation`. Data rows start at line 9. */
function parseEpw(epw: string, station: StationDef): ParsedEpw {
  const lines = epw.split(/\r?\n/);
  if (lines.length < 100) {
    throw new Error(`EPW file too short for ${station.usaf}`);
  }
  const locCells = lines[0].split(",");
  const meta: StationMeta = {
    usaf: station.usaf,
    name: locCells[1]?.trim() || station.name,
    state: locCells[2]?.trim() || station.state,
    latitude: Number(locCells[6]) || 0,
    longitude: Number(locCells[7]) || 0,
    timezone: Number(locCells[8]) || 0,
    elevation: Number(locCells[9]) || 0,
  };
  // EPW header is exactly 8 rows: LOCATION, DESIGN CONDITIONS,
  // TYPICAL/EXTREME PERIODS, GROUND TEMPERATURES, HOLIDAYS/DAYLIGHT
  // SAVINGS, COMMENTS 1, COMMENTS 2, DATA PERIODS. Data starts at row 9.
  const hours: HourRec[] = [];
  for (let i = 8; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cells = line.split(",");
    // Column 6 (0-indexed) is dry-bulb °C in EPW.
    const celsius = Number(cells[6]);
    if (!Number.isFinite(celsius)) continue;
    // EPW uses 99.9 as the missing-data sentinel for dry-bulb.
    if (celsius >= 99.9) continue;
    const dewpointC = Number(cells[7]);
    const rhPct = Number(cells[8]);
    const pressurePa = Number(cells[9]);
    const wbC = wetBulbFromEpwFields({
      tdbC: celsius,
      dewpointC: Number.isFinite(dewpointC) ? dewpointC : null,
      rhPct: Number.isFinite(rhPct) ? rhPct : null,
      pressurePa: Number.isFinite(pressurePa) ? pressurePa : null,
      stationElevationM: meta.elevation,
    });
    hours.push({
      dbF: cToF(celsius),
      wbF: wbC === null ? null : cToF(wbC),
    });
  }
  return { meta, hours };
}

/** Map hour_of_year (0..8759) to a schedule mask slot (0..167).
 *  Convention: Jan 1 hour 0 = Sunday 00:00 slot. */
function scheduleSlotForHour(hourOfYear: number): number {
  return hourOfYear % SCHEDULE_LENGTH;
}

/** True when the hour is inside both the weekly schedule and the
 *  selected months. */
function makeHourFilter(
  schedule: ScheduleMask,
  months: MonthMask
): (hourOfYear: number) => boolean {
  return (hourOfYear: number) =>
    schedule[scheduleSlotForHour(hourOfYear)] &&
    (months[MONTH_OF_HOUR[hourOfYear] ?? 0] ?? true);
}

function binTemps(
  hours: HourRec[],
  binWidthF: number,
  included: (hourOfYear: number) => boolean,
  maxBinF?: number
): BinRow[] {
  if (binWidthF <= 0) throw new Error("binWidthF must be positive");
  // Compute range across ALL temps so bin boundaries don't shift when
  // the user tightens the schedule. Engineers expect consistent bins.
  const rawMin = hours.reduce((a, b) => Math.min(a, b.dbF), Infinity);
  const rawMax = hours.reduce((a, b) => Math.max(a, b.dbF), -Infinity);
  const startF = Math.floor(rawMin / binWidthF) * binWidthF;
  // Top of the range: the engineer's design high (maxBinF) when set,
  // rounded up to a whole bin, otherwise the station's actual annual
  // max. Setting it above the data adds empty design-cooling bins;
  // setting it below folds the hotter hours into the top bin. Never
  // collapses below one bin above the start.
  const topRaw = maxBinF != null && Number.isFinite(maxBinF) ? maxBinF : rawMax;
  let endF = Math.ceil(topRaw / binWidthF) * binWidthF;
  if (endF <= startF) endF = startF + binWidthF;
  const bins: BinRow[] = [];
  const wbSums: number[] = [];
  const wbCounts: number[] = [];
  for (let lo = startF; lo < endF; lo += binWidthF) {
    bins.push({
      minF: lo,
      maxF: lo + binWidthF,
      midF: lo + binWidthF / 2,
      hours: 0,
      mcwbF: null,
    });
    wbSums.push(0);
    wbCounts.push(0);
  }
  for (let i = 0; i < hours.length; i++) {
    if (!included(i)) continue;
    const rec = hours[i];
    let idx = Math.floor((rec.dbF - startF) / binWidthF);
    if (idx < 0) idx = 0;
    if (idx >= bins.length) idx = bins.length - 1;
    bins[idx].hours += 1;
    if (rec.wbF !== null) {
      wbSums[idx] += rec.wbF;
      wbCounts[idx] += 1;
    }
  }
  for (let i = 0; i < bins.length; i++) {
    if (wbCounts[i] > 0) {
      bins[i].mcwbF = wbSums[i] / wbCounts[i];
    }
  }
  return bins;
}

/** Sum degree-hours vs a base temp, then divide by 24. Filtered to the
 *  operating schedule + selected months — an hour outside the filter
 *  contributes zero, matching engineers' expectation that HDD/CDD
 *  represent the load the HVAC actually sees. */
function computeDegreeDays(
  hours: HourRec[],
  baseF: number,
  kind: "hdd" | "cdd",
  included: (hourOfYear: number) => boolean
): number {
  let degreeHours = 0;
  for (let i = 0; i < hours.length; i++) {
    if (!included(i)) continue;
    const t = hours[i].dbF;
    if (kind === "hdd" && t < baseF) degreeHours += baseF - t;
    if (kind === "cdd" && t > baseF) degreeHours += t - baseF;
  }
  return degreeHours / 24;
}

/** Per-month DD, also filtered by the operating schedule + months.
 *  Deselected months report 0. */
function computeDegreeDaysMonthly(
  hours: HourRec[],
  baseF: number,
  kind: "hdd" | "cdd",
  included: (hourOfYear: number) => boolean
): number[] {
  const monthly: number[] = new Array(12).fill(0);
  for (let i = 0; i < hours.length; i++) {
    if (!included(i)) continue;
    const m = MONTH_OF_HOUR[i];
    if (m === undefined) break;
    const t = hours[i].dbF;
    if (kind === "hdd" && t < baseF) monthly[m] += baseF - t;
    if (kind === "cdd" && t > baseF) monthly[m] += t - baseF;
  }
  return monthly.map((v) => v / 24);
}

function countOperatingHours(
  nHours: number,
  included: (hourOfYear: number) => boolean
): number {
  let n = 0;
  for (let i = 0; i < nHours; i++) {
    if (included(i)) n++;
  }
  return n;
}

/** Public entry. */
export async function computeBinData(opts: {
  usaf: string;
  binWidthF: number;
  hddBaseF: number;
  cddBaseF: number;
  schedule?: ScheduleMask;
  months?: MonthMask;
  /** Design high — forces the top of the bin range (default: station
   *  annual max when omitted). */
  maxBinF?: number;
}): Promise<BinResult> {
  const station = COMMON_STATIONS.find((s) => s.usaf === opts.usaf);
  if (!station) {
    throw new Error(`Unknown station USAF ${opts.usaf}`);
  }
  const { meta, hours } = await fetchEpw(station);
  if (hours.length === 0) {
    throw new Error(`No hourly temperature data for station ${opts.usaf}`);
  }
  const included = makeHourFilter(
    opts.schedule ?? scheduleAllHours(),
    opts.months ?? monthsAll()
  );
  const bins = binTemps(hours, opts.binWidthF, included);
  const hddAnnual = computeDegreeDays(hours, opts.hddBaseF, "hdd", included);
  const cddAnnual = computeDegreeDays(hours, opts.cddBaseF, "cdd", included);
  const hddMonthly = computeDegreeDaysMonthly(hours, opts.hddBaseF, "hdd", included);
  const cddMonthly = computeDegreeDaysMonthly(hours, opts.cddBaseF, "cdd", included);
  // Annual avg / high / low always reflect the full year for context,
  // regardless of operating schedule — that's climate data, not load.
  const annualAvgF =
    hours.reduce((a, b) => a + b.dbF, 0) / hours.length;
  const annualHighF = hours.reduce((a, b) => Math.max(a, b.dbF), -Infinity);
  const annualLowF = hours.reduce((a, b) => Math.min(a, b.dbF), Infinity);
  const operatingHours = countOperatingHours(hours.length, included);
  return {
    station: meta,
    binWidthF: opts.binWidthF,
    bins,
    hddBaseF: opts.hddBaseF,
    cddBaseF: opts.cddBaseF,
    hddAnnual,
    cddAnnual,
    hddMonthly,
    cddMonthly,
    annualAvgF,
    annualHighF,
    annualLowF,
    totalHours: hours.length,
    operatingHours,
  };
}
