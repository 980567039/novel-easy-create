"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileText,
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
    const response = await fetch(endpoint, { cache: "no-store" });
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
  const [busy, setBusy] = useState<"scene" | "draft" | "save" | "finalize" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [outlineFallback, setOutlineFallback] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [revisionId, setRevisionId] = useState<string | null>(null);

  const selectedChapter = useMemo(() => chapters.find((chapter) => chapter.id === selectedId) ?? chapters[0] ?? null, [chapters, selectedId]);
  const currentWordCount = wordCount(content);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [projectsResponse, chaptersResponse, outlineResponse] = await Promise.all([
          fetch("/api/projects"),
          fetch(`/api/projects/${projectId}/chapters`),
          fetch(`/api/projects/${projectId}/outline`),
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
    if (!selectedChapter) return;
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(localDraftKey(projectId, selectedChapter.id)) : null;
    setContent(stored ?? selectedChapter.content ?? "");
    setScenePlan(selectedChapter.scenePlan ?? null);
    setRevisionId(selectedChapter.latestRevision?.id ?? null);
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

  async function persistDraft() {
    if (!selectedChapter) return null;
    let response = await fetch(`/api/chapters/${selectedChapter.id}/drafts?projectId=${encodeURIComponent(projectId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (response.status === 404 || response.status === 405) {
      response = await fetch(`/api/projects/${projectId}/chapters/${selectedChapter.id}/drafts`, {
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
        const response = await fetch(`/api/chapters/${selectedChapter.id}/finalize?projectId=${encodeURIComponent(projectId)}`, {
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
      const response = await fetch(`/api/chapters/${selectedChapter.id}/scene-plan/generate`, { method: "POST" });
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

  const generateDraft = async () => {
    if (!selectedChapter) return;
    setBusy("draft");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/chapters/${selectedChapter.id}/drafts/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenePlan }),
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
          const revisionsResponse = await fetch(`/api/projects/${projectId}/chapters/${selectedChapter.id}/drafts`);
          const revisionsBody = await revisionsResponse.json().catch(() => ({})) as { latestRevision?: { id?: string; content?: string } };
          generated = revisionsBody.latestRevision?.content;
          if (typeof revisionsBody.latestRevision?.id === "string") setRevisionId(revisionsBody.latestRevision.id);
        }
      }
      if (!generated) throw new Error("正文生成成功，但返回内容为空。");
      setContent(generated);
      saveLocalDraft(generated);
      setNotice("正文初稿已生成，可直接编辑后保存。");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "正文生成失败");
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <main className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500">正在加载章节工作台...</main>;
  if (error && !project) {
    return <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 px-6 text-center"><p className="text-slate-600">{error}</p><button type="button" onClick={() => router.push(`/projects/${projectId}`)} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white">返回项目工作台</button></main>;
  }
  if (!project) return null;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 sm:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href={`/projects/${projectId}`} className="rounded-lg p-2 text-slate-500 hover:bg-white hover:text-indigo-600" aria-label="返回项目工作台"><ArrowLeft size={18} /></Link>
            <div><p className="text-xs font-semibold uppercase tracking-wider text-indigo-600">章节工作台</p><h1 className="text-2xl font-extrabold tracking-tight">{project.title}</h1></div>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500"><span>{chapters.length} 章计划</span><span className="h-4 w-px bg-slate-200" /><Link href={`/projects/${projectId}/read`} className="inline-flex items-center gap-1.5 font-semibold text-indigo-600 hover:text-indigo-700"><BookOpen size={15} />小说预览</Link><span className="h-4 w-px bg-slate-200" /><Link href={`/projects/${projectId}`} className="font-semibold text-indigo-600 hover:text-indigo-700">查看完结健康度</Link></div>
        </header>

        {outlineFallback && <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"><Clock3 size={16} />章节列表接口暂不可用，当前显示大纲中的章节计划；保存和生成仍会明确反馈结果。</div>}
        {error && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
        {notice && <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}

        {chapters.length === 0 ? (
          <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center shadow-sm"><FileText className="mx-auto text-slate-300" size={36} /><h2 className="mt-4 text-lg font-bold">还没有章节计划</h2><p className="mt-2 text-sm text-slate-500">返回项目工作台生成分层大纲后，就可以开始逐章创作。</p><Link href={`/projects/${projectId}`} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white">返回项目工作台 <ChevronRight size={16} /></Link></section>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
            <aside className="self-start rounded-2xl border border-slate-200 bg-white p-3 shadow-sm lg:sticky lg:top-5">
              <div className="px-3 pb-3 pt-2"><p className="text-xs font-semibold uppercase tracking-wider text-slate-400">写作进度</p><div className="mt-2 flex items-end justify-between"><span className="text-xl font-extrabold">{chapters.filter((chapter) => chapter.status === "FINAL" || chapter.revisionStatus === "FINAL").length}<span className="ml-1 text-sm font-medium text-slate-400">/ {chapters.length}</span></span><span className="text-xs text-slate-400">已定稿</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.round((chapters.filter((chapter) => chapter.status === "FINAL" || chapter.revisionStatus === "FINAL").length / chapters.length) * 100)}%` }} /></div></div>
              <div className="max-h-[calc(100vh-220px)] space-y-1 overflow-y-auto border-t border-slate-100 pt-3">
                {chapters.map((chapter) => <button type="button" key={chapter.id} onClick={() => selectChapter(chapter.id)} className={`group w-full rounded-xl px-3 py-3 text-left transition ${selectedChapter?.id === chapter.id ? "bg-indigo-50 text-indigo-900 ring-1 ring-indigo-100" : "hover:bg-slate-50"}`}><div className="flex items-center gap-2"><span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${selectedChapter?.id === chapter.id ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-500"}`}>{chapter.number}</span><span className="min-w-0 flex-1 truncate text-sm font-semibold">{chapter.title}</span>{chapter.status === "FINAL" && <CheckCircle2 size={15} className="shrink-0 text-emerald-500" />}</div><p className="mt-1 truncate pl-8 text-xs text-slate-400">{statusLabel[chapter.status ?? ""] ?? "计划"}{chapter.plannedWordCount ? ` · ${chapter.plannedWordCount} 字` : ""}</p></button>)}
              </div>
            </aside>

            {selectedChapter && <section className="min-w-0 rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-5 py-5 sm:px-8"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-semibold text-indigo-600">第 {selectedChapter.number} 章{selectedChapter.volumeTitle ? ` · ${selectedChapter.volumeTitle}` : ""}</p><h2 className="mt-1 text-2xl font-extrabold tracking-tight">{selectedChapter.title}</h2><p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-500">{selectedChapter.summary ?? "暂无章节摘要，先从场景表开始整理。"}</p></div><span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${selectedChapter.status === "FINAL" || selectedChapter.revisionStatus === "FINAL" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{statusLabel[selectedChapter.status === "FINAL" ? "FINAL" : selectedChapter.revisionStatus ?? selectedChapter.status ?? ""] ?? "草稿"}</span></div></div>
              <div className="grid gap-6 px-5 py-6 sm:px-8 xl:grid-cols-[minmax(0,1fr)_300px]">
                <div className="min-w-0"><div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-bold">正文编辑</h3><p className="mt-1 text-xs text-slate-400">{currentWordCount.toLocaleString()} 字{selectedChapter.plannedWordCount ? ` · 计划 ${selectedChapter.plannedWordCount.toLocaleString()} 字` : ""}{lastSaved ? ` · ${lastSaved.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} 保存` : ""}</p></div><button type="button" onClick={() => void generateDraft()} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 px-3 py-2 text-sm font-semibold text-indigo-600 hover:bg-indigo-50 disabled:cursor-wait disabled:opacity-50"><WandSparkles size={15} />{busy === "draft" ? "生成中..." : "生成正文初稿"}</button></div><textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder="从一个具体场景开始。写下人物此刻想要什么、遇到什么阻力，以及场景结束时发生了什么变化。" className="min-h-[520px] w-full resize-y rounded-xl border border-slate-200 bg-slate-50/50 p-5 text-[15px] leading-8 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:bg-white focus:ring-4 focus:ring-indigo-50" /><div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-slate-400">草稿会先保存在本机，避免切换章节时丢失。</p><div className="flex items-center gap-2"><button type="button" onClick={() => void saveDraft(false)} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><Save size={15} />{busy === "save" ? "保存中..." : "保存草稿"}</button><button type="button" onClick={() => void saveDraft(true)} disabled={busy !== null || !content.trim()} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3.5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"><Check size={15} />{busy === "finalize" ? "定稿中..." : "标记为定稿"}</button></div></div></div>
                <aside className="space-y-4"><div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4"><div className="mb-3 flex items-center justify-between"><h3 className="font-bold">场景表</h3><button type="button" onClick={() => void generateScenePlan()} disabled={busy !== null} className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-700 disabled:opacity-50"><Sparkles size={14} />{busy === "scene" ? "生成中" : scenePlan ? "重新生成" : "生成"}</button></div><dl className="space-y-3 text-sm"><div><dt className="text-xs font-semibold text-slate-400">本章目标</dt><dd className="mt-1 leading-relaxed text-slate-700">{selectedChapter.objective ?? "待补充"}</dd></div><div><dt className="text-xs font-semibold text-slate-400">主要冲突</dt><dd className="mt-1 leading-relaxed text-slate-700">{selectedChapter.conflict ?? "待补充"}</dd></div><div><dt className="text-xs font-semibold text-slate-400">结束变化</dt><dd className="mt-1 leading-relaxed text-slate-700">{selectedChapter.expectedOutcome ?? "待补充"}</dd></div>{scenePlan?.chapterPromise && <div><dt className="text-xs font-semibold text-slate-400">读者期待</dt><dd className="mt-1 leading-relaxed text-slate-700">{scenePlan.chapterPromise}</dd></div>}{scenePlan?.endingState && <div><dt className="text-xs font-semibold text-slate-400">结束状态</dt><dd className="mt-1 leading-relaxed text-slate-700">{scenePlan.endingState}</dd></div>}</dl>{scenePlan?.scenes && scenePlan.scenes.length > 0 && <div className="mt-4 border-t border-slate-200 pt-3"><p className="mb-2 text-xs font-semibold text-slate-400">场景节拍</p><ol className="space-y-3">{scenePlan.scenes.map((scene, index) => <li key={`${scene.title ?? "scene"}-${index}`} className="flex gap-2 text-xs leading-relaxed text-slate-600"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white font-semibold text-indigo-600">{scene.order ?? index + 1}</span><span><strong className="font-semibold text-slate-700">{scene.title ?? "场景"}</strong>{scene.setting ? ` · ${scene.setting}` : ""}{scene.objective ? <span className="mt-0.5 block text-slate-500">目标：{scene.objective}</span> : null}{scene.turningPoint ? <span className="mt-0.5 block text-slate-500">转折：{scene.turningPoint}</span> : null}</span></li>)}</ol></div>}</div><div className="rounded-xl border border-indigo-100 bg-indigo-50/70 p-4 text-sm leading-relaxed text-indigo-900"><p className="font-bold">写作提示</p><p className="mt-2 text-indigo-700">每一场都应让人物、关系、信息或危险程度至少发生一项可追踪变化。</p></div></aside>
              </div>
            </section>}
          </div>
        )}
      </div>
    </main>
  );
}
