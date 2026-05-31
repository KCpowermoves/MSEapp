import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getDriveClient } from "@/lib/google/auth";

// Per-fileId image proxy. Two modes:
//
//   - Full mode (default): streams the original file bytes through.
//     Used by the in-app edit screens and the lightbox.
//
//   - Thumbnail mode (?w=NNN): proxies Drive's lightweight thumbnail
//     endpoint (the same one the Drive web UI uses internally). Cheap
//     for grid views — a 400px thumbnail is ~10-30KB vs ~1-2MB for the
//     full file, so a 200-tile gallery weighs ~3MB instead of ~300MB.
//
// Drive's `https://drive.google.com/thumbnail?id=X&sz=wNNN` endpoint
// works without auth for world-readable files (the upload helpers
// stamp "anyone can view" on every file we put up). The proxy hop
// gives us cookie-based access control on top of that — non-admins
// can't binary-search file IDs through this route because requireSession
// gates it.

const ALLOWED_THUMB_WIDTHS = [120, 200, 320, 400, 600, 800, 1200];

function nearestAllowedWidth(raw: number): number {
  let best = ALLOWED_THUMB_WIDTHS[0];
  let bestDelta = Math.abs(raw - best);
  for (const w of ALLOWED_THUMB_WIDTHS) {
    const d = Math.abs(raw - w);
    if (d < bestDelta) {
      best = w;
      bestDelta = d;
    }
  }
  return best;
}

export async function GET(request: Request) {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const url = new URL(request.url);
  const fileId = url.searchParams.get("fileId");
  if (!fileId || !/^[A-Za-z0-9_-]+$/.test(fileId)) {
    return NextResponse.json({ error: "Invalid fileId" }, { status: 400 });
  }
  const rawWidth = Number(url.searchParams.get("w") ?? "0");
  const wantsThumb = Number.isFinite(rawWidth) && rawWidth > 0;
  const thumbWidth = wantsThumb ? nearestAllowedWidth(rawWidth) : 0;

  // ── Thumbnail path ──────────────────────────────────────────────
  if (wantsThumb) {
    try {
      const thumbUrl = `https://drive.google.com/thumbnail?id=${encodeURIComponent(
        fileId
      )}&sz=w${thumbWidth}`;
      const upstream = await fetch(thumbUrl, { cache: "no-store" });
      if (!upstream.ok) {
        // Fallback: stream the full image. Better a slow load than a
        // broken tile.
        return await streamFullImage(fileId);
      }
      const buf = Buffer.from(await upstream.arrayBuffer());
      const contentType =
        upstream.headers.get("content-type") ?? "image/jpeg";
      return new Response(buf, {
        headers: {
          "Content-Type": contentType,
          // Thumbnails are immutable per (fileId, width).
          "Cache-Control": "private, max-age=86400, immutable",
        },
      });
    } catch (e) {
      console.warn("photo thumbnail proxy fell back to full:", e);
      return await streamFullImage(fileId);
    }
  }

  // ── Full-size path (legacy) ─────────────────────────────────────
  return await streamFullImage(fileId);
}

async function streamFullImage(fileId: string): Promise<Response> {
  try {
    const drive = getDriveClient();
    const res = await drive.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "arraybuffer" }
    );
    const contentType =
      (res.headers["content-type"] as string | undefined) ?? "image/jpeg";
    return new Response(Buffer.from(res.data as ArrayBuffer), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=3600, immutable",
      },
    });
  } catch (e) {
    console.error("photo proxy error", e);
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
