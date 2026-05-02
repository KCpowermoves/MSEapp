import { getSession } from "@/lib/auth";
import { listActiveTechNames } from "@/lib/data/techs";
import { NewJobForm } from "@/components/NewJobForm";

export const dynamic = "force-dynamic";

export default async function NewJobPage() {
  const [session, activeTechs] = await Promise.all([
    getSession(),
    listActiveTechNames(),
  ]);
  return (
    <NewJobForm activeTechs={activeTechs} currentUserName={session.name ?? ""} />
  );
}
