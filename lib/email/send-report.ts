import "server-only";
import { env } from "@/lib/env";
import { extractDriveFileId } from "@/lib/utils";

/**
 * Sends the auto-generated service report to a customer via HighLevel.
 *
 * Two-call flow (per LeadConnector v2 contract):
 *   1. POST /contacts/upsert (Version 2021-07-28) — idempotent
 *      create-or-find by email. Returns the contactId.
 *   2. POST /conversations/messages (Version 2021-04-15) with
 *      type=Email + contactId. Location is implied by the contact, so
 *      we don't pass locationId or raw `to` on this call.
 *
 * Returns:
 *  - { sent: true } when HighLevel accepted both calls
 *  - { sent: false, reason: "not configured" } when env vars missing
 *    (so the rest of the flow keeps working in dev / pre-launch)
 *  - { sent: false, reason: <error> } when HighLevel rejected either call
 *
 * The HTML body just links to the Drive PDF — we don't attach because
 * Drive's share-with-anyone permission handles delivery cleanly.
 */
export interface HeroPhotos {
  /** Drive URL of the "before" photo. We extract the fileId and embed
   *  via the Drive thumbnail proxy so the customer doesn't need to
   *  click through to view it. */
  beforeUrl: string;
  /** Drive URL of the "after" photo. */
  afterUrl: string;
}

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
  /** When present, embeds a side-by-side before/after photo pair near
   *  the top of the email so customers see the work right away. */
  heroPhotos?: HeroPhotos;
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

  const html = buildEmailBody({
    customerName: opts.customerName,
    pdfUrl: opts.pdfUrl,
    jobAddress: opts.jobAddress,
    dispatchDate: opts.dispatchDate,
    rating: opts.rating,
    googleReviewUrl: opts.googleReviewUrl,
    heroPhotos: opts.heroPhotos,
  });

  // HighLevel's /conversations/messages endpoint with type=Email is
  // contact-scoped — it wants a contactId, not a raw `to` email. We do
  // a two-call dance: upsert a contact by email (idempotent on
  // [locationId, email]), then send the message bound to that contact.
  // The upsert call uses Version: 2021-07-28; the messages call uses
  // Version: 2021-04-15. Don't mix them.
  let contactId: string;
  try {
    const upsert = await fetch(
      "https://services.leadconnectorhq.com/contacts/upsert",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Version: "2021-07-28",
          Accept: "application/json",
        },
        body: JSON.stringify({ locationId, email: opts.to }),
      }
    );
    if (!upsert.ok) {
      const text = await upsert.text().catch(() => "");
      return {
        sent: false,
        reason: `highlevel upsert ${upsert.status}: ${text.slice(0, 300)}`,
      };
    }
    const upsertData = (await upsert.json().catch(() => ({}))) as {
      contact?: { id?: string };
    };
    contactId = upsertData.contact?.id ?? "";
    if (!contactId) {
      return {
        sent: false,
        reason: "highlevel upsert returned no contactId",
      };
    }
  } catch (e) {
    return {
      sent: false,
      reason: e instanceof Error ? e.message : "highlevel upsert failed",
    };
  }

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
        // Per LeadConnector docs: when contactId is set the location
        // is implied by the contact, so we don't pass locationId or
        // raw `to` here.
        body: JSON.stringify({
          type: "Email",
          contactId,
          subject,
          html,
        }),
      }
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        sent: false,
        reason: `highlevel send ${res.status}: ${text.slice(0, 300)}`,
      };
    }
    return { sent: true };
  } catch (e) {
    return {
      sent: false,
      reason: e instanceof Error ? e.message : "highlevel send failed",
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
  heroPhotos?: HeroPhotos;
}): string {
  const greeting = `<p>Hi ${escapeHtml(opts.customerName)},</p>`;

  const heroBlock = renderHeroBlock(opts.heroPhotos);

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
    heroBlock,
    reportBlock,
    fiveStarBlock,
    lowRatingBlock,
    giftBlock,
    footer,
  ].join("\n");
}

/**
 * Builds the side-by-side before/after image pair. Uses the Drive
 * thumbnail proxy so customers' email clients can render without auth
 * (our uploads are share-with-anyone). Drops the block entirely when
 * either URL is missing or unparseable.
 */
function renderHeroBlock(hero?: HeroPhotos): string {
  if (!hero) return "";
  const beforeId = extractDriveFileId(hero.beforeUrl);
  const afterId = extractDriveFileId(hero.afterUrl);
  if (!beforeId || !afterId) return "";
  const beforeImg = `https://drive.google.com/thumbnail?id=${beforeId}&sz=w800`;
  const afterImg = `https://drive.google.com/thumbnail?id=${afterId}&sz=w800`;
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
      style="border-collapse:collapse;margin:6px 0 18px">
      <tr>
        <td width="50%" style="padding-right:5px;vertical-align:top">
          <div style="font-size:11px;text-transform:uppercase;color:#6b7280;
            letter-spacing:0.5px;font-weight:bold;margin-bottom:4px">
            Before
          </div>
          <img src="${escapeAttr(beforeImg)}" alt="Before service"
            style="width:100%;height:auto;border-radius:8px;border:1px solid #e5e7eb;display:block">
        </td>
        <td width="50%" style="padding-left:5px;vertical-align:top">
          <div style="font-size:11px;text-transform:uppercase;color:#1A2332;
            letter-spacing:0.5px;font-weight:bold;margin-bottom:4px">
            After
          </div>
          <img src="${escapeAttr(afterImg)}" alt="After service"
            style="width:100%;height:auto;border-radius:8px;border:1px solid #e5e7eb;display:block">
        </td>
      </tr>
    </table>
  `;
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
