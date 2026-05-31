import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/payroll/auth";
import { listFolderFiles } from "@/lib/google/drive";

// GET /api/admin/drive/list-folder?folderId=ABC[&pageSize=200]
// Returns the immediate children of a Drive folder, newest first.
// Admin-only — gives the in-app file browser its data.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await requireAdmin();
  if ("response" in guard) return guard.response;

  const url = new URL(request.url);
  const folderId = url.searchParams.get("folderId") ?? "";
  if (!/^[A-Za-z0-9_-]+$/.test(folderId)) {
    return NextResponse.json(
      { error: "Invalid folderId" },
      { status: 400 }
    );
  }
  const pageSizeRaw = Number(url.searchParams.get("pageSize") ?? "200");
  const pageSize = Number.isFinite(pageSizeRaw)
    ? Math.min(Math.max(20, pageSizeRaw), 1000)
    : 200;

  try {
    const files = await listFolderFiles(folderId, { pageSize });
    return NextResponse.json({ ok: true, files });
  } catch (e) {
    console.error("[drive/list-folder] failed:", e);
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "Server error",
      },
      { status: 500 }
    );
  }
}
