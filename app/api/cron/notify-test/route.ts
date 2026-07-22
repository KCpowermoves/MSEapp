import { NextResponse } from "next/server";
import { notify } from "@/lib/email/notify";

// TEMPORARY endpoint for one-time live verification of the internal
// notification path (Resend → HighLevel fallback) with production env.
// Same auth scheme as the other crons. REMOVE after the test run.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const result = await notify({
    subject: "MSE Field notifications are live (test)",
    html: `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto">
  <div style="font-size:18px;font-weight:bold;color:#1A2332;margin-bottom:6px">Notifications are wired up</div>
  <p style="color:#374151;font-size:14px;line-height:1.5">One-time test from tonight's overnight work. This mailbox now receives automatic alerts for:</p>
  <ul style="color:#374151;font-size:14px;line-height:1.7">
    <li>New signed lead &rarr; job created</li>
    <li>Dispatch submitted &rarr; service report ready</li>
    <li>Weekly payroll ready to review (Monday mornings)</li>
    <li>New building tune-up (engineering project) created</li>
  </ul>
  <p style="color:#9ca3af;font-size:12px;margin-top:24px">MSE Field &middot; automated notification (test)</p>
</div>`,
  });
  return NextResponse.json({ ok: result.sent, ...result });
}
