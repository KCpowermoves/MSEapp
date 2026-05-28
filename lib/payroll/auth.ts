import "server-only";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

/**
 * Shared admin guard for /api/admin/payroll/* routes. Returns either:
 *  - { session } if the caller is authenticated AND admin
 *  - { response } a NextResponse to return immediately (401/403)
 */
export async function requireAdmin(): Promise<
  | { session: { techId: string; name: string; isAdmin: boolean } }
  | { response: NextResponse }
> {
  const session = await getSession();
  if (!session.techId) {
    return {
      response: NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      ),
    };
  }
  if (!session.isAdmin) {
    return {
      response: NextResponse.json({ error: "Admin only" }, { status: 403 }),
    };
  }
  return {
    session: {
      techId: session.techId,
      name: session.name ?? "",
      isAdmin: true,
    },
  };
}
