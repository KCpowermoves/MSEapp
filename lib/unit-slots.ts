import type { PhotoSlot, UnitType } from "@/lib/types";

export interface SlotDef {
  slot: PhotoSlot;
  label: string;
  hint: string;
  required: boolean;
}

export interface SlotGroups {
  /** Nameplate photo(s) — rendered FIRST so the tech captures Make/Model/Serial
   *  before anything else. Drives the OCR auto-fill. */
  nameplate: SlotDef[];
  /** Before/after work photos, plus filter etc. — rendered after the
   *  Make/Model/Serial fields. */
  body: SlotDef[];
}

const SIMPLE_TYPES: UnitType[] = ["PTAC / Ductless"];
const RTU_TYPES: UnitType[] = ["RTU-S", "RTU-M", "RTU-L"];

export function slotsForType(unitType: UnitType | null): SlotGroups {
  if (!unitType) return { nameplate: [], body: [] };

  if (SIMPLE_TYPES.includes(unitType)) {
    return {
      nameplate: [
        { slot: "nameplate", label: "Nameplate", hint: "Make / model / serial label — capture this first", required: true },
      ],
      body: [
        { slot: "pre", label: "Pre-service", hint: "Before you start", required: true },
        { slot: "post", label: "Post-service", hint: "After tune-up", required: true },
        { slot: "filter", label: "Filter", hint: "New filter installed (optional)", required: false },
      ],
    };
  }

  if (RTU_TYPES.includes(unitType)) {
    return {
      nameplate: [
        { slot: "nameplate", label: "Nameplate", hint: "Make / model / serial label — capture this first", required: true },
      ],
      body: [
        // All befores
        { slot: "coil1_pre", label: "Coil 1 · before", hint: "First coil before tune-up", required: true },
        { slot: "coil2_pre", label: "Coil 2 · before", hint: "Second coil before tune-up", required: true },
        { slot: "filter_pre", label: "Filter · before", hint: "Filter condition before cleaning", required: true },
        // All afters
        { slot: "coil1_post", label: "Coil 1 · after", hint: "First coil after tune-up", required: true },
        { slot: "coil2_post", label: "Coil 2 · after", hint: "Second coil after tune-up", required: true },
        { slot: "filter_post", label: "Filter · after", hint: "Filter after replacement", required: true },
      ],
    };
  }

  if (unitType === "Outdoor Split System") {
    return {
      nameplate: [
        {
          slot: "out_nameplate",
          label: "Outdoor nameplate",
          hint: "Make / model / serial label on the outdoor unit — capture this first",
          required: true,
        },
      ],
      body: [
        { slot: "out_pre_1", label: "Side 1 · before", hint: "Outdoor unit, first angle", required: true },
        { slot: "out_pre_2", label: "Side 2 · before", hint: "Different angle", required: true },
        { slot: "out_pre_3", label: "Side 3 · before", hint: "Third angle", required: true },
        { slot: "out_post_1", label: "Side 1 · after", hint: "After tune-up", required: true },
        { slot: "out_post_2", label: "Side 2 · after", hint: "After tune-up", required: true },
        { slot: "out_post_3", label: "Side 3 · after", hint: "After tune-up", required: true },
        { slot: "filter", label: "Filter", hint: "Filter condition or replacement", required: true },
      ],
    };
  }

  if (unitType === "Indoor Split System") {
    return {
      nameplate: [
        {
          slot: "in_nameplate",
          label: "Air handler nameplate",
          hint: "Make / model / serial label on the air handler",
          required: true,
        },
      ],
      body: [
        { slot: "in_pre", label: "Air handler · before", hint: "Indoor unit before service", required: true },
        { slot: "in_post", label: "Air handler · after", hint: "Indoor unit after service", required: true },
        { slot: "filter", label: "Filter", hint: "Filter condition or replacement", required: true },
      ],
    };
  }

  // Legacy combined "Split System" — kept so historical rows still
  // render in EditUnitForm. Not offered in the new-job picker.
  return {
    nameplate: [
      { slot: "out_nameplate", label: "Outdoor nameplate", hint: "Outdoor unit make / model / serial", required: true },
      { slot: "in_nameplate", label: "Air handler nameplate", hint: "Indoor unit make / model / serial", required: true },
    ],
    body: [
      { slot: "out_pre_1", label: "Outdoor · side 1 · before", hint: "Outdoor unit, first angle", required: true },
      { slot: "out_pre_2", label: "Outdoor · side 2 · before", hint: "Different angle", required: true },
      { slot: "out_pre_3", label: "Outdoor · side 3 · before", hint: "Third angle", required: true },
      { slot: "out_post_1", label: "Outdoor · side 1 · after", hint: "After tune-up", required: true },
      { slot: "out_post_2", label: "Outdoor · side 2 · after", hint: "After tune-up", required: true },
      { slot: "out_post_3", label: "Outdoor · side 3 · after", hint: "After tune-up", required: true },
      { slot: "in_pre", label: "Air handler · before", hint: "Indoor unit before service", required: true },
      { slot: "in_post", label: "Air handler · after", hint: "Indoor unit after service", required: true },
      { slot: "filter", label: "Filter", hint: "Filter condition / replacement", required: true },
    ],
  };
}

/** Flat list helper — used by completeness checks (any unit with all
 *  required slots set is "Complete"). */
export function flatSlots(groups: SlotGroups): SlotDef[] {
  return [...groups.nameplate, ...groups.body];
}
