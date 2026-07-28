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

const globalForBatchDrafts = globalThis as unknown as {
  batchDraftAbortControllers?: Map<string, AbortController>;
};
const batchDraftAbortControllers = globalForBatchDrafts.batchDraftAbortControllers
  ?? new Map<string, AbortController>();
globalForBatchDrafts.batchDraftAbortControllers = batchDraftAbortControllers;

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
  const updated = await db.generationJob.updateMany({
    // Every runner write is conditional. A concurrent cancellation changes
    // the status first, causing this update to become a no-op instead of
    // reviving the parent as RUNNING/SUCCEEDED.
    where: { id: jobId, status: { in: ["QUEUED", "RUNNING"] } },
    data: {
      output: asJson(output),
      progress: options.status === "SUCCEEDED" ? 100 : progressFor(output),
      status: options.status,
      error: options.error,
      startedAt: options.startedAt,
      finishedAt: options.finishedAt,
    },
  });
  return updated.count === 1;
}

async function getBatchJobStatus(db: PrismaClient, jobId: string) {
  const job = await db.generationJob.findUnique({ where: { id: jobId }, select: { status: true } });
  return job?.status ?? null;
}

async function getSerializedBatchJobStatus(db: PrismaClient, jobId: string) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "GenerationJob" WHERE id = ${jobId} FOR UPDATE
    `;
    const job = await tx.generationJob.findUnique({ where: { id: jobId }, select: { status: true } });
    return job?.status ?? null;
  }, { maxWait: 10_000, timeout: 20_000 });
}

async function parentAllowsRevisionSave(tx: Prisma.TransactionClient, userId: string, projectId: string, jobId: string) {
  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "GenerationJob" WHERE id = ${jobId} FOR UPDATE
  `;
  const parent = await tx.generationJob.findFirst({
    where: {
      id: jobId,
      projectId,
      requesterId: userId,
      type: "DRAFT",
      chapterPlanId: null,
      status: "RUNNING",
    },
    select: { id: true },
  });
  return Boolean(parent);
}

async function settleChapterAfterCancellation(
  db: PrismaClient,
  jobId: string,
  chapterId: string,
  result: "succeeded" | "failed" | "cancelled",
  error?: string,
) {
  await db.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "GenerationJob" WHERE id = ${jobId} FOR UPDATE
    `;
    const job = await tx.generationJob.findFirst({
      where: { id: jobId, status: "CANCELLED" },
      select: { output: true },
    });
    const parsed = parseBatchOutput(job?.output);
    if (!job || !parsed.success) return;
    const output = parsed.data;
    const index = output.chapters.findIndex((chapter) => chapter.id === chapterId);
    const chapter = output.chapters[index];
    if (index < 0 || !chapter || chapter.status !== "running") return;

    const chapters = [...output.chapters];
    chapters[index] = {
      ...chapter,
      status: result,
      ...(error ? { error } : {}),
    };
    const completedDelta = result === "cancelled" ? 0 : 1;
    const nextOutput: BatchDraftJobOutput = {
      ...output,
      completed: output.completed + completedDelta,
      succeeded: output.succeeded + (result === "succeeded" ? 1 : 0),
      failed: output.failed + (result === "failed" ? 1 : 0),
      currentChapter: null,
      chapters,
      message: result === "succeeded"
        ? `批量任务已终止；第 ${chapter.number} 章在终止前已开始，并已完成保存。`
        : result === "failed"
          ? `批量任务已终止；第 ${chapter.number} 章执行失败，不再继续后续章节。`
          : "批量任务已终止，未再启动新的正文生成。",
    };
    await tx.generationJob.update({
      where: { id: jobId },
      data: { output: asJson(nextOutput), progress: progressFor(nextOutput) },
    });
  }, { maxWait: 10_000, timeout: 20_000 });
}

async function cancelChildJob(db: PrismaClient, childJobId: string) {
  await db.generationJob.updateMany({
    where: { id: childJobId, status: { in: ["QUEUED", "RUNNING"] } },
    data: {
      status: "CANCELLED",
      error: null,
      finishedAt: new Date(),
      output: asJson({ phase: "cancelled", message: "父批量任务已终止，未开始正文生成。" }),
    },
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

export type CancelBatchDraftResult =
  | { kind: "project_not_found" }
  | { kind: "job_not_found" }
  | { kind: "not_cancellable"; job: BatchJob }
  | { kind: "cancelled"; job: BatchJob; reused: boolean };

export async function cancelBatchDraftJob(
  db: PrismaClient,
  userId: string,
  projectId: string,
  jobId: string,
): Promise<CancelBatchDraftResult> {
  const result: CancelBatchDraftResult = await db.$transaction(async (tx) => {
    const project = await tx.novelProject.findFirst({
      where: { id: projectId, ownerId: userId },
      select: { id: true },
    });
    if (!project) return { kind: "project_not_found" };

    // Lock the parent row so cancellation reads the latest output and wins
    // atomically over any runner update that was already in flight.
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "GenerationJob" WHERE id = ${jobId} FOR UPDATE
    `;
    const job = await tx.generationJob.findFirst({
      where: {
        id: jobId,
        projectId,
        requesterId: userId,
        type: "DRAFT",
        chapterPlanId: null,
        project: { ownerId: userId },
      },
      select: batchJobSelect,
    });
    const parsed = parseBatchOutput(job?.output);
    if (!job || !parsed.success) return { kind: "job_not_found" };
    if (job.status === "CANCELLED") return { kind: "cancelled", job, reused: true };
    if (job.status !== "QUEUED" && job.status !== "RUNNING") {
      return { kind: "not_cancellable", job };
    }

    const output = parsed.data;
    const chapters = output.chapters.map((chapter) => chapter.status === "pending"
      ? { ...chapter, status: "cancelled" as const }
      : chapter);
    const cancelledOutput: BatchDraftJobOutput = {
      ...output,
      phase: "cancelled",
      message: output.currentChapter
        ? "批量任务已终止；当前已开始的章节可能完成保存，不再启动后续章节。"
        : "批量任务已终止，不再启动后续章节。",
      chapters,
    };
    const cancelled = await tx.generationJob.update({
      where: { id: job.id },
      data: {
        status: "CANCELLED",
        output: asJson(cancelledOutput),
        error: null,
        finishedAt: new Date(),
      },
      select: batchJobSelect,
    });
    return { kind: "cancelled", job: cancelled, reused: false };
  }, { maxWait: 10_000, timeout: 20_000 });
  if (result.kind === "cancelled") {
    // Best effort for the current process. The database save-boundary check
    // remains authoritative when the request and runner are on different
    // processes or the provider has already returned.
    batchDraftAbortControllers.get(jobId)?.abort();
  }
  return result;
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
    if (!await persistBatchOutput(db, jobId, output, { status: "RUNNING", error: null, startedAt: new Date() })) return;

    for (let index = 0; index < output.chapters.length; index += 1) {
      const chapter = output.chapters[index];
      if (!chapter || chapter.status !== "pending") continue;
      if (await getBatchJobStatus(db, jobId) !== "RUNNING") return;

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
        if (!await persistBatchOutput(db, jobId, output, { status: "RUNNING" })) return;
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
      if (!await persistBatchOutput(db, jobId, output, { status: "RUNNING" })) return;

      let childJobId: string | null = null;
      try {
        const childJob = await createChapterGenerationJob(db, {
          userId,
          projectId,
          chapterPlanId: chapter.id,
          type: "DRAFT",
          idempotencyKey: `batch-draft:${jobId}:${chapter.id}`,
        });
        childJobId = childJob.id;
        await updateChapterGenerationJob(db, childJob.id, "running", {
          progress: 10,
          startedAt: new Date(),
        });
        const controller = new AbortController();
        const generationTimeout = setTimeout(() => controller.abort(), 300_000);
        generationTimeout.unref?.();
        batchDraftAbortControllers.set(jobId, controller);
        try {
          if (await getBatchJobStatus(db, jobId) !== "RUNNING") {
            controller.abort();
            await cancelChildJob(db, childJob.id);
            await settleChapterAfterCancellation(db, jobId, chapter.id, "cancelled");
            return;
          }
          await generateDraft(db, userId, chapter.id, childJob.id, {}, {
            signal: controller.signal,
            canSaveRevision: (tx) => parentAllowsRevisionSave(tx, userId, projectId, jobId),
          });
        } finally {
          clearTimeout(generationTimeout);
          if (batchDraftAbortControllers.get(jobId) === controller) batchDraftAbortControllers.delete(jobId);
        }

        if (await getBatchJobStatus(db, jobId) === "CANCELLED") {
          // generateDraft saves its revision before returning. The in-flight
          // chapter is therefore reported as succeeded, while the parent stays
          // CANCELLED and no next chapter is started.
          await settleChapterAfterCancellation(db, jobId, chapter.id, "succeeded");
          return;
        }

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
        // Taking the parent row lock waits for an in-flight DELETE transaction
        // to commit. A child cancelled by that path is never overwritten as
        // FAILED by this error handler.
        if (await getSerializedBatchJobStatus(db, jobId) === "CANCELLED") {
          const savedRevision = await db.chapterRevision.findFirst({
            where: { chapterPlanId: chapter.id },
            orderBy: { revisionNumber: "desc" },
            select: { id: true, wordCount: true },
          });
          if (savedRevision) {
            if (childJobId) {
              await db.generationJob.updateMany({
                where: { id: childJobId, status: { in: ["QUEUED", "RUNNING"] } },
                data: {
                  status: "SUCCEEDED",
                  progress: 100,
                  chapterRevisionId: savedRevision.id,
                  finishedAt: new Date(),
                  error: null,
                  output: asJson({ phase: "succeeded", message: "正文已在父任务终止前保存。", revisionId: savedRevision.id, wordCount: savedRevision.wordCount }),
                },
              });
            }
            await settleChapterAfterCancellation(db, jobId, chapter.id, "succeeded");
          } else {
            if (childJobId) await cancelChildJob(db, childJobId);
            await settleChapterAfterCancellation(db, jobId, chapter.id, "cancelled");
          }
          return;
        }
        if (childJobId) {
          await updateChapterGenerationJob(db, childJobId, "failed", {
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
      if (!await persistBatchOutput(db, jobId, output, { status: "RUNNING" })) {
        const chapterResult = output.chapters[index]?.status;
        if (await getBatchJobStatus(db, jobId) === "CANCELLED" && (chapterResult === "succeeded" || chapterResult === "failed")) {
          await settleChapterAfterCancellation(
            db,
            jobId,
            chapter.id,
            chapterResult,
            chapterResult === "failed" ? chapterFailureMessage() : undefined,
          );
        }
        return;
      }
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
