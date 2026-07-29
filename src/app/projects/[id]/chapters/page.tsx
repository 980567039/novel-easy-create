"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import {
  ArrowLeft,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileText,
  LoaderCircle,
  Save,
  Sparkles,
  WandSparkles,
} from "lucide-react";

type ChapterStatus = "SUGGESTED" | "DRAFT" | "REVIEWING" | "FINAL" | "ARCHIVED" | string;

interface Chapter {
  id: string;
  number: number;
  title: string;
  summary?: string | null;
  objective?: string | null;
  conflict?: string | null;
  expectedOutcome?: string | null;
  requiredChanges?: unknown;
  plannedWordCount?: number | null;
  status?: ChapterStatus;
  volumeNumber?: number;
  volumeTitle?: string | null;
  content?: string | null;
  wordCount?: number | null;
  revisionStatus?: ChapterStatus | null;
  scenePlan?: ScenePlan | null;
  latestRevision?: { id?: string; content?: string; wordCount?: number | null; status?: string } | null;
}

interface ScenePlan {
  chapterPromise?: string | null;
  endingState?: string | null;
  setting?: string | null;
  viewpoint?: string | null;
  beats?: Array<{ title?: string | null; description?: string | null }>;
  scenes?: Array<{ order?: number; title?: string; setting?: string; time?: string; participants?: string[]; objective?: string; obstacle?: string; actions?: string[]; turningPoint?: string; outcome?: string; estimatedWords?: number }>;
}

interface Project {
  id: string;
  title: string;
  targetWordCount?: number | null;
  targetChapterCount?: number | null;
}

interface VolumeDetail {
  id: string;
  number: number;
  title?: string | null;
  chapters?: Chapter[];
}

type BatchCount = 5 | 10 | 20 | 50 | "all";

interface BatchDraftJob {
  id: string;
  status?: string;
  progress?: number | null;
  output?: unknown;
  error?: string | null;
}

interface BatchDraftResponse {
  job?: BatchDraftJob | null;
  remainingCount?: number;
  reused?: boolean;
  error?: string;
  message?: string;
}

const statusLabel: Record<string, string> = {
  SUGGESTED: "待开始",
  DRAFT: "草稿",
  REVIEWING: "待检查",
  FINAL: "已定稿",
  ARCHIVED: "已归档",
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizedStatus(value: unknown) {
  return typeof value === "string" ? value.toLowerCase() : "idle";
}

function isActiveBatchStatus(value: unknown) {
  const status = normalizedStatus(value);
  return status === "queued" || status === "running";
}

function normalizeChapter(value: unknown, volume?: VolumeDetail): Chapter | null {
  const item = asRecord(value);
  if (typeof item.id !== "string" || typeof item.number !== "number") return null;
  const revision = asRecord(item.latestRevision ?? item.revision);
  return {
    id: item.id,
    number: item.number,
    title: asText(item.title) ?? `第 ${item.number} 章`,
    summary: asText(item.summary),
    objective: asText(item.objective),
    conflict: asText(item.conflict),
    expectedOutcome: asText(item.expectedOutcome),
    requiredChanges: item.requiredChanges,
    plannedWordCount: typeof item.plannedWordCount === "number" ? item.plannedWordCount : null,
    status: typeof item.status === "string" ? item.status : "SUGGESTED",
    volumeNumber: volume?.number,
    volumeTitle: volume?.title,
    content: asText(item.content) ?? asText(revision.content),
    wordCount: typeof item.wordCount === "number" ? item.wordCount : typeof revision.wordCount === "number" ? revision.wordCount : null,
    revisionStatus: typeof revision.status === "string" ? revision.status : null,
    scenePlan: item.scenePlan ? asRecord(item.scenePlan) as ScenePlan : null,
    latestRevision: asRecord(item.latestRevision) as Chapter["latestRevision"],
  };
}

function wordCount(value: string) {
  return value.trim() ? value.trim().split(/\s+/).join("").length : 0;
}

function localDraftKey(projectId: string, chapterId: string) {
  return `novel-role:draft:${projectId}:${chapterId}`;
}

async function pollJob(endpoint: string) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const response = await apiFetch(endpoint, { cache: "no-store" });
    const body = await response.json().catch(() => ({})) as { status?: string; output?: unknown; error?: string };
    if (!response.ok) throw new Error(body.error ?? "生成任务状态读取失败");
    const status = body.status?.toLowerCase();
    if (status === "succeeded" || status === "failed" || status === "cancelled") return { status, output: body.output, error: body.error };
    await new Promise((resolve) => window.setTimeout(resolve, 1500));
  }
  throw new Error("生成任务等待超时，请稍后刷新查看结果。");
}

export default function ChaptersPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const projectId = params.id;
  const [project, setProject] = useState<Project | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [scenePlan, setScenePlan] = useState<ScenePlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"scene" | "draft" | "rewrite" | "save" | "finalize" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [outlineFallback, setOutlineFallback] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [revisionId, setRevisionId] = useState<string | null>(null);
  const [rewriteOpen, setRewriteOpen] = useState(false);
  const [rewriteInstruction, setRewriteInstruction] = useState("");
  const [batchCount, setBatchCount] = useState<BatchCount>(5);
  const [batchJob, setBatchJob] = useState<BatchDraftJob | null>(null);
  const [batchRemainingCount, setBatchRemainingCount] = useState<number | null>(null);
  const [batchChecking, setBatchChecking] = useState(true);
  const [batchStarting, setBatchStarting] = useState(false);
  const [batchCancelling, setBatchCancelling] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [batchPollVersion, setBatchPollVersion] = useState(0);
  const batchPollGenerationRef = useRef(0);

  const selectedChapter = useMemo(() => chapters.find((chapter) => chapter.id === selectedId) ?? chapters[0] ?? null, [chapters, selectedId]);
  const currentWordCount = wordCount(content);
  const missingDraftCount = useMemo(() => chapters.filter((chapter) => typeof chapter.latestRevision?.id !== "string").length, [chapters]);
  const batchOutput = useMemo(() => asRecord(batchJob?.output), [batchJob]);
  const batchStatus = normalizedStatus(batchJob?.status);
  const batchRunning = isActiveBatchStatus(batchJob?.status);
  const batchTotal = asNumber(batchOutput.total) ?? asNumber(batchOutput.requestedCount) ?? 0;
  const batchCompleted = asNumber(batchOutput.completed) ?? 0;
  const batchSucceeded = asNumber(batchOutput.succeeded) ?? 0;
  const batchFailed = asNumber(batchOutput.failed) ?? 0;
  const batchSkipped = asNumber(batchOutput.skipped) ?? 0;
  const batchProgress = Math.min(100, Math.max(0, asNumber(batchJob?.progress) ?? (batchTotal > 0 ? Math.round((batchCompleted / batchTotal) * 100) : 0)));
  const batchChapterStates = Array.isArray(batchOutput.chapters) ? batchOutput.chapters.map(asRecord) : [];
  const failedBatchChapters = batchChapterStates.filter((item) => normalizedStatus(item.status) === "failed");
  const cancelledBatchChapters = batchChapterStates.filter((item) => normalizedStatus(item.status) === "cancelled");
  const currentBatchChapter = asRecord(batchOutput.currentChapter);
  const currentBatchChapterLabel = asText(currentBatchChapter.title)
    ?? (asNumber(currentBatchChapter.number) !== null ? `第 ${asNumber(currentBatchChapter.number)} 章` : asText(batchOutput.currentChapter));

  useEffect(() => {
    if ((missingDraftCount === 0 && batchCount !== "all") || (typeof batchCount === "number" && batchCount > missingDraftCount)) setBatchCount("all");
  }, [batchCount, missingDraftCount]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [projectsResponse, chaptersResponse, outlineResponse] = await Promise.all([
          apiFetch("/api/projects"),
          apiFetch(`/api/projects/${projectId}/chapters`),
          apiFetch(`/api/projects/${projectId}/outline`),
        ]);
        const projectsBody = await projectsResponse.json() as { projects?: Project[]; error?: string };
        if (!projectsResponse.ok) throw new Error(projectsBody.error ?? "无法加载项目");
        const found = projectsBody.projects?.find((item) => item.id === projectId);
        if (!found) throw new Error("小说项目不存在，或者数据库尚未连接。");

        let chapterItems: Chapter[] = [];
        if (chaptersResponse.ok) {
          const body = await chaptersResponse.json() as { chapters?: unknown[]; error?: string };
          chapterItems = (body.chapters ?? []).map((item) => normalizeChapter(item)).filter((item): item is Chapter => Boolean(item));
        } else if (chaptersResponse.status !== 404) {
          const body = await chaptersResponse.json().catch(() => ({})) as { error?: string };
          throw new Error(body.error ?? "无法加载章节列表");
        }

        // Until the chapter list endpoint is available, the outline remains a
        // useful, explicit read-only fallback. The warning makes the degraded
        // state visible instead of silently losing the author's work.
        if (chapterItems.length === 0 && outlineResponse.ok) {
          const outlineBody = await outlineResponse.json() as { outline?: { volumeDetails?: VolumeDetail[] }; error?: string };
          const volumeDetails = outlineBody.outline?.volumeDetails ?? [];
          chapterItems = volumeDetails.flatMap((volume) => (volume.chapters ?? []).map((chapter) => normalizeChapter(chapter, volume))).filter((item): item is Chapter => Boolean(item));
          if (chapterItems.length > 0 && chaptersResponse.status === 404) setOutlineFallback(true);
        }
        if (chapterItems.length === 0 && !outlineResponse.ok && chaptersResponse.status === 404) {
          throw new Error("还没有可创作的章节，请先在项目工作台生成分层大纲。");
        }
        if (!cancelled) {
          const requestedId = new URL(window.location.href).searchParams.get("chapterId");
          const initialId = requestedId && chapterItems.some((chapter) => chapter.id === requestedId)
            ? requestedId
            : chapterItems[0]?.id ?? null;
          setProject(found);
          setChapters(chapterItems.sort((a, b) => a.number - b.number));
          setSelectedId((current) => current && chapterItems.some((chapter) => chapter.id === current) ? current : initialId);
        }
      } catch (requestError) {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : "无法加载章节工作台");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const pollingGeneration = batchPollGenerationRef.current + 1;
    batchPollGenerationRef.current = pollingGeneration;

    async function refreshChapterList() {
      const response = await apiFetch(`/api/projects/${projectId}/chapters`, { cache: "no-store" });
      const body = await response.json().catch(() => ({})) as { chapters?: unknown[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "批量生成完成，但章节列表刷新失败");
      const nextChapters = (body.chapters ?? [])
        .map((item) => normalizeChapter(item))
        .filter((item): item is Chapter => Boolean(item))
        .sort((a, b) => a.number - b.number);
      if (typeof window !== "undefined") {
        for (const chapter of nextChapters) {
          if (typeof chapter.latestRevision?.id !== "string") continue;
          const key = localDraftKey(projectId, chapter.id);
          if (window.localStorage.getItem(key) === "") window.localStorage.removeItem(key);
        }
      }
      if (!cancelled) setChapters(nextChapters);
    }

    async function checkBatch(firstCheck: boolean) {
      if (cancelled || batchPollGenerationRef.current !== pollingGeneration) return;
      if (firstCheck) setBatchChecking(true);
      try {
        const response = await apiFetch(`/api/projects/${projectId}/chapters/batch-drafts`, { cache: "no-store" });
        const body = await response.json().catch(() => ({})) as BatchDraftResponse;
        if (!response.ok) throw new Error(body.error ?? body.message ?? "无法读取批量生成任务");
        if (cancelled || batchPollGenerationRef.current !== pollingGeneration) return;
        const nextJob = body.job ?? null;
        setBatchJob(nextJob);
        setBatchRemainingCount(typeof body.remainingCount === "number" ? body.remainingCount : null);
        setBatchError(null);
        if (nextJob && isActiveBatchStatus(nextJob.status)) {
          timer = window.setTimeout(() => { void checkBatch(false); }, 1800);
        } else if (nextJob) {
          await refreshChapterList();
        }
      } catch (requestError) {
        if (!cancelled && batchPollGenerationRef.current === pollingGeneration) setBatchError(requestError instanceof Error ? requestError.message : "无法读取批量生成任务");
      } finally {
        if (!cancelled && batchPollGenerationRef.current === pollingGeneration && firstCheck) setBatchChecking(false);
      }
    }

    void checkBatch(true);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [batchPollVersion, projectId]);

  useEffect(() => {
    if (!selectedChapter) return;
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(localDraftKey(projectId, selectedChapter.id)) : null;
    setContent(stored ?? selectedChapter.content ?? "");
    setScenePlan(selectedChapter.scenePlan ?? null);
    setRevisionId(selectedChapter.latestRevision?.id ?? null);
    setRewriteOpen(false);
    setRewriteInstruction("");
    setNotice(null);
    setError(null);
  }, [projectId, selectedChapter]);

  useEffect(() => {
    if (!selectedChapter || typeof window === "undefined") return;
    const timer = window.setTimeout(() => {
      window.localStorage.setItem(localDraftKey(projectId, selectedChapter.id), content);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [content, projectId, selectedChapter]);

  const selectChapter = (chapterId: string) => {
    if (chapterId === selectedId) return;
    if (selectedChapter && typeof window !== "undefined") {
      window.localStorage.setItem(localDraftKey(projectId, selectedChapter.id), content);
    }
    const url = new URL(window.location.href);
    url.searchParams.set("chapterId", chapterId);
    window.history.replaceState(null, "", url);
    setSelectedId(chapterId);
  };

  const saveLocalDraft = (value = content) => {
    if (!selectedChapter || typeof window === "undefined") return;
    window.localStorage.setItem(localDraftKey(projectId, selectedChapter.id), value);
  };

  const startBatchDrafts = async () => {
    if (batchRunning || batchStarting || batchCancelling || batchChecking || missingDraftCount === 0) return;
    setBatchStarting(true);
    setBatchError(null);
    setNotice(null);
    try {
      const response = await apiFetch(`/api/projects/${projectId}/chapters/batch-drafts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: batchCount }),
      });
      const body = await response.json().catch(() => ({})) as BatchDraftResponse;
      if (!response.ok) throw new Error(body.error ?? body.message ?? "批量生成任务启动失败");
      if (!body.job) throw new Error("批量生成接口未返回任务信息");
      setBatchJob(body.job);
      setBatchRemainingCount(typeof body.remainingCount === "number" ? body.remainingCount : null);
      setNotice(body.reused ? "已恢复正在运行的批量生成任务。" : "批量生成任务已启动；离开或刷新页面不会中断任务。");
      setBatchPollVersion((current) => current + 1);
    } catch (requestError) {
      setBatchError(requestError instanceof Error ? requestError.message : "批量生成任务启动失败");
    } finally {
      setBatchStarting(false);
    }
  };

  const cancelBatchDrafts = async () => {
    if (!batchJob || !batchRunning || batchCancelling) return;
    const confirmed = window.confirm("确定要终止这次批量生成吗？已生成完成的章节会保留，尚未开始的章节将停止生成。");
    if (!confirmed) return;

    batchPollGenerationRef.current += 1;
    setBatchCancelling(true);
    setBatchChecking(false);
    setBatchError(null);
    let cancellationSucceeded = false;
    try {
      const response = await apiFetch(`/api/projects/${projectId}/chapters/batch-drafts?jobId=${encodeURIComponent(batchJob.id)}`, {
        method: "DELETE",
      });
      const body = await response.json().catch(() => ({})) as BatchDraftResponse;
      if (!response.ok) throw new Error(body.error ?? body.message ?? "终止批量生成失败");
      if (!body.job) throw new Error("终止接口未返回任务信息");

      cancellationSucceeded = true;
      setBatchJob(body.job);
      setBatchRemainingCount(typeof body.remainingCount === "number" ? body.remainingCount : null);
      setNotice("批量生成已终止；已经完成的正文初稿已保留。");

      const chaptersResponse = await apiFetch(`/api/projects/${projectId}/chapters`, { cache: "no-store" });
      const chaptersBody = await chaptersResponse.json().catch(() => ({})) as { chapters?: unknown[]; error?: string };
      if (!chaptersResponse.ok) throw new Error(chaptersBody.error ?? "任务已终止，但章节列表刷新失败");
      const nextChapters = (chaptersBody.chapters ?? [])
        .map((item) => normalizeChapter(item))
        .filter((item): item is Chapter => Boolean(item))
        .sort((a, b) => a.number - b.number);
      if (typeof window !== "undefined") {
        for (const chapter of nextChapters) {
          if (typeof chapter.latestRevision?.id !== "string") continue;
          const key = localDraftKey(projectId, chapter.id);
          if (window.localStorage.getItem(key) === "") window.localStorage.removeItem(key);
        }
      }
      setChapters(nextChapters);
    } catch (requestError) {
      setBatchError(requestError instanceof Error ? requestError.message : "终止批量生成失败");
      if (!cancellationSucceeded) setBatchPollVersion((current) => current + 1);
    } finally {
      setBatchCancelling(false);
    }
  };

  async function persistDraft() {
    if (!selectedChapter) return null;
    let response = await apiFetch(`/api/chapters/${selectedChapter.id}/drafts?projectId=${encodeURIComponent(projectId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (response.status === 404 || response.status === 405) {
      response = await apiFetch(`/api/projects/${projectId}/chapters/${selectedChapter.id}/drafts`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
    }
    const body = await response.json().catch(() => ({})) as { revision?: { id?: string }; error?: string };
    if (!response.ok) throw Object.assign(new Error(body.error ?? "保存草稿失败"), { status: response.status });
    const savedRevisionId = typeof body.revision?.id === "string" ? body.revision.id : null;
    if (savedRevisionId) setRevisionId(savedRevisionId);
    return savedRevisionId;
  }

  const saveDraft = async (finalize = false) => {
    if (!selectedChapter) return;
    setBusy(finalize ? "finalize" : "save");
    setError(null);
    setNotice(null);
    saveLocalDraft();
    try {
      let savedRevision = revisionId;
      try {
        savedRevision = await persistDraft();
      } catch (requestError) {
        const status = requestError && typeof requestError === "object" && "status" in requestError ? requestError.status : null;
        if (!finalize && (status === 404 || status === 405)) {
          setNotice("已保存到本机草稿。服务器保存接口尚未就绪，联网后可再次保存。");
          setLastSaved(new Date());
          return;
        }
        throw requestError;
      }
      if (finalize) {
        if (!savedRevision) throw new Error("请先保存一份正文草稿，再进行定稿。");
        const response = await apiFetch(`/api/chapters/${selectedChapter.id}/finalize?projectId=${encodeURIComponent(projectId)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revisionId: savedRevision }),
        });
        const body = await response.json().catch(() => ({})) as { revision?: unknown; error?: string };
        if (!response.ok) throw new Error(body.error ?? "章节定稿失败");
        setChapters((current) => current.map((chapter) => chapter.id === selectedChapter.id
          ? { ...chapter, status: "FINAL", revisionStatus: "FINAL", content, wordCount: currentWordCount, latestRevision: { ...chapter.latestRevision, id: savedRevision, content, wordCount: currentWordCount, status: "FINAL" } }
          : chapter));
      }
      setLastSaved(new Date());
      setNotice(finalize ? "章节已定稿，后续可以继续确认事实变化。" : "草稿已保存。");
      if (finalize) window.localStorage.removeItem(localDraftKey(projectId, selectedChapter.id));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : (finalize ? "章节定稿失败" : "保存草稿失败"));
    } finally {
      setBusy(null);
    }
  };

  const generateScenePlan = async () => {
    if (!selectedChapter) return;
    setBusy("scene");
    setError(null);
    setNotice(null);
    try {
      const response = await apiFetch(`/api/chapters/${selectedChapter.id}/scene-plan/generate`, { method: "POST" });
      const body = await response.json().catch(() => ({})) as { jobId?: string; output?: { data?: ScenePlan }; scenePlan?: ScenePlan; error?: string };
      if (!response.ok) throw new Error(body.error ?? "场景表生成失败");
      if (body.scenePlan) setScenePlan(body.scenePlan);
      else if (body.output?.data) setScenePlan(body.output.data);
      else if (body.jobId) {
        const result = await pollJob(`/api/chapters/${selectedChapter.id}/scene-plan?jobId=${encodeURIComponent(body.jobId)}`);
        const data = asRecord(asRecord(result.output).data);
        if (result.status !== "succeeded" || !Object.keys(data).length) throw new Error(result.error ?? "场景表生成失败");
        setScenePlan(data as ScenePlan);
      } else throw new Error("场景表任务未返回任务编号。");
      setChapters((current) => current.map((chapter) => chapter.id === selectedChapter.id ? { ...chapter, scenePlan: body.scenePlan ?? (body.output?.data ?? scenePlan) } : chapter));
      setNotice("场景表已生成，请确认每个场景都推动了人物或主线变化。");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "场景表生成失败");
    } finally {
      setBusy(null);
    }
  };

  const generateDraft = async (mode: "generate" | "rewrite" = "generate") => {
    if (!selectedChapter || batchRunning || batchCancelling) return;
    const instruction = rewriteInstruction.trim();
    if (mode === "rewrite" && !instruction) {
      setError("请先填写本次重写的修改意见。");
      return;
    }
    if (mode === "rewrite" && !content.trim()) {
      setError("当前章节还没有正文，请先生成或填写正文初稿。");
      return;
    }
    setBusy(mode === "rewrite" ? "rewrite" : "draft");
    setError(null);
    setNotice(null);
    try {
      // Rewrite always uses the text currently visible in the editor. Persist
      // unsaved edits first so the server can use that exact revision as the
      // source and preserve a reliable parent/child revision chain.
      if (mode === "rewrite" && content.trim() !== (selectedChapter.latestRevision?.content ?? "").trim()) {
        await persistDraft();
      }
      const response = await apiFetch(`/api/chapters/${selectedChapter.id}/drafts/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenePlan, mode, ...(mode === "rewrite" ? { instruction } : {}) }),
      });
      const body = await response.json().catch(() => ({})) as { jobId?: string; draft?: string; content?: string; revision?: { id?: string; content?: string }; error?: string };
      if (!response.ok) throw new Error(body.error ?? "正文生成失败");
      let generated = body.draft ?? body.content ?? body.revision?.content;
      if (!generated && body.jobId) {
        const result = await pollJob(`/api/projects/${projectId}/chapters/${selectedChapter.id}/drafts?jobId=${encodeURIComponent(body.jobId)}`);
        const output = asRecord(result.output);
        const draftRevision = asRecord(output.revision);
        if (typeof draftRevision.id === "string") setRevisionId(draftRevision.id);
        if (result.status !== "succeeded") throw new Error(result.error ?? "正文生成失败");
        generated = typeof draftRevision.content === "string" ? draftRevision.content : undefined;
        if (!generated) {
          const revisionsResponse = await apiFetch(`/api/projects/${projectId}/chapters/${selectedChapter.id}/drafts`);
          const revisionsBody = await revisionsResponse.json().catch(() => ({})) as { latestRevision?: { id?: string; content?: string } };
          generated = revisionsBody.latestRevision?.content;
          if (typeof revisionsBody.latestRevision?.id === "string") setRevisionId(revisionsBody.latestRevision.id);
        }
      }
      if (!generated) {
        const revisionsResponse = await apiFetch(`/api/projects/${projectId}/chapters/${selectedChapter.id}/drafts`, { cache: "no-store" });
        const revisionsBody = await revisionsResponse.json().catch(() => ({})) as { latestRevision?: { id?: string; content?: string }; error?: string };
        if (!revisionsResponse.ok) throw new Error(revisionsBody.error ?? "正文生成成功，但读取新版本失败。");
        generated = revisionsBody.latestRevision?.content;
        if (typeof revisionsBody.latestRevision?.id === "string") setRevisionId(revisionsBody.latestRevision.id);
      }
      if (!generated) throw new Error("正文生成成功，但返回内容为空。");
      setContent(generated);
      saveLocalDraft(generated);
      const latestResponse = await apiFetch(`/api/projects/${projectId}/chapters/${selectedChapter.id}/drafts`, { cache: "no-store" });
      const latestBody = await latestResponse.json().catch(() => ({})) as { latestRevision?: { id?: string; content?: string; wordCount?: number | null; status?: string } };
      const latestRevision = latestResponse.ok ? latestBody.latestRevision : undefined;
      if (typeof latestRevision?.id === "string") setRevisionId(latestRevision.id);
      setChapters((current) => current.map((chapter) => chapter.id === selectedChapter.id
        ? {
          ...chapter,
          content: generated,
          wordCount: wordCount(generated),
          revisionStatus: latestRevision?.status ?? "DRAFT",
          latestRevision: {
            ...chapter.latestRevision,
            ...latestRevision,
            content: generated,
            wordCount: latestRevision?.wordCount ?? wordCount(generated),
          },
        }
        : chapter));
      if (mode === "rewrite") {
        setRewriteOpen(false);
        setRewriteInstruction("");
      }
      setNotice(mode === "rewrite" ? "章节已按修改意见重写，旧版本仍然保留。" : "正文初稿已生成，可直接编辑后保存。");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : (mode === "rewrite" ? "章节重写失败" : "正文生成失败"));
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <main className="flex min-h-[100dvh] items-center justify-center bg-slate-50 text-slate-500">正在加载章节工作台...</main>;
  if (error && !project) {
    return <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-slate-50 px-6 text-center"><p className="text-slate-600">{error}</p><button type="button" onClick={() => router.push(`/projects/${projectId}`)} className="min-h-11 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white">返回项目工作台</button></main>;
  }
  if (!project) return null;

  return (
    <main className="min-h-[100dvh] bg-slate-50 px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] text-slate-900 sm:px-8 sm:py-6">
      <div className="mx-auto max-w-7xl">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3 sm:mb-6 sm:gap-4">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <Link href={`/projects/${projectId}`} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-white hover:text-indigo-600" aria-label="返回项目工作台"><ArrowLeft size={18} /></Link>
            <div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-wider text-indigo-600">章节工作台</p><h1 className="truncate text-xl font-extrabold tracking-tight sm:text-2xl">{project.title}</h1></div>
          </div>
          <div className="flex w-full items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500 shadow-sm sm:w-auto sm:flex-wrap sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none"><span>{chapters.length} 章计划</span><span className="hidden h-4 w-px bg-slate-200 sm:block" /><Link href={`/projects/${projectId}/read`} className="inline-flex min-h-9 items-center gap-1.5 font-semibold text-indigo-600 hover:text-indigo-700"><BookOpen size={15} />小说预览</Link><span className="hidden h-4 w-px bg-slate-200 sm:block" /><Link href={`/projects/${projectId}`} className="inline-flex min-h-9 items-center font-semibold text-indigo-600 hover:text-indigo-700">完结健康度</Link></div>
        </header>

        {outlineFallback && <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"><Clock3 size={16} />章节列表接口暂不可用，当前显示大纲中的章节计划；保存和生成仍会明确反馈结果。</div>}
        {error && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
        {notice && <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}

        {chapters.length > 0 && (
          <details className="desktop-expanded mb-4 rounded-2xl border border-indigo-100 bg-white p-3 shadow-sm sm:mb-5 sm:p-5" open={batchRunning || batchStarting || batchCancelling || undefined}>
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-bold text-slate-900 sm:hidden [&::-webkit-details-marker]:hidden">
              <span className="inline-flex items-center gap-2"><WandSparkles size={17} className="text-indigo-600" />批量生成正文</span>
              <span className="text-xs font-semibold text-indigo-600">{batchRunning ? `${batchProgress}%` : `剩余 ${missingDraftCount} 章`} · 展开</span>
            </summary>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <div className="rounded-lg bg-indigo-50 p-2 text-indigo-600"><WandSparkles size={17} /></div>
                  <div>
                    <h2 id="batch-drafts-title" className="font-bold text-slate-900">批量生成正文</h2>
                    <p className="mt-0.5 text-xs leading-relaxed text-slate-500">只生成尚无正文版本的章节，不会覆盖已有草稿或定稿。当前还有 {missingDraftCount} 章可生成。</p>
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <label className="text-xs font-semibold text-slate-600">
                  生成数量
                  <select
                    value={String(batchCount)}
                    onChange={(event) => setBatchCount(event.target.value === "all" ? "all" : Number(event.target.value) as BatchCount)}
                    disabled={batchRunning || batchStarting || batchCancelling || batchChecking || missingDraftCount === 0}
                    className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-100 sm:w-32"
                  >
                    {[5, 10, 20, 50].map((count) => <option key={count} value={count} disabled={count > missingDraftCount}>{count} 章</option>)}
                    <option value="all">全部 ({missingDraftCount})</option>
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => void startBatchDrafts()}
                  disabled={batchRunning || batchStarting || batchCancelling || batchChecking || missingDraftCount === 0 || busy === "draft"}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                >
                  {(batchStarting || batchCancelling || batchChecking) ? <LoaderCircle size={16} className="animate-spin" /> : <Sparkles size={16} />}
                  {batchStarting ? "正在启动..." : batchCancelling ? "终止中..." : batchChecking ? "读取任务..." : batchRunning ? "批量生成中" : "开始批量生成"}
                </button>
              </div>
            </div>

            <div aria-live="polite" aria-atomic="true">
              {batchError && <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{batchError}</p>}
              {batchJob && (
                <div className="mt-4 border-t border-slate-100 pt-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                    <p className="inline-flex items-center gap-2 font-semibold text-slate-800">
                      {batchRunning && <LoaderCircle size={15} className="animate-spin text-indigo-600" />}
                      {batchStatus === "succeeded" ? "批量生成已完成" : batchStatus === "failed" ? "批量任务已失败" : batchStatus === "cancelled" ? "批量任务已取消" : "正在批量生成正文"}
                    </p>
                    <div className="flex items-center gap-3">
                      <span className="font-bold tabular-nums text-indigo-700">{batchProgress}%</span>
                      {batchRunning && (
                        <button
                          type="button"
                          onClick={() => void cancelBatchDrafts()}
                          disabled={batchCancelling}
                          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 transition hover:border-rose-300 hover:bg-rose-100 disabled:cursor-wait disabled:opacity-60"
                          aria-label="终止批量生成正文"
                        >
                          {batchCancelling && <LoaderCircle size={13} className="animate-spin" />}
                          {batchCancelling ? "终止中..." : "终止生成"}
                        </button>
                      )}
                    </div>
                  </div>
                  <div
                    role="progressbar"
                    aria-label="批量生成正文进度"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={batchProgress}
                    aria-valuetext={`已完成 ${batchCompleted} 章，共 ${batchTotal} 章`}
                    className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100"
                  >
                    <div className={`h-full rounded-full transition-[width] duration-500 ${batchStatus === "failed" ? "bg-rose-500" : batchStatus === "cancelled" ? "bg-amber-500" : "bg-indigo-600"}`} style={{ width: `${batchProgress}%` }} />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-500 sm:grid-cols-6">
                    <span>完成 <strong className="text-slate-800">{batchCompleted}/{batchTotal}</strong></span>
                    <span>成功 <strong className="text-emerald-700">{batchSucceeded}</strong></span>
                    <span>失败 <strong className="text-rose-700">{batchFailed}</strong></span>
                    <span>跳过 <strong className="text-slate-700">{batchSkipped}</strong></span>
                    <span>取消 <strong className="text-amber-700">{cancelledBatchChapters.length}</strong></span>
                    <span>剩余可生成 <strong className="text-slate-700">{batchRemainingCount ?? missingDraftCount}</strong></span>
                  </div>
                  {(currentBatchChapterLabel || asText(batchOutput.message)) && (
                    <p className="mt-3 text-xs leading-relaxed text-slate-500">
                      {batchStatus === "cancelled"
                        ? asText(batchOutput.message)
                        : currentBatchChapterLabel ? `当前：${currentBatchChapterLabel}` : asText(batchOutput.message)}
                    </p>
                  )}
                  {failedBatchChapters.length > 0 && (
                    <details className="mt-3 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800">
                      <summary className="cursor-pointer font-semibold">查看失败章节（{failedBatchChapters.length}）</summary>
                      <ul className="mt-2 space-y-1.5 text-xs leading-relaxed">
                        {failedBatchChapters.map((item, index) => {
                          const chapterNumber = asNumber(item.chapterNumber) ?? asNumber(item.number);
                          const label = asText(item.title) ?? (chapterNumber !== null ? `第 ${chapterNumber} 章` : `章节 ${index + 1}`);
                          return <li key={asText(item.chapterId) ?? asText(item.id) ?? `${label}-${index}`}><strong>{label}</strong>{asText(item.error) ? `：${asText(item.error)}` : "：生成失败"}</li>;
                        })}
                      </ul>
                    </details>
                  )}
                </div>
              )}
            </div>
          </details>
        )}

        {chapters.length === 0 ? (
          <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-7 text-center shadow-sm sm:p-12"><FileText className="mx-auto text-slate-300" size={36} /><h2 className="mt-4 text-lg font-bold">还没有章节计划</h2><p className="mt-2 text-sm text-slate-500">返回项目工作台生成分层大纲后，就可以开始逐章创作。</p><Link href={`/projects/${projectId}`} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white">返回项目工作台 <ChevronRight size={16} /></Link></section>
        ) : (
          <div className="grid gap-3 sm:gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
            <label className="block rounded-xl border border-slate-200 bg-white p-3 text-xs font-semibold text-slate-500 shadow-sm lg:hidden">
              当前章节
              <select value={selectedChapter?.id ?? ""} onChange={(event) => selectChapter(event.target.value)} className="mt-1.5 block min-h-11 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-base font-semibold text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100">
                {chapters.map((chapter) => <option key={chapter.id} value={chapter.id}>第 {chapter.number} 章 · {chapter.title}</option>)}
              </select>
            </label>
            <aside className="hidden self-start rounded-2xl border border-slate-200 bg-white p-3 shadow-sm lg:sticky lg:top-5 lg:block">
              <div className="px-3 pb-3 pt-2"><p className="text-xs font-semibold uppercase tracking-wider text-slate-400">写作进度</p><div className="mt-2 flex items-end justify-between"><span className="text-xl font-extrabold">{chapters.filter((chapter) => chapter.status === "FINAL" || chapter.revisionStatus === "FINAL").length}<span className="ml-1 text-sm font-medium text-slate-400">/ {chapters.length}</span></span><span className="text-xs text-slate-400">已定稿</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.round((chapters.filter((chapter) => chapter.status === "FINAL" || chapter.revisionStatus === "FINAL").length / chapters.length) * 100)}%` }} /></div></div>
              <div className="max-h-[calc(100vh-220px)] space-y-1 overflow-y-auto border-t border-slate-100 pt-3">
                {chapters.map((chapter) => <button type="button" key={chapter.id} onClick={() => selectChapter(chapter.id)} className={`group w-full rounded-xl px-3 py-3 text-left transition ${selectedChapter?.id === chapter.id ? "bg-indigo-50 text-indigo-900 ring-1 ring-indigo-100" : "hover:bg-slate-50"}`}><div className="flex items-center gap-2"><span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${selectedChapter?.id === chapter.id ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-500"}`}>{chapter.number}</span><span className="min-w-0 flex-1 truncate text-sm font-semibold">{chapter.title}</span>{chapter.status === "FINAL" && <CheckCircle2 size={15} className="shrink-0 text-emerald-500" />}</div><p className="mt-1 truncate pl-8 text-xs text-slate-400">{statusLabel[chapter.status ?? ""] ?? "计划"}{chapter.plannedWordCount ? ` · ${chapter.plannedWordCount} 字` : ""}</p></button>)}
              </div>
            </aside>

            {selectedChapter && <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm sm:rounded-2xl">
              <div className="border-b border-slate-100 px-4 py-4 sm:px-8 sm:py-5"><div className="flex flex-wrap items-start justify-between gap-3 sm:gap-4"><div className="min-w-0"><p className="text-sm font-semibold text-indigo-600">第 {selectedChapter.number} 章{selectedChapter.volumeTitle ? ` · ${selectedChapter.volumeTitle}` : ""}</p><h2 className="mt-1 break-words text-xl font-extrabold tracking-tight sm:text-2xl">{selectedChapter.title}</h2><p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-500">{selectedChapter.summary ?? "暂无章节摘要，先从场景表开始整理。"}</p></div><span className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${selectedChapter.status === "FINAL" || selectedChapter.revisionStatus === "FINAL" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{statusLabel[selectedChapter.status === "FINAL" ? "FINAL" : selectedChapter.revisionStatus ?? selectedChapter.status ?? ""] ?? "草稿"}</span></div></div>
              <div className="grid gap-5 px-4 py-4 sm:gap-6 sm:px-8 sm:py-6 xl:grid-cols-[minmax(0,1fr)_300px]">
                <div className="min-w-0">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="font-bold">正文编辑</h3>
                      <p className="mt-1 text-xs text-slate-400">{currentWordCount.toLocaleString()} 字{selectedChapter.plannedWordCount ? ` · 计划 ${selectedChapter.plannedWordCount.toLocaleString()} 字` : ""}{lastSaved ? ` · ${lastSaved.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} 保存` : ""}</p>
                    </div>
                    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                      {content.trim() && (
                        <button
                          type="button"
                          onClick={() => {
                            setRewriteOpen(true);
                            setError(null);
                            setNotice(null);
                          }}
                          disabled={busy !== null || batchRunning || batchCancelling}
                          className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-amber-200 px-3 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-50 disabled:cursor-wait disabled:opacity-50 sm:flex-none"
                        >
                          <Sparkles size={15} />
                          {busy === "rewrite" ? "重写中..." : "重写"}
                        </button>
                      )}
                      <button type="button" onClick={() => void generateDraft()} disabled={busy !== null || batchRunning || batchCancelling} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-indigo-200 px-3 py-2 text-sm font-semibold text-indigo-600 hover:bg-indigo-50 disabled:cursor-wait disabled:opacity-50 sm:flex-none"><WandSparkles size={15} />{busy === "draft" ? "生成中..." : batchCancelling ? "终止中..." : batchRunning ? "批量生成中..." : "生成正文初稿"}</button>
                    </div>
                  </div>
                  {rewriteOpen && (
                    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/70 p-4">
                      <label htmlFor="rewrite-instruction" className="text-sm font-bold text-amber-950">这次希望怎样修改？</label>
                      <p className="mt-1 text-xs leading-relaxed text-amber-800">AI 会根据当前编辑器中的正文重新生成完整章节，旧版本会继续保留。</p>
                      <textarea
                        id="rewrite-instruction"
                        value={rewriteInstruction}
                        onChange={(event) => setRewriteInstruction(event.target.value)}
                        maxLength={10_000}
                        rows={4}
                        autoFocus
                        placeholder="例如：加强主角和反派的正面冲突，减少解释性叙述，让结尾停在更强的悬念上。"
                        className="mt-3 w-full resize-y rounded-lg border border-amber-200 bg-white p-3 text-sm leading-6 text-slate-800 outline-none placeholder:text-slate-400 focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
                      />
                      <div className="mt-3 flex flex-wrap justify-end gap-2">
                        <button type="button" onClick={() => { setRewriteOpen(false); setRewriteInstruction(""); }} disabled={busy === "rewrite"} className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">取消</button>
                        <button type="button" onClick={() => void generateDraft("rewrite")} disabled={busy !== null || batchRunning || batchCancelling || !rewriteInstruction.trim()} className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400">
                          {busy === "rewrite" ? <LoaderCircle size={15} className="animate-spin" /> : <Sparkles size={15} />}
                          {busy === "rewrite" ? "正在重写..." : "按意见重写"}
                        </button>
                      </div>
                    </div>
                  )}
                  <details className="group mb-4 rounded-xl border border-indigo-100 bg-indigo-50/60 xl:hidden">
                    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 text-sm font-bold text-indigo-900 [&::-webkit-details-marker]:hidden">
                      <span className="inline-flex items-center gap-2"><Sparkles size={15} />场景参考与写作提示</span>
                      <ChevronRight size={16} className="shrink-0 transition group-open:rotate-90" />
                    </summary>
                    <div className="border-t border-indigo-100 px-4 py-4 text-sm">
                      <div className="mb-3 flex justify-end">
                        <button type="button" onClick={() => void generateScenePlan()} disabled={busy !== null} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-indigo-200 bg-white px-3 text-sm font-semibold text-indigo-600 disabled:opacity-50"><Sparkles size={14} />{busy === "scene" ? "生成中..." : scenePlan ? "重新生成场景表" : "生成场景表"}</button>
                      </div>
                      <dl className="space-y-3">
                        <div><dt className="text-xs font-semibold text-indigo-500">本章目标</dt><dd className="mt-1 leading-relaxed text-slate-700">{selectedChapter.objective ?? "待补充"}</dd></div>
                        <div><dt className="text-xs font-semibold text-indigo-500">主要冲突</dt><dd className="mt-1 leading-relaxed text-slate-700">{selectedChapter.conflict ?? "待补充"}</dd></div>
                        <div><dt className="text-xs font-semibold text-indigo-500">结束变化</dt><dd className="mt-1 leading-relaxed text-slate-700">{selectedChapter.expectedOutcome ?? "待补充"}</dd></div>
                      </dl>
                      {scenePlan?.scenes && scenePlan.scenes.length > 0 && (
                        <ol className="mt-4 space-y-3 border-t border-indigo-100 pt-3">
                          {scenePlan.scenes.map((scene, index) => <li key={`${scene.title ?? "mobile-scene"}-${index}`} className="flex gap-2 text-xs leading-relaxed text-slate-600"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white font-semibold text-indigo-600">{scene.order ?? index + 1}</span><span><strong className="font-semibold text-slate-700">{scene.title ?? "场景"}</strong>{scene.objective ? <span className="mt-0.5 block">目标：{scene.objective}</span> : null}{scene.turningPoint ? <span className="mt-0.5 block">转折：{scene.turningPoint}</span> : null}</span></li>)}
                        </ol>
                      )}
                      <p className="mt-4 rounded-lg bg-white/80 px-3 py-2 text-xs leading-5 text-indigo-800">每一场都应让人物、关系、信息或危险程度至少发生一项可追踪变化。</p>
                    </div>
                  </details>
                  <textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder="从一个具体场景开始。写下人物此刻想要什么、遇到什么阻力，以及场景结束时发生了什么变化。" className="min-h-[55dvh] w-full resize-y rounded-xl border border-slate-200 bg-slate-50/50 p-4 text-base leading-7 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:bg-white focus:ring-4 focus:ring-indigo-50 sm:min-h-[520px] sm:p-5 sm:text-[15px] sm:leading-8" />
                  <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"><p className="text-xs text-slate-400">草稿会先保存在本机，避免切换章节时丢失。</p><div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:items-center"><button type="button" onClick={() => void saveDraft(false)} disabled={busy !== null} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><Save size={15} />{busy === "save" ? "保存中..." : "保存草稿"}</button><button type="button" onClick={() => void saveDraft(true)} disabled={busy !== null || !content.trim()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3.5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"><Check size={15} />{busy === "finalize" ? "定稿中..." : "标记为定稿"}</button></div></div>
                </div>
                <aside className="hidden space-y-4 xl:block"><div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4"><div className="mb-3 flex items-center justify-between"><h3 className="font-bold">场景表</h3><button type="button" onClick={() => void generateScenePlan()} disabled={busy !== null} className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-700 disabled:opacity-50"><Sparkles size={14} />{busy === "scene" ? "生成中" : scenePlan ? "重新生成" : "生成"}</button></div><dl className="space-y-3 text-sm"><div><dt className="text-xs font-semibold text-slate-400">本章目标</dt><dd className="mt-1 leading-relaxed text-slate-700">{selectedChapter.objective ?? "待补充"}</dd></div><div><dt className="text-xs font-semibold text-slate-400">主要冲突</dt><dd className="mt-1 leading-relaxed text-slate-700">{selectedChapter.conflict ?? "待补充"}</dd></div><div><dt className="text-xs font-semibold text-slate-400">结束变化</dt><dd className="mt-1 leading-relaxed text-slate-700">{selectedChapter.expectedOutcome ?? "待补充"}</dd></div>{scenePlan?.chapterPromise && <div><dt className="text-xs font-semibold text-slate-400">读者期待</dt><dd className="mt-1 leading-relaxed text-slate-700">{scenePlan.chapterPromise}</dd></div>}{scenePlan?.endingState && <div><dt className="text-xs font-semibold text-slate-400">结束状态</dt><dd className="mt-1 leading-relaxed text-slate-700">{scenePlan.endingState}</dd></div>}</dl>{scenePlan?.scenes && scenePlan.scenes.length > 0 && <div className="mt-4 border-t border-slate-200 pt-3"><p className="mb-2 text-xs font-semibold text-slate-400">场景节拍</p><ol className="space-y-3">{scenePlan.scenes.map((scene, index) => <li key={`${scene.title ?? "scene"}-${index}`} className="flex gap-2 text-xs leading-relaxed text-slate-600"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white font-semibold text-indigo-600">{scene.order ?? index + 1}</span><span><strong className="font-semibold text-slate-700">{scene.title ?? "场景"}</strong>{scene.setting ? ` · ${scene.setting}` : ""}{scene.objective ? <span className="mt-0.5 block text-slate-500">目标：{scene.objective}</span> : null}{scene.turningPoint ? <span className="mt-0.5 block text-slate-500">转折：{scene.turningPoint}</span> : null}</span></li>)}</ol></div>}</div><div className="rounded-xl border border-indigo-100 bg-indigo-50/70 p-4 text-sm leading-relaxed text-indigo-900"><p className="font-bold">写作提示</p><p className="mt-2 text-indigo-700">每一场都应让人物、关系、信息或危险程度至少发生一项可追踪变化。</p></div></aside>
              </div>
            </section>}
          </div>
        )}
      </div>
    </main>
  );
}
