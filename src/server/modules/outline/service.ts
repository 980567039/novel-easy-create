import type { Prisma, PrismaClient } from "@prisma/client";

import type { OutlineBookSkeleton, OutlineDraft, OutlineVolumeDraft } from "@/server/ai";

export const MAX_OUTLINE_CHAPTERS = 500;
export const DEFAULT_OUTLINE_CHAPTERS = 80;
const PREFERRED_CHAPTERS_PER_VOLUME = 20;

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join("\n");
  if (value && typeof value === "object") return Object.values(asRecord(value)).map(asText).filter(Boolean).join("\n");
  return value == null ? "" : String(value).trim();
}

function clippedText(value: unknown, maxLength: number): string {
  const text = asText(value);
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function compactCharacters(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 24).map((item) => {
    const record = asRecord(item);
    return {
      name: clippedText(record.name, 80),
      role: clippedText(record.role, 160),
      desire: clippedText(record.desire, 300),
      fear: clippedText(record.fear, 240),
      arc: clippedText(record.arc, 400),
    };
  });
}

export function resolveTargetChapterCount(targetChapterCount: number | null, targetWordCount: number | null) {
  const explicit = targetChapterCount !== null && Number.isInteger(targetChapterCount) ? targetChapterCount : null;
  const inferred = targetWordCount && targetWordCount > 0
    ? Math.max(1, Math.round(targetWordCount / 2_500))
    : DEFAULT_OUTLINE_CHAPTERS;
  const target = explicit ?? inferred;
  if (target < 1 || target > MAX_OUTLINE_CHAPTERS) {
    throw new RangeError(`目标章节数必须在 1 到 ${MAX_OUTLINE_CHAPTERS} 之间`);
  }
  return target;
}

/** Allocate every chapter exactly once while keeping normal volumes near 20 chapters. */
export function allocateVolumeChapterCounts(targetChapterCount: number) {
  if (!Number.isInteger(targetChapterCount) || targetChapterCount < 1) {
    throw new RangeError("目标章节数必须是正整数");
  }
  const volumeCount = Math.max(1, Math.round(targetChapterCount / PREFERRED_CHAPTERS_PER_VOLUME));
  const base = Math.floor(targetChapterCount / volumeCount);
  const remainder = targetChapterCount % volumeCount;
  return Array.from({ length: volumeCount }, (_, index) => base + (index < remainder ? 1 : 0));
}

export interface OutlineVolumeSkeleton {
  number: number;
  title: string;
  goal: string;
  climax: string;
  endingCondition: string;
  chapterCount: number;
  chapterStart: number;
  chapterEnd: number;
}

export function normalizeOutlineSkeleton(
  skeleton: OutlineBookSkeleton,
  chapterCounts: number[],
): { ending: string; volumes: OutlineVolumeSkeleton[] } {
  const allocationMatches = skeleton.volumes.length === chapterCounts.length && skeleton.volumes.every(
    (volume, index) => volume.number === index + 1 && volume.chapterCount === chapterCounts[index],
  );
  if (!allocationMatches) throw new Error("分卷骨架与目标章节分配不一致");
  let chapterStart = 1;
  const volumes = chapterCounts.map((chapterCount, index) => {
    const generated = skeleton.volumes[index]!;
    const chapterEnd = chapterStart + chapterCount - 1;
    const volume: OutlineVolumeSkeleton = {
      number: index + 1,
      title: generated.title,
      goal: generated.goal,
      climax: generated.climax,
      endingCondition: generated.endingCondition,
      chapterCount,
      chapterStart,
      chapterEnd,
    };
    chapterStart = chapterEnd + 1;
    return volume;
  });
  return { ending: skeleton.ending, volumes };
}

type OutlineChapter = OutlineVolumeDraft["chapters"][number];

function fallbackChapter(
  volume: OutlineVolumeSkeleton,
  globalNumber: number,
  localNumber: number,
  estimatedWords?: number,
): OutlineChapter {
  const isLast = localNumber === volume.chapterCount;
  return {
    order: globalNumber,
    title: isLast ? `${volume.title}·卷末转折` : `${volume.title}·推进${localNumber}`,
    objective: isLast ? `完成“${volume.goal}”并进入下一阶段` : `推进“${volume.goal}”的第${localNumber}步`,
    conflict: isLast ? `本卷积累的阻力在“${volume.climax}”中集中爆发` : `既有阻力升级，迫使主要人物为本卷目标付出新的代价`,
    result: isLast ? volume.endingCondition : `局势发生不可逆变化，并形成通往本卷第${localNumber + 1}阶段的新问题`,
    requiredChange: isLast ? `本卷目标完成，故事状态满足：${volume.endingCondition}` : `本卷进度推进到 ${localNumber}/${volume.chapterCount}，人物关系或资源状态发生变化`,
    ...(estimatedWords ? { estimatedWords } : {}),
  };
}

/** Normalize global numbering and deterministically fill/truncate to the promised count. */
export function ensureExactVolumeChapters(
  volume: OutlineVolumeSkeleton,
  chapters: OutlineChapter[],
  estimatedWords?: number,
) {
  const selected = chapters.slice(0, volume.chapterCount);
  const repairedCount = Math.max(0, volume.chapterCount - selected.length);
  const exact = Array.from({ length: volume.chapterCount }, (_, index) => {
    const globalNumber = volume.chapterStart + index;
    const generated = selected[index];
    const fallback = fallbackChapter(volume, globalNumber, index + 1, estimatedWords);
    return generated
      ? {
          order: globalNumber,
          title: generated.title || fallback.title,
          objective: generated.objective || fallback.objective,
          conflict: generated.conflict || fallback.conflict,
          result: generated.result || fallback.result,
          requiredChange: generated.requiredChange || fallback.requiredChange,
          estimatedWords: generated.estimatedWords ?? estimatedWords,
        }
      : fallback;
  });
  return { chapters: exact, repairedCount, truncatedCount: Math.max(0, chapters.length - volume.chapterCount) };
}

export function assertOutlineIntegrity(draft: OutlineDraft, targetChapterCount: number) {
  const chapters = draft.volumes.flatMap((volume) => volume.chapters);
  if (chapters.length !== targetChapterCount) {
    throw new Error("生成章节总数与目标章节数不一致");
  }
  for (const [index, chapter] of chapters.entries()) {
    if (chapter.order !== index + 1) throw new Error("章节编号不连续");
  }
}

export type OutlineGenerationStage = "queued" | "running" | "validating" | "saving" | "succeeded" | "failed";

export interface OutlineJobMetadata {
  currentVolume?: number;
  totalVolumes?: number;
  chapterStart?: number;
  chapterEnd?: number;
  generatedChapters?: number;
  targetChapters?: number;
  repairedChapters?: number;
}

const stageMessages: Record<OutlineGenerationStage, string> = {
  queued: "已排队，等待生成任务开始。",
  running: "正在根据故事圣经生成分层大纲。",
  validating: "正在检查大纲结构和章节完整性。",
  saving: "正在保存分卷和章节计划。",
  succeeded: "分层大纲已生成并保存。",
  failed: "分层大纲生成失败。",
};

function definedMetadata(metadata: OutlineJobMetadata) {
  return Object.fromEntries([
    ["currentVolume", metadata.currentVolume],
    ["totalVolumes", metadata.totalVolumes],
    ["chapterStart", metadata.chapterStart],
    ["chapterEnd", metadata.chapterEnd],
    ["generatedChapters", metadata.generatedChapters],
    ["targetChapters", metadata.targetChapters],
    ["repairedChapters", metadata.repairedChapters],
  ].filter(([, value]) => value !== undefined));
}

function jobOutput(
  stage: OutlineGenerationStage,
  message = stageMessages[stage],
  existing: unknown = {},
  metadata: OutlineJobMetadata = {},
): Prisma.InputJsonValue {
  return { ...asRecord(existing), ...definedMetadata(metadata), phase: stage, stage, message } as Prisma.InputJsonValue;
}

export async function createOutlineGenerationJob(
  db: PrismaClient,
  projectId: string,
  metadata: OutlineJobMetadata = {},
) {
  return db.generationJob.create({
    data: {
      projectId,
      type: "OUTLINE",
      createdBy: "SYSTEM",
      status: "QUEUED",
      progress: 0,
      output: jobOutput("queued", stageMessages.queued, {}, metadata),
    },
    select: { id: true, createdAt: true },
  });
}

export async function updateOutlineGenerationJob(
  db: PrismaClient,
  jobId: string,
  stage: OutlineGenerationStage,
  options: OutlineJobMetadata & {
    model?: string | null;
    progress?: number;
    error?: string;
    message?: string;
    startedAt?: Date;
    finishedAt?: Date;
    tokensInput?: number;
    tokensOutput?: number;
  } = {},
) {
  const status = stage === "succeeded" ? "SUCCEEDED" : stage === "failed" ? "FAILED" : stage === "queued" ? "QUEUED" : "RUNNING";
  const existing = await db.generationJob.findUnique({ where: { id: jobId }, select: { output: true } });
  return db.generationJob.update({
    where: { id: jobId },
    data: {
      status,
      progress: options.progress ?? (stage === "succeeded" ? 100 : undefined),
      model: options.model === undefined ? undefined : options.model,
      error: stage === "failed" ? options.error ?? "分层大纲生成失败。" : undefined,
      tokensInput: options.tokensInput,
      tokensOutput: options.tokensOutput,
      startedAt: options.startedAt,
      finishedAt: options.finishedAt,
      output: jobOutput(stage, options.message ?? stageMessages[stage], existing?.output, options),
    },
    select: { id: true, status: true, progress: true, model: true, error: true, startedAt: true, finishedAt: true, createdAt: true, output: true },
  });
}

export async function getLatestOutlineGenerationJob(db: PrismaClient, projectId: string) {
  return db.generationJob.findFirst({
    where: { projectId, type: "OUTLINE" },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, progress: true, model: true, error: true, startedAt: true, finishedAt: true, createdAt: true, updatedAt: true, output: true },
  });
}

function statusStage(job: { status: string; output: unknown }): OutlineGenerationStage {
  const output = asRecord(job.output);
  const phase = output.phase ?? output.stage;
  if (phase === "queued" || phase === "running" || phase === "validating" || phase === "saving" || phase === "succeeded" || phase === "failed") return phase;
  if (job.status === "SUCCEEDED") return "succeeded";
  if (job.status === "FAILED" || job.status === "CANCELLED") return "failed";
  if (job.status === "QUEUED") return "queued";
  return "running";
}

export async function getOutlineGenerationStatus(db: PrismaClient, projectId: string, jobId?: string) {
  const project = await db.novelProject.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) return null;
  const job = await db.generationJob.findFirst({
    where: { projectId, type: "OUTLINE", ...(jobId ? { id: jobId } : {}) },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, progress: true, model: true, error: true, startedAt: true, finishedAt: true, createdAt: true, updatedAt: true, output: true },
  });
  if (!job) return { jobId: null, phase: "queued" as const, stage: "queued" as const, status: "idle", progress: 0, message: "尚未提交大纲生成任务。", startedAt: null, finishedAt: null, elapsedMs: 0, model: null, error: null };
  const phase = statusStage(job);
  const started = job.startedAt?.getTime() ?? job.createdAt.getTime();
  const ended = job.finishedAt?.getTime() ?? Date.now();
  const output = asRecord(job.output);
  return {
    id: job.id,
    jobId: job.id,
    phase,
    stage: phase,
    // Keep Prisma's enum casing for existing clients while `phase` remains
    // the human-readable lower-case state used by polling UIs.
    status: job.status,
    progress: job.progress,
    message: typeof output.message === "string" ? output.message : stageMessages[phase],
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    elapsedMs: Math.max(0, ended - started),
    model: job.model,
    error: phase === "failed" ? job.error ?? "分层大纲生成失败。" : null,
    currentVolume: typeof output.currentVolume === "number" ? output.currentVolume : null,
    totalVolumes: typeof output.totalVolumes === "number" ? output.totalVolumes : null,
    chapterStart: typeof output.chapterStart === "number" ? output.chapterStart : null,
    chapterEnd: typeof output.chapterEnd === "number" ? output.chapterEnd : null,
    generatedChapters: typeof output.generatedChapters === "number" ? output.generatedChapters : 0,
    targetChapters: typeof output.targetChapters === "number" ? output.targetChapters : null,
    repairedChapters: typeof output.repairedChapters === "number" ? output.repairedChapters : 0,
  };
}

export async function getOutlineProject(db: PrismaClient, projectId: string) {
  return db.novelProject.findUnique({
    where: { id: projectId },
    include: { storyBible: true },
  });
}

export function hasGeneratedStoryBible(storyBible: { premise: string | null; styleGuide: unknown; createdBy: string }) {
  const styleGuide = asRecord(storyBible.styleGuide);
  return Boolean(
    storyBible.premise?.trim() &&
    storyBible.createdBy === "AI" &&
    (styleGuide.generatedAt || styleGuide.generatedDraft),
  );
}

export function buildOutlinePrompt(project: {
  title: string;
  genre: string | null;
  targetWordCount: number | null;
  targetChapterCount: number | null;
  storyBible: { premise: string | null; theme: string | null; tone: string | null; pointOfView: string | null; styleGuide: unknown };
}) {
  const styleGuide = asRecord(project.storyBible.styleGuide);
  const generatedDraft = asRecord(styleGuide.generatedDraft);
  const onboardingAnswers = asRecord(styleGuide.onboardingAnswers);
  return JSON.stringify({
    title: clippedText(project.title, 200),
    genre: clippedText(project.genre, 100) || null,
    targetWordCount: project.targetWordCount,
    targetChapterCount: project.targetChapterCount,
    storyBible: {
      premise: clippedText(project.storyBible.premise, 4_000),
      theme: clippedText(project.storyBible.theme, 1_200),
      tone: clippedText(project.storyBible.tone, 1_000),
      pointOfView: clippedText(project.storyBible.pointOfView, 600),
      characters: compactCharacters(styleGuide.generatedCharacters),
      endingDirection: clippedText(styleGuide.endingDirection ?? generatedDraft.endingDirection, 2_000) || null,
      constraints: clippedText(generatedDraft.constraints ?? onboardingAnswers.constraints, 2_000),
    },
  });
}

export async function replaceOutline(
  db: PrismaClient,
  projectId: string,
  draft: OutlineDraft,
  metadata: { generatedAt: string; generatedModel: string | null; expectedChapterCount: number },
) {
  assertOutlineIntegrity(draft, metadata.expectedChapterCount);
  return db.$transaction(async (tx) => {
    // Serialize outline replacement with chapter/revision writes. Without this
    // lock, a revision inserted between the safety check and delete could be
    // removed by ChapterRevision's cascading foreign key.
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "NovelProject"
      WHERE "id" = ${projectId}
      FOR UPDATE
    `;
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "ChapterPlan"
      WHERE "projectId" = ${projectId}
      FOR UPDATE
    `;

    const existingChapters = await tx.chapterPlan.findMany({
      where: { projectId },
      orderBy: { number: "asc" },
      select: {
        id: true,
        number: true,
        _count: { select: { revisions: true } },
      },
    });
    const retainedChapterIds = new Map(
      existingChapters
        .filter(({ number }) => number >= 1 && number <= metadata.expectedChapterCount)
        .map(({ id, number }) => [number, id]),
    );
    const obsoleteChapters = existingChapters.filter(
      ({ number }) => number < 1 || number > metadata.expectedChapterCount,
    );
    const protectedChapters = obsoleteChapters.filter(({ _count }) => _count.revisions > 0);
    if (protectedChapters.length > 0) {
      const chapterNumbers = protectedChapters.map(({ number }) => `第${number}章`).join("、");
      throw new Error(`目标章节范围外的${chapterNumbers}已有正文修订，为避免删除正文，已取消大纲替换`);
    }

    if (obsoleteChapters.length > 0) {
      const deleted = await tx.chapterPlan.deleteMany({
        where: {
          projectId,
          id: { in: obsoleteChapters.map(({ id }) => id) },
          revisions: { none: {} },
        },
      });
      if (deleted.count !== obsoleteChapters.length) {
        throw new Error("大纲保存期间检测到目标范围外章节新增了正文修订，已取消大纲替换");
      }
    }

    // VolumePlan may be rebuilt, but ChapterPlan must survive so its revisions
    // remain attached to the same chapter id. Detach explicitly before deleting
    // old volumes instead of relying solely on the database's ON DELETE SET NULL.
    await tx.chapterPlan.updateMany({
      where: { projectId, volumeId: { not: null } },
      data: { volumeId: null },
    });
    await tx.volumePlan.deleteMany({ where: { projectId } });

    let chapterNumber = 0;
    const volumes = [];
    for (const [volumeIndex, volumeDraft] of draft.volumes.entries()) {
      const chapters = volumeDraft.chapters.map((chapterDraft) => {
        chapterNumber += 1;
        return { chapterDraft, number: chapterNumber };
      });
      const plannedWordCount = chapters.reduce((sum, item) => sum + (item.chapterDraft.estimatedWords ?? 0), 0) || null;
      const volume = await tx.volumePlan.create({
        data: {
          projectId,
          number: volumeIndex + 1,
          title: volumeDraft.title,
          goal: volumeDraft.goal,
          climax: volumeDraft.climax,
          endingCondition: volumeDraft.endingCondition,
          plannedWordCount,
          createdBy: "AI",
          status: "SUGGESTED",
        },
      });
      volumes.push({ volume, chapters });
    }

    for (const { volume, chapters } of volumes) {
      for (const { chapterDraft, number } of chapters) {
        const plan = {
          volumeId: volume.id,
          title: chapterDraft.title,
          summary: chapterDraft.result,
          objective: chapterDraft.objective,
          conflict: chapterDraft.conflict,
          expectedOutcome: chapterDraft.result,
          requiredChanges: asJson(chapterDraft.requiredChange ? [chapterDraft.requiredChange] : []),
          plannedWordCount: chapterDraft.estimatedWords ?? null,
          isFinale: number === metadata.expectedChapterCount,
          createdBy: "AI" as const,
          status: "SUGGESTED" as const,
        };
        const existingChapterId = retainedChapterIds.get(number);
        if (existingChapterId) {
          await tx.chapterPlan.update({
            where: { id: existingChapterId },
            data: { ...plan, version: { increment: 1 } },
          });
        } else {
          await tx.chapterPlan.create({
            data: { projectId, number, ...plan },
          });
        }
      }
    }

    const persistedChapters = await tx.chapterPlan.findMany({
      where: { projectId },
      orderBy: { number: "asc" },
      select: { id: true, number: true, volumeId: true, isFinale: true },
    });
    const hasContinuousNumbers = persistedChapters.every(
      ({ number }, index) => number === index + 1,
    );
    const finales = persistedChapters.filter(({ isFinale }) => isFinale);
    const retainedIdsChanged = [...retainedChapterIds].some(
      ([number, id]) => persistedChapters[number - 1]?.id !== id,
    );
    if (
      persistedChapters.length !== metadata.expectedChapterCount ||
      !hasContinuousNumbers ||
      persistedChapters.some(({ volumeId }) => volumeId === null) ||
      finales.length !== 1 ||
      finales[0]?.number !== metadata.expectedChapterCount ||
      retainedIdsChanged
    ) {
      throw new Error("持久化后的章节数量或完结章标记不正确");
    }

    const storyBible = await tx.storyBible.findUniqueOrThrow({ where: { projectId } });
    const existingStyleGuide = asRecord(storyBible.styleGuide);
    await tx.storyBible.update({
      where: { projectId },
      data: {
        styleGuide: {
          ...existingStyleGuide,
          outlineEnding: draft.ending,
          generatedOutline: asJson(draft),
          outlineGeneratedAt: metadata.generatedAt,
          outlineGeneratedModel: metadata.generatedModel,
        } as Prisma.InputJsonValue,
      },
    });

    return getOutlineSummary(tx, projectId);
  }, {
    maxWait: 10_000,
    timeout: 60_000,
  });
}

export async function getOutlineSummary(
  db: Pick<Prisma.TransactionClient, "novelProject">,
  projectId: string,
) {
  const project = await db.novelProject.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      title: true,
      targetChapterCount: true,
      targetWordCount: true,
      storyBible: { select: { styleGuide: true } },
      volumes: {
        orderBy: { number: "asc" },
        select: {
          id: true,
          number: true,
          title: true,
          summary: true,
          goal: true,
          climax: true,
          endingCondition: true,
          plannedWordCount: true,
          chapters: {
            orderBy: { number: "asc" },
            select: {
              id: true,
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
            },
          },
        },
      },
    },
  });
  if (!project) return null;

  const styleGuide = asRecord(project.storyBible?.styleGuide);
  const generatedOutline = asRecord(styleGuide.generatedOutline);
  const ending = asText(styleGuide.outlineEnding ?? generatedOutline.ending);
  const volumeCount = project.volumes.length;
  const chapterCount = project.volumes.reduce((sum, volume) => sum + volume.chapters.length, 0);
  const volumeDetails = project.volumes.map((volume) => ({
    id: volume.id,
    number: volume.number,
    title: volume.title,
    summary: volume.summary,
    goal: volume.goal,
    climax: volume.climax,
    endingCondition: volume.endingCondition,
    plannedWordCount: volume.plannedWordCount,
    chapterCount: volume.chapters.length,
    chapters: volume.chapters.map((chapter) => ({
      ...chapter,
      order: chapter.number,
      result: chapter.expectedOutcome,
      requiredChange: asText(chapter.requiredChanges) || null,
      estimatedWords: chapter.plannedWordCount,
    })),
  }));
  return {
    projectId: project.id,
    title: project.title,
    targetChapterCount: project.targetChapterCount,
    targetWordCount: project.targetWordCount,
    ending: ending || null,
    // `volumes` and `chapters` are the compact fields consumed by the
    // dashboard. Keep the explicit names too for API clients that prefer
    // self-documenting counters.
    volumes: volumeCount,
    chapters: chapterCount,
    volumeCount,
    chapterCount,
    generatedAt: typeof styleGuide.outlineGeneratedAt === "string" ? styleGuide.outlineGeneratedAt : null,
    generatedModel: typeof styleGuide.outlineGeneratedModel === "string" ? styleGuide.outlineGeneratedModel : null,
    model: typeof styleGuide.outlineGeneratedModel === "string" ? styleGuide.outlineGeneratedModel : null,
    volumeDetails,
    volumePlans: volumeDetails,
  };
}
