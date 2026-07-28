import { NextResponse } from "next/server";

import { getDatabase } from "@/server/db";
import { databaseUnavailable } from "@/server/modules/chapter/http";
import { listProjectChapters } from "@/server/modules/chapter/service";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const result = await listProjectChapters(getDatabase(), id);
    if (!result) return NextResponse.json({ code: "PROJECT_NOT_FOUND", error: "小说项目不存在。" }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[chapters] list failed", error);
    return databaseUnavailable();
  }
}
