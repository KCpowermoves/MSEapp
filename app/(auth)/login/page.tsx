"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Delete } from "lucide-react";
import { cn } from "@/lib/utils";

export default function LoginPage() {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);

  const submit = async (digits: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: digits }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Wrong PIN");
        setPin("");
        setShake(true);
        setTimeout(() => setShake(false), 400);
        return;
      }
      router.replace("/jobs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (pin.length === 4) {
      submit(pin);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  const press = (digit: string) => {
    if (loading) return;
    setPin((p) => (p.length >= 4 ? p : p + digit));
  };
  const backspace = () => {
    if (loading) return;
    setPin((p) => p.slice(0, -1));
    setError(null);
  };

  return (
    <main className="flex-1 flex flex-col items-center justify-between px-6 pt-16 pb-12 safe-bottom">
      <div className="flex flex-col items-center gap-4">
        <Image
          src="/logo.png"
          alt="MSE"
          width={96}
          height={96}
          className="rounded-full shadow-elevated"
          priority
        />
        <div className="text-white text-2xl font-bold tracking-tight">
          MSE Field
        </div>
        <div className="text-white/60 text-sm">Enter your 4-digit PIN</div>
      </div>

      <div className="flex flex-col items-center gap-6">
        <div
          className={cn(
            "flex gap-4 transition-transform",
            shake && "animate-[shake_0.4s_ease-in-out]"
          )}
        >
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={cn(
                "w-4 h-4 rounded-full border-2 transition-colors",
                pin.length > i
                  ? "bg-mse-gold border-mse-gold"
                  : "border-white/30"
              )}
            />
          ))}
        </div>
        <div
          className={cn(
            "h-5 text-mse-gold text-sm transition-opacity",
            error ? "opacity-100" : "opacity-0"
          )}
          aria-live="polite"
        >
          {error}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 w-full max-w-xs">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <PadButton key={d} onClick={() => press(d)}>
            {d}
          </PadButton>
        ))}
        <PadButton onClick={backspace} variant="ghost" aria-label="Delete">
          <Delete className="w-6 h-6" />
        </PadButton>
        <PadButton onClick={() => press("0")}>0</PadButton>
        <div />
      </div>

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-6px); }
          40% { transform: translateX(6px); }
          60% { transform: translateX(-4px); }
          80% { transform: translateX(4px); }
        }
      `}</style>
    </main>
  );
}

function PadButton({
  children,
  onClick,
  variant = "default",
  ...props
}: {
  children: React.ReactNode;
  onClick: () => void;
  variant?: "default" | "ghost";
} & React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-16 rounded-2xl text-2xl font-medium tap-target",
        "transition-[transform,background-color,box-shadow] duration-100",
        "active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mse-gold",
        variant === "default"
          ? "bg-white/10 text-white hover:bg-white/15 active:bg-white/20"
          : "bg-transparent text-white/70 hover:text-white hover:bg-white/5"
      )}
      {...props}
    >
      {children}
    </button>
  );
}
