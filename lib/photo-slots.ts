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
