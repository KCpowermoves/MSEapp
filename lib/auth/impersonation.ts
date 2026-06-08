import "server-only";
import { getSession, loadAllTechs } from "@/lib/auth";
import { logImpersonationEvent } from "@/lib/data/impersonation-log";

/**
 * True when the current session is impersonating someone.
 * Cheap inline check — used by middleware / route guards.
 */
export async function isImpersonating(): Promise<boolean> {
  const session = await getSession();
  return Boolean(session.impersonatorTechId);
}

/**
 * Start impersonating a target tech. Caller must be admin (caller is
 * responsible for the requireAdmin() check upstream). Throws if the
 * target doesn't exist or isn't active.
 */
export async function startImpersonation(
  targetTechId: string
): Promise<void> {
  const session = await getSession();
  if (!session.techId) throw new Error("Not authenticated");
  if (!session.isAdmin) throw new Error("Admin only");

  const techs = await loadAllTechs();
  const target = techs.find((t) => t.techId === targetTechId);
  if (!target) throw new Error("Target tech not found");
  if (!target.active) throw new Error("Target tech is not active");

  // Stash the admin's real identity in the impersonator fields, swap
  // the effective identity to the target. Cookie still proves who
  // initiated when we exit.
  const adminTechId = session.techId;
  const adminName = session.name;

  session.impersonatorTechId = adminTechId;
  session.impersonatorName = adminName;
  session.techId = target.techId;
  session.name = target.name;
  session.isAdmin = target.isAdmin;
  await session.save();

  await logImpersonationEvent({
    eventType: "Start",
    adminTechId,
    adminName,
    targetTechId: target.techId,
    targetName: target.name,
  });
}

/**
 * End impersonation. Resolves the real admin from the impersonator
 * field on the cookie. Re-reads their current Techs row so name +
 * isAdmin are accurate (in case they changed mid-session). Cleared
 * cookie reverts to a normal admin session.
 *
 * Bypasses the admin check — the impersonator field is the proof that
 * an admin originally initiated this session.
 */
export async function exitImpersonation(): Promise<void> {
  const session = await getSession();
  if (!session.impersonatorTechId) {
    throw new Error("Not impersonating");
  }
  const realTechId = session.impersonatorTechId;
  const realNameAtStart = session.impersonatorName ?? "";

  const techs = await loadAllTechs();
  const real = techs.find((t) => t.techId === realTechId);
  if (!real) {
    // Edge case: admin was deactivated mid-session. Clear cookie
    // anyway so they're forced back to login.
    session.destroy();
    throw new Error("Original admin no longer exists");
  }

  const targetTechId = session.techId;
  const targetName = session.name;

  session.techId = real.techId;
  session.name = real.name;
  session.isAdmin = real.isAdmin;
  delete session.impersonatorTechId;
  delete session.impersonatorName;
  await session.save();

  await logImpersonationEvent({
    eventType: "Exit",
    adminTechId: realTechId,
    adminName: real.name || realNameAtStart,
    targetTechId,
    targetName,
  });
}
