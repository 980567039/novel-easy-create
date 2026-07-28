import { NextResponse } from "next/server";

import { getDatabase } from "@/server/db";
import { databaseUnavailable, readJson } from "@/server/modules/chapter/http";
import { getChapterDetail, updateChapterPlan } from "@/server/modules/chapter/service";
import { UpdateChapterPlanInputSchema } from "@/server/modules/chapter/schema";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; chapterId: string }> }) {
  const { id: projectId, chapterId } = await params;
  try {
    const chapter = await getChapterDetail(getDatabase(), chapterId, projectId);
    if (!chapter) return NextResponse.json({ code: "CHAPTER_NOT_FOUND", error: "章节不存在。" }, { status: 404 });
    return NextResponse.json({ chapter });
  } catch (error) {
    console.error("[project/chapter] detail failed", error);
    return databaseUnavailable();
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; chapterId: string }> }) {
  const { id: projectId, chapterId } = await params;
  const body = await readJson(request);
  if (body.error) return body.error;
  const parsed = UpdateChapterPlanInputSchema.safeParse(body.value);
  if (!parsed.success) return NextResponse.json({ code: "VALIDATION_ERROR", error: "章节计划参数格式不正确。", details: parsed.error.flatten().fieldErrors }, { status: 400 });
  try {
    const chapter = await updateChapterPlan(getDatabase(), chapterId, projectId, parsed.data);
    if (!chapter) return NextResponse.json({ code: "CHAPTER_NOT_FOUND", error: "章节不存在。" }, { status: 404 });
    return NextResponse.json({ chapter });
  } catch (error) {
    if (error instanceof Error && error.message.includes("锁定")) return NextResponse.json({ code: "CHAPTER_LOCKED", error: error.message }, { status: 409 });
    console.error("[project/chapter] plan update failed", error);
    return databaseUnavailable();
  }
}
