import { NextResponse } from "next/server";

import { getDatabase } from "@/server/db";
import {
  getPublicReaderChapter,
  getPublicReaderDirectory,
} from "@/server/modules/share/service";

export const runtime = "nodejs";

const PUBLIC_HEADERS = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

function publicNotFound() {
  return NextResponse.json(
    { code: "PUBLIC_READER_NOT_FOUND", error: "公开阅读链接不存在或已关闭。" },
    { status: 404, headers: PUBLIC_HEADERS },
  );
}

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const chapterId = new URL(request.url).searchParams.get("chapterId")?.trim();
  try {
    if (chapterId) {
      const chapter = await getPublicReaderChapter(getDatabase(), token, chapterId);
      if (!chapter) return publicNotFound();
      return NextResponse.json({ chapter }, { headers: PUBLIC_HEADERS });
    }

    const reader = await getPublicReaderDirectory(getDatabase(), token);
    if (!reader) return publicNotFound();
    return NextResponse.json(reader, { headers: PUBLIC_HEADERS });
  } catch (error) {
    // Never include the bearer-style share token in logs or error responses.
    console.error("[public/reader] request failed", error);
    return publicNotFound();
  }
}
