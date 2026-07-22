import "server-only";
import { env } from "@/lib/env";
import type { Dispatch, EngineeringProject, Job, PayrollPeriod } from "@/lib/types";

/**
 * Internal ops notifications via Resend (transactional email).
 *
 * Deliberately separate from lib/email/send-report.ts (HighLevel):
 * HighLevel's send upserts the recipient as a CRM contact, which is
 * right for customers but wrong for internal team addresses. Resend is
 * a plain transactional API — no CRM side effects.
 *
 * Every send is best-effort and fire-and-forget from the caller's
 * perspective (use notify() which never throws). When Resend isn't
 * configured the send is logged and skipped so the main flow is
 * unaffected in dev / pre-config.
 */

const DEFAULT_TO = "admin@mdsmartenergy.com";
const DEFAULT_APP_URL = "https://ms-eapp.vercel.app";

function appUrl(pathAndQuery: string): string {
  const base = (env.appBaseUrl() ?? DEFAULT_APP_URL).replace(/\/+$/, "");
  return `${base}${pathAndQuery.startsWith("/") ? "" : "/"}${pathAndQuery}`;
}

async function sendViaResend(opts: {
  subject: string;
  html: string;
  to: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const apiKey = env.resendApiKey();
  const from = env.notifyEmailFrom();
  if (!apiKey || !from) return { sent: false, reason: "not configured" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        sent: false,
        reason: `resend ${res.status}: ${text.slice(0, 200)}`,
      };
    }
    return { sent: true };
  } catch (e) {
    return {
      sent: false,
      reason: e instanceof Error ? e.message : "resend failed",
    };
  }
}

/**
 * Fallback path: HighLevel conversations email (same two-call contract
 * as lib/email/send-report.ts). Trade-off: the recipient is upserted as
 * a HighLevel contact — acceptable for the single internal ops mailbox,
 * wrong for anything broader. Resend is preferred whenever configured.
 */
async function sendViaHighLevel(opts: {
  subject: string;
  html: string;
  to: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const token = env.highlevelApiToken();
  const locationId = env.highlevelLocationId();
  if (!token || !locationId) return { sent: false, reason: "not configured" };
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
        reason: `highlevel upsert ${upsert.status}: ${text.slice(0, 200)}`,
      };
    }
    const upsertData = (await upsert.json().catch(() => ({}))) as {
      contact?: { id?: string };
    };
    const contactId = upsertData.contact?.id ?? "";
    if (!contactId) return { sent: false, reason: "highlevel: no contactId" };

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
          contactId,
          subject: opts.subject,
          html: opts.html,
        }),
      }
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        sent: false,
        reason: `highlevel send ${res.status}: ${text.slice(0, 200)}`,
      };
    }
    return { sent: true };
  } catch (e) {
    return {
      sent: false,
      reason: e instanceof Error ? e.message : "highlevel failed",
    };
  }
}

async function sendNotification(opts: {
  subject: string;
  html: string;
  to?: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const to = opts.to || env.notifyEmailTo() || DEFAULT_TO;
  const payload = { subject: opts.subject, html: opts.html, to };

  // Resend first (when configured), HighLevel as the fallback so
  // notifications still deliver while the Resend account/domain is
  // pending. Whichever succeeds first wins.
  const viaResend = await sendViaResend(payload);
  if (viaResend.sent) return viaResend;
  if (viaResend.reason !== "not configured") {
    console.warn(`[notify] resend failed (${viaResend.reason}) — trying HighLevel`);
  }
  const viaHl = await sendViaHighLevel(payload);
  if (viaHl.sent) return viaHl;

  if (viaResend.reason === "not configured" && viaHl.reason === "not configured") {
    console.warn(
      `[notify] no email provider configured — skipping "${opts.subject}" to ${to}`
    );
    return { sent: false, reason: "not configured" };
  }
  return {
    sent: false,
    reason: `resend: ${viaResend.reason}; highlevel: ${viaHl.reason}`,
  };
}

/**
 * Fire-and-forget wrapper — never throws, logs the outcome. Call sites
 * use `void notify(...)` so a notification failure can't break the flow
 * that triggered it. Returns the outcome for callers that care (tests).
 */
export async function notify(opts: {
  subject: string;
  html: string;
  to?: string;
}): Promise<{ sent: boolean; reason?: string }> {
  try {
    const r = await sendNotification(opts);
    if (!r.sent && r.reason !== "not configured") {
      console.warn(`[notify] "${opts.subject}" not sent: ${r.reason}`);
    }
    return r;
  } catch (e) {
    console.warn("[notify] unexpected error:", e);
    return { sent: false, reason: e instanceof Error ? e.message : "error" };
  }
}

// ── HTML shell ──────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

/** Simple branded shell: heading, a few "Label: value" rows, optional CTA. */
function shell(opts: {
  heading: string;
  intro: string;
  rows: Array<[string, string]>;
  ctaLabel?: string;
  ctaHref?: string;
}): string {
  const rows = opts.rows
    .filter(([, v]) => v)
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:13px;white-space:nowrap">${escapeHtml(
          k
        )}</td><td style="padding:4px 0;color:#1A2332;font-size:14px;font-weight:600">${escapeHtml(
          v
        )}</td></tr>`
    )
    .join("");
  const cta =
    opts.ctaLabel && opts.ctaHref
      ? `<p style="margin-top:18px"><a href="${escapeAttr(
          opts.ctaHref
        )}" style="display:inline-block;padding:11px 18px;background:#1A2332;color:#fff;border-radius:10px;text-decoration:none;font-weight:bold;font-size:14px">${escapeHtml(
          opts.ctaLabel
        )}</a></p>`
      : "";
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto">
    <div style="font-size:18px;font-weight:bold;color:#1A2332;margin-bottom:6px">${escapeHtml(
      opts.heading
    )}</div>
    <p style="color:#374151;font-size:14px;line-height:1.5;margin:0 0 12px">${escapeHtml(
      opts.intro
    )}</p>
    <table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse">${rows}</table>
    ${cta}
    <p style="color:#9ca3af;font-size:12px;margin-top:24px">MSE Field · automated notification</p>
  </div>`;
}

// ── Per-event notifications ─────────────────────────────────────────

/** A signed agreement created a new job. */
export function notifyLeadSigned(opts: {
  job: Job;
  agentName?: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const { job } = opts;
  return notify({
    subject: `New signed lead — ${job.customerName}`,
    html: shell({
      heading: "New signed lead → job created",
      intro: "A customer signed their agreement and a job was created. Schedule the visit when ready.",
      rows: [
        ["Customer", job.customerName],
        ["Address", job.siteAddress],
        ["Utility", job.utilityTerritory],
        ["Sold by", opts.agentName || job.soldBy || "—"],
        ["Job", job.jobId],
      ],
      ctaLabel: "Open job",
      ctaHref: appUrl(`/jobs/${encodeURIComponent(job.jobId)}`),
    }),
  });
}

/** A dispatch was submitted and its service report PDF rendered. */
export function notifyReportReady(opts: {
  job: Job;
  dispatch: Dispatch;
  pdfUrl?: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const { job, dispatch } = opts;
  return notify({
    subject: `Service report ready — ${job.customerName}`,
    html: shell({
      heading: "Dispatch submitted — report ready",
      intro: "A tech submitted a completed visit and the service report has been generated.",
      rows: [
        ["Customer", job.customerName],
        ["Address", job.siteAddress],
        ["Service date", dispatch.dispatchDate],
        ["Tech(s)", dispatch.techsOnSite.join(", ") || "—"],
        ["Job", job.jobId],
      ],
      ctaLabel: opts.pdfUrl ? "View report" : "Open job",
      ctaHref: opts.pdfUrl || appUrl(`/jobs/${encodeURIComponent(job.jobId)}`),
    }),
  });
}

/** A weekly payroll period is ready for review/approval. */
export function notifyPayrollReady(opts: {
  period: PayrollPeriod;
}): Promise<{ sent: boolean; reason?: string }> {
  const { period } = opts;
  return notify({
    subject: `Payroll ready to review — ${period.label || period.periodId}`,
    html: shell({
      heading: "Weekly payroll ready to review",
      intro: "Last week closed. The commission report is ready to review and approve.",
      rows: [
        ["Week", period.label || period.periodId],
        ["Dates", `${period.startDate} to ${period.endDate}`],
      ],
      ctaLabel: "Open payroll",
      ctaHref: appUrl(`/payroll/${encodeURIComponent(period.periodId)}`),
    }),
  });
}

/** A building tune-up / engineering project was created. */
export function notifyEngineeringCreated(opts: {
  project: EngineeringProject;
  createdBy?: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const { project } = opts;
  return notify({
    subject: `New building tune-up — ${project.customerName}`,
    html: shell({
      heading: "Building tune-up created",
      intro: "A new engineering project (building tune-up) was created.",
      rows: [
        ["Customer", project.customerName],
        ["Utility", project.utility],
        ["Type", project.projectType],
        ["Created by", opts.createdBy || project.createdBy || "—"],
        ["Project", project.projectId],
      ],
      ctaLabel: "Open building tune-up",
      ctaHref: appUrl(`/admin/engineering/${encodeURIComponent(project.projectId)}`),
    }),
  });
}
