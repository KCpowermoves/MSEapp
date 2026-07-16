import { NextResponse } from "next/server";
import { autoFinalizeAllStaleDrafts } from "@/lib/data/dispatches";

// GET /api/cron/finalize-drafts
//
// Fires nightly (see vercel.json — 07:00 UTC = 2–3am Eastern). Submits
// every open draft dispatch from today and prior days so pay
// attribution always runs: real work pays automatically, and anything
// that submits with problems ($0 pay, missing photos) surfaces on the
// admin finalization worklist as an exception instead of silently
// sitting as a draft forever.
//
// Auth: same scheme as the weekly-period cron — Bearer CRON_SECRET
// when set, otherwise Vercel's documented cron user-agent.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // Vercel hobby cap

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  const ua = request.headers.get("user-agent") ?? "";
  const authorized = secret
    ? auth === `Bearer ${secret}`
    : ua.toLowerCase().includes("vercel-cron") ||
      Boolean(request.headers.get("x-vercel-cron"));
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { finalized, errors } = await autoFinalizeAllStaleDrafts();
    if (finalized.length > 0 || errors.length > 0) {
      console.log(
        `[cron/finalize-drafts] finalized=${finalized.join(",") || "none"} errors=${errors.join(",") || "none"}`
      );
    }
    return NextResponse.json({ ok: true, finalized, errors });
  } catch (e) {
    console.error("[cron/finalize-drafts] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Cron failed" },
      { status: 500 }
    );
  }
}
