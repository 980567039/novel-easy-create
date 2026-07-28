import type { Prisma, PrismaClient } from "@prisma/client";

import {
  createChapterGenerationJob,
  generateDraft,
  updateChapterGenerationJob,
} from "./service";
import {
  BatchDraftJobOutputSchema,
  type BatchDraftInput,
  type BatchDraftJobOutput,
} from "./schema";

const batchJobSelect = {
  id: true,
  projectId: true,
  requesterId: true,
  status: true,
  progress: true,
  output: true,
  error: true,
  createdAt: true,
  updatedAt: true,
  startedAt: true,
  finishedAt: true,
} satisfies Prisma.GenerationJobSelect;

type BatchJob = Prisma.GenerationJobGetPayload<{ select: typeof batchJobSelect }>;

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function parseBatchOutput(value: unknown) {
  return BatchDraftJobOutputSchema.safeParse(value);
}

function isBatchJob(job: Pick<BatchJob, "output">) {
  return parseBatchOutput(job.output).success;
}

function progressFor(output: BatchDraftJobOutput) {
  return output.total === 0 ? 100 : Math.min(100, Math.floor((output.completed / output.total) * 100));
}

async function persistBatchOutput(
  db: PrismaClient,
  jobId: string,
  output: BatchDraftJobOutput,
  options: { status?: "RUNNING" | "SUCCEEDED" | "FAILED"; error?: string | null; startedAt?: Date; finishedAt?: Date } = {},
) {
  return db.generationJob.update({
    where: { id: jobId },
    data: {
      output: asJson(output),
      progress: options.status === "SUCCEEDED" ? 100 : progressFor(output),
      status: options.status,
      error: options.error,
      startedAt: options.startedAt,
      finishedAt: options.finishedAt,
    },
    select: batchJobSelect,
  });
}

export type ReserveBatchDraftResult =
  | { kind: "project_not_found" }
  | { kind: "no_missing_drafts" }
  | { kind: "job"; job: BatchJob; reused: boolean; remainingCount: number };

export async function reserveBatchDraftJob(
  db: PrismaClient,
  userId: string,
  projectId: string,
  input: BatchDraftInput,
): Promise<ReserveBatchDraftResult> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ lock: string }>>`
      SELECT pg_advisory_xact_lock(hashtext(${`batch-drafts:${projectId}`}))::text AS lock
    `;

    const project = await tx.novelProject.findFirst({
      where: { id: projectId, ownerId: userId },
      select: { id: true },
    });
    if (!project) return { kind: "project_not_found" };

    const remainingCount = await tx.chapterPlan.count({
      where: { projectId, revisions: { none: {} } },
    });

    const activeCandidates = await tx.generationJob.findMany({
      where: {
        projectId,
        requesterId: userId,
        type: "DRAFT",
        chapterPlanId: null,
        status: { in: ["QUEUED", "RUNNING"] },
      },
      orderBy: { createdAt: "desc" },
      select: batchJobSelect,
    });
    const activeJob = activeCandidates.find(isBatchJob);
    if (activeJob) return { kind: "job", job: activeJob, reused: true, remainingCount };

    if (remainingCount === 0) return { kind: "no_missing_drafts" };

    const chapters = await tx.chapterPlan.findMany({
      where: { projectId, revisions: { none: {} } },
      orderBy: { number: "asc" },
      ...(input.count === "all" ? {} : { take: input.count }),
      select: { id: true, number: true, title: true },
    });
    if (chapters.length === 0) return { kind: "no_missing_drafts" };

    const output: BatchDraftJobOutput = {
      kind: "BATCH_DRAFT",
      phase: "queued",
      message: `已排队，准备生成 ${chapters.length} 章正文初稿。`,
      requestedCount: input.count,
      total: chapters.length,
      completed: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      currentChapter: null,
      chapters: chapters.map((chapter) => ({
        id: chapter.id,
        number: chapter.number,
        title: chapter.title?.trim() || `第 ${chapter.number} 章`,
        status: "pending",
      })),
    };
    const job = await tx.generationJob.create({
      data: {
        projectId,
        requesterId: userId,
        chapterPlanId: null,
        type: "DRAFT",
        status: "QUEUED",
        createdBy: "SYSTEM",
        progress: 0,
        output: asJson(output),
      },
      select: batchJobSelect,
    });
    return { kind: "job", job, reused: false, remainingCount };
  }, { maxWait: 10_000, timeout: 30_000 });
}

export async function getBatchDraftJob(
  db: PrismaClient,
  userId: string,
  projectId: string,
  jobId?: string,
) {
  const project = await db.novelProject.findFirst({
    where: { id: projectId, ownerId: userId },
    select: { id: true },
  });
  if (!project) return { projectFound: false as const, job: null, remainingCount: 0 };

  const candidates = await db.generationJob.findMany({
    where: {
      projectId,
      requesterId: userId,
      type: "DRAFT",
      chapterPlanId: null,
      ...(jobId ? { id: jobId } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: batchJobSelect,
  });
  const job = candidates.find(isBatchJob) ?? null;
  const remainingCount = await db.chapterPlan.count({
    where: { projectId, revisions: { none: {} } },
  });
  return { projectFound: true as const, job, remainingCount };
}

async function shouldSkipChapter(db: PrismaClient, userId: string, projectId: string, chapterId: string) {
  const chapter = await db.chapterPlan.findFirst({
    where: { id: chapterId, projectId, project: { ownerId: userId } },
    select: {
      id: true,
      _count: { select: { revisions: true } },
      generationJobs: {
        where: { type: "DRAFT", status: { in: ["QUEUED", "RUNNING"] } },
        take: 1,
        select: { id: true },
      },
    },
  });
  return !chapter || chapter._count.revisions > 0 || chapter.generationJobs.length > 0;
}

function chapterFailureMessage() {
  return "正文生成失败，请检查 AI 设置和模型服务。";
}

export async function runBatchDraftJob(db: PrismaClient, userId: string, projectId: string, jobId: string) {
  const stored = await db.generationJob.findFirst({
    where: { id: jobId, projectId, requesterId: userId, type: "DRAFT", chapterPlanId: null },
    select: batchJobSelect,
  });
  const parsed = parseBatchOutput(stored?.output);
  if (!stored || !parsed.success) return;
  let output = parsed.data;

  try {
    output = {
      ...output,
      phase: "running",
      message: `正在串行生成 ${output.total} 章正文初稿。`,
    };
    await persistBatchOutput(db, jobId, output, { status: "RUNNING", error: null, startedAt: new Date() });

    for (let index = 0; index < output.chapters.length; index += 1) {
      const chapter = output.chapters[index];
      if (!chapter || chapter.status !== "pending") continue;

      if (await shouldSkipChapter(db, userId, projectId, chapter.id)) {
        const chapters = [...output.chapters];
        chapters[index] = { ...chapter, status: "skipped" };
        output = {
          ...output,
          completed: output.completed + 1,
          skipped: output.skipped + 1,
          currentChapter: null,
          chapters,
          message: `第 ${chapter.number} 章已有正文或正在生成，已跳过。`,
        };
        await persistBatchOutput(db, jobId, output, { status: "RUNNING" });
        continue;
      }

      const chapters = [...output.chapters];
      chapters[index] = { ...chapter, status: "running" };
      output = {
        ...output,
        currentChapter: { id: chapter.id, number: chapter.number, title: chapter.title },
        chapters,
        message: `正在生成第 ${chapter.number} 章《${chapter.title}》。`,
      };
      await persistBatchOutput(db, jobId, output, { status: "RUNNING" });

      try {
        const childJob = await createChapterGenerationJob(db, {
          userId,
          projectId,
          chapterPlanId: chapter.id,
          type: "DRAFT",
          idempotencyKey: `batch-draft:${jobId}:${chapter.id}`,
        });
        await updateChapterGenerationJob(db, childJob.id, "running", {
          progress: 10,
          startedAt: new Date(),
        });
        await generateDraft(db, userId, chapter.id, childJob.id, {});

        const nextChapters = [...output.chapters];
        nextChapters[index] = { ...chapter, status: "succeeded" };
        output = {
          ...output,
          completed: output.completed + 1,
          succeeded: output.succeeded + 1,
          currentChapter: null,
          chapters: nextChapters,
          message: `第 ${chapter.number} 章正文初稿已生成。`,
        };
      } catch (error) {
        console.error(`[batch-drafts] chapter ${chapter.id} failed`, error);
        const message = chapterFailureMessage();
        const childJob = await db.generationJob.findFirst({
          where: { projectId, chapterPlanId: chapter.id, idempotencyKey: `batch-draft:${jobId}:${chapter.id}` },
          select: { id: true },
        });
        if (childJob) {
          await updateChapterGenerationJob(db, childJob.id, "failed", {
            progress: 10,
            error: message,
            finishedAt: new Date(),
          }).catch((statusError) => console.error("[batch-drafts] child failure status update failed", statusError));
        }
        const nextChapters = [...output.chapters];
        nextChapters[index] = { ...chapter, status: "failed", error: message };
        output = {
          ...output,
          completed: output.completed + 1,
          failed: output.failed + 1,
          currentChapter: null,
          chapters: nextChapters,
          message: `第 ${chapter.number} 章生成失败，正在继续下一章。`,
        };
      }
      await persistBatchOutput(db, jobId, output, { status: "RUNNING" });
    }

    output = {
      ...output,
      phase: "succeeded",
      currentChapter: null,
      message: `批量生成完成：成功 ${output.succeeded} 章，失败 ${output.failed} 章，跳过 ${output.skipped} 章。`,
    };
    await persistBatchOutput(db, jobId, output, {
      status: "SUCCEEDED",
      error: null,
      finishedAt: new Date(),
    });
  } catch (error) {
    console.error("[batch-drafts] fatal failure", error);
    output = {
      ...output,
      phase: "failed",
      currentChapter: null,
      message: "批量正文任务异常结束，请稍后重试未生成的章节。",
    };
    await persistBatchOutput(db, jobId, output, {
      status: "FAILED",
      error: output.message,
      finishedAt: new Date(),
    }).catch((statusError) => console.error("[batch-drafts] fatal status update failed", statusError));
  }
}

export function serializeBatchDraftJob(job: BatchJob | null) {
  if (!job) return null;
  const parsed = parseBatchOutput(job.output);
  if (!parsed.success) return null;
  return {
    id: job.id,
    status: job.status.toLowerCase(),
    progress: job.progress,
    output: parsed.data,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}
