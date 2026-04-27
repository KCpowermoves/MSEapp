import { NextResponse } from "next/server";
import { getSession, validatePin } from "@/lib/auth";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const pin = body?.pin;
  if (typeof pin !== "string" || !/^\d{4}$/.test(pin)) {
    return NextResponse.json({ error: "Enter a 4-digit PIN" }, { status: 400 });
  }
  let tech;
  try {
    tech = await validatePin(pin);
  } catch (e) {
    console.error("Auth backend error:", e);
    const message = e instanceof Error ? e.message : "Backend error";
    return NextResponse.json(
      { error: `Setup error: ${message}` },
      { status: 500 }
    );
  }
  if (!tech) {
    return NextResponse.json({ error: "Wrong PIN" }, { status: 401 });
  }
  const session = await getSession();
  session.techId = tech.techId;
  session.name = tech.name;
  session.loggedInAt = Date.now();
  await session.save();
  return NextResponse.json({ techId: tech.techId, name: tech.name });
}

export async function DELETE() {
  const session = await getSession();
  session.destroy();
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const session = await getSession();
  if (!session.techId) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
  return NextResponse.json({
    authenticated: true,
    techId: session.techId,
    name: session.name,
  });
}
