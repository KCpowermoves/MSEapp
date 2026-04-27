"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Minus, Plus } from "lucide-react";
import { PhotoCapture, type CapturedPhoto } from "@/components/PhotoCapture";
import { enqueuePhoto } from "@/lib/upload-queue";
import { kickWorker } from "@/lib/upload-worker";
import { cn } from "@/lib/utils";
import type { Job, ServiceType } from "@/lib/types";

const SERVICES: { id: ServiceType; label: string; sub: string }[] = [
  {
    id: "Thermostat (regular)",
    label: "Thermostat",
    sub: "regular HVAC visit · $25",
  },
  {
    id: "Thermostat (scheduled)",
    label: "Thermostat (scheduled)",
    sub: "separate trip · $30",
  },
  { id: "Endo Cube", label: "Endo Cube", sub: "$20 each" },
  {
    id: "Standalone Small Job",
    label: "Standalone trip",
    sub: "$100 + per-item rate",
  },
];

export function AddServiceForm({ job }: { job: Job }) {
  const router = useRouter();
  const [serviceType, setServiceType] = useState<ServiceType | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = serviceType !== null && quantity >= 1 && !submitting;

  const setPhotoAt = (i: number) => (next: CapturedPhoto | null) => {
    setPhotos((prev) => {
      const copy = [...prev];
      if (next === null) {
        copy.splice(i, 1);
      } else {
        copy[i] = next;
      }
      return copy;
    });
  };

  const submit = async () => {
    if (!canSubmit || !serviceType) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: job.jobId,
          serviceType,
          quantity,
          notes,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not save service");
      }
      const data = await res.json();
      const serviceId = data.service.serviceId as string;

      for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];
        if (!photo) continue;
        await enqueuePhoto({
          id: `${serviceId}-${i}-${Date.now()}`,
          jobId: job.jobId,
          unitId: null,
          serviceId,
          photoSlot: "service",
          blob: photo.blob,
          filename: `${serviceId}_${i + 1}.jpg`,
          capturedAt: photo.capturedAt,
        });
      }
      kickWorker();
      router.replace(`/jobs/${encodeURIComponent(job.jobId)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save service");
      setSubmitting(false);
    }
  };

  const totalPhotoSlots = Math.max(photos.length + 1, 1);

  return (
    <div className="space-y-6 pb-24">
      <div className="flex items-center gap-2">
        <Link
          href={`/jobs/${encodeURIComponent(job.jobId)}`}
          className="p-2 -ml-2 text-mse-muted hover:text-mse-navy"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-2xl font-bold text-mse-navy">Add service</h1>
      </div>

      <Field label="What did you install?" required>
        <div className="space-y-2">
          {SERVICES.map((s) => {
            const active = serviceType === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setServiceType(s.id)}
                className={cn(
                  "w-full text-left rounded-2xl p-4 transition-[background-color,border-color,transform]",
                  "active:scale-[0.99]",
                  active
                    ? "border-2 border-mse-navy bg-mse-navy text-white shadow-elevated"
                    : "border-2 border-mse-light bg-white text-mse-navy hover:border-mse-navy/40"
                )}
              >
                <div className="font-bold">{s.label}</div>
                <div
                  className={cn(
                    "text-xs mt-0.5",
                    active ? "text-white/70" : "text-mse-muted"
                  )}
                >
                  {s.sub}
                </div>
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="Quantity" required>
        <div className="inline-flex items-center gap-2">
          <button
            type="button"
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            className="w-12 h-12 rounded-full bg-mse-light text-mse-navy hover:bg-mse-light/80 active:scale-95 transition-[background-color,transform] flex items-center justify-center"
          >
            <Minus className="w-5 h-5" />
          </button>
          <div className="w-16 h-12 rounded-xl border-2 border-mse-light bg-white flex items-center justify-center font-bold text-xl text-mse-navy">
            {quantity}
          </div>
          <button
            type="button"
            onClick={() => setQuantity((q) => q + 1)}
            className="w-12 h-12 rounded-full bg-mse-navy text-white hover:bg-mse-navy-soft active:scale-95 transition-[background-color,transform] flex items-center justify-center"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>
      </Field>

      <Field label="Photos">
        <div className="space-y-2">
          {Array.from({ length: totalPhotoSlots }).map((_, i) => (
            <PhotoCapture
              key={i}
              label={i === 0 ? "Photo" : `Photo ${i + 1}`}
              hint={i === 0 ? "At least one if required by service" : undefined}
              value={photos[i] ?? null}
              onChange={setPhotoAt(i)}
              filenameSuffix={`service_${i + 1}`}
            />
          ))}
        </div>
      </Field>

      <Field label="Notes">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="w-full px-4 py-3 rounded-xl border border-mse-light bg-white text-base focus:outline-none focus:border-mse-navy resize-none"
        />
      </Field>

      {error && (
        <div className="text-mse-red text-sm bg-mse-red/5 border border-mse-red/20 rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-mse-light p-4 safe-bottom z-10">
        <div className="max-w-2xl mx-auto">
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className={cn(
              "w-full font-bold rounded-2xl py-4 text-center transition-[background-color,transform]",
              canSubmit
                ? "bg-mse-red hover:bg-mse-red-hover active:scale-[0.98] text-white shadow-card"
                : "bg-mse-light text-mse-muted cursor-not-allowed"
            )}
          >
            {submitting ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin" />
                Saving...
              </span>
            ) : (
              "Save service"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  required,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <div>
      <div className="text-sm font-semibold text-mse-navy mb-2">
        {label}
        {required && <span className="text-mse-red ml-1">*</span>}
      </div>
      {children}
    </div>
  );
}
