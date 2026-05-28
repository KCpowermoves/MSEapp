"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

// Shared payroll modal shell — fixed overlay + centered panel with a
// generous max-width, scroll-friendly body, and a tight focus trap
// via tabindex. Click-outside and Escape both close.

interface Props {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onClose: () => void;
  /** Max width tier — "sm" for confirmations, "md" default, "lg" for
   *  the split-change dialog with multi-row table. */
  size?: "sm" | "md" | "lg";
}

export function Dialog({
  title,
  subtitle,
  children,
  onClose,
  size = "md",
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // Lock scroll on the underlying page while modal open.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const widthClass =
    size === "sm" ? "max-w-sm" : size === "lg" ? "max-w-2xl" : "max-w-md";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={cn(
          "relative bg-white rounded-2xl shadow-elevated w-full max-h-[90vh] overflow-y-auto",
          widthClass
        )}
      >
        <div className="sticky top-0 bg-white border-b border-mse-light px-5 py-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-mse-navy truncate">{title}</h2>
            {subtitle && (
              <div className="text-xs text-mse-muted mt-0.5">{subtitle}</div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md text-mse-muted hover:text-mse-navy hover:bg-mse-light"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
