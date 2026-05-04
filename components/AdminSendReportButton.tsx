"use client";

import { useState } from "react";
import {
  Loader2,
  Mail,
  MailCheck,
  MailWarning,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";

type State =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; recipient: string }
  | { kind: "saved"; recipient: string; reason: string }
  | { kind: "error"; reason: string };

type RenderState =
  | { kind: "idle" }
  | { kind: "rendering" }
  | { kind: "rendered"; url: string }
  | { kind: "error"; reason: string };

/**
 * Tiny client widget that calls /api/dispatches/send-report and shows
 * the result inline. Lives on the admin dashboard so admins can re-send
 * the customer report when the auto-send didn't go (e.g. email was
 * fixed after the visit).
 */
export function AdminSendReportButton({
  dispatchId,
  defaultEmail,
  hasPdf,
  pdfUrl,
  reportEmailedAt,
}: {
  dispatchId: string;
  defaultEmail: string;
  hasPdf: boolean;
  pdfUrl: string;
  reportEmailedAt: string;
}) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [renderState, setRenderState] = useState<RenderState>({ kind: "idle" });
  const [editing, setEditing] = useState(false);
  const [recipient, setRecipient] = useState(defaultEmail);

  const send = async () => {
    setState({ kind: "sending" });
    try {
      const res = await fetch("/api/dispatches/send-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dispatchId, to: recipient.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState({
          kind: "error",
          reason: data.error ?? `HTTP ${res.status}`,
        });
        return;
      }
      if (data.sent) {
        setState({ kind: "sent", recipient: data.recipient });
      } else {
        setState({
          kind: "saved",
          recipient: data.recipient,
          reason: data.reason ?? "saved without delivery",
        });
      }
      setEditing(false);
    } catch (e) {
      setState({
        kind: "error",
        reason: e instanceof Error ? e.message : "Network error",
      });
    }
  };

  const rerenderPdf = async () => {
    if (!confirm("Re-render the PDF for this dispatch? Replaces the current one in Drive.")) return;
    setRenderState({ kind: "rendering" });
    try {
      const res = await fetch("/api/dispatches/render-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dispatchId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        setRenderState({
          kind: "error",
          reason: data.error ?? `HTTP ${res.status}`,
        });
        return;
      }
      setRenderState({ kind: "rendered", url: data.url });
    } catch (e) {
      setRenderState({
        kind: "error",
        reason: e instanceof Error ? e.message : "Network error",
      });
    }
  };

  const sending = state.kind === "sending";
  const rendering = renderState.kind === "rendering";

  // Latest known PDF URL — prefer freshly rendered if we just hit
  // re-render, otherwise the prop from the server.
  const liveUrl =
    renderState.kind === "rendered" ? renderState.url : pdfUrl;
  const liveHasPdf = renderState.kind === "rendered" || hasPdf;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <PdfBadge hasPdf={liveHasPdf} pdfUrl={liveUrl} />
        {liveHasPdf && (
          <button
            type="button"
            onClick={rerenderPdf}
            disabled={rendering}
            className={cn(
              "text-[10px] uppercase tracking-wider font-bold inline-flex items-center gap-1 px-2 py-0.5 rounded-full",
              "bg-white border border-mse-light text-mse-muted hover:text-mse-navy hover:border-mse-navy/40",
              rendering && "opacity-60 cursor-not-allowed"
            )}
            title="Replace the PDF in Drive with a fresh render — useful if photos were missing"
          >
            {rendering ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <RefreshCw className="w-3 h-3" />
            )}
            {rendering ? "Rendering" : "Re-render"}
          </button>
        )}
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs text-mse-navy font-semibold hover:underline"
          >
            {state.kind === "sent" || reportEmailedAt
              ? "Resend"
              : defaultEmail
              ? "Send report"
              : "Send report…"}
          </button>
        )}
      </div>
      {reportEmailedAt && state.kind !== "sent" && (
        <div className="text-[11px] text-mse-muted">
          Last sent {defaultEmail ? `to ${defaultEmail} ` : ""}
          {formatSentAt(reportEmailedAt)}
        </div>
      )}
      {editing && (
        <div className="flex items-center gap-2">
          <input
            type="email"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="customer@example.com"
            className="flex-1 px-3 py-2 rounded-lg border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy"
          />
          <button
            type="button"
            onClick={send}
            disabled={sending || !recipient.trim()}
            className={cn(
              "px-3 py-2 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 shrink-0",
              "bg-mse-navy text-white hover:bg-mse-navy-soft",
              (sending || !recipient.trim()) && "opacity-60 cursor-not-allowed"
            )}
          >
            {sending ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Sending
              </>
            ) : (
              <>
                <Mail className="w-3.5 h-3.5" />
                Send
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="text-xs text-mse-muted hover:text-mse-navy px-2"
          >
            Cancel
          </button>
        </div>
      )}
      {state.kind === "sent" && (
        <div className="text-xs text-mse-navy bg-mse-gold/10 border border-mse-gold/30 rounded-md px-2 py-1 inline-flex items-center gap-1.5">
          <MailCheck className="w-3.5 h-3.5" />
          Sent to {state.recipient}
        </div>
      )}
      {state.kind === "saved" && (
        <div className="text-xs text-mse-muted bg-mse-light/60 rounded-md px-2 py-1 inline-flex items-center gap-1.5">
          <MailWarning className="w-3.5 h-3.5" />
          Saved for {state.recipient} — {state.reason}
        </div>
      )}
      {state.kind === "error" && (
        <div className="text-xs text-mse-red bg-mse-red/5 border border-mse-red/20 rounded-md px-2 py-1">
          {state.reason}
        </div>
      )}
      {renderState.kind === "rendered" && (
        <div className="text-xs text-mse-navy bg-mse-gold/10 border border-mse-gold/30 rounded-md px-2 py-1 inline-flex items-center gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" />
          PDF re-rendered. Resend to share the new copy.
        </div>
      )}
      {renderState.kind === "error" && (
        <div className="text-xs text-mse-red bg-mse-red/5 border border-mse-red/20 rounded-md px-2 py-1">
          Render failed: {renderState.reason}
        </div>
      )}
    </div>
  );
}

function PdfBadge({
  hasPdf,
  pdfUrl,
}: {
  hasPdf: boolean;
  pdfUrl: string;
}) {
  if (hasPdf) {
    return (
      <a
        href={pdfUrl}
        target="_blank"
        rel="noopener"
        className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full bg-mse-gold/15 text-mse-navy hover:bg-mse-gold/30 transition-colors"
      >
        PDF ready
      </a>
    );
  }
  return (
    <span className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full bg-mse-light text-mse-muted">
      PDF rendering…
    </span>
  );
}

function formatSentAt(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `today at ${time}`;
  const dateStr = d.toLocaleDateString([], { month: "short", day: "numeric" });
  return `${dateStr} at ${time}`;
}
