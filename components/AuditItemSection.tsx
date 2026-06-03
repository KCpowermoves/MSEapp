"use client";

import { useMemo, useState } from "react";
import { Plus, Minus, Loader2 } from "lucide-react";
import { AuditPhotoSlot } from "@/components/AuditPhotoSlot";
import { cn } from "@/lib/utils";
import type {
  Audit,
  AuditItem,
  AuditItemType,
  Job,
  WaterSourceSubtype,
} from "@/lib/types";

interface Props {
  anchorId: string;
  title: string;
  itemType: AuditItemType;
  audit: Audit;
  job: Job;
  items: AuditItem[];
  onItemsChange: (next: AuditItem[]) => void;
}

const WATER_SUBTYPES: WaterSourceSubtype[] = [
  "Chiller",
  "Cooling Tower",
  "Boiler",
  "Controls",
  "Other",
];

export function AuditItemSection({
  anchorId,
  title,
  itemType,
  audit,
  job,
  items,
  onItemsChange,
}: Props) {
  const mine = useMemo(
    () =>
      items
        .filter((i) => i.itemType === itemType && i.status === "Active")
        .sort((a, b) => a.itemNumber - b.itemNumber),
    [items, itemType]
  );
  const [busyCount, setBusyCount] = useState(false);

  async function bumpCount(direction: "up" | "down") {
    if (busyCount) return;
    setBusyCount(true);
    try {
      if (direction === "up") {
        const nextNumber = (mine.at(-1)?.itemNumber ?? 0) + 1;
        const res = await fetch("/api/audit-items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            auditId: audit.auditId,
            jobId: job.jobId,
            itemType,
            itemNumber: nextNumber,
          }),
        });
        const body = (await res.json().catch(() => ({}))) as { item?: AuditItem; error?: string };
        if (!res.ok || !body.item) throw new Error(body.error ?? "Add failed");
        onItemsChange([...items, body.item]);
      } else {
        const last = mine.at(-1);
        if (!last) return;
        const res = await fetch(
          `/api/audit-items/${encodeURIComponent(last.itemId)}`,
          { method: "DELETE" }
        );
        if (!res.ok) throw new Error("Could not orphan item");
        onItemsChange(
          items.map((i) =>
            i.itemId === last.itemId ? { ...i, status: "Orphaned" } : i
          )
        );
      }
    } finally {
      setBusyCount(false);
    }
  }

  async function uploadItemPhoto(
    item: AuditItem,
    slot: string,
    file: File
  ) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("jobId", job.jobId);
    fd.append("itemId", item.itemId);
    fd.append("kind", "audit-item");
    fd.append("slot", slot);
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!res.ok || !body.url) throw new Error(body.error ?? "Upload failed");
    onItemsChange(
      items.map((i) => {
        if (i.itemId !== item.itemId) return i;
        const updated = { ...i };
        if (slot === "model-label") updated.modelLabelPhotoUrl = body.url ?? "";
        if (slot === "nameplate") updated.nameplatePhotoUrl = body.url ?? "";
        if (slot === "fans") updated.fansPhotoUrl = body.url ?? "";
        if (slot === "temp") updated.tempPhotoUrl = body.url ?? "";
        if (slot === "wiring") updated.wiringPhotoUrl = body.url ?? "";
        if (slot === "location") updated.locationPhotoUrl = body.url ?? "";
        if (slot === "controls") updated.controlsPhotoUrl = body.url ?? "";
        if (slot === "schedule") {
          const existing = updated.schedulePhotoUrlsCsv
            ? updated.schedulePhotoUrlsCsv.split(",").map((s) => s.trim()).filter(Boolean)
            : [];
          existing.push(body.url ?? "");
          updated.schedulePhotoUrlsCsv = existing.join(",");
        }
        return updated;
      })
    );
  }

  async function patchItem(itemId: string, patch: Partial<AuditItem>) {
    const res = await fetch(`/api/audit-items/${encodeURIComponent(itemId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? "Patch failed");
    }
    onItemsChange(items.map((i) => (i.itemId === itemId ? { ...i, ...patch } : i)));
  }

  return (
    <section id={anchorId} className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-mse-navy uppercase tracking-wider">
          {title}
        </h2>
        <div className="inline-flex items-center gap-2">
          <button
            type="button"
            onClick={() => bumpCount("down")}
            disabled={busyCount || mine.length === 0}
            className="w-8 h-8 inline-flex items-center justify-center rounded-full bg-mse-light text-mse-muted disabled:opacity-40"
            aria-label="Remove last"
          >
            <Minus className="w-4 h-4" />
          </button>
          <span className="w-8 text-center font-bold text-mse-navy tabular-nums">
            {mine.length}
          </span>
          <button
            type="button"
            onClick={() => bumpCount("up")}
            disabled={busyCount}
            className="w-8 h-8 inline-flex items-center justify-center rounded-full bg-mse-navy text-white"
            aria-label="Add"
          >
            {busyCount ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {mine.length === 0 ? (
        <p className="text-xs text-mse-muted italic px-3 py-4 border-2 border-dashed border-mse-light rounded-xl text-center">
          None — tap + to add the first.
        </p>
      ) : (
        <div className="space-y-3">
          {mine.map((item) => (
            <ItemCard
              key={item.itemId}
              item={item}
              itemType={itemType}
              onPhoto={(slot, file) => uploadItemPhoto(item, slot, file)}
              onPatch={(patch) => patchItem(item.itemId, patch)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ItemCard({
  item,
  itemType,
  onPhoto,
  onPatch,
}: {
  item: AuditItem;
  itemType: AuditItemType;
  onPhoto: (slot: string, file: File) => Promise<void>;
  onPatch: (patch: Partial<AuditItem>) => Promise<void>;
}) {
  const [label, setLabel] = useState(item.label);
  const [notes, setNotes] = useState(item.notes);
  const [subtype, setSubtype] = useState(item.itemSubtype);

  return (
    <div className="rounded-2xl border border-mse-light bg-white p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] uppercase tracking-wider font-bold text-mse-gold">
          {itemType.replace("-", " ")} {item.itemNumber}
        </div>
        {itemType === "Water-Source" && (
          <select
            value={subtype}
            onChange={(e) => {
              const v = e.target.value as WaterSourceSubtype | "";
              setSubtype(v);
              onPatch({ itemSubtype: v });
            }}
            className="text-xs px-2 py-1 rounded-md border border-mse-light bg-white"
          >
            <option value="">— Subtype —</option>
            {WATER_SUBTYPES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
      </div>

      <input
        type="text"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => onPatch({ label })}
        placeholder="Label (optional)"
        className="w-full px-3 py-2 rounded-lg border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy"
      />

      <div className="grid grid-cols-2 gap-3">
        {itemType === "Walk-In" && (
          <>
            <AuditPhotoSlot
              label="Model label"
              hint="Inside the walk-in, around back"
              required
              existingUrl={item.modelLabelPhotoUrl}
              onPick={(f) => onPhoto("model-label", f)}
            />
            <AuditPhotoSlot
              label="Fans"
              hint="Show the count"
              required
              existingUrl={item.fansPhotoUrl}
              onPick={(f) => onPhoto("fans", f)}
            />
            <AuditPhotoSlot
              label="Temp setting"
              required
              existingUrl={item.tempPhotoUrl}
              onPick={(f) => onPhoto("temp", f)}
            />
          </>
        )}
        {itemType === "Thermostat" && (
          <>
            <AuditPhotoSlot
              label="Existing wiring"
              required
              existingUrl={item.wiringPhotoUrl}
              onPick={(f) => onPhoto("wiring", f)}
            />
            <AuditPhotoSlot
              label="Location"
              hint="Optional"
              existingUrl={item.locationPhotoUrl}
              onPick={(f) => onPhoto("location", f)}
            />
            <ScheduleStrip
              csv={item.schedulePhotoUrlsCsv}
              onPick={(f) => onPhoto("schedule", f)}
            />
          </>
        )}
        {itemType === "Water-Source" && (
          <>
            <AuditPhotoSlot
              label="Model label / nameplate"
              required
              existingUrl={item.modelLabelPhotoUrl || item.nameplatePhotoUrl}
              onPick={(f) => onPhoto("model-label", f)}
            />
            <AuditPhotoSlot
              label="Controls"
              hint="Optional"
              existingUrl={item.controlsPhotoUrl}
              onPick={(f) => onPhoto("controls", f)}
            />
          </>
        )}
      </div>

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => onPatch({ notes })}
        rows={2}
        placeholder="Notes (optional)"
        className="w-full px-3 py-2 rounded-lg border border-mse-light bg-white text-xs focus:outline-none focus:border-mse-navy resize-none"
      />
    </div>
  );
}

function ScheduleStrip({
  csv,
  onPick,
}: {
  csv: string;
  onPick: (file: File) => Promise<void>;
}) {
  const urls = csv ? csv.split(",").map((s) => s.trim()).filter(Boolean) : [];
  // The first photo uses an AuditPhotoSlot for camera flow; we render
  // additional photos as small thumbnails next to it + one trailing
  // "add another" slot for multi-shot schedules.
  return (
    <div className={cn("col-span-2 space-y-2")}>
      <div className="text-[11px] uppercase tracking-wider font-bold text-mse-muted">
        Schedule {urls.length > 0 && <span className="text-mse-navy">· {urls.length}</span>}
      </div>
      <div className="text-[10px] text-mse-muted/80">
        One photo of the lit-up thermostat if no schedule; one per screen if scheduled.
      </div>
      <div className="grid grid-cols-3 gap-2">
        {urls.map((url, i) => (
          <div
            key={`${url}-${i}`}
            className="relative aspect-[4/3] rounded-lg overflow-hidden border border-mse-light bg-white"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/photo?fileId=${encodeURIComponent(extractFileId(url))}&w=240`}
              alt={`Schedule ${i + 1}`}
              className="absolute inset-0 w-full h-full object-cover"
            />
          </div>
        ))}
        <AuditPhotoSlot
          label={urls.length === 0 ? "First schedule photo" : "Add another"}
          existingUrl=""
          onPick={onPick}
        />
      </div>
    </div>
  );
}

function extractFileId(url: string): string {
  const match =
    url.match(/[?&]id=([A-Za-z0-9_-]+)/) ||
    url.match(/\/d\/([A-Za-z0-9_-]+)/) ||
    url.match(/\/file\/d\/([A-Za-z0-9_-]+)/);
  return match?.[1] ?? "";
}
