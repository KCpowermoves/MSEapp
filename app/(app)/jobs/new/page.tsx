import { listActiveTechNames } from "@/lib/data/techs";
import { NewJobForm } from "@/components/NewJobForm";

export const dynamic = "force-dynamic";

export default async function NewJobPage() {
  const activeTechs = await listActiveTechNames();
  return <NewJobForm activeTechs={activeTechs} />;
}
