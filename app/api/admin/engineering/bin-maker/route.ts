import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/payroll/auth";
import {
  computeBinData,
  decodeSchedule,
  decodeMonths,
} from "@/lib/engineering/bin-maker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/engineering/bin-maker?station=724060&binWidth=5&hddBase=65&cddBase=65
 *
 * Runs the TMY3 bin-method calc live. Fetches NREL's public archive
 * for the given USAF station number, returns bin table + HDD/CDD.
 */
export async function GET(req: NextRequest) {
  const guard = await requireAdmin();
  if ("response" in guard) return guard.response;

  const url = new URL(req.url);
  const station = (url.searchParams.get("station") ?? "").trim();
  if (!/^\d{6}$/.test(station)) {
    return NextResponse.json(
      { error: "station must be a 6-digit USAF number" },
      { status: 400 }
    );
  }
  const binWidthF = clampNum(url.searchParams.get("binWidth"), 5, 1, 20);
  const hddBaseF = clampNum(url.searchParams.get("hddBase"), 65, 40, 80);
  const cddBaseF = clampNum(url.searchParams.get("cddBase"), 65, 40, 90);
  // 168-char binary string: one slot per hour of the week (Sun 00 ..
  // Sat 23). Missing/invalid → 24/7 default.
  const schedule = decodeSchedule(url.searchParams.get("schedule"));
  // 12-char binary string, Jan..Dec. Missing/invalid → all months.
  const months = decodeMonths(url.searchParams.get("months"));

  try {
    const data = await computeBinData({
      usaf: station,
      binWidthF,
      hddBaseF,
      cddBaseF,
      schedule,
      months,
    });
    // Schedule param is part of the URL, so the edge cache keys off it
    // naturally — different schedules → different cached responses.
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, max-age=3600, s-maxage=86400",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Bin calc failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

function clampNum(
  raw: string | null,
  fallback: number,
  min: number,
  max: number
): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}
