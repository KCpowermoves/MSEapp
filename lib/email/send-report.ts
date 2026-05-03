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
  /** 0 if not yet captured. 5 = great visit; 1–4 = needs follow-up. */
  rating?: number;
  /** Public Google review link. When present and rating === 5, the
   *  email includes a "share us on Google" CTA. */
  googleReviewUrl?: string;
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

  const subject =
    opts.rating === 5
      ? `Thanks for the kind words — your MSE service report is here`
      : opts.rating && opts.rating > 0
      ? `Your MSE service report — and a quick favor`
      : `Your service report from Maryland Smart Energy`;

  const html = buildEmailBody(opts);

  try {
    const res = await fetch(
      "https://services.leadconnectorhq.com/conversations/messages",
      {
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
      }
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        sent: false,
        reason: `highlevel ${res.status}: ${text.slice(0, 300)}`,
      };
    }
    return { sent: true };
  } catch (e) {
    return {
      sent: false,
      reason: e instanceof Error ? e.message : "highlevel call failed",
    };
  }
}

/**
 * Single email per dispatch with three variants:
 *
 * - rating === 5: warm thanks + Google review CTA
 * - rating in 1..4: short, gentle nudge to reply with what we missed
 * - no rating yet: neutral (we still send the report + thank-you gift)
 *
 * Every variant includes the free-filter thank-you offer so the gift
 * isn't tied to a 5★ rating (keeps us out of Google's incentivized-
 * review trap).
 */
function buildEmailBody(opts: {
  customerName: string;
  pdfUrl: string;
  jobAddress: string;
  dispatchDate: string;
  rating?: number;
  googleReviewUrl?: string;
}): string {
  const greeting = `<p>Hi ${escapeHtml(opts.customerName)},</p>`;

  const reportBlock = `
    <p>Your service report from today is ready — photos, work summary, and
    everything we touched are inside.</p>
    <p>
      <a href="${escapeAttr(opts.pdfUrl)}"
        style="display:inline-block;padding:12px 18px;background:#1A2332;color:#fff;
        border-radius:10px;text-decoration:none;font-weight:bold">
        View your service report
      </a>
    </p>
  `;

  // Free-filter thank-you offer — same for every customer, framed as a
  // gift for honest feedback (not for a 5★ review).
  const giftBlock = `
    <table role="presentation" width="100%" style="margin-top:18px;border-collapse:collapse">
      <tr>
        <td style="padding:14px 16px;background:#FFF8E5;border:1px solid #F0D27B;border-radius:12px">
          <div style="font-weight:bold;color:#1A2332;font-size:15px;margin-bottom:6px">
            🎁 A thank-you from MSE
          </div>
          <div style="color:#1A2332;font-size:14px;line-height:1.5">
            Because you took the time to share honest feedback, we&apos;d
            like to install a <strong>free air filter on your next service
            visit</strong>. Just mention this email when you book — no
            promo code needed, and it doesn&apos;t expire.
          </div>
        </td>
      </tr>
    </table>
  `;

  const fiveStarBlock =
    opts.rating === 5 && opts.googleReviewUrl
      ? `
    <p style="margin-top:20px">
      Thank you for the 5-star rating — that means a lot to a small
      Maryland team like ours. If you have 30 seconds, sharing on Google
      genuinely helps:
    </p>
    <p>
      <a href="${escapeAttr(opts.googleReviewUrl)}"
        style="display:inline-block;padding:10px 16px;background:#C8A04A;color:#1A2332;
        border-radius:10px;text-decoration:none;font-weight:bold">
        Leave a Google review
      </a>
    </p>
  `
      : "";

  const lowRatingBlock =
    opts.rating && opts.rating > 0 && opts.rating < 5
      ? `
    <p style="margin-top:20px;color:#1A2332">
      You rated us <strong>${opts.rating} star${
          opts.rating === 1 ? "" : "s"
        }</strong>, and we want to make it right. If you have a moment,
      just hit reply and tell us what would&apos;ve made it 5-star —
      goes straight to our team and stays private.
    </p>
  `
      : "";

  const footer = `
    <p style="color:#6b7280;font-size:13px;margin-top:24px">
      Service date: ${escapeHtml(opts.dispatchDate)}<br>
      Site: ${escapeHtml(opts.jobAddress)}
    </p>
    <p style="color:#6b7280;font-size:12px">
      Maryland Smart Energy · Empower Maryland program partner
    </p>
  `;

  return [
    greeting,
    reportBlock,
    fiveStarBlock,
    lowRatingBlock,
    giftBlock,
    footer,
  ].join("\n");
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
