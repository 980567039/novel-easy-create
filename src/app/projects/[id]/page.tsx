"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, BookOpen, CheckCircle2, Clock3, FileText, GitBranch, Sparkles } from "lucide-react";
import { apiFetch } from "@/lib/api-client";

interface ProjectSummary {
  id: string;
  title: string;
  genre?: string | null;
  targetWordCount?: number | null;
  targetChapterCount?: number | null;
  status?: string;
  storyBible?: { premise?: string | null; status?: string; styleGuide?: { generatedAt?: string } | null } | null;
}

interface OutlineSummary {
  ending?: string | null;
  volumeCount?: number;
  chapterCount?: number;
  targetChapterCount?: number | null;
  volumes?: number | Array<{ number: number; chapterCount: number }>;
  chapters?: number;
  generatedAt?: string | null;
  model?: string | null;
  generatedModel?: string | null;
  activeJob?: OutlineJob | null;
  volumeDetails?: VolumeDetail[];
}

interface ChapterDetail {
  number: number;
  title?: string | null;
  summary?: string | null;
  objective?: string | null;
  conflict?: string | null;
  expectedOutcome?: string | null;
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

type OutlineJobStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";

interface OutlineJob {
  id: string;
  status: OutlineJobStatus;
  progress: number;
  phase?: string | null;
  message?: string | null;
  error?: string | null;
  createdAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  currentVolume?: number | null;
  totalVolumes?: number | null;
  chapterStart?: number | null;
  chapterEnd?: number | null;
  generatedChapterCount?: number | null;
  targetChapterCount?: number | null;
}

type RawOutlineJob = Omit<Partial<OutlineJob>, "status"> & {
  jobId?: string | null;
  status?: string | null;
  currentVolumeNumber?: number | null;
  volumeNumber?: number | null;
  volumeCount?: number | null;
  totalVolumeCount?: number | null;
  chapterRangeStart?: number | null;
  chapterRangeEnd?: number | null;
  startChapter?: number | null;
  endChapter?: number | null;
  completedChapterCount?: number | null;
  generatedChapters?: number | null;
  targetChapters?: number | null;
};

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

function normalizeOutlineJob(value?: RawOutlineJob | null): OutlineJob | null {
  if (!value) return null;
  const id = value.id ?? value.jobId;
  if (!id) return null;
  const status = String(value.status ?? "RUNNING").toUpperCase() as OutlineJobStatus;
  return {
    id,
    status: ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"].includes(status) ? status : "RUNNING",
    progress: count(value.progress) ?? 0,
    phase: value.phase ?? null,
    message: value.message ?? null,
    error: value.error ?? null,
    createdAt: value.createdAt ?? null,
    startedAt: value.startedAt ?? null,
    finishedAt: value.finishedAt ?? null,
    currentVolume: firstCount(value.currentVolume, value.currentVolumeNumber, value.volumeNumber),
    totalVolumes: firstCount(value.totalVolumes, value.totalVolumeCount, value.volumeCount),
    chapterStart: firstCount(value.chapterStart, value.chapterRangeStart, value.startChapter),
    chapterEnd: firstCount(value.chapterEnd, value.chapterRangeEnd, value.endChapter),
    generatedChapterCount: firstCount(value.generatedChapterCount, value.generatedChapters, value.completedChapterCount),
    targetChapterCount: firstCount(value.targetChapterCount, value.targetChapters),
  };
}

function isActiveJob(job?: OutlineJob | null) {
  return Boolean(job && (job.status === "QUEUED" || job.status === "RUNNING"));
}

function formatElapsed(startedAt?: string | null, now = Date.now()) {
  if (!startedAt) return "0秒";
  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  if (seconds < 60) return `${seconds}秒`;
  return `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
}

function phaseLabel(phase?: string | null, status?: OutlineJobStatus) {
  if (phase === "queued" || status === "QUEUED") return "排队中";
  if (phase === "connecting") return "连接模型服务";
  if (phase === "planning" || phase === "planning_volumes" || phase === "generating_skeleton") return "正在规划全书和分卷骨架";
  if (phase === "generating_volume" || phase === "expanding") return "正在按卷扩展章节大纲";
  if (phase === "assembling") return "正在汇总各卷章节";
  if (phase === "running" || phase === "generating") return "模型正在规划卷章结构";
  if (phase === "validating") return "校验大纲结构";
  if (phase === "saving") return "写入数据库";
  if (status === "SUCCEEDED") return "生成完成";
  if (status === "FAILED") return "生成失败";
  if (status === "CANCELLED") return "已取消";
  return "处理中";
}

function outlineChapterTotal(value?: OutlineSummary | null) {
  return firstCount(value?.chapterCount, value?.chapters)
    ?? value?.volumeDetails?.reduce((sum, volume) => sum + (volume.chapters?.length ?? 0), 0)
    ?? 0;
}

function outlineVolumeTotal(value?: OutlineSummary | null) {
  return firstCount(value?.volumeCount, Array.isArray(value?.volumes) ? value.volumes.length : value?.volumes)
    ?? value?.volumeDetails?.length
    ?? 0;
}

function hasValidChapterSequence(value: OutlineSummary | null | undefined, expectedChapterCount: number) {
  const chapters = value?.volumeDetails?.flatMap((volume) => volume.chapters ?? []) ?? [];
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

function isCompleteOutline(value: OutlineSummary | null | undefined, targetChapterCount: number | null) {
  const chapterTotal = outlineChapterTotal(value);
  if (chapterTotal === 0) return false;
  if (targetChapterCount !== null) {
    return chapterTotal === targetChapterCount && hasValidChapterSequence(value, targetChapterCount);
  }
  return Boolean(value?.generatedAt) && hasValidChapterSequence(value, chapterTotal);
}

function pollingRetryDelay(failureCount: number) {
  return Math.min(15_000, 1_500 * (2 ** Math.min(failureCount, 4)));
}

function targetChapterTotal(project?: ProjectSummary | null, outline?: OutlineSummary | null, job?: OutlineJob | null) {
  const target = firstCount(project?.targetChapterCount, outline?.targetChapterCount, job?.targetChapterCount);
  return target && target > 0 ? target : null;
}

function jobScopeLabel(job: OutlineJob) {
  const volume = job.currentVolume;
  const totalVolumes = job.totalVolumes;
  const chapterStart = job.chapterStart;
  const chapterEnd = job.chapterEnd;
  if (volume !== null && volume !== undefined) {
    if (volume < 1) return null;
    const volumeText = totalVolumes ? `第 ${volume}/${totalVolumes} 卷` : `第 ${volume} 卷`;
    const rangeText = chapterStart !== null && chapterStart !== undefined && chapterEnd !== null && chapterEnd !== undefined
      ? `（第 ${chapterStart}–${chapterEnd} 章）`
      : "";
    return `正在生成${volumeText}${rangeText}`;
  }
  if (chapterStart !== null && chapterStart !== undefined && chapterEnd !== null && chapterEnd !== undefined) {
    return `正在生成第 ${chapterStart}–${chapterEnd} 章`;
  }
  return null;
}

function visibleProgress(job: OutlineJob, now: number) {
  if (job.phase !== "running" && job.phase !== "generating") return Math.min(100, Math.max(0, job.progress));
  if (job.progress > 10 || job.currentVolume) return Math.min(100, Math.max(0, job.progress));
  const startedAt = job.startedAt ?? job.createdAt;
  const elapsedSeconds = startedAt ? Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000)) : 0;
  return Math.min(55, Math.max(job.progress, 10 + Math.floor(elapsedSeconds / 5)));
}

export default function ProjectDashboardPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generatingBible, setGeneratingBible] = useState(false);
  const [generatingOutline, setGeneratingOutline] = useState(false);
  const [outline, setOutline] = useState<OutlineSummary | null>(null);
  const [outlineJob, setOutlineJob] = useState<OutlineJob | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [message, setMessage] = useState<string | null>(null);
  const [outlinePollingWarning, setOutlinePollingWarning] = useState<string | null>(null);
  const pollingJobId = outlineJob && isActiveJob(outlineJob) ? outlineJob.id : null;

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetch("/api/projects").then(async (response) => {
        const body = (await response.json()) as { projects?: ProjectSummary[]; error?: string };
        if (!response.ok) throw new Error(body.error ?? "无法加载项目");
        return body.projects?.find((item) => item.id === params.id) ?? null;
      }),
      apiFetch(`/api/projects/${params.id}/outline`).then(async (response) => {
        if (response.status === 404) return null;
        const body = (await response.json()) as { outline?: OutlineSummary | null; error?: string };
        if (!response.ok) throw new Error(body.error ?? "无法加载大纲状态");
        return body.outline ?? null;
      }),
    ])
      .then(([result, outlineResult]) => {
        if (!cancelled) {
          setProject(result);
          setOutline(outlineResult);
          const initialJob = normalizeOutlineJob(outlineResult?.activeJob as RawOutlineJob | null | undefined);
          if (initialJob) setOutlineJob(initialJob);
          if (isActiveJob(initialJob)) setGeneratingOutline(true);
        }
      })
      .catch((requestError: unknown) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : "无法加载项目");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [params.id]);

  useEffect(() => {
    if (!pollingJobId) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [pollingJobId]);

  useEffect(() => {
    if (!pollingJobId) return;
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
      setGeneratingOutline(true);
      setOutlinePollingWarning(`${reason}，将在 ${Math.ceil(retryDelay / 1000)} 秒后自动重试；生成任务仍可能在后台运行。`);
      scheduleNextPoll(retryDelay);
    };

    const poll = async () => {
      try {
        const response = await apiFetch(`/api/projects/${params.id}/outline/generate?jobId=${encodeURIComponent(pollingJobId)}`, { cache: "no-store" });
        const body = await response.json().catch(() => ({})) as { job?: RawOutlineJob; status?: RawOutlineJob; outline?: OutlineSummary; error?: string };
        if (response.status === 404) {
          if (cancelled) return;
          setOutlineJob(null);
          setGeneratingOutline(false);
          setOutlinePollingWarning(null);
          setError(body.error ?? "找不到这次大纲生成任务，自动刷新已停止，请重新发起生成。");
          return;
        }
        if (!response.ok) {
          retryPolling(body.error ?? `生成进度服务暂时不可用（HTTP ${response.status}）`);
          return;
        }
        const nextJob = normalizeOutlineJob(body.job ?? body.status);
        if (!nextJob) {
          retryPolling(body.error ?? "生成进度响应暂时不完整");
          return;
        }
        if (cancelled) return;
        consecutiveFailures = 0;
        setOutlinePollingWarning(null);
        setOutlineJob(nextJob);
        if (body.outline) setOutline(body.outline);
        if (nextJob.status === "SUCCEEDED") {
          let completedOutline = body.outline ?? null;
          if (!body.outline) {
            try {
              const outlineResponse = await apiFetch(`/api/projects/${params.id}/outline`, { cache: "no-store" });
              const outlineBody = await outlineResponse.json().catch(() => ({})) as { outline?: OutlineSummary };
              if (outlineResponse.ok && outlineBody.outline) {
                completedOutline = outlineBody.outline;
                setOutline(outlineBody.outline);
              }
            } catch {
              // The job has reached a terminal state; a manual refresh can recover the saved outline.
            }
          }
          setGeneratingOutline(false);
          const target = targetChapterTotal(project, completedOutline, nextJob);
          const generated = outlineChapterTotal(completedOutline);
          if (isCompleteOutline(completedOutline, target)) {
            setMessage(`完整章节大纲已生成，共 ${generated}${target ? ` / ${target}` : ""} 章，可以查看每一卷和每一章。`);
          } else if (generated > 0) {
            setMessage(`首版骨架已生成，目前 ${generated}${target ? ` / ${target}` : ""} 章；尚未达到完整章节大纲。`);
          } else {
            setMessage("大纲任务已结束，请刷新后检查生成内容。");
          }
          return;
        }
        if (nextJob.status === "FAILED" || nextJob.status === "CANCELLED") {
          setGeneratingOutline(false);
          setOutlinePollingWarning(null);
          setError(nextJob.error ?? "分层大纲生成失败，请重试。");
          return;
        }
        scheduleNextPoll(1500);
      } catch (requestError) {
        if (cancelled) return;
        retryPolling(requestError instanceof Error ? requestError.message : "暂时无法读取大纲生成进度");
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [pollingJobId, params.id, project]);

  const generateStoryBible = async () => {
    setGeneratingBible(true);
    setError(null);
    setMessage(null);
    try {
      const response = await apiFetch(`/api/projects/${params.id}/story-bible/generate`, { method: "POST" });
      const body = (await response.json()) as { storyBible?: ProjectSummary["storyBible"]; error?: string };
      if (!response.ok || !body.storyBible) throw new Error(body.error ?? "故事圣经生成失败");
      setProject((current) => current ? { ...current, storyBible: body.storyBible } : current);
      setMessage("故事圣经已生成，建议先确认人物和结局方向，再继续生成大纲。");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "故事圣经生成失败");
    } finally {
      setGeneratingBible(false);
    }
  };

  const generateOutline = async () => {
    if (!project?.storyBible?.styleGuide?.generatedAt) {
      setError("请先生成故事圣经，再生成分层大纲。");
      return;
    }
    setGeneratingOutline(true);
    setError(null);
    setMessage(null);
    setOutlinePollingWarning(null);
    try {
      const response = await apiFetch(`/api/projects/${params.id}/outline/generate`, { method: "POST" });
      const body = (await response.json()) as RawOutlineJob & { job?: RawOutlineJob; outline?: OutlineSummary; error?: string };
      const queuedJob = normalizeOutlineJob(body.job ?? body);
      if (response.status === 202 && queuedJob) {
        setOutlineJob(queuedJob);
        setMessage("任务已排队，下面会实时显示模型生成进度；你可以停留在此页等待。");
        return;
      }
      if (!response.ok || !body.outline) throw new Error(body.error ?? "分层大纲生成失败");
      setOutline(body.outline);
      setOutlineJob(null);
      const volumeCount = outlineVolumeTotal(body.outline);
      const chapterCount = outlineChapterTotal(body.outline);
      const target = targetChapterTotal(project, body.outline);
      setMessage(isCompleteOutline(body.outline, target)
        ? `完整章节大纲已生成，共 ${volumeCount} 卷、${chapterCount}${target ? ` / ${target}` : ""} 章。`
        : `首版骨架已生成，共 ${volumeCount} 卷、${chapterCount}${target ? ` / ${target}` : ""} 章，仍需继续扩展。`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "分层大纲生成失败");
    } finally {
      setGeneratingOutline(false);
    }
  };

  if (loading) {
    return <main className="flex min-h-[100dvh] items-center justify-center text-slate-500">正在加载项目...</main>;
  }

  if (!project) {
    return (
      <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-slate-600">{error ?? "项目不存在，或者数据库尚未连接。"}</p>
        <button type="button" onClick={() => router.push("/projects/new")} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white">新建项目</button>
      </main>
    );
  }

  const outlineVolumeCount = outlineVolumeTotal(outline);
  const outlineChapterCount = outlineChapterTotal(outline);
  const targetChapterCount = targetChapterTotal(project, outline, outlineJob);
  const hasOutlineContent = outlineVolumeCount > 0 || outlineChapterCount > 0;
  const outlineJobIsActive = isActiveJob(outlineJob);
  const outlineIsComplete = isCompleteOutline(outline, targetChapterCount);
  const outlineIsExpanding = outlineJobIsActive && hasOutlineContent && !outlineIsComplete;
  const visibleChapterCount = outlineJobIsActive ? Math.max(outlineChapterCount, outlineJob?.generatedChapterCount ?? 0) : outlineChapterCount;
  const outlineProgress = outlineJob ? visibleProgress(outlineJob, clock) : 0;
  const jobScope = outlineJobIsActive && outlineJob ? jobScopeLabel(outlineJob) : null;
  const outlineReadiness = targetChapterCount
    ? Math.min(1, outlineChapterCount / targetChapterCount)
    : outlineIsComplete ? 1 : 0;
  const healthProgress = project.storyBible?.styleGuide?.generatedAt ? 20 + Math.round(outlineReadiness * 20) : 0;

  return (
    <main className="min-h-[100dvh] bg-slate-50 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))] text-slate-900 sm:px-8 sm:py-8">
      <div className="mx-auto max-w-6xl">
        <button type="button" onClick={() => router.push("/")} className="mb-5 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-slate-500 hover:text-indigo-600 sm:mb-8">
          <ArrowLeft size={16} /> 返回首页
        </button>
        <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:mb-8 sm:flex-row">
          <div className="min-w-0">
            <p className="mb-2 text-sm font-semibold text-indigo-600">小说工作台</p>
            <h1 className="break-words text-2xl font-extrabold tracking-tight sm:text-4xl">{project.title}</h1>
            <p className="mt-2 max-w-2xl break-words leading-relaxed text-slate-500">{project.storyBible?.premise ?? "故事圣经尚未生成，下一步先把故事方向整理清楚。"}</p>
          </div>
          <button type="button" onClick={() => void generateStoryBible()} disabled={generatingBible} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-60 sm:w-auto sm:shrink-0">
            <Sparkles size={17} /> {generatingBible ? "生成中..." : project.storyBible?.styleGuide?.generatedAt ? "重新生成故事圣经" : "生成故事圣经"}
          </button>
        </div>

        {message && <div className="mb-6 rounded-xl bg-emerald-50 px-4 py-3 text-sm leading-relaxed text-emerald-700">{message}</div>}
        {error && <div className="mb-6 rounded-xl bg-rose-50 px-4 py-3 text-sm leading-relaxed text-rose-700">{error}</div>}

        {outlineJob && (
          <section className="mb-6 rounded-2xl border border-indigo-100 bg-white p-4 shadow-sm sm:p-5" aria-live="polite">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="rounded-xl bg-indigo-50 p-2.5 text-indigo-600"><Clock3 size={19} /></div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-indigo-600">{outlineIsExpanding ? "正在扩展完整章节大纲" : "分层大纲生成进度"}</p>
                  <p className="mt-1 break-words font-bold text-slate-900">{phaseLabel(outlineJob.phase, outlineJob.status)}</p>
                </div>
              </div>
              <div className="w-full text-left text-sm text-slate-500 sm:w-auto sm:text-right">
                <p className="font-bold text-slate-800">{outlineJob.phase === "running" || outlineJob.phase === "generating" ? "约 " : ""}{Math.round(outlineProgress)}%</p>
                <p>已用时 {formatElapsed(outlineJob.startedAt ?? outlineJob.createdAt, clock)}</p>
              </div>
            </div>
            <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full rounded-full transition-all ${outlineJob.status === "FAILED" ? "bg-rose-500" : outlineJob.status === "SUCCEEDED" ? "bg-emerald-500" : "bg-indigo-500"}`} style={{ width: `${Math.max(3, outlineProgress)}%` }} />
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
              {jobScope && <p className="font-semibold text-indigo-700">{jobScope}</p>}
              <p className="font-semibold text-slate-700">
                已生成 {visibleChapterCount}{targetChapterCount ? ` / ${targetChapterCount}` : ""} 章
              </p>
            </div>
            <p className="mt-3 break-words text-sm leading-relaxed text-slate-500">{outlineJob.message ?? "模型正在整理全书、分卷和章节关系，内容越长所需时间越久。"}</p>
            {outlinePollingWarning && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700">{outlinePollingWarning}</p>}
            {isActiveJob(outlineJob) && <p className="mt-2 text-xs text-slate-400">进度会自动刷新；即使暂时停在某个百分比，模型仍可能正在生成较长内容。</p>}
          </section>
        )}

        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-5 flex items-center justify-between">
              <div className="rounded-xl bg-indigo-50 p-2.5 text-indigo-600"><BookOpen size={20} /></div>
              {project.storyBible?.styleGuide?.generatedAt && <CheckCircle2 size={20} className="text-emerald-500" />}
            </div>
            <h2 className="font-bold text-slate-900">故事圣经</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">{project.storyBible?.styleGuide?.generatedAt ? "AI 已整理完成，等待你确认" : "把人物、世界和文风整理成一份可靠资料"}</p>
          </div>

          <div className="rounded-2xl border border-indigo-200 bg-white p-4 shadow-sm ring-1 ring-indigo-100 sm:p-5">
            <div className="mb-5 flex items-center justify-between">
              <div className="rounded-xl bg-indigo-50 p-2.5 text-indigo-600"><GitBranch size={20} /></div>
              {outlineIsComplete && !outlineJobIsActive && <CheckCircle2 size={20} className="text-emerald-500" />}
            </div>
            <h2 className="font-bold text-slate-900">分层大纲</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">
              {outlineIsExpanding
                ? `正在扩展到 ${targetChapterCount ?? "目标"} 章，当前已生成 ${visibleChapterCount}${targetChapterCount ? ` / ${targetChapterCount}` : ""} 章`
                : outlineIsComplete
                  ? `完整章节大纲已完成：${outlineVolumeCount} 卷，${outlineChapterCount}${targetChapterCount ? ` / ${targetChapterCount}` : ""} 章`
                  : hasOutlineContent
                    ? `首版骨架已生成：${outlineVolumeCount} 卷，${outlineChapterCount}${targetChapterCount ? ` / ${targetChapterCount}` : ""} 章，仍需扩展`
                    : outlineJobIsActive
                      ? `正在生成首版骨架：已生成 ${visibleChapterCount}${targetChapterCount ? ` / ${targetChapterCount}` : ""} 章`
                      : "全书、分卷、章节和场景计划"}
            </p>
            <button type="button" onClick={() => void generateOutline()} disabled={generatingOutline || outlineJobIsActive || !project.storyBible?.styleGuide?.generatedAt} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 sm:w-auto">
              <Sparkles size={15} /> {outlineJobIsActive || generatingOutline
                ? outlineIsExpanding ? "扩展中..." : "生成中..."
                : outlineIsComplete
                  ? "重新生成完整大纲"
                  : hasOutlineContent && targetChapterCount
                    ? `继续扩展到 ${targetChapterCount} 章`
                    : "生成分层大纲"}
            </button>
            {hasOutlineContent && <Link href={`/projects/${params.id}/outline`} className="mt-3 block text-sm font-semibold text-indigo-600 hover:text-indigo-700">{outlineIsComplete ? "查看完整大纲" : "查看当前大纲内容"} →</Link>}
            {!project.storyBible?.styleGuide?.generatedAt && <p className="mt-2 text-xs text-slate-400">请先完成故事圣经</p>}
          </div>

          <div className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 ${outlineIsComplete ? "" : "opacity-70"}`}>
            <div className="mb-5 flex items-center justify-between">
              <div className="rounded-xl bg-indigo-50 p-2.5 text-indigo-600"><FileText size={20} /></div>
              {outlineIsComplete && <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-600">即将开始</span>}
            </div>
            <h2 className="font-bold text-slate-900">章节创作</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">{outlineIsComplete ? "完整大纲已就绪，可以从第一章场景表开始" : hasOutlineContent ? `当前只有 ${outlineChapterCount}${targetChapterCount ? ` / ${targetChapterCount}` : ""} 章，扩展完成后再进入逐章创作` : "先完成分层大纲，再逐章写到完结"}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {outlineIsComplete && (
                <Link href={`/projects/${params.id}/chapters`} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
                  进入章节工作台 <ArrowRight size={15} />
                </Link>
              )}
              <Link href={`/projects/${params.id}/read`} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700">
                <BookOpen size={15} /> 预览小说
              </Link>
            </div>
          </div>
        </section>

        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:mt-8 sm:p-6">
          <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-500">完结健康度</p>
              <p className="mt-1 break-words text-xl font-extrabold text-slate-900 sm:text-2xl">{outlineIsComplete ? "完整章节大纲已完成" : hasOutlineContent ? "已有首版骨架，尚未完整" : project.storyBible?.styleGuide?.generatedAt ? "故事基础已完成" : "等待生成故事圣经"}</p>
            </div>
            <p className="text-sm text-slate-500">目标：{project.targetChapterCount ?? "—"} 章 · {project.targetWordCount ?? "—"} 字</p>
          </div>
          <div className="mt-5 h-3 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${healthProgress}%` }} /></div>
          <p className="mt-4 text-sm leading-relaxed text-slate-500">{outlineIsComplete
            ? `完整章节大纲已达到 ${outlineChapterCount}${targetChapterCount ? ` / ${targetChapterCount}` : ""} 章，下一步可以选择第一章并生成场景表。`
            : outlineIsExpanding
              ? `系统正在按卷扩展章节，目前 ${visibleChapterCount}${targetChapterCount ? ` / ${targetChapterCount}` : ""} 章；完成前不会进入章节创作。`
              : hasOutlineContent
                ? `当前内容是首版骨架，共 ${outlineChapterCount}${targetChapterCount ? ` / ${targetChapterCount}` : ""} 章，还不能视为完整长篇大纲。`
                : project.storyBible?.styleGuide?.generatedAt
                  ? "故事圣经已进入待确认状态，点击上方“生成分层大纲”继续。"
                  : "先生成故事圣经，系统才能继续生成大纲，并在后续章节中追踪人物状态、伏笔和收束风险。"}</p>
        </section>
      </div>
    </main>
  );
}
