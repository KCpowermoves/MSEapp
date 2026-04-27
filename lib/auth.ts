import "server-only";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { env } from "@/lib/env";
import { TABS, readTab } from "@/lib/google/sheets";
import type { SessionData, Tech } from "@/lib/types";

const SESSION_COOKIE = "mse_field_session";
const SESSION_TTL_DAYS = 30;

function sessionOptions() {
  return {
    password: env.ironSessionPassword(),
    cookieName: SESSION_COOKIE,
    cookieOptions: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax" as const,
      maxAge: 60 * 60 * 24 * SESSION_TTL_DAYS,
      path: "/",
    },
  };
}

export async function getSession() {
  const store = await cookies();
  return getIronSession<SessionData>(store, sessionOptions());
}

export async function requireSession(): Promise<SessionData> {
  const session = await getSession();
  if (!session.techId) {
    throw new Error("Not authenticated");
  }
  return session;
}

export async function loadActiveTechs(): Promise<Tech[]> {
  const rows = await readTab(TABS.techs);
  return rows
    .filter((r) => r[0])
    .map((r) => ({
      techId: String(r[0] ?? ""),
      name: String(r[1] ?? ""),
      pinHash: String(r[2] ?? ""),
      active: String(r[3] ?? "").toUpperCase() === "TRUE",
      phone: String(r[4] ?? ""),
    }))
    .filter((t) => t.active);
}

export async function loadAllTechs(): Promise<Tech[]> {
  const rows = await readTab(TABS.techs);
  return rows
    .filter((r) => r[0])
    .map((r) => ({
      techId: String(r[0] ?? ""),
      name: String(r[1] ?? ""),
      pinHash: String(r[2] ?? ""),
      active: String(r[3] ?? "").toUpperCase() === "TRUE",
      phone: String(r[4] ?? ""),
    }));
}

export async function validatePin(pin: string): Promise<Tech | null> {
  if (!/^\d{4}$/.test(pin)) return null;
  const techs = await loadActiveTechs();
  for (const tech of techs) {
    if (!tech.pinHash) continue;
    const ok = await bcrypt.compare(pin, tech.pinHash);
    if (ok) return tech;
  }
  return null;
}

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, 10);
}
