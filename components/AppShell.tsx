"use client";

import Link from "next/link";
import Image from "next/image";
import { LayoutDashboard, LogOut } from "lucide-react";
import { PendingBadge } from "@/components/PendingBadge";
import { LocationConsent } from "@/components/LocationConsent";

export function AppShell({
  children,
  techName,
  isAdmin = false,
}: {
  children: React.ReactNode;
  techName: string;
  isAdmin?: boolean;
}) {
  const logout = async () => {
    try {
      await fetch("/api/auth", { method: "DELETE" });
    } catch {
      // Network failure on logout is fine — we still clear local state below.
    }
    // Tell the SW to drop cached HTML for /jobs and /admin so the next
    // user doesn't see the previous user's pages from the cache.
    if (typeof navigator !== "undefined" && navigator.serviceWorker?.controller) {
      try {
        await new Promise<void>((resolve) => {
          const channel = new MessageChannel();
          const timeout = setTimeout(resolve, 500);
          channel.port1.onmessage = () => {
            clearTimeout(timeout);
            resolve();
          };
          navigator.serviceWorker.controller!.postMessage(
            { type: "clear-user-data" },
            [channel.port2]
          );
        });
      } catch {
        // Best-effort — full page reload below is the real safety net.
      }
    }
    // Hard reload to /login: drops in-memory React state from the previous
    // user (router.replace would keep the SPA shell mounted).
    window.location.replace("/login");
  };
  return (
    <div className="min-h-screen flex flex-col bg-white">
      <header className="bg-mse-navy text-white sticky top-0 z-10 shadow-elevated">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/jobs" className="flex items-center gap-2">
            <Image
              src="/logo.png"
              alt="MSE"
              width={32}
              height={32}
              className="rounded-full"
            />
            <span className="font-bold tracking-tight">MSE Field</span>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <PendingBadge />
            {isAdmin && (
              <Link
                href="/admin"
                aria-label="Admin dashboard"
                className="p-2 rounded-lg hover:bg-white/10 active:bg-white/15 transition-colors"
              >
                <LayoutDashboard className="w-5 h-5" />
              </Link>
            )}
            <span className="hidden sm:inline text-sm text-white/70">{techName}</span>
            <button
              type="button"
              onClick={logout}
              aria-label="Log out"
              className="p-2 rounded-lg hover:bg-white/10 active:bg-white/15 transition-colors"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-2xl w-full mx-auto px-4 py-6 safe-bottom">
        {children}
      </main>
      <LocationConsent techName={techName} />
    </div>
  );
}
