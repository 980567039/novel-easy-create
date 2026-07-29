import { NextResponse } from "next/server";

import { getDatabase } from "@/server/db";
import {
  createChapterGenerationJob,
  generateDraft,
  generateScenePlan,
  getChapterDetail,
  getChapterGenerationJob,
} from "./service";
import { GenerateChapterInputSchema } from "./schema";

export function databaseUnavailable() {
  return NextResponse.json({ code: "DATABASE_UNAVAILABLE", error: "数据库暂不可用，请配置 DATABASE_URL 并确认数据库已启动。" }, { status: 503 });
}

export async function readJson(request: Request) {
  try {
    const value = await request.json();
    return { value, error: null };
  } catch {
    return { value: null, error: NextResponse.json({ code: "INVALID_JSON", error: "请求体必须是有效的 JSON。" }, { status: 400 }) };
  }
}

export async function handleGenerationStatus(userId: string, chapterId: string, type: "SCENE_PLAN" | "DRAFT", jobId?: string, projectId?: string) {
  try {
    const db = getDatabase();
    const chapter = await getChapterDetail(db, userId, chapterId, projectId);
    if (!chapter) return NextResponse.json({ code: "CHAPTER_NOT_FOUND", error: "章节不存在。" }, { status: 404 });
    const job = await getChapterGenerationJob(db, chapterId, jobId, type);
    if (!job) return NextResponse.json({ job: null, status: "idle", progress: 0 });
    return NextResponse.json({ job, status: job.status.toLowerCase(), progress: job.progress, output: job.output, error: job.error });
  } catch (error) {
    console.error(`[chapter/${type.toLowerCase()}] status failed`, error);
    return databaseUnavailable();
  }
}

export async function handleGeneration(request: Request, userId: string, chapterId: string, projectId: string | undefined, type: "SCENE_PLAN" | "DRAFT") {
  const parsedBody = await readJson(request);
  if (parsedBody.error) return parsedBody.error;
  const parsed = GenerateChapterInputSchema.safeParse(parsedBody.value ?? {});
  if (!parsed.success) return NextResponse.json({ code: "VALIDATION_ERROR", error: "章节生成参数格式不正确。", details: parsed.error.flatten().fieldErrors }, { status: 400 });
  if (type === "SCENE_PLAN" && parsed.data.mode === "rewrite") {
    return NextResponse.json({ code: "INVALID_GENERATION_MODE", error: "场景表不支持章节重写模式。" }, { status: 400 });
  }

  try {
    const db = getDatabase();
    const chapter = await getChapterDetail(db, userId, chapterId, projectId);
    if (!chapter) return NextResponse.json({ code: "CHAPTER_NOT_FOUND", error: "章节不存在。" }, { status: 404 });
    if (parsed.data.mode === "rewrite" && !chapter.revisions[0]) {
      return NextResponse.json({ code: "REVISION_NOT_FOUND", error: "当前章节没有可重写的正文。" }, { status: 409 });
    }
    const job = await createChapterGenerationJob(db, { userId, projectId: chapter.projectId, chapterPlanId: chapter.id, type, idempotencyKey: parsed.data.idempotencyKey });
    if (job.status === "SUCCEEDED") return NextResponse.json({ jobId: job.id, status: "succeeded", progress: job.progress, output: job.output }, { status: 200 });
    if (job.status === "RUNNING" || job.status === "QUEUED") {
      await db.generationJob.update({ where: { id: job.id }, data: { status: "RUNNING", progress: 10, startedAt: new Date() } });
      const run = type === "SCENE_PLAN" ? generateScenePlan(db, userId, chapter.id, job.id, parsed.data) : generateDraft(db, userId, chapter.id, job.id, parsed.data);
      void run.catch(async (error) => {
        console.error(`[chapter/${type.toLowerCase()}] generation failed`, error);
        try {
          await db.generationJob.update({ where: { id: job.id }, data: { status: "FAILED", progress: 10, error: "章节生成失败，请检查 AI 设置和模型服务。", finishedAt: new Date(), output: { phase: "failed", message: "章节生成失败。" } } });
        } catch (statusError) {
          console.error("[chapter] failed to persist generation error", statusError);
        }
      });
    }
    return NextResponse.json({ jobId: job.id, status: "queued", phase: "queued", progress: 0, message: "已排队，等待生成任务开始。" }, { status: 202 });
  } catch (error) {
    console.error(`[chapter/${type.toLowerCase()}] generation request failed`, error);
    return databaseUnavailable();
  }
}
