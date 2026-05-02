import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getDriveClient } from "@/lib/google/auth";

export async function GET(request: Request) {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const fileId = new URL(request.url).searchParams.get("fileId");
  if (!fileId || !/^[A-Za-z0-9_-]+$/.test(fileId)) {
    return NextResponse.json({ error: "Invalid fileId" }, { status: 400 });
  }

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
        // Drive content is immutable per fileId; cache hard so the
        // edit screen doesn't re-fetch every photo on every keystroke.
        "Cache-Control": "private, max-age=3600, immutable",
      },
    });
  } catch (e) {
    console.error("photo proxy error", e);
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
