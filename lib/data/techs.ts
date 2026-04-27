import "server-only";
import { loadActiveTechs } from "@/lib/auth";

export async function listActiveTechNames(): Promise<string[]> {
  const techs = await loadActiveTechs();
  return techs.map((t) => t.name);
}

export { loadActiveTechs };
