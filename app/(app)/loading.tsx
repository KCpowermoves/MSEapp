import { Loader2 } from "lucide-react";

// Route-level loading state for every page in the app group. Pages are
// force-dynamic and read Google Sheets server-side (300ms+ per tab), so
// without this the UI freezes on the old page during navigation and the
// app "feels slow." With it, taps respond instantly with a spinner.
export default function Loading() {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-3">
      <Loader2 className="w-8 h-8 animate-spin text-mse-gold" />
      <div className="text-sm text-mse-muted">Loading…</div>
    </div>
  );
}
