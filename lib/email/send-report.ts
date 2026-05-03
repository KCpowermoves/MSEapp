import "server-only";
import { env } from "@/lib/env";

/**
 * Sends the auto-generated service report to a customer via HighLevel.
 *
 * Returns:
 *  - { sent: true } when HighLevel accepted the request
 *  - { sent: false, reason: "not configured" } when env vars are
 *    missing (we still want the rest of the flow to succeed in dev /
 *    pre-launch — wire HIGHLEVEL_API_TOKEN to enable real sends)
 *  - { sent: false, reason: <error> } when HighLevel rejected the call
 *
 * The HighLevel side expects a contact + outbound email. We POST to the
 * v2 conversations API with a bare-bones HTML body that links to the
 * Drive PDF. Customers click through to view; we don't attach the PDF
 * directly because Drive will respect their account-level access.
 */
export async function sendReportEmail(opts: {
  to: string;
  customerName: string;
  pdfUrl: string;
  jobAddress: string;
  dispatchDate: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const token = env.highlevelApiToken();
  const locationId = env.highlevelLocationId();
  if (!token || !locationId) {
    console.warn(
      "[email] HighLevel not configured — saving send request without delivery."
    );
    return { sent: false, reason: "not configured" };
  }
  if (!opts.to) return { sent: false, reason: "no recipient" };

  const subject = `Your service report from Maryland Smart Energy — ${opts.dispatchDate}`;
  const html = `
    <p>Hi ${escapeHtml(opts.customerName)},</p>
    <p>Thanks again for letting our team out today. Your service report is ready —
    photos and a summary of the work are in the PDF below.</p>
    <p><a href="${escapeAttr(opts.pdfUrl)}"
      style="display:inline-block;padding:12px 18px;background:#1A2332;color:#fff;
      border-radius:10px;text-decoration:none;font-weight:bold">View your report</a></p>
    <p style="color:#6b7280;font-size:13px;margin-top:24px">
      Service date: ${escapeHtml(opts.dispatchDate)}<br>
      Address: ${escapeHtml(opts.jobAddress)}
    </p>
    <p style="color:#6b7280;font-size:12px">
      Maryland Smart Energy · Empower Maryland program partner
    </p>
  `;

  try {
    const res = await fetch("https://services.leadconnectorhq.com/conversations/messages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Version: "2021-04-15",
        Accept: "application/json",
      },
      body: JSON.stringify({
        type: "Email",
        locationId,
        to: opts.to,
        subject,
        html,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { sent: false, reason: `highlevel ${res.status}: ${text.slice(0, 300)}` };
    }
    return { sent: true };
  } catch (e) {
    return {
      sent: false,
      reason: e instanceof Error ? e.message : "highlevel call failed",
    };
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}
