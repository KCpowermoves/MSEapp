/**
 * Psychrometric helpers for the bin-method calculator. Pure math, no
 * server-only imports, so it can be unit-tested with tsx directly.
 *
 * Formulas follow ASHRAE Handbook of Fundamentals (2017), Ch. 1, with
 * Buck (1981) saturation-pressure curves. Accuracy is within ~0.1 °F
 * of published psychrometric-chart wet bulbs over the -40..120 °F
 * range, which is more than enough for mean-coincident reporting.
 */

/** Saturation vapor pressure in Pa. Buck equations, water vs ice. */
export function satVaporPressurePa(tC: number): number {
  if (tC >= 0) {
    return 611.21 * Math.exp((17.502 * tC) / (240.97 + tC));
  }
  return 611.15 * Math.exp((22.452 * tC) / (272.55 + tC));
}

/** Saturation humidity ratio (kg water / kg dry air). */
export function satHumidityRatio(tC: number, pressurePa: number): number {
  const pws = satVaporPressurePa(tC);
  const denom = pressurePa - pws;
  if (denom <= 0) return Infinity; // above boiling for this pressure
  return (0.621945 * pws) / denom;
}

export function humidityRatioFromDewpoint(
  dpC: number,
  pressurePa: number
): number {
  const pw = satVaporPressurePa(dpC);
  return (0.621945 * pw) / (pressurePa - pw);
}

export function humidityRatioFromRh(
  tdbC: number,
  rhPct: number,
  pressurePa: number
): number {
  const pw = (rhPct / 100) * satVaporPressurePa(tdbC);
  return (0.621945 * pw) / (pressurePa - pw);
}

/** Standard-atmosphere pressure at elevation (m). ASHRAE eq. 3. */
export function pressureAtElevationPa(elevationM: number): number {
  return 101325 * Math.pow(1 - 2.25577e-5 * elevationM, 5.2559);
}

/** Humidity ratio predicted by the ASHRAE wet-bulb relation for a
 *  given dry bulb + wet bulb. Eq. 33 (water) / eq. 35 (ice). */
function humidityRatioFromWetBulb(
  tdbC: number,
  twbC: number,
  pressurePa: number
): number {
  const wsStar = satHumidityRatio(twbC, pressurePa);
  if (twbC >= 0) {
    return (
      ((2501 - 2.326 * twbC) * wsStar - 1.006 * (tdbC - twbC)) /
      (2501 + 1.86 * tdbC - 4.186 * twbC)
    );
  }
  return (
    ((2830 - 0.24 * twbC) * wsStar - 1.006 * (tdbC - twbC)) /
    (2830 + 1.86 * tdbC - 2.1 * twbC)
  );
}

/**
 * Thermodynamic wet-bulb temperature (°C) by bisection. The predicted
 * humidity ratio is monotonically increasing in twb, so bisection on
 * [floor, tdb] always converges. Returns tdb when the air is saturated.
 */
export function wetBulbC(
  tdbC: number,
  humidityRatio: number,
  pressurePa: number
): number {
  const wsAtDb = satHumidityRatio(tdbC, pressurePa);
  // Clamp supersaturated data noise to saturation.
  const w = Math.min(humidityRatio, wsAtDb);
  if (w <= 0) {
    // Perfectly dry air: solve anyway, floor guards the search range.
  }
  let lo = tdbC - 60;
  let hi = tdbC;
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    if (humidityRatioFromWetBulb(tdbC, mid, pressurePa) > w) {
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return (lo + hi) / 2;
}

/**
 * Wet bulb (°C) from raw EPW fields, preferring dewpoint over RH.
 * Returns null when neither moisture field is usable. EPW sentinels:
 * dewpoint 99.9, RH 999, pressure 999999.
 */
export function wetBulbFromEpwFields(opts: {
  tdbC: number;
  dewpointC: number | null;
  rhPct: number | null;
  pressurePa: number | null;
  stationElevationM: number;
}): number | null {
  const p =
    opts.pressurePa !== null &&
    Number.isFinite(opts.pressurePa) &&
    opts.pressurePa < 999999 &&
    opts.pressurePa > 30000
      ? opts.pressurePa
      : pressureAtElevationPa(opts.stationElevationM);

  let w: number | null = null;
  if (
    opts.dewpointC !== null &&
    Number.isFinite(opts.dewpointC) &&
    opts.dewpointC < 99.9
  ) {
    w = humidityRatioFromDewpoint(Math.min(opts.dewpointC, opts.tdbC), p);
  } else if (
    opts.rhPct !== null &&
    Number.isFinite(opts.rhPct) &&
    opts.rhPct >= 0 &&
    opts.rhPct <= 110
  ) {
    w = humidityRatioFromRh(opts.tdbC, Math.min(opts.rhPct, 100), p);
  }
  if (w === null) return null;
  return wetBulbC(opts.tdbC, w, p);
}

export function cToF(c: number): number {
  return (c * 9) / 5 + 32;
}
