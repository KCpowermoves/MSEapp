"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
  const logout = async () => {
    await fetch("/api/auth", { method: "DELETE" });
    router.replace("/login");
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
