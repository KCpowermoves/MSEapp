"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  DollarSign,
  Image as ImageIcon,
  LayoutDashboard,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Tab strip across the top of every admin page. Pure presentation —
// the layout already gates non-admin users out, so this just decides
// which tab gets the active treatment based on the current path.

interface Tab {
  href: string;
  label: string;
  icon: React.ReactNode;
  // Match the active tab via either exact path or "starts with" — the
  // latter keeps Payroll highlighted on detail pages and tech views.
  match: (path: string) => boolean;
}

const TABS: Tab[] = [
  {
    href: "/admin",
    label: "Dashboard",
    icon: <LayoutDashboard className="w-3.5 h-3.5" />,
    match: (p) => p === "/admin",
  },
  {
    href: "/admin/customers",
    label: "Customers",
    icon: <Building2 className="w-3.5 h-3.5" />,
    match: (p) => p.startsWith("/admin/customers"),
  },
  {
    href: "/admin/library",
    label: "Library",
    icon: <ImageIcon className="w-3.5 h-3.5" />,
    match: (p) => p.startsWith("/admin/library"),
  },
  {
    href: "/admin/payroll",
    label: "Pay Report",
    icon: <DollarSign className="w-3.5 h-3.5" />,
    match: (p) => p.startsWith("/admin/payroll"),
  },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-1 border-b border-mse-light overflow-x-auto -mx-1 px-1">
      {TABS.map((t) => {
        const active = t.match(pathname);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-2.5 text-sm font-semibold rounded-t-lg whitespace-nowrap",
              "transition-[color,background-color,border-color]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mse-red focus-visible:ring-offset-1",
              active
                ? "text-mse-navy bg-mse-light/60 border-b-2 border-mse-navy -mb-px"
                : "text-mse-muted hover:text-mse-navy hover:bg-mse-light/30"
            )}
          >
            {t.icon}
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
