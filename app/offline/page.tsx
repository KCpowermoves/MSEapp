"use client";

import { usePathname } from "next/navigation";
import { OfflineJobDetail } from "@/components/OfflineJobDetail";
import { OfflineAddUnit } from "@/components/OfflineAddUnit";

/**
 * SW-served offline fallback. When the user navigates to a route the
 * service worker hasn't cached (most commonly a fresh local-job-XXX
 * URL created in airplane mode), the fetch handler returns this page.
 *
 * The page reads the URL the user actually wanted via usePathname()
 * and dispatches to the appropriate offline-aware view, all rendered
 * from IndexedDB on the client.
 *
 * Lives at /offline (not under (app)/) so it doesn't depend on a
 * server-side session check that would otherwise redirect to /login.
 */
export default function OfflineShell() {
  const pathname = usePathname() ?? "";

  // /jobs/[jobId]/units/new → offline add-unit form
  const newUnitMatch = pathname.match(/^\/jobs\/([^/]+)\/units\/new\/?$/);
  if (newUnitMatch) {
    return (
      <main className="min-h-screen bg-white max-w-2xl mx-auto px-4 py-6 safe-bottom">
        <OfflineAddUnit jobId={decodeURIComponent(newUnitMatch[1])} />
      </main>
    );
  }

  // /jobs/[jobId] → offline job detail
  const detailMatch = pathname.match(/^\/jobs\/([^/]+)\/?$/);
  if (detailMatch) {
    return (
      <main className="min-h-screen bg-white max-w-2xl mx-auto px-4 py-6 safe-bottom">
        <OfflineJobDetail jobId={decodeURIComponent(detailMatch[1])} />
      </main>
    );
  }

  // Anything else hitting the offline shell — show a friendly message
  // and a way back to the cached jobs list.
  return (
    <main className="min-h-screen bg-white max-w-2xl mx-auto px-6 py-12 safe-bottom text-center">
      <h1 className="text-2xl font-bold text-mse-navy mb-2">
        You&apos;re offline
      </h1>
      <p className="text-mse-muted text-sm mb-6">
        This screen isn&apos;t cached for offline use. Try the jobs list
        or wait until you have signal.
      </p>
      <a
        href="/jobs"
        className="inline-block bg-mse-red text-white font-bold rounded-2xl px-6 py-3"
      >
        Back to jobs
      </a>
    </main>
  );
}
