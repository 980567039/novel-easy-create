import { NextResponse } from "next/server";

import { getDatabase } from "@/server/db";
import { getProjectReader, getReaderChapter } from "@/server/modules/reader/service";

export const runtime = "nodejs";

function notFound(code: "PROJECT_NOT_FOUND" | "CHAPTER_NOT_FOUND") {
  const error = code === "PROJECT_NOT_FOUND" ? "小说项目不存在。" : "章节不存在。";
  return NextResponse.json({ code, error }, { status: 404 });
}

function databaseUnavailable() {
  return NextResponse.json(
    {
      code: "DATABASE_UNAVAILABLE",
      error: "数据库暂不可用，请配置 DATABASE_URL 并确认数据库已启动。",
    },
    { status: 503 },
  );
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const chapterId = new URL(request.url).searchParams.get("chapterId")?.trim();

  try {
    if (chapterId) {
      const result = await getReaderChapter(getDatabase(), projectId, chapterId);
      if (!result.projectFound) return notFound("PROJECT_NOT_FOUND");
      if (!result.chapter) return notFound("CHAPTER_NOT_FOUND");
      return NextResponse.json({ chapter: result.chapter });
    }

    const result = await getProjectReader(getDatabase(), projectId);
    if (!result) return notFound("PROJECT_NOT_FOUND");
    return NextResponse.json(result);
  } catch {
    console.error("[reader] database request failed");
    return databaseUnavailable();
  }
}
