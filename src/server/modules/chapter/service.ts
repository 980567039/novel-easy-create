import type { Prisma, PrismaClient } from "@prisma/client";

import { getConfiguredAiProvider } from "@/server/ai";
import type { GenerateChapterInput, UpdateChapterPlanInput } from "./schema";
import { ScenePlanSchema } from "./schema";

type Database = PrismaClient | Prisma.TransactionClient;

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function wordCount(text: string) {
  // Chinese has no spaces; counting non-whitespace characters is a useful
  // estimate while still giving sensible results for mixed-language drafts.
  return text.replace(/\s+/g, "").length;
}

export async function listProjectChapters(db: Database, userId: string, projectId: string) {
  const project = await db.novelProject.findFirst({
    where: { id: projectId, ownerId: userId },
    select: { id: true, title: true },
  });
  if (!project) return null;

  const chapters = await db.chapterPlan.findMany({
    where: { projectId },
    orderBy: { number: "asc" },
    select: {
      id: true,
      projectId: true,
      volumeId: true,
      number: true,
      title: true,
      summary: true,
      objective: true,
      conflict: true,
      expectedOutcome: true,
      requiredChanges: true,
      plannedWordCount: true,
      isFinale: true,
      status: true,
      version: true,
      locked: true,
      volume: { select: { id: true, number: true, title: true } },
      revisions: {
        orderBy: { revisionNumber: "desc" },
        take: 1,
        select: { id: true, revisionNumber: true, content: true, summary: true, wordCount: true, status: true, updatedAt: true },
      },
      generationJobs: {
        where: { type: "SCENE_PLAN" },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, status: true, progress: true, output: true, error: true, createdAt: true },
      },
    },
  });

  return {
    project,
    chapters: chapters.map((chapter) => ({
      ...chapter,
      latestRevision: chapter.revisions[0] ?? null,
      scenePlanJob: chapter.generationJobs[0] ?? null,
      scenePlan: (() => {
        const latestSceneJob = chapter.generationJobs.find((job) => job.status === "SUCCEEDED") ?? chapter.generationJobs[0];
        const output = asRecord(latestSceneJob?.output);
        return output.data ?? null;
      })(),
      revisions: undefined,
      generationJobs: undefined,
    })),
    volumes: groupChaptersByVolume(chapters),
  };
}

function groupChaptersByVolume(chapters: Array<{ volume: { id: string; number: number; title: string | null } | null; id: string; number: number; title: string | null }>) {
  const groups = new Map<string, { id: string | null; number: number; title: string | null; chapters: typeof chapters }>();
  for (const chapter of chapters) {
    const volume = chapter.volume;
    const key = volume?.id ?? "unassigned";
    const existing = groups.get(key);
    if (existing) existing.chapters.push(chapter);
    else groups.set(key, { id: volume?.id ?? null, number: volume?.number ?? 0, title: volume?.title ?? "未分卷", chapters: [chapter] });
  }
  return [...groups.values()].sort((a, b) => a.number - b.number);
}

export async function getChapterDetail(db: Database, userId: string, chapterId: string, projectId?: string) {
  const chapter = await db.chapterPlan.findFirst({
    where: { id: chapterId, ...(projectId ? { projectId } : {}), project: { ownerId: userId } },
    select: {
      id: true,
      projectId: true,
      volumeId: true,
      number: true,
      title: true,
      summary: true,
      objective: true,
      conflict: true,
      expectedOutcome: true,
      requiredChanges: true,
      plannedWordCount: true,
      isFinale: true,
      status: true,
      version: true,
      locked: true,
      createdAt: true,
      updatedAt: true,
      project: {
        select: {
          id: true,
          title: true,
          genre: true,
          targetWordCount: true,
          storyBible: { select: { premise: true, theme: true, tone: true, pointOfView: true, styleGuide: true, forbiddenExpressions: true } },
          characters: { orderBy: { updatedAt: "desc" }, take: 80, select: { id: true, name: true, role: true, summary: true, desire: true, fear: true, secret: true, personality: true, arc: true } },
          worldRules: { orderBy: { updatedAt: "desc" }, take: 80, select: { name: true, content: true, scope: true, exceptions: true, status: true, locked: true } },
          plotThreads: { orderBy: { updatedAt: "desc" }, take: 80, select: { title: true, description: true, type: true, status: true, plannedPayoffChapter: true, endingCondition: true } },
        },
      },
      volume: { select: { id: true, number: true, title: true, goal: true, climax: true, endingCondition: true } },
      revisions: { orderBy: { revisionNumber: "desc" }, select: { id: true, revisionNumber: true, parentRevisionId: true, content: true, wordCount: true, summary: true, source: true, status: true, createdAt: true, updatedAt: true } },
      generationJobs: { where: { type: "SCENE_PLAN" }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, status: true, progress: true, model: true, output: true, error: true, createdAt: true, updatedAt: true, finishedAt: true } },
    },
  });
  if (!chapter || (projectId && chapter.projectId !== projectId)) return null;
  const sceneJob = chapter.generationJobs.find((job) => job.status === "SUCCEEDED") ?? chapter.generationJobs[0] ?? null;
  const scenePlan = sceneJob && asRecord(sceneJob.output).data ? asRecord(sceneJob.output).data : null;
  return { ...chapter, scenePlan, scenePlanJob: sceneJob };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function updateChapterPlan(db: Database, userId: string, chapterId: string, projectId: string | undefined, input: UpdateChapterPlanInput) {
  const chapter = await db.chapterPlan.findFirst({ where: { id: chapterId, ...(projectId ? { projectId } : {}), project: { ownerId: userId } }, select: { id: true, projectId: true, locked: true } });
  if (!chapter) return null;
  if (chapter.locked) throw new Error("章节计划已锁定，无法修改。");
  return db.chapterPlan.update({
    where: { id: chapterId },
    data: {
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.summary === undefined ? {} : { summary: input.summary }),
      ...(input.objective === undefined ? {} : { objective: input.objective }),
      ...(input.conflict === undefined ? {} : { conflict: input.conflict }),
      ...(input.expectedOutcome === undefined ? {} : { expectedOutcome: input.expectedOutcome }),
      ...(input.requiredChanges === undefined ? {} : { requiredChanges: asJson(input.requiredChanges) }),
      ...(input.plannedWordCount === undefined ? {} : { plannedWordCount: input.plannedWordCount }),
      version: { increment: 1 },
    },
  });
}

export async function createChapterGenerationJob(db: Database, args: { userId: string; projectId: string; chapterPlanId: string; type: "SCENE_PLAN" | "DRAFT"; idempotencyKey?: string }) {
  if (args.idempotencyKey) {
    const existing = await db.generationJob.findFirst({ where: { projectId: args.projectId, chapterPlanId: args.chapterPlanId, requesterId: args.userId, type: args.type, idempotencyKey: args.idempotencyKey }, select: { id: true, status: true, progress: true, model: true, output: true, error: true, createdAt: true, finishedAt: true } });
    if (existing) return existing;
  }
  return db.generationJob.create({
    data: { projectId: args.projectId, chapterPlanId: args.chapterPlanId, requesterId: args.userId, type: args.type, createdBy: "SYSTEM", status: "QUEUED", progress: 0, ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}), output: asJson({ phase: "queued", message: "已排队，等待生成任务开始。" }) },
    select: { id: true, status: true, progress: true, model: true, output: true, error: true, createdAt: true, finishedAt: true },
  });
}

export async function updateChapterGenerationJob(db: Database, jobId: string, phase: "queued" | "running" | "validating" | "saving" | "succeeded" | "failed", options: { progress?: number; model?: string | null; error?: string; output?: unknown; startedAt?: Date; finishedAt?: Date } = {}) {
  const status = phase === "succeeded" ? "SUCCEEDED" : phase === "failed" ? "FAILED" : phase === "queued" ? "QUEUED" : "RUNNING";
  const output = options.output === undefined ? { phase, message: phaseMessage(phase) } : { phase, message: phaseMessage(phase), ...asRecord(options.output) };
  return db.generationJob.update({ where: { id: jobId }, data: { status, progress: options.progress ?? (phase === "succeeded" ? 100 : undefined), model: options.model === undefined ? undefined : options.model, error: phase === "failed" ? options.error ?? "章节生成失败。" : undefined, startedAt: options.startedAt, finishedAt: options.finishedAt, output: asJson(output) }, select: { id: true, status: true, progress: true, model: true, output: true, error: true, createdAt: true, finishedAt: true } });
}

function phaseMessage(phase: string) {
  return ({ queued: "已排队，等待生成任务开始。", running: "正在生成章节内容。", validating: "正在校验模型输出。", saving: "正在保存章节版本。", succeeded: "章节生成完成。", failed: "章节生成失败。" } as Record<string, string>)[phase] ?? "正在处理。";
}

export async function getChapterGenerationJob(db: Database, chapterId: string, jobId?: string, type?: "SCENE_PLAN" | "DRAFT") {
  return db.generationJob.findFirst({ where: { chapterPlanId: chapterId, ...(jobId ? { id: jobId } : {}), ...(type ? { type } : {}) }, orderBy: { createdAt: "desc" }, select: { id: true, chapterPlanId: true, type: true, status: true, progress: true, model: true, output: true, error: true, createdAt: true, updatedAt: true, startedAt: true, finishedAt: true } });
}

export async function saveDraftRevision(db: Database, userId: string, chapterId: string, projectId: string | undefined, content: string, summary?: string | null) {
  const chapter = await db.chapterPlan.findFirst({ where: { id: chapterId, ...(projectId ? { projectId } : {}), project: { ownerId: userId } }, select: { id: true, projectId: true } });
  if (!chapter) return null;
  const trimmed = content.trim();
  if (!trimmed) throw new Error("正文内容不能为空。");
  return db.$transaction(async (tx) => {
    const latest = await tx.chapterRevision.findFirst({ where: { chapterPlanId: chapterId }, orderBy: { revisionNumber: "desc" }, select: { revisionNumber: true, id: true } });
    return tx.chapterRevision.create({ data: { projectId: chapter.projectId, chapterPlanId: chapterId, authorId: userId, parentRevisionId: latest?.id ?? null, revisionNumber: (latest?.revisionNumber ?? 0) + 1, content: trimmed, wordCount: wordCount(trimmed), summary: summary?.trim() || null, source: "USER", createdBy: "USER", status: "DRAFT" } });
  });
}

export async function buildChapterContext(db: Database, userId: string, chapterId: string) {
  const chapter = await getChapterDetail(db, userId, chapterId);
  if (!chapter) return null;
  const previous = await db.chapterPlan.findMany({ where: { projectId: chapter.projectId, number: { lt: chapter.number } }, orderBy: { number: "desc" }, take: 3, select: { number: true, title: true, summary: true, expectedOutcome: true, revisions: { where: { status: "FINAL" }, orderBy: { revisionNumber: "desc" }, take: 1, select: { summary: true } } } });
  return {
    project: chapter.project,
    volume: chapter.volume,
    chapter: { id: chapter.id, number: chapter.number, title: chapter.title, summary: chapter.summary, objective: chapter.objective, conflict: chapter.conflict, expectedOutcome: chapter.expectedOutcome, requiredChanges: chapter.requiredChanges, plannedWordCount: chapter.plannedWordCount, isFinale: chapter.isFinale },
    previousChapters: previous,
    characters: chapter.project.characters,
    worldRules: chapter.project.worldRules,
    plotThreads: chapter.project.plotThreads,
    storyBible: chapter.project.storyBible,
  };
}

export async function generateScenePlan(db: Database, userId: string, chapterId: string, jobId: string, input: GenerateChapterInput) {
  const context = await buildChapterContext(db, userId, chapterId);
  if (!context) throw new Error("章节不存在。");
  const provider = await getConfiguredAiProvider(userId);
  const result = await provider.generateStructured({ schemaName: "ScenePlan", temperature: input.temperature ?? 0.2, maxTokens: 6_000, timeoutMs: 180_000, messages: [
    { role: "system", content: "你是一名长篇小说策划编辑。请根据章节计划和上下文生成可执行的场景表。每个场景必须有角色目标、阻碍、行动、转折和结果；场景结束后必须推动至少一项人物或剧情状态变化。严格只输出 JSON。" },
    { role: "user", content: JSON.stringify({ ...context, instruction: input.instruction ?? null }) },
  ] }, ScenePlanSchema);
  await updateChapterGenerationJob(db, jobId, "validating", { progress: 65, model: result.model ?? null });
  await updateChapterGenerationJob(db, jobId, "saving", { progress: 85, model: result.model ?? null, output: { data: result.data, usage: result.usage ?? null, generatedAt: new Date().toISOString() } });
  await updateChapterGenerationJob(db, jobId, "succeeded", { progress: 100, model: result.model ?? null, output: { data: result.data, usage: result.usage ?? null, generatedAt: new Date().toISOString() }, finishedAt: new Date() });
  return result;
}

export class ChapterDraftGenerationCancelledError extends Error {
  constructor() {
    super("正文生成已在保存前取消。");
    this.name = "ChapterDraftGenerationCancelledError";
  }
}

export interface GenerateDraftExecutionOptions {
  signal?: AbortSignal;
  /**
   * Runs inside the same transaction that creates the revision. Batch jobs use
   * this hook to lock/check their parent immediately before the save boundary.
   */
  canSaveRevision?: (tx: Prisma.TransactionClient) => Promise<boolean>;
}

export async function generateDraft(
  db: Database,
  userId: string,
  chapterId: string,
  jobId: string,
  input: GenerateChapterInput,
  execution: GenerateDraftExecutionOptions = {},
) {
  const context = await buildChapterContext(db, userId, chapterId);
  if (!context) throw new Error("章节不存在。");
  const provider = await getConfiguredAiProvider(userId);
  const sceneJob = await getChapterGenerationJob(db, chapterId, undefined, "SCENE_PLAN");
  const scenePlan = sceneJob ? asRecord(sceneJob.output).data : null;
  const result = await provider.generateText({ temperature: input.temperature ?? 0.7, maxTokens: 20_000, timeoutMs: 300_000, signal: execution.signal, messages: [
    { role: "system", content: "你是一名中文长篇小说作者。根据章节计划、场景表和上下文写出连贯的正文初稿。遵守故事圣经的视角和文风，不擅自改变锁定事实。只输出正文，不要标题、解释或 Markdown。" },
    { role: "user", content: JSON.stringify({ ...context, scenePlan, instruction: input.instruction ?? null }) },
  ] });
  await updateChapterGenerationJob(db, jobId, "saving", { progress: 85, model: result.model ?? null });
  const revision = await db.$transaction(async (tx) => {
    if (execution.canSaveRevision && !await execution.canSaveRevision(tx)) {
      throw new ChapterDraftGenerationCancelledError();
    }
    const latest = await tx.chapterRevision.findFirst({ where: { chapterPlanId: chapterId }, orderBy: { revisionNumber: "desc" }, select: { revisionNumber: true, id: true } });
    return tx.chapterRevision.create({ data: { projectId: context.project.id, chapterPlanId: chapterId, parentRevisionId: latest?.id ?? null, revisionNumber: (latest?.revisionNumber ?? 0) + 1, content: result.content.trim(), wordCount: wordCount(result.content), source: "AI", createdBy: "AI", status: "DRAFT" } });
  });
  await db.generationJob.update({ where: { id: jobId }, data: { chapterRevisionId: revision.id } });
  await updateChapterGenerationJob(db, jobId, "succeeded", { progress: 100, model: result.model ?? null, output: { revisionId: revision.id, wordCount: revision.wordCount, usage: result.usage ?? null, generatedAt: new Date().toISOString() }, finishedAt: new Date() });
  return { ...result, revision };
}

export async function finalizeChapter(db: Database, userId: string, chapterId: string, projectId: string | undefined, revisionId?: string) {
  const chapter = await db.chapterPlan.findFirst({ where: { id: chapterId, ...(projectId ? { projectId } : {}), project: { ownerId: userId } }, select: { id: true, projectId: true } });
  if (!chapter) return null;
  const revision = revisionId
    ? await db.chapterRevision.findFirst({ where: { id: revisionId, chapterPlanId: chapterId, projectId: chapter.projectId } })
    : await db.chapterRevision.findFirst({ where: { chapterPlanId: chapterId }, orderBy: { revisionNumber: "desc" } });
  if (!revision) throw new Error("没有可定稿的正文版本。");
  return db.$transaction(async (tx) => {
    await tx.chapterRevision.updateMany({ where: { chapterPlanId: chapterId, status: "FINAL" }, data: { status: "ARCHIVED" } });
    const finalRevision = await tx.chapterRevision.update({ where: { id: revision.id }, data: { status: "FINAL", locked: true } });
    await tx.chapterPlan.update({ where: { id: chapterId }, data: { status: "CONFIRMED", version: { increment: 1 } } });
    return finalRevision;
  });
}
