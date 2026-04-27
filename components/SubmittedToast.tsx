"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";

export function SubmittedToast() {
  const router = useRouter();
  const [show, setShow] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShow(false);
      router.replace("/jobs");
    }, 4000);
    return () => clearTimeout(timer);
  }, [router]);

  if (!show) return null;
  return (
    <div className="bg-mse-gold/15 border border-mse-gold/40 rounded-2xl p-4 flex items-center gap-3 animate-fade-in">
      <CheckCircle2 className="w-6 h-6 text-mse-gold shrink-0" />
      <div>
        <div className="font-bold text-mse-navy">Dispatch submitted</div>
        <div className="text-sm text-mse-muted">
          Photos keep uploading in the background.
        </div>
      </div>
    </div>
  );
}
