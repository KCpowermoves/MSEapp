import "server-only";
import JSZip from "jszip";

/**
 * TMY3 bin-method calculator. Fetches the archived TMY3 weather file
 * for a given station from climate.onebuilding.org (the community
 * mirror that replaced NREL's retired rredc.nrel.gov archive), parses
 * the 8760 hourly dry-bulb temps out of the EPW inside, and bins them
 * for HVAC load calcs.
 *
 * EPW ("EnergyPlus Weather") file format: 8 header rows, then 8760
 * comma-separated data rows. Column 6 (0-indexed) is dry-bulb °C.
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
}

interface ParsedEpw {
  meta: StationMeta;
  tempsF: number[];
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
  const tempsF: number[] = [];
  for (let i = 8; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cells = line.split(",");
    // Column 6 (0-indexed) is dry-bulb °C in EPW.
    const celsius = Number(cells[6]);
    if (!Number.isFinite(celsius)) continue;
    // EPW uses 99.9 as the missing-data sentinel for dry-bulb.
    if (celsius >= 99.9) continue;
    tempsF.push((celsius * 9) / 5 + 32);
  }
  return { meta, tempsF };
}

function binTemps(tempsF: number[], binWidthF: number): BinRow[] {
  if (binWidthF <= 0) throw new Error("binWidthF must be positive");
  const rawMin = tempsF.reduce((a, b) => Math.min(a, b), Infinity);
  const rawMax = tempsF.reduce((a, b) => Math.max(a, b), -Infinity);
  const startF = Math.floor(rawMin / binWidthF) * binWidthF;
  const endF = Math.ceil(rawMax / binWidthF) * binWidthF;
  const bins: BinRow[] = [];
  for (let lo = startF; lo < endF; lo += binWidthF) {
    bins.push({
      minF: lo,
      maxF: lo + binWidthF,
      midF: lo + binWidthF / 2,
      hours: 0,
    });
  }
  for (const t of tempsF) {
    let idx = Math.floor((t - startF) / binWidthF);
    if (idx < 0) idx = 0;
    if (idx >= bins.length) idx = bins.length - 1;
    bins[idx].hours += 1;
  }
  return bins;
}

/** Sum degree-hours vs a base temp, then divide by 24. We have hourly
 *  data so this is more accurate than the daily-mean approximation. */
function computeDegreeDays(
  tempsF: number[],
  baseF: number,
  kind: "hdd" | "cdd"
): number {
  let degreeHours = 0;
  for (const t of tempsF) {
    if (kind === "hdd" && t < baseF) degreeHours += baseF - t;
    if (kind === "cdd" && t > baseF) degreeHours += t - baseF;
  }
  return degreeHours / 24;
}

/** Same but split by month. EPW hours are chronological 1..8760
 *  starting Jan 1 hour 1, non-leap. */
function computeDegreeDaysMonthly(
  tempsF: number[],
  baseF: number,
  kind: "hdd" | "cdd"
): number[] {
  const monthHours = [744, 672, 744, 720, 744, 720, 744, 744, 720, 744, 720, 744];
  const monthly: number[] = new Array(12).fill(0);
  let hourIdx = 0;
  for (let m = 0; m < 12; m++) {
    for (let h = 0; h < monthHours[m]; h++) {
      const t = tempsF[hourIdx];
      hourIdx++;
      if (t === undefined) break;
      if (kind === "hdd" && t < baseF) monthly[m] += baseF - t;
      if (kind === "cdd" && t > baseF) monthly[m] += t - baseF;
    }
  }
  return monthly.map((v) => v / 24);
}

/** Public entry. */
export async function computeBinData(opts: {
  usaf: string;
  binWidthF: number;
  hddBaseF: number;
  cddBaseF: number;
}): Promise<BinResult> {
  const station = COMMON_STATIONS.find((s) => s.usaf === opts.usaf);
  if (!station) {
    throw new Error(`Unknown station USAF ${opts.usaf}`);
  }
  const { meta, tempsF } = await fetchEpw(station);
  if (tempsF.length === 0) {
    throw new Error(`No hourly temperature data for station ${opts.usaf}`);
  }
  const bins = binTemps(tempsF, opts.binWidthF);
  const hddAnnual = computeDegreeDays(tempsF, opts.hddBaseF, "hdd");
  const cddAnnual = computeDegreeDays(tempsF, opts.cddBaseF, "cdd");
  const hddMonthly = computeDegreeDaysMonthly(tempsF, opts.hddBaseF, "hdd");
  const cddMonthly = computeDegreeDaysMonthly(tempsF, opts.cddBaseF, "cdd");
  const annualAvgF =
    tempsF.reduce((a, b) => a + b, 0) / tempsF.length;
  const annualHighF = tempsF.reduce((a, b) => Math.max(a, b), -Infinity);
  const annualLowF = tempsF.reduce((a, b) => Math.min(a, b), Infinity);
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
    totalHours: tempsF.length,
  };
}
