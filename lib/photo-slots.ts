// Client-safe photo URL helper (no server-only imports)
import type { UnitServiced, PhotoSlot } from "@/lib/types";

function urlForSlot(unit: UnitServiced, slot: PhotoSlot): string {
  switch (slot) {
    case "pre": case "out_pre_1": case "coil1_pre": return unit.pre1Url;
    case "post": case "out_pre_2": case "coil2_pre": return unit.pre2Url;
    case "out_pre_3": case "filter_post": return unit.pre3Url;
    case "out_post_1": case "coil1_post": return unit.post1Url;
    case "out_post_2": case "coil2_post": return unit.post2Url;
    case "out_post_3": return unit.post3Url;
    case "nameplate": case "out_nameplate": return unit.nameplateUrl;
    case "filter": case "filter_pre": return unit.filterUrl;
    case "in_pre": return unit.inPreUrl;
    case "in_post": return unit.inPostUrl;
    case "in_nameplate": return unit.inNameplateUrl;
    default: return "";
  }
}

export function photoUrlForSlot(unit: UnitServiced, slot: PhotoSlot): string {
  return urlForSlot(unit, slot);
}

/** The UnitServiced field a given slot's URL is stored in. Mirrors the
 *  read mapping above AND the server-side PHOTO_COL in lib/data/units.ts —
 *  keep all three in sync. `additional` is a comma-joined list, handled
 *  separately by the caller. */
function fieldForSlot(slot: PhotoSlot): keyof UnitServiced | null {
  switch (slot) {
    case "pre": case "out_pre_1": case "coil1_pre": return "pre1Url";
    case "post": case "out_pre_2": case "coil2_pre": return "pre2Url";
    case "out_pre_3": case "filter_post": return "pre3Url";
    case "out_post_1": case "coil1_post": return "post1Url";
    case "out_post_2": case "coil2_post": return "post2Url";
    case "out_post_3": return "post3Url";
    case "nameplate": case "out_nameplate": return "nameplateUrl";
    case "filter": case "filter_pre": return "filterUrl";
    case "in_pre": return "inPreUrl";
    case "in_post": return "inPostUrl";
    case "in_nameplate": return "inNameplateUrl";
    default: return null;
  }
}

/** Optimistically write a freshly-uploaded URL into the correct field on a
 *  client-side copy of the unit, so the tile updates without a full refetch.
 *  Derived from the same slot→field mapping as photoUrlForSlot to prevent
 *  the display cross-assignment bug (before-shot appearing in the after slot). */
export function applyPhotoUrlForSlot(
  unit: UnitServiced,
  slot: PhotoSlot,
  url: string
): void {
  const key = fieldForSlot(slot);
  if (!key) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (unit as any)[key] = url;
}
