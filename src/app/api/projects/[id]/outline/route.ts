import { NextResponse } from "next/server";

import {
  AiProviderError,
  getConfiguredAiProvider,
  OutlineBookSkeletonSchema,
  OutlineDraftSchema,
  OutlineVolumeDraftSchema,
  type AiProvider,
  type AiStructuredResult,
  type AiUsage,
  type OutlineDraft,
  type OutlineVolumeDraft,
} from "@/server/ai";
import { getDatabase } from "@/server/db";
import {
  buildOutlinePrompt,
  allocateVolumeChapterCounts,
  assertOutlineIntegrity,
  getOutlineProject,
  getOutlineGenerationStatus,
  getOutlineSummary,
  hasGeneratedStoryBible,
  normalizeOutlineSkeleton,
  replaceOutline,
  resolveTargetChapterCount,
  type OutlineVolumeSkeleton,
  updateOutlineGenerationJob,
} from "@/server/modules/outline/service";

export const runtime = "nodejs";

const ACTIVE_JOB_STALE_AFTER_MS = 15 * 60 * 1_000;

function databaseUnavailable() {
  return NextResponse.json(
    {
      code: "DATABASE_UNAVAILABLE",
      error: "数据库暂不可用，请配置 DATABASE_URL 并确认数据库已启动。",
    },
    { status: 503 },
  );
}

async function reserveOutlineGenerationJob(
  db: ReturnType<typeof getDatabase>,
  projectId: string,
  metadata: {
    totalVolumes: number;
    targetChapters: number;
  },
) {
  const message = `已排队，将生成 ${metadata.totalVolumes} 卷、共 ${metadata.targetChapters} 章。`;
  return db.$transaction(async (transaction) => {
    // PostgreSQL advisory locks make the active-job check and creation one
    // project-scoped critical section. Two simultaneous POSTs therefore
    // cannot both create billable outline jobs.
    await transaction.$queryRaw<Array<{ lock: string }>>`
      SELECT pg_advisory_xact_lock(hashtext(${`outline:${projectId}`}))::text AS lock
    `;

    const activeJobs = await transaction.generationJob.findMany({
      where: {
        projectId,
        type: "OUTLINE",
        status: { in: ["QUEUED", "RUNNING"] },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true, updatedAt: true },
    });
    const staleBefore = Date.now() - ACTIVE_JOB_STALE_AFTER_MS;
    for (const activeJob of activeJobs) {
      if (activeJob.updatedAt.getTime() >= staleBefore) {
        return { ...activeJob, reused: true as const };
      }
      const staleMessage = "大纲生成任务长时间没有进度，已自动结束；请重新生成。";
      await transaction.generationJob.update({
        where: { id: activeJob.id },
        data: {
          status: "FAILED",
          error: staleMessage,
          finishedAt: new Date(),
          output: {
            phase: "failed",
            stage: "failed",
            message: staleMessage,
          },
        },
      });
    }

    const created = await transaction.generationJob.create({
      data: {
        projectId,
        type: "OUTLINE",
        createdBy: "SYSTEM",
        status: "QUEUED",
        progress: 0,
        output: {
          phase: "queued",
          stage: "queued",
          message,
          currentVolume: 0,
          totalVolumes: metadata.totalVolumes,
          chapterStart: 1,
          chapterEnd: metadata.targetChapters,
          generatedChapters: 0,
          targetChapters: metadata.targetChapters,
          repairedChapters: 0,
        },
      },
      select: { id: true, createdAt: true, updatedAt: true },
    });
    return { ...created, reused: false as const };
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const db = getDatabase();
    const jobId = new URL(request.url).searchParams.get("jobId") ?? undefined;
    if (jobId) {
      const status = await getOutlineGenerationStatus(db, id, jobId);
      if (!status) {
        return NextResponse.json({ code: "PROJECT_NOT_FOUND", error: "小说项目不存在。" }, { status: 404 });
      }
      if (status.jobId === null) {
        return NextResponse.json({ code: "OUTLINE_JOB_NOT_FOUND", error: "大纲生成任务不存在。" }, { status: 404 });
      }
      const outline = status.status === "SUCCEEDED" ? await getOutlineSummary(db, id) : undefined;
      return NextResponse.json({ status, job: status, ...(outline ? { outline } : {}) });
    }
    const summary = await getOutlineSummary(db, id);
    if (!summary) {
      return NextResponse.json({ code: "PROJECT_NOT_FOUND", error: "小说项目不存在。" }, { status: 404 });
    }
    const activeJob = await getOutlineGenerationStatus(db, id);
    return NextResponse.json({ outline: { ...summary, activeJob: activeJob?.status === "QUEUED" || activeJob?.status === "RUNNING" ? activeJob : null } });
  } catch {
    console.error("[outline] summary failed");
    return databaseUnavailable();
  }
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let db: ReturnType<typeof getDatabase>;
  let project: Awaited<ReturnType<typeof getOutlineProject>>;
  try {
    db = getDatabase();
    project = await getOutlineProject(db, id);
  } catch {
    console.error("[outline] project lookup failed");
    return databaseUnavailable();
  }

  if (!project) {
    return NextResponse.json({ code: "PROJECT_NOT_FOUND", error: "小说项目不存在。" }, { status: 404 });
  }
  const storyBible = project.storyBible;
  if (!storyBible || !hasGeneratedStoryBible(storyBible)) {
    return NextResponse.json(
      { code: "STORY_BIBLE_NOT_READY", error: "请先生成故事圣经，再生成分层大纲。" },
      { status: 409 },
    );
  }

  let targetChapterCount: number;
  let chapterCounts: number[];
  try {
    targetChapterCount = resolveTargetChapterCount(project.targetChapterCount, project.targetWordCount);
    chapterCounts = allocateVolumeChapterCounts(targetChapterCount);
  } catch {
    return NextResponse.json(
      { code: "TARGET_CHAPTER_COUNT_UNSUPPORTED", error: "目标章节数无效或超出当前支持范围，请调整后重试。" },
      { status: 422 },
    );
  }

  let job: Awaited<ReturnType<typeof reserveOutlineGenerationJob>>;
  try {
    job = await reserveOutlineGenerationJob(db, id, {
      totalVolumes: chapterCounts.length,
      targetChapters: targetChapterCount,
    });
  } catch {
    console.error("[outline] job reservation failed");
    return databaseUnavailable();
  }

  if (job.reused) {
    try {
      const activeJob = await getOutlineGenerationStatus(db, id, job.id);
      if (!activeJob || activeJob.jobId === null) {
        console.error("[outline] reserved job disappeared");
        return databaseUnavailable();
      }
      return NextResponse.json(
        {
          job: activeJob,
          jobId: activeJob.jobId,
          status: activeJob.phase,
          phase: activeJob.phase,
          stage: activeJob.stage,
          progress: activeJob.progress,
          message: activeJob.message,
          reused: true,
        },
        { status: 202 },
      );
    } catch {
      console.error("[outline] active job lookup failed");
      return databaseUnavailable();
    }
  }

  const updateJob = async (...args: Parameters<typeof updateOutlineGenerationJob>) => {
    try {
      await updateOutlineGenerationJob(...args);
    } catch {
      // A status write must never expose provider details or hide the primary
      // generation result. The next status poll can still observe the last
      // successfully persisted stage.
      console.error("[outline] job status update failed");
    }
  };
  void runOutlineGeneration(db, id, project, storyBible, job.id, targetChapterCount, chapterCounts, updateJob);
  const queuedJob = {
    id: job.id,
    jobId: job.id,
    status: "QUEUED",
    phase: "queued",
    stage: "queued",
    progress: 0,
    message: `已排队，将生成 ${chapterCounts.length} 卷、共 ${targetChapterCount} 章。`,
    createdAt: job.createdAt.toISOString(),
    startedAt: null,
    finishedAt: null,
    error: null,
    currentVolume: 0,
    totalVolumes: chapterCounts.length,
    chapterStart: 1,
    chapterEnd: targetChapterCount,
    generatedChapters: 0,
    targetChapters: targetChapterCount,
    repairedChapters: 0,
  };
  return NextResponse.json(
    { job: queuedJob, jobId: job.id, status: "queued", phase: "queued", stage: "queued", progress: 0, message: queuedJob.message },
    { status: 202 },
  );
}

class OutlinePipelineError extends Error {}

type UpdateJob = (...args: Parameters<typeof updateOutlineGenerationJob>) => Promise<void>;

function addUsage(total: { input: number; output: number }, usage?: AiUsage) {
  total.input += usage?.promptTokens ?? 0;
  total.output += usage?.completionTokens ?? 0;
}

async function generateBookSkeleton(
  provider: AiProvider,
  storyContext: unknown,
  targetChapterCount: number,
  chapterCounts: number[],
) {
  let chapterStart = 1;
  const allocation = chapterCounts.map((chapterCount, index) => {
    const chapterEnd = chapterStart + chapterCount - 1;
    const item = { number: index + 1, chapterCount, chapterStart, chapterEnd };
    chapterStart = chapterEnd + 1;
    return item;
  });
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const result = await provider.generateStructured(
        {
          schemaName: "OutlineBookSkeleton",
          temperature: 0.2,
          maxTokens: 6_000,
          timeoutMs: 180_000,
          messages: [
            {
              role: "system",
              content: [
                "你是长篇小说总编。本阶段只生成全书结局和分卷骨架，不要生成章节列表。",
                "只返回 JSON 对象：{ending, volumes:[{number,title,goal,climax,endingCondition,chapterCount}]}。",
                `必须生成 ${chapterCounts.length} 卷，各卷 chapterCount 严格依次为 ${chapterCounts.join("、")}，总计 ${targetChapterCount} 章。`,
                "每卷必须承接上一卷，并为下一卷或全书结局建立明确因果；ending 要说明最终选择、代价和人物弧收束。",
                attempt === 2 ? "上一次输出未通过结构校验。本次务必完整输出全部必填字段和准确卷数。" : "字段保持精炼，避免重复故事圣经原文。",
              ].join("\n"),
            },
            { role: "user", content: JSON.stringify({ story: storyContext, targetChapterCount, allocation }) },
          ],
        },
        OutlineBookSkeletonSchema,
      );
      const allocationMatches = result.data.volumes.length === chapterCounts.length && result.data.volumes.every(
        (volume, index) => volume.number === index + 1 && volume.chapterCount === chapterCounts[index],
      );
      if (!allocationMatches) {
        lastError = new OutlinePipelineError(
          `分卷骨架应为 ${chapterCounts.length} 卷，且章节分配为 ${chapterCounts.join("、")}。`,
        );
        continue;
      }
      return result;
    } catch (error) {
      lastError = error;
      if (error instanceof AiProviderError && error.code !== "response") break;
    }
  }
  if (lastError instanceof AiProviderError && lastError.code === "aborted") {
    throw new OutlinePipelineError("生成全书分卷骨架超时（已等待 180 秒），请检查模型负载后重试。");
  }
  if (lastError instanceof AiProviderError && lastError.code !== "response") {
    throw lastError;
  }
  throw new OutlinePipelineError("全书分卷骨架连续两次未通过结构校验，请重试或调整故事圣经。");
}

async function requestVolumeChapters(
  provider: AiProvider,
  storyContext: unknown,
  skeleton: { ending: string; volumes: OutlineVolumeSkeleton[] },
  volume: OutlineVolumeSkeleton,
  estimatedWords: number | undefined,
  onRetry: (returnedCount: number | null) => Promise<void>,
) {
  let returnedCount: number | null = null;
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    if (attempt === 2) await onRetry(returnedCount);
    try {
      const result: AiStructuredResult<OutlineVolumeDraft> = await provider.generateStructured(
        {
          schemaName: "OutlineVolumeDraft",
          temperature: 0.2,
          maxTokens: 12_000,
          timeoutMs: 420_000,
          messages: [
            {
              role: "system",
              content: [
                "你是长篇小说分卷编剧。只规划当前一卷，不要重写其他卷或故事圣经。",
                "只返回 JSON 对象：{chapters:[{order,title,objective,conflict,result,requiredChange,estimatedWords}]}。",
                `chapters 必须准确包含 ${volume.chapterCount} 项，对应全书第 ${volume.chapterStart}-${volume.chapterEnd} 章，不能省略、合并或增加。`,
                "order 使用全书章号且连续；每章必须推动因果，并至少改变目标、关系、知识、资源、风险或伏笔中的一项。",
                "title 简洁；objective/conflict/result/requiredChange 各用一至三句，避免正文式长篇描写。",
                estimatedWords ? `每章 estimatedWords 约 ${estimatedWords} 字。` : "estimatedWords 使用合理的正整数。",
                attempt === 2 ? "上一次返回数量或结构不正确。这是唯一纠错重试，必须严格满足数量和字段契约。" : "保证相邻章节的结果与下一章目标形成因果链。",
              ].join("\n"),
            },
            {
              role: "user",
              content: JSON.stringify({
                story: storyContext,
                bookEnding: skeleton.ending,
                volumeBoundaries: skeleton.volumes.map(({ number, title, goal, endingCondition, chapterStart, chapterEnd }) => ({ number, title, goal, endingCondition, chapterStart, chapterEnd })),
                currentVolume: volume,
                previousAttemptChapterCount: returnedCount,
              }),
            },
          ],
        },
        OutlineVolumeDraftSchema,
      );
      returnedCount = result.data.chapters.length;
      lastError = undefined;
      if (returnedCount === volume.chapterCount) return result;
    } catch (error) {
      lastError = error;
      if (error instanceof AiProviderError && error.code !== "response") break;
    }
  }
  if (lastError instanceof AiProviderError && lastError.code === "aborted") {
    throw new OutlinePipelineError(`第${volume.number}卷（第${volume.chapterStart}-${volume.chapterEnd}章）生成超时（已等待 420 秒）。`);
  }
  if (lastError instanceof AiProviderError && lastError.code !== "response") {
    throw lastError;
  }
  if (returnedCount !== null) {
    throw new OutlinePipelineError(
      `第${volume.number}卷连续两次未精确返回 ${volume.chapterCount} 章（最近一次为 ${returnedCount} 章），任务已失败，旧大纲未被修改。`,
    );
  }
  throw new OutlinePipelineError(`第${volume.number}卷连续两次未返回可用章节结构，旧大纲未被修改。`);
}

function safePipelineMessage(error: unknown) {
  if (error instanceof OutlinePipelineError) return error.message;
  if (error instanceof AiProviderError && error.code === "aborted") return "模型响应超时，请降低模型负载后重试。";
  if (error instanceof AiProviderError && error.code === "configuration") return "AI 配置不可用，请检查模型、地址和 API Key 设置。";
  if (error instanceof AiProviderError && error.code === "response") return "模型返回的 JSON 结构不符合大纲要求，旧大纲未被修改。";
  if (error instanceof AiProviderError && error.code === "request") {
    const authenticationFailure = /(?:\b401\b|\b403\b|unauthori[sz]ed|forbidden|api[ _-]?key|authent(?:ication|ication failed)|鉴权|认证)/i.test(error.message);
    return authenticationFailure
      ? "AI 模型服务鉴权失败，请检查 API Key 和中转服务权限。"
      : "AI 模型服务请求失败，请检查 API 地址、网络和服务状态。";
  }
  return "长篇大纲管线执行失败，请检查 AI 设置后重试；旧大纲未被修改。";
}

async function runOutlineGeneration(
  db: ReturnType<typeof getDatabase>,
  id: string,
  project: NonNullable<Awaited<ReturnType<typeof getOutlineProject>>>,
  storyBible: NonNullable<NonNullable<Awaited<ReturnType<typeof getOutlineProject>>>["storyBible"]>,
  jobId: string,
  targetChapterCount: number,
  chapterCounts: number[],
  updateJob: UpdateJob,
) {
  const totalVolumes = chapterCounts.length;
  let generatedChapters = 0;
  const repairedChapters = 0;
  let currentVolume = 0;
  let generatedModel: string | null = null;
  const usage = { input: 0, output: 0 };
  try {
    await updateJob(db, jobId, "running", {
      progress: 3,
      startedAt: new Date(),
      currentVolume: 0,
      totalVolumes,
      chapterStart: 1,
      chapterEnd: targetChapterCount,
      generatedChapters,
      targetChapters: targetChapterCount,
      repairedChapters,
      message: `正在生成全书结局与 ${totalVolumes} 卷骨架。`,
    });
    let provider: AiProvider;
    try {
      provider = await getConfiguredAiProvider();
    } catch (error) {
      if (error instanceof AiProviderError) throw error;
      throw new AiProviderError("AI provider configuration unavailable", "configuration", error);
    }
    const storyContext: unknown = JSON.parse(buildOutlinePrompt({ ...project, storyBible }));
    const skeletonResult = await generateBookSkeleton(provider, storyContext, targetChapterCount, chapterCounts);
    addUsage(usage, skeletonResult.usage);
    generatedModel = skeletonResult.model ?? null;
    const skeleton = normalizeOutlineSkeleton(skeletonResult.data, chapterCounts);
    const estimatedWords = project.targetWordCount
      ? Math.max(500, Math.round(project.targetWordCount / targetChapterCount))
      : undefined;
    const volumes: OutlineDraft["volumes"] = [];

    for (const volume of skeleton.volumes) {
      currentVolume = volume.number;
      const startProgress = 10 + Math.floor(((volume.number - 1) / totalVolumes) * 74);
      await updateJob(db, jobId, "running", {
        progress: startProgress,
        model: generatedModel,
        currentVolume: volume.number,
        totalVolumes,
        chapterStart: volume.chapterStart,
        chapterEnd: volume.chapterEnd,
        generatedChapters,
        targetChapters: targetChapterCount,
        repairedChapters,
        message: `正在生成第 ${volume.number}/${totalVolumes} 卷（第 ${volume.chapterStart}-${volume.chapterEnd} 章，共 ${volume.chapterCount} 章）。`,
      });
      const volumeResult = await requestVolumeChapters(
        provider,
        storyContext,
        skeleton,
        volume,
        estimatedWords,
        async (returnedCount) => {
          await updateJob(db, jobId, "running", {
            progress: startProgress,
            currentVolume: volume.number,
            totalVolumes,
            chapterStart: volume.chapterStart,
            chapterEnd: volume.chapterEnd,
            generatedChapters,
            targetChapters: targetChapterCount,
            repairedChapters,
            message: returnedCount === null
              ? `第 ${volume.number}/${totalVolumes} 卷首次输出无效，正在进行一次结构纠错重试。`
              : `第 ${volume.number}/${totalVolumes} 卷应为 ${volume.chapterCount} 章，模型返回 ${returnedCount} 章，正在重试一次。`,
          });
        },
      );
      addUsage(usage, volumeResult.usage);
      generatedModel = volumeResult.model ?? generatedModel;
      // Count and content already passed the strict schema. Only global order
      // is canonicalized; no chapter text is filled, truncated, or invented.
      const chapters = volumeResult.data.chapters.map((chapter, index) => ({
        ...chapter,
        order: volume.chapterStart + index,
      }));
      generatedChapters += chapters.length;
      volumes.push({
        title: volume.title,
        goal: volume.goal,
        climax: volume.climax,
        endingCondition: volume.endingCondition,
        chapters,
      });
      const endProgress = 10 + Math.floor((volume.number / totalVolumes) * 74);
      await updateJob(db, jobId, "running", {
        progress: endProgress,
        model: generatedModel,
        currentVolume: volume.number,
        totalVolumes,
        chapterStart: volume.chapterStart,
        chapterEnd: volume.chapterEnd,
        generatedChapters,
        targetChapters: targetChapterCount,
        repairedChapters,
        message: `第 ${volume.number}/${totalVolumes} 卷已完成：第 ${volume.chapterStart}-${volume.chapterEnd} 章。`,
      });
    }

    let draft: OutlineDraft;
    try {
      draft = OutlineDraftSchema.parse({ ending: skeleton.ending, volumes });
      assertOutlineIntegrity(draft, targetChapterCount);
    } catch {
      throw new OutlinePipelineError(`最终校验失败：应生成 ${targetChapterCount} 章且编号连续 1-${targetChapterCount}，旧大纲未被修改。`);
    }
    await updateJob(db, jobId, "validating", {
      progress: 90,
      model: generatedModel,
      currentVolume,
      totalVolumes,
      generatedChapters,
      targetChapters: targetChapterCount,
      repairedChapters,
      message: `已生成 ${generatedChapters}/${targetChapterCount} 章，正在验证全局编号、卷边界和完结章。`,
    });
    await updateJob(db, jobId, "saving", {
      progress: 95,
      model: generatedModel,
      generatedChapters,
      targetChapters: targetChapterCount,
      repairedChapters,
      message: `校验通过：共 ${totalVolumes} 卷、${targetChapterCount} 章，正在事务保存。`,
    });
    try {
      await replaceOutline(db, id, draft, {
        generatedAt: new Date().toISOString(),
        generatedModel,
        expectedChapterCount: targetChapterCount,
      });
    } catch {
      throw new OutlinePipelineError("大纲保存失败，数据库事务已回滚，旧大纲未被修改。");
    }
    await updateJob(db, jobId, "succeeded", {
      progress: 100,
      model: generatedModel,
      finishedAt: new Date(),
      currentVolume: totalVolumes,
      totalVolumes,
      chapterStart: skeleton.volumes.at(-1)?.chapterStart,
      chapterEnd: targetChapterCount,
      generatedChapters,
      targetChapters: targetChapterCount,
      repairedChapters,
      tokensInput: usage.input || undefined,
      tokensOutput: usage.output || undefined,
      message: `长篇大纲已完成：${totalVolumes} 卷、${generatedChapters}/${targetChapterCount} 章，编号连续 1-${targetChapterCount}。`,
    });
  } catch (error) {
    console.error("[outline] generation failed");
    const message = safePipelineMessage(error);
    await updateJob(db, jobId, "failed", {
      error: message,
      message,
      finishedAt: new Date(),
      currentVolume,
      totalVolumes,
      generatedChapters,
      targetChapters: targetChapterCount,
      repairedChapters,
      tokensInput: usage.input || undefined,
      tokensOutput: usage.output || undefined,
    });
  }
}
