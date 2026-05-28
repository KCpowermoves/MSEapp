import { NextResponse } from "next/server";
import { autoFinalizeAllStaleDrafts } from "@/lib/data/dispatches";

// Nightly safety net at 01:00 UTC (≈ 8pm EST / 9pm EDT). Sweeps every
// dispatch that's still in draft state — submittedAt empty — and
// finalizes it. Crew + split are pulled from the existing draft row
// (set at job-creation), pay attribution rolls up via submitDispatch.
//
// Per v2 spec, drafts with zero photos are finalized anyway — the
// IndexedDB upload queue on the tech's device keeps retrying until
// their phone has signal, so photos eventually land in Drive even
// after the dispatch row is closed.
//
// Schedule lives in vercel.json. Vercel sends GET with a header set
// to the project's CRON_SECRET (`x-vercel-cron-signature` on Pro+,
// `authorization: Bearer <CRON_SECRET>` on hobby/manual triggers).
// We accept either, plus reject everything else.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isAuthorized(req: Request): boolean {
  // Vercel cron auto-adds this header for scheduled invocations.
  if (req.headers.get("x-vercel-cron-signature")) return true;

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // No secret configured → only allow Vercel-cron-signed requests.
    return false;
  }
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    const result = await autoFinalizeAllStaleDrafts();
    const durationMs = Date.now() - startedAt;
    console.log(
      `[cron-finalize] finalized ${result.finalized.length}, errors ${result.errors.length}, ${durationMs}ms`
    );
    return NextResponse.json({
      ok: true,
      finalized: result.finalized,
      errors: result.errors,
      durationMs,
    });
  } catch (e) {
    console.error("[cron-finalize] fatal:", e);
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
