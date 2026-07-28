import { NextResponse } from "next/server";

import { authenticateApiRequest } from "@/server/api-auth";
import { getDatabase } from "@/server/db";
import {
  getBatchDraftJob,
  reserveBatchDraftJob,
  runBatchDraftJob,
  serializeBatchDraftJob,
} from "@/server/modules/chapter/batch-service";
import { BatchDraftInputSchema } from "@/server/modules/chapter/schema";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;
  const { id: projectId } = await params;
  const jobId = new URL(request.url).searchParams.get("jobId")?.trim() || undefined;

  try {
    const result = await getBatchDraftJob(getDatabase(), auth.user.id, projectId, jobId);
    if (!result.projectFound) {
      return NextResponse.json({ code: "PROJECT_NOT_FOUND", error: "小说项目不存在。" }, { status: 404 });
    }
    const job = serializeBatchDraftJob(result.job);
    if (jobId && !job) {
      return NextResponse.json({ code: "BATCH_JOB_NOT_FOUND", error: "批量正文任务不存在。" }, { status: 404 });
    }
    return NextResponse.json({ job, remainingCount: result.remainingCount });
  } catch (error) {
    console.error("[batch-drafts] status failed", error);
    return NextResponse.json({ code: "DATABASE_UNAVAILABLE", error: "批量正文任务状态读取失败。" }, { status: 503 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;
  const { id: projectId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: "INVALID_JSON", error: "请求体必须是有效的 JSON。" }, { status: 400 });
  }
  const parsed = BatchDraftInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { code: "VALIDATION_ERROR", error: "批量生成数量只能是 5、10、20、50 或 all。", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  try {
    const db = getDatabase();
    const result = await reserveBatchDraftJob(db, auth.user.id, projectId, parsed.data);
    if (result.kind === "project_not_found") {
      return NextResponse.json({ code: "PROJECT_NOT_FOUND", error: "小说项目不存在。" }, { status: 404 });
    }
    if (result.kind === "no_missing_drafts") {
      return NextResponse.json({ code: "NO_MISSING_DRAFTS", error: "所有章节都已有正文初稿。" }, { status: 409 });
    }

    if (!result.reused) {
      void runBatchDraftJob(db, auth.user.id, projectId, result.job.id).catch((error) => {
        console.error("[batch-drafts] background runner failed", error);
      });
    }
    const job = serializeBatchDraftJob(result.job);
    return NextResponse.json(
      {
        job,
        jobId: job?.id ?? result.job.id,
        status: job?.status ?? result.job.status.toLowerCase(),
        progress: job?.progress ?? result.job.progress,
        output: job?.output ?? result.job.output,
        reused: result.reused,
        remainingCount: result.remainingCount,
      },
      { status: 202 },
    );
  } catch (error) {
    console.error("[batch-drafts] request failed", error);
    return NextResponse.json({ code: "BATCH_DRAFT_REQUEST_FAILED", error: "批量正文任务创建失败。" }, { status: 500 });
  }
}
