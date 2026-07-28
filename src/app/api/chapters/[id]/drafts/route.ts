import { NextResponse } from "next/server";

import { getDatabase } from "@/server/db";
import { databaseUnavailable, handleGenerationStatus, readJson } from "@/server/modules/chapter/http";
import { getChapterDetail, saveDraftRevision } from "@/server/modules/chapter/service";
import { SaveDraftInputSchema } from "@/server/modules/chapter/schema";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const query = new URL(request.url).searchParams;
  if (query.has("jobId")) return handleGenerationStatus(id, "DRAFT", query.get("jobId") ?? undefined, query.get("projectId") ?? undefined);
  try {
    const chapter = await getChapterDetail(getDatabase(), id, new URL(request.url).searchParams.get("projectId") ?? undefined);
    if (!chapter) return NextResponse.json({ code: "CHAPTER_NOT_FOUND", error: "章节不存在。" }, { status: 404 });
    return NextResponse.json({ revisions: chapter.revisions, latestRevision: chapter.revisions[0] ?? null });
  } catch (error) {
    console.error("[chapter] revisions failed", error);
    return databaseUnavailable();
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readJson(request);
  if (body.error) return body.error;
  const parsed = SaveDraftInputSchema.safeParse(body.value);
  if (!parsed.success) return NextResponse.json({ code: "VALIDATION_ERROR", error: "正文参数格式不正确。", details: parsed.error.flatten().fieldErrors }, { status: 400 });
  try {
    const projectId = new URL(request.url).searchParams.get("projectId") ?? undefined;
    const revision = await saveDraftRevision(getDatabase(), id, projectId, parsed.data.content, parsed.data.summary);
    if (!revision) return NextResponse.json({ code: "CHAPTER_NOT_FOUND", error: "章节不存在。" }, { status: 404 });
    return NextResponse.json({ revision }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes("不能为空")) return NextResponse.json({ code: "VALIDATION_ERROR", error: error.message }, { status: 400 });
    console.error("[chapter] draft save failed", error);
    return databaseUnavailable();
  }
}
