import "server-only";
import { loadActiveTechs } from "@/lib/auth";

/**
 * Names that should appear in the on-site crew picker. Active techs
 * are still allowed to log in regardless — this filter only hides
 * non-field staff (office admins) from the crew dropdown so techs
 * don't accidentally pick them. Anyone with Techs!G = "FALSE" drops
 * out; empty / TRUE / anything else stays in.
 */
export async function listActiveTechNames(): Promise<string[]> {
  const techs = await loadActiveTechs();
  return techs.filter((t) => t.crewEligible).map((t) => t.name);
}

export { loadActiveTechs };
