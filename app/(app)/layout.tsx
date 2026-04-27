import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { Providers } from "@/components/Providers";
import { AppShell } from "@/components/AppShell";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session.techId) {
    redirect("/login");
  }
  return (
    <Providers>
      <AppShell techName={session.name}>{children}</AppShell>
    </Providers>
  );
}
