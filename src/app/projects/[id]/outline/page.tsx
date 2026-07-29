"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, BookOpen, Clock3, RefreshCw, Sparkles } from "lucide-react";
import { apiFetch } from "@/lib/api-client";

interface ChapterDetail {
  number: number;
  title?: string | null;
  summary?: string | null;
  objective?: string | null;
  conflict?: string | null;
  expectedOutcome?: string | null;
  result?: string | null;
  requiredChanges?: unknown;
  plannedWordCount?: number | null;
  isFinale?: boolean;
}

interface VolumeDetail {
  number: number;
  title?: string | null;
  summary?: string | null;
  goal?: string | null;
  climax?: string | null;
  endingCondition?: string | null;
  plannedWordCount?: number | null;
  chapters?: ChapterDetail[];
}

interface OutlineData {
  title?: string | null;
  ending?: string | null;
  volumeCount?: number;
  chapterCount?: number;
  chapters?: number;
  targetChapterCount?: number | null;
  generatedAt?: string | null;
  generatedModel?: string | null;
  volumeDetails?: VolumeDetail[];
  volumePlans?: VolumeDetail[];
  activeJob?: OutlineProgressJob | null;
}

interface OutlineProgressJob {
  id?: string | null;
  jobId?: string | null;
  status?: string | null;
  phase?: string | null;
  progress?: number | null;
  message?: string | null;
  currentVolume?: number | null;
  currentVolumeNumber?: number | null;
  volumeNumber?: number | null;
  totalVolumes?: number | null;
  totalVolumeCount?: number | null;
  volumeCount?: number | null;
  chapterStart?: number | null;
  chapterRangeStart?: number | null;
  startChapter?: number | null;
  chapterEnd?: number | null;
  chapterRangeEnd?: number | null;
  endChapter?: number | null;
  generatedChapters?: number | null;
  generatedChapterCount?: number | null;
  completedChapterCount?: number | null;
  targetChapters?: number | null;
  targetChapterCount?: number | null;
}

interface ProjectTarget {
  id: string;
  targetChapterCount?: number | null;
}

function count(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

function firstCount(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = count(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function outlineChapterTotal(outline: OutlineData | null, volumes: VolumeDetail[]) {
  return firstCount(outline?.chapterCount, outline?.chapters)
    ?? volumes.reduce((sum, volume) => sum + (volume.chapters?.length ?? 0), 0);
}

function hasValidChapterSequence(volumes: VolumeDetail[], expectedChapterCount: number) {
  const chapters = volumes.flatMap((volume) => volume.chapters ?? []);
  if (chapters.length === 0) return true;
  if (chapters.length !== expectedChapterCount) return false;

  const chapterNumbers = new Set(chapters.map((chapter) => chapter.number));
  if (chapterNumbers.size !== expectedChapterCount) return false;
  for (let chapterNumber = 1; chapterNumber <= expectedChapterCount; chapterNumber += 1) {
    if (!chapterNumbers.has(chapterNumber)) return false;
  }

  const finales = chapters.filter((chapter) => chapter.isFinale === true);
  return finales.length === 1 && finales[0]?.number === expectedChapterCount;
}

function isCompleteOutline(outline: OutlineData | null, volumes: VolumeDetail[], targetChapterCount: number | null) {
  const chapterTotal = outlineChapterTotal(outline, volumes);
  if (chapterTotal === 0) return false;
  if (targetChapterCount !== null) {
    return chapterTotal === targetChapterCount && hasValidChapterSequence(volumes, targetChapterCount);
  }
  return Boolean(outline?.generatedAt) && hasValidChapterSequence(volumes, chapterTotal);
}

function pollingRetryDelay(failureCount: number) {
  return Math.min(15_000, 1_500 * (2 ** Math.min(failureCount, 4)));
}

function isActiveJob(job?: OutlineProgressJob | null) {
  const status = job?.status?.toUpperCase();
  return status === "QUEUED" || status === "RUNNING" || job?.phase === "queued" || job?.phase === "running" || job?.phase === "generating" || job?.phase === "generating_volume" || job?.phase === "expanding" || job?.phase === "planning" || job?.phase === "planning_volumes" || job?.phase === "generating_skeleton" || job?.phase === "assembling" || job?.phase === "validating" || job?.phase === "saving";
}

function jobScopeLabel(job?: OutlineProgressJob | null) {
  const volume = firstCount(job?.currentVolume, job?.currentVolumeNumber, job?.volumeNumber);
  const totalVolumes = firstCount(job?.totalVolumes, job?.totalVolumeCount, job?.volumeCount);
  const chapterStart = firstCount(job?.chapterStart, job?.chapterRangeStart, job?.startChapter);
  const chapterEnd = firstCount(job?.chapterEnd, job?.chapterRangeEnd, job?.endChapter);
  if (volume !== null) {
    if (volume < 1) return null;
    const volumeText = totalVolumes ? `第 ${volume}/${totalVolumes} 卷` : `第 ${volume} 卷`;
    const rangeText = chapterStart !== null && chapterEnd !== null ? `（第 ${chapterStart}–${chapterEnd} 章）` : "";
    return `正在生成${volumeText}${rangeText}`;
  }
  if (chapterStart !== null && chapterEnd !== null) return `正在生成第 ${chapterStart}–${chapterEnd} 章`;
  return null;
}

function display(value: unknown, fallback = "暂未填写"): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const text = value.map((item) => display(item, "")).filter(Boolean).join("、");
    return text || fallback;
  }
  if (value && typeof value === "object") {
    const text = Object.values(value as Record<string, unknown>).map((item) => display(item, "")).filter(Boolean).join("、");
    return text || fallback;
  }
  return fallback;
}

function formatDate(value?: string | null) {
  if (!value) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function OutlinePage() {
  const params = useParams<{ id: string }>();
  const [outline, setOutline] = useState<OutlineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectTargetChapterCount, setProjectTargetChapterCount] = useState<number | null>(null);
  const [outlinePollingWarning, setOutlinePollingWarning] = useState<string | null>(null);
  const [outlinePollingStopped, setOutlinePollingStopped] = useState(false);

  const loadOutline = useCallback(async (background = false) => {
    if (background) setRefreshing(true);
    else setLoading(true);
    setError(null);
    setOutlinePollingWarning(null);
    try {
      const response = await apiFetch(`/api/projects/${params.id}/outline`, { cache: "no-store" });
      const body = await response.json().catch(() => ({})) as { outline?: OutlineData; error?: string };
      if (response.status === 404) {
        setOutlinePollingStopped(true);
        throw new Error(body.error ?? "找不到大纲，自动刷新已停止。");
      }
      if (!response.ok || !body.outline) throw new Error(body.error ?? "无法读取大纲");
      setOutline(body.outline);
      setOutlinePollingStopped(false);
      const responseTarget = count(body.outline.targetChapterCount);
      if (responseTarget && responseTarget > 0) setProjectTargetChapterCount(responseTarget);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "无法读取大纲");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [params.id]);

  useEffect(() => {
    void loadOutline();
  }, [loadOutline]);

  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/projects", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as { projects?: ProjectTarget[] };
        if (!response.ok) return;
        const target = count(body.projects?.find((project) => project.id === params.id)?.targetChapterCount);
        if (!cancelled && target && target > 0) setProjectTargetChapterCount(target);
      })
      .catch(() => {
        // The outline remains readable if the lightweight project lookup fails.
      });
    return () => { cancelled = true; };
  }, [params.id]);

  const outlineJobIsActive = isActiveJob(outline?.activeJob);
  const pollingOutlineJobId = outlineJobIsActive
    ? outline?.activeJob?.id ?? outline?.activeJob?.jobId ?? "active-outline-job"
    : null;

  useEffect(() => {
    if (!pollingOutlineJobId || outlinePollingStopped) return;
    let cancelled = false;
    let timer: number | undefined;
    let consecutiveFailures = 0;

    const scheduleNextPoll = (delay: number) => {
      if (!cancelled) timer = window.setTimeout(() => void poll(), delay);
    };

    const retryPolling = (reason: string) => {
      if (cancelled) return;
      consecutiveFailures += 1;
      const retryDelay = pollingRetryDelay(consecutiveFailures - 1);
      setOutlinePollingWarning(`${reason}，将在 ${Math.ceil(retryDelay / 1000)} 秒后自动重试；当前内容和生成任务均已保留。`);
      scheduleNextPoll(retryDelay);
    };

    const poll = async () => {
      try {
        const response = await apiFetch(`/api/projects/${params.id}/outline`, { cache: "no-store" });
        const body = await response.json().catch(() => ({})) as { outline?: OutlineData; error?: string };
        if (response.status === 404) {
          if (cancelled) return;
          setOutlinePollingStopped(true);
          setOutlinePollingWarning(body.error ?? "找不到大纲，自动刷新已停止；可稍后点击“刷新大纲”重试。");
          return;
        }
        if (!response.ok) {
          retryPolling(body.error ?? `大纲进度服务暂时不可用（HTTP ${response.status}）`);
          return;
        }
        if (!body.outline) {
          retryPolling(body.error ?? "大纲进度响应暂时不完整");
          return;
        }
        if (cancelled) return;

        consecutiveFailures = 0;
        setOutlinePollingWarning(null);
        setError(null);
        setOutline(body.outline);
        const responseTarget = count(body.outline.targetChapterCount);
        if (responseTarget && responseTarget > 0) setProjectTargetChapterCount(responseTarget);
        if (isActiveJob(body.outline.activeJob)) scheduleNextPoll(1500);
      } catch (requestError) {
        if (cancelled) return;
        retryPolling(requestError instanceof Error ? requestError.message : "暂时无法读取大纲生成进度");
      }
    };

    scheduleNextPoll(1500);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [outlinePollingStopped, params.id, pollingOutlineJobId]);

  if (loading) {
    return <main className="flex min-h-[100dvh] items-center justify-center text-slate-500">正在加载大纲...</main>;
  }

  const volumes = outline?.volumeDetails ?? outline?.volumePlans ?? [];
  const generatedChapterCount = outlineChapterTotal(outline, volumes);
  const targetChapterCount = firstCount(projectTargetChapterCount, outline?.targetChapterCount);
  const validTargetChapterCount = targetChapterCount && targetChapterCount > 0 ? targetChapterCount : null;
  const outlineIsComplete = isCompleteOutline(outline, volumes, validTargetChapterCount);
  const outlineIsExpanding = outlineJobIsActive && generatedChapterCount > 0 && !outlineIsComplete;
  const jobGeneratedChapterCount = firstCount(outline?.activeJob?.generatedChapters, outline?.activeJob?.generatedChapterCount, outline?.activeJob?.completedChapterCount) ?? 0;
  const visibleGeneratedChapterCount = Math.max(generatedChapterCount, jobGeneratedChapterCount);
  const activeJobProgress = Math.min(100, Math.max(0, count(outline?.activeJob?.progress) ?? 0));
  const activeJobScope = outlineJobIsActive ? jobScopeLabel(outline?.activeJob) : null;

  return (
    <main className="min-h-[100dvh] bg-slate-50 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))] text-slate-900 sm:px-8 sm:py-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-2 sm:mb-8 sm:gap-4">
          <Link href={`/projects/${params.id}`} className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-slate-500 hover:text-indigo-600">
            <ArrowLeft size={16} /> 返回项目工作台
          </Link>
          <button type="button" onClick={() => void loadOutline(true)} disabled={refreshing} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-white hover:text-indigo-600 disabled:opacity-50">
            <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} /> 刷新大纲
          </button>
        </div>

        {error && <div className="mb-6 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
        {outlinePollingWarning && <div className="mb-6 rounded-xl bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-700" aria-live="polite">{outlinePollingWarning}</div>}

        {!error && outline && volumes.length === 0 && (
          <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-4 text-center shadow-sm sm:p-12">
            <BookOpen className="mx-auto text-slate-400" size={30} />
            <h1 className="mt-4 text-xl font-bold">{outlineJobIsActive ? "正在生成首版骨架" : "大纲还没有生成"}</h1>
            <p className="mt-2 text-sm text-slate-500">{outlineJobIsActive ? `当前已生成 ${visibleGeneratedChapterCount}${validTargetChapterCount ? ` / ${validTargetChapterCount}` : ""} 章，页面会自动刷新。` : "返回工作台，点击“生成分层大纲”开始。"}</p>
            {outlineJobIsActive && (
              <div className="mx-auto mt-5 max-w-md">
                <div className="h-2.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${Math.max(3, activeJobProgress)}%` }} /></div>
                <p className="mt-3 text-xs text-slate-400">{activeJobScope ?? outline.activeJob?.message ?? "模型正在规划全书和分卷结构。"}</p>
              </div>
            )}
            <Link href={`/projects/${params.id}`} className="mt-6 inline-flex rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white">返回工作台</Link>
          </section>
        )}

        {outline && volumes.length > 0 && (
          <>
            <header className="mb-8">
              <p className="mb-2 text-sm font-semibold text-indigo-600">{outlineIsExpanding ? "分层大纲 · 正在扩展" : outlineIsComplete ? "分层大纲 · 完整章节版" : "分层大纲 · 首版骨架"}</p>
              <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end sm:gap-4">
                <div className="min-w-0">
                  <h1 className="break-words text-2xl font-extrabold tracking-tight sm:text-4xl">{outline.title ?? "未命名小说"}</h1>
                  <p className="mt-2 text-sm text-slate-500">{outline.volumeCount ?? volumes.length} 卷 · 已生成 {generatedChapterCount}{validTargetChapterCount ? ` / ${validTargetChapterCount}` : ""} 章</p>
                </div>
                <div className="break-all text-left text-xs text-slate-400 sm:shrink-0 sm:text-right">
                  <p className="inline-flex items-center gap-1"><Clock3 size={13} /> {formatDate(outline.generatedAt)}</p>
                  {outline.generatedModel && <p className="mt-1">模型：{outline.generatedModel}</p>}
                </div>
              </div>
            </header>

            <section className={`mb-6 rounded-2xl border p-4 sm:mb-8 sm:p-5 ${outlineJobIsActive ? "border-indigo-200 bg-indigo-50/70" : outlineIsComplete ? "border-emerald-200 bg-emerald-50/70" : "border-amber-200 bg-amber-50/70"}`} aria-live="polite">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className={`text-sm font-bold ${outlineJobIsActive ? "text-indigo-700" : outlineIsComplete ? "text-emerald-700" : "text-amber-700"}`}>
                    {outlineIsExpanding ? `正在扩展到 ${validTargetChapterCount ?? "目标"} 章` : outlineJobIsActive ? "正在生成首版骨架" : outlineIsComplete ? "完整章节大纲已完成" : "当前是首版骨架，尚未形成完整长篇大纲"}
                  </p>
                  <p className="mt-2 break-words text-sm leading-6 text-slate-600">
                    {outlineJobIsActive
                      ? `生成进度：${visibleGeneratedChapterCount}${validTargetChapterCount ? ` / ${validTargetChapterCount}` : ""} 章${activeJobScope ? `；${activeJobScope}` : ""}`
                      : outlineIsComplete
                        ? `共 ${generatedChapterCount}${validTargetChapterCount ? ` / ${validTargetChapterCount}` : ""} 章，章节编号和内容可以在下方逐卷检查。`
                        : `当前可查看 ${generatedChapterCount}${validTargetChapterCount ? ` / ${validTargetChapterCount}` : ""} 章，请返回工作台继续扩展。`}
                  </p>
                </div>
                {!outlineIsComplete && !outlineJobIsActive && <Link href={`/projects/${params.id}`} className="inline-flex min-h-11 items-center rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-700">返回工作台继续扩展</Link>}
              </div>
              {outlineJobIsActive && (
                <>
                  <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-white/80"><div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${Math.max(3, activeJobProgress)}%` }} /></div>
                  <p className="mt-2 text-xs leading-5 text-indigo-600">{outline.activeJob?.message ?? "系统会按卷生成章节，完成后自动刷新本页内容。"}</p>
                </>
              )}
            </section>

            <section className="mb-6 rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4 sm:mb-8 sm:p-6">
              <div className="flex items-center gap-2 text-sm font-bold text-indigo-700"><Sparkles size={16} /> 全书结局方向</div>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-700">{display(outline.ending)}</p>
            </section>

            <section className="space-y-5">
              {volumes.map((volume) => (
                <details key={volume.number} open className="group rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <summary className="cursor-pointer list-none px-4 py-4 sm:px-6 sm:py-5 [&::-webkit-details-marker]:hidden">
                    <div className="flex flex-col items-start gap-3 sm:flex-row sm:justify-between sm:gap-4">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-wider text-indigo-500">第 {volume.number} 卷</p>
                        <h2 className="mt-1 break-words text-xl font-extrabold">{display(volume.title, `第${volume.number}卷`)}</h2>
                        <p className="mt-2 break-words text-sm text-slate-500">{volume.chapters?.length ?? 0} 章 · {display(volume.goal, "本卷目标待确认")}</p>
                      </div>
                      <span className="inline-flex min-h-11 shrink-0 items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500 group-open:bg-indigo-50 group-open:text-indigo-600">展开 / 收起</span>
                    </div>
                  </summary>

                  <div className="border-t border-slate-100 px-4 py-4 sm:px-6 sm:py-5">
                    <div className="grid gap-4 text-sm md:grid-cols-3">
                      <div><p className="font-semibold text-slate-500">本卷高潮</p><p className="mt-1 leading-6 text-slate-700">{display(volume.climax)}</p></div>
                      <div><p className="font-semibold text-slate-500">结束条件</p><p className="mt-1 leading-6 text-slate-700">{display(volume.endingCondition)}</p></div>
                      <div><p className="font-semibold text-slate-500">预计字数</p><p className="mt-1 leading-6 text-slate-700">{volume.plannedWordCount ? `${volume.plannedWordCount} 字` : "待规划"}</p></div>
                    </div>

                    <div className="mt-6 space-y-3">
                      {(volume.chapters ?? []).map((chapter) => (
                        <article key={chapter.number} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 sm:p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-indigo-500">第 {chapter.number} 章{chapter.isFinale ? " · 全书终章" : ""}</p>
                              <h3 className="mt-1 break-words font-bold text-slate-900">{display(chapter.title, `第${chapter.number}章`)}</h3>
                            </div>
                            {chapter.plannedWordCount && <span className="text-xs text-slate-400">约 {chapter.plannedWordCount} 字</span>}
                          </div>
                          <div className="mt-3 grid gap-3 text-sm md:grid-cols-3">
                            <div><p className="font-semibold text-slate-500">本章目标</p><p className="mt-1 leading-6 text-slate-700">{display(chapter.objective)}</p></div>
                            <div><p className="font-semibold text-slate-500">主要冲突</p><p className="mt-1 leading-6 text-slate-700">{display(chapter.conflict)}</p></div>
                            <div><p className="font-semibold text-slate-500">预期结果</p><p className="mt-1 leading-6 text-slate-700">{display(chapter.expectedOutcome ?? chapter.result ?? chapter.summary)}</p></div>
                          </div>
                          <p className="mt-3 break-words border-t border-slate-200 pt-3 text-xs leading-5 text-slate-500">状态变化：{display(chapter.requiredChanges)}</p>
                        </article>
                      ))}
                    </div>
                  </div>
                </details>
              ))}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
