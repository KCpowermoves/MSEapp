"use client";

import { useRouter } from "next/navigation";
import { UndoStackProvider, UndoToast } from "@/components/payroll/UndoContext";

// Tiny client shell that wraps every TechSection on the admin
// commission detail page in a shared undo context. The toast pill
// renders at the bottom of the viewport whenever there's a recent
// edit to undo. After a successful undo we refresh() so the report
// totals re-pull from the server.

export function UndoProviderShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <UndoStackProvider onAfterUndo={() => router.refresh()}>
      {children}
      <UndoToast />
    </UndoStackProvider>
  );
}
