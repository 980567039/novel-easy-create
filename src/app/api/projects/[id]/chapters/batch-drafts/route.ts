import { NextResponse } from "next/server";

import { authenticateApiRequest } from "@/server/api-auth";
import { getDatabase } from "@/server/db";
import {
  cancelBatchDraftJob,
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

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;
  const { id: projectId } = await params;
  const jobId = new URL(request.url).searchParams.get("jobId")?.trim();
  if (!jobId) {
    return NextResponse.json({ code: "VALIDATION_ERROR", error: "缺少要终止的批量任务 jobId。" }, { status: 400 });
  }

  try {
    const db = getDatabase();
    const result = await cancelBatchDraftJob(db, auth.user.id, projectId, jobId);
    if (result.kind === "project_not_found") {
      return NextResponse.json({ code: "PROJECT_NOT_FOUND", error: "小说项目不存在。" }, { status: 404 });
    }
    if (result.kind === "job_not_found") {
      return NextResponse.json({ code: "BATCH_JOB_NOT_FOUND", error: "批量正文任务不存在。" }, { status: 404 });
    }
    if (result.kind === "not_cancellable") {
      return NextResponse.json(
        { code: "BATCH_JOB_NOT_CANCELLABLE", error: "只有排队中或执行中的批量任务可以终止。", job: serializeBatchDraftJob(result.job) },
        { status: 409 },
      );
    }

    const job = serializeBatchDraftJob(result.job);
    const remaining = await getBatchDraftJob(db, auth.user.id, projectId, jobId);
    return NextResponse.json({
      job,
      jobId: job?.id ?? jobId,
      status: "cancelled",
      progress: job?.progress ?? result.job.progress,
      output: job?.output ?? result.job.output,
      cancelled: true,
      reused: result.reused,
      remainingCount: remaining.remainingCount,
    });
  } catch (error) {
    console.error("[batch-drafts] cancellation failed", error);
    return NextResponse.json({ code: "BATCH_DRAFT_CANCEL_FAILED", error: "批量正文任务终止失败。" }, { status: 500 });
  }
}
