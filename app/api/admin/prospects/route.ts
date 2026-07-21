import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import {
  addProspects,
  clearProspects,
  listAllProspects,
} from "@/lib/data/prospects";
import { importProspectsCsv } from "@/lib/prospect-import";

// Admin prospect-list management.
//   GET    → import summary counts (New / Used / total)
//   POST   { csv }        → parse + append; returns matched columns + count
//   DELETE                → mark all remaining New prospects Used (clear)

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function requireAdmin() {
  const session = await getSession();
  if (!session.techId) return { error: "Not authenticated", status: 401 as const };
  if (!session.isAdmin) return { error: "Admin only", status: 403 as const };
  return { session };
}

export async function GET() {
  const guard = await requireAdmin();
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  const all = await listAllProspects();
  const nw = all.filter((p) => p.status === "New").length;
  return NextResponse.json({
    total: all.length,
    available: nw,
    used: all.length - nw,
  });
}

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  let csv = "";
  let listName = "";
  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      const body = (await request.json()) as { csv?: unknown; listName?: unknown };
      csv = String(body.csv ?? "");
      listName = String(body.listName ?? "");
    } else {
      const form = await request.formData();
      listName = String(form.get("listName") ?? "");
      const file = form.get("file");
      if (file instanceof File) {
        if (file.size > 25 * 1024 * 1024) {
          return NextResponse.json(
            { error: "File too large (25 MB max)." },
            { status: 400 }
          );
        }
        csv = await file.text();
      } else {
        csv = String(form.get("csv") ?? "");
      }
    }
  } catch {
    return NextResponse.json({ error: "Could not read upload" }, { status: 400 });
  }
  listName = listName.trim().slice(0, 60);

  if (!csv.trim()) {
    return NextResponse.json({ error: "Empty file" }, { status: 400 });
  }

  const result = importProspectsCsv(csv);
  if (result.prospects.length === 0) {
    const hasName = result.matchedColumns.businessName || result.matchedColumns.contactName;
    const error = hasName
      ? "No rows found under the header row. Make sure the file has data and is saved as CSV."
      : `Couldn't find a business/customer name column. Your headers were: ${result.headers.slice(0, 20).join(", ")}. Rename the customer column to something like "Business", "Company", or "Customer" (or keep "Primary Customer"), save as CSV, and re-upload.`;
    return NextResponse.json(
      { error, matchedColumns: result.matchedColumns },
      { status: 400 }
    );
  }

  // Default the list name to a dated label if the admin didn't set one.
  const finalListName =
    listName || `Imported ${new Date().toISOString().slice(0, 10)}`;

  try {
    const added = await addProspects(
      result.prospects,
      guard.session.name ?? guard.session.techId,
      finalListName
    );
    revalidatePath("/admin/prospects");
    return NextResponse.json({
      ok: true,
      added,
      skipped: result.skipped,
      matchedColumns: result.matchedColumns,
      listName: finalListName,
    });
  } catch (e) {
    console.error("[prospects import] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Import failed" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  const guard = await requireAdmin();
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  // ?list=<name> clears one batch; omit to clear all.
  const url = new URL(request.url);
  const list = url.searchParams.get("list");
  const cleared = await clearProspects(list ?? undefined);
  revalidatePath("/admin/prospects");
  return NextResponse.json({ ok: true, cleared });
}
