"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

// Shared undo stack scoped to a single commission report detail page.
// Each successful edit (Add adjustment, Add standalone line, Reattribute,
// Split change, Override, Void) pushes a record onto the stack with:
//   - a list of adjustmentIds it created (most edits = 1; reattribute
//     = 2; split-change = N; void = 0, but we still record the voided
//     id so undo can re-create or skip)
//   - a label like "Add adjustment to Crystal R." for the toast
//
// 'Undo last edit' pops the most recent record and voids each
// adjustmentId via /api/admin/payroll/adjustments/void. We can't
// reverse a void (the original adjustment row is still there with
// amount=0) so void actions are non-undoable and pushed as such.
//
// State lives in React only — survives within the page session but
// resets on full reload. That's the right tradeoff: undo is a
// "recent action" affordance, not a permanent history.

export interface UndoEntry {
  id: string; // local UUID for the stack entry
  label: string;
  adjustmentIds: string[];
  undoable: boolean;
  createdAt: number;
}

interface UndoContextValue {
  stack: UndoEntry[];
  push: (entry: Omit<UndoEntry, "id" | "createdAt">) => void;
  undoLast: () => Promise<void>;
  clear: () => void;
  busy: boolean;
  error: string | null;
}

const UndoContext = createContext<UndoContextValue | null>(null);

export function useUndoStack(): UndoContextValue {
  const ctx = useContext(UndoContext);
  if (!ctx) {
    // Permissive — components outside the provider get a no-op so
    // they can still call push without crashing.
    return {
      stack: [],
      push: () => {},
      undoLast: async () => {},
      clear: () => {},
      busy: false,
      error: null,
    };
  }
  return ctx;
}

export function UndoStackProvider({
  children,
  onAfterUndo,
}: {
  children: React.ReactNode;
  onAfterUndo?: () => void;
}) {
  const [stack, setStack] = useState<UndoEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Capture onAfterUndo in a ref so the undo function doesn't re-create
  // on every render of the parent — keeps the dialogs from re-running
  // their effects unnecessarily.
  const cbRef = useRef(onAfterUndo);
  useEffect(() => {
    cbRef.current = onAfterUndo;
  }, [onAfterUndo]);

  const push = useCallback(
    (entry: Omit<UndoEntry, "id" | "createdAt">) => {
      setStack((prev) => [
        ...prev,
        {
          ...entry,
          id: `undo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          createdAt: Date.now(),
        },
      ]);
      setError(null);
    },
    []
  );

  const undoLast = useCallback(async () => {
    setError(null);
    let popped: UndoEntry | null = null;
    setStack((prev) => {
      if (prev.length === 0) return prev;
      popped = prev[prev.length - 1];
      return prev.slice(0, -1);
    });
    if (!popped) return;
    const entry = popped as UndoEntry;
    if (!entry.undoable || entry.adjustmentIds.length === 0) {
      // Can't actually reverse this kind of action — pop has already
      // removed it from the stack. Surface a hint.
      setError("That action can't be undone (a void is permanent).");
      return;
    }
    setBusy(true);
    try {
      for (const adjustmentId of entry.adjustmentIds) {
        const res = await fetch("/api/admin/payroll/adjustments/void", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ adjustmentId }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(
            body.error ?? `Server error ${res.status} voiding ${adjustmentId}`
          );
        }
      }
      cbRef.current?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Undo failed");
      // Push the entry back so the user can try again.
      setStack((prev) => [...prev, entry]);
    } finally {
      setBusy(false);
    }
  }, []);

  const clear = useCallback(() => {
    setStack([]);
    setError(null);
  }, []);

  return (
    <UndoContext.Provider
      value={{ stack, push, undoLast, clear, busy, error }}
    >
      {children}
    </UndoContext.Provider>
  );
}

// ─── Floating undo pill ────────────────────────────────────────────

export function UndoToast() {
  const { stack, undoLast, busy, error, clear } = useUndoStack();
  const last = stack[stack.length - 1];

  if (!last && !error) return null;

  return (
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40"
      role="status"
      aria-live="polite"
    >
      <div className="rounded-full bg-mse-navy text-white shadow-elevated flex items-center gap-2 pl-4 pr-2 py-1.5 max-w-[92vw]">
        <span className="text-sm font-semibold truncate max-w-[40vw]">
          {error ? error : last?.label}
        </span>
        {!error && last && last.undoable && (
          <button
            type="button"
            onClick={undoLast}
            disabled={busy}
            className="px-3 py-1 rounded-full text-xs font-bold bg-mse-gold text-mse-navy hover:bg-mse-gold/90 active:scale-95 disabled:opacity-60"
          >
            {busy ? "Undoing…" : "Undo"}
          </button>
        )}
        <button
          type="button"
          onClick={clear}
          className="px-2 py-1 text-white/70 hover:text-white text-xs"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
