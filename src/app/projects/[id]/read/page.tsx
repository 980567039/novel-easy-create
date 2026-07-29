"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  BookOpenText,
  ChevronLeft,
  ChevronRight,
  FileX2,
  Leaf,
  List,
  LoaderCircle,
  Moon,
  PenLine,
  RotateCw,
  Settings2,
  Sun,
  X,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";

type ReaderTheme = "day" | "eye" | "night";

interface ReaderSettings {
  theme: ReaderTheme;
  fontSize: number;
  lineHeight: number;
}

interface ReaderProject {
  id: string;
  title: string;
}

interface ReaderChapterSummary {
  id: string;
  number: number;
  title: string;
  volumeNumber: number | null;
  volumeTitle: string | null;
  isFinale: boolean;
  hasContent: boolean;
  revisionStatus: string | null;
  wordCount: number;
  updatedAt: string | null;
}

interface ReaderChapter extends ReaderChapterSummary {
  content: string;
}

interface ReaderStats {
  totalChapters?: number;
  readableChapters?: number;
  chapterCount?: number;
  readableChapterCount?: number;
  totalWordCount?: number;
}

interface DirectoryPayload {
  project?: unknown;
  stats?: ReaderStats;
  chapters?: unknown[];
  error?: string;
}

interface ChapterPayload extends DirectoryPayload {
  chapter?: unknown;
}

const DEFAULT_SETTINGS: ReaderSettings = {
  theme: "day",
  fontSize: 19,
  lineHeight: 2,
};

const THEME_OPTIONS: Array<{ value: ReaderTheme; label: string; icon: typeof Sun }> = [
  { value: "day", label: "日间", icon: Sun },
  { value: "eye", label: "护眼", icon: Leaf },
  { value: "night", label: "夜间", icon: Moon },
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeProject(value: unknown, projectId: string): ReaderProject {
  const item = asRecord(value);
  return {
    id: text(item.id) ?? projectId,
    title: text(item.title) ?? "未命名小说",
  };
}

function normalizeSummary(value: unknown): ReaderChapterSummary | null {
  const item = asRecord(value);
  const id = text(item.id);
  const chapterNumber = number(item.number);
  if (!id || chapterNumber === null) return null;

  const revision = asRecord(item.latestRevision ?? item.revision);
  const content = text(item.content) ?? text(revision.content);
  const countedWords = number(item.wordCount) ?? number(revision.wordCount) ?? 0;
  const explicitContent = typeof item.hasContent === "boolean" ? item.hasContent : null;

  return {
    id,
    number: chapterNumber,
    title: text(item.title) ?? `第 ${chapterNumber} 章`,
    volumeNumber: number(item.volumeNumber),
    volumeTitle: text(item.volumeTitle),
    isFinale: item.isFinale === true,
    hasContent: explicitContent ?? Boolean(content || countedWords > 0),
    revisionStatus: text(item.revisionStatus) ?? text(revision.status) ?? text(item.status),
    wordCount: countedWords,
    updatedAt: text(item.updatedAt) ?? text(revision.updatedAt),
  };
}

function normalizeChapter(value: unknown): ReaderChapter | null {
  const summary = normalizeSummary(value);
  if (!summary) return null;
  const item = asRecord(value);
  const revision = asRecord(item.latestRevision ?? item.revision);
  // Only persisted chapter/revision content is allowed here. Outline fields such
  // as summary, objective and expectedOutcome must never become reader content.
  const content = text(item.content) ?? text(revision.content) ?? "";
  return {
    ...summary,
    content,
    hasContent: Boolean(content),
    wordCount: summary.wordCount || countWords(content),
  };
}

function countWords(value: string) {
  return value.replace(/\s/g, "").length;
}

function settingsKey(projectId: string) {
  return `novel-role:reader-settings:${projectId}`;
}

function loadSettings(projectId: string): ReaderSettings {
  try {
    const raw = window.localStorage.getItem(settingsKey(projectId));
    if (!raw) return DEFAULT_SETTINGS;
    const stored = JSON.parse(raw) as Partial<ReaderSettings>;
    return {
      theme: stored.theme === "eye" || stored.theme === "night" ? stored.theme : "day",
      fontSize: typeof stored.fontSize === "number"
        ? Math.min(26, Math.max(16, stored.fontSize))
        : DEFAULT_SETTINGS.fontSize,
      lineHeight: typeof stored.lineHeight === "number"
        ? Math.min(2.4, Math.max(1.6, stored.lineHeight))
        : DEFAULT_SETTINGS.lineHeight,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function paragraphs(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n|\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function statusLabel(chapter: ReaderChapterSummary) {
  if (!chapter.hasContent) return "待创作";
  if (chapter.revisionStatus?.toUpperCase() === "FINAL") return "定稿";
  return "草稿";
}

function formatWordCount(value: number) {
  return `${new Intl.NumberFormat("zh-CN").format(value)} 字`;
}

function themeClasses(theme: ReaderTheme) {
  if (theme === "night") {
    return {
      root: "bg-[#101620] text-[#d7dce4]",
      chrome: "border-slate-700/80 bg-[#151d2a]/95 text-slate-200",
      panel: "border-slate-700 bg-[#182130] text-slate-200",
      article: "bg-[#151d2a] text-[#d7dce4] sm:shadow-black/20",
      muted: "text-slate-400",
      subtle: "border-slate-700 bg-slate-800/70",
      hover: "hover:bg-slate-700/70",
      accent: "bg-indigo-400",
      active: "bg-indigo-400/15 text-indigo-200",
    };
  }
  if (theme === "eye") {
    return {
      root: "bg-[#dfe8d2] text-[#313b2c]",
      chrome: "border-[#c5d0b8] bg-[#edf2e5]/95 text-[#33402e]",
      panel: "border-[#c5d0b8] bg-[#f1f5eb] text-[#33402e]",
      article: "bg-[#edf2e5] text-[#313b2c] sm:shadow-[#7b8b6c]/15",
      muted: "text-[#73806b]",
      subtle: "border-[#ccd6c0] bg-[#e4ebda]",
      hover: "hover:bg-[#dce6d1]",
      accent: "bg-emerald-600",
      active: "bg-emerald-700/10 text-emerald-800",
    };
  }
  return {
    root: "bg-[#f2efe8] text-slate-800",
    chrome: "border-stone-200 bg-white/95 text-slate-700",
    panel: "border-stone-200 bg-white text-slate-800",
    article: "bg-[#fffefa] text-slate-800 sm:shadow-stone-300/30",
    muted: "text-slate-500",
    subtle: "border-stone-200 bg-stone-50",
    hover: "hover:bg-stone-100",
    accent: "bg-indigo-600",
    active: "bg-indigo-50 text-indigo-700",
  };
}

export default function NovelReaderPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const scrollRef = useRef<HTMLElement | null>(null);
  const [project, setProject] = useState<ReaderProject | null>(null);
  const [stats, setStats] = useState<ReaderStats>({});
  const [chapters, setChapters] = useState<ReaderChapterSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chapter, setChapter] = useState<ReaderChapter | null>(null);
  const [loadingDirectory, setLoadingDirectory] = useState(true);
  const [loadingChapter, setLoadingChapter] = useState(false);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [chapterError, setChapterError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsReady, setSettingsReady] = useState(false);
  const [settings, setSettings] = useState<ReaderSettings>(DEFAULT_SETTINGS);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [chapterReloadToken, setChapterReloadToken] = useState(0);

  const colors = themeClasses(settings.theme);
  const selectedSummary = useMemo(
    () => chapters.find((item) => item.id === selectedId) ?? null,
    [chapters, selectedId],
  );
  const readableChapters = useMemo(
    () => chapters.filter((item) => item.hasContent),
    [chapters],
  );
  const previousChapter = useMemo(() => {
    if (!selectedSummary) return null;
    return [...readableChapters].reverse().find((item) => item.number < selectedSummary.number) ?? null;
  }, [readableChapters, selectedSummary]);
  const nextChapter = useMemo(() => {
    if (!selectedSummary) return null;
    return readableChapters.find((item) => item.number > selectedSummary.number) ?? null;
  }, [readableChapters, selectedSummary]);
  const chapterPosition = selectedSummary
    ? chapters.findIndex((item) => item.id === selectedSummary.id) + 1
    : 0;
  const chapterParagraphs = useMemo(() => paragraphs(chapter?.content ?? ""), [chapter?.content]);

  const loadDirectory = useCallback(async () => {
    setLoadingDirectory(true);
    setDirectoryError(null);
    try {
      const response = await apiFetch(`/api/projects/${projectId}/reader`, { cache: "no-store" });
      const body = await response.json().catch(() => ({})) as DirectoryPayload;
      if (!response.ok) throw new Error(body.error ?? "无法加载小说目录");

      const normalized = (body.chapters ?? [])
        .map(normalizeSummary)
        .filter((item): item is ReaderChapterSummary => Boolean(item))
        .sort((a, b) => a.number - b.number);
      const requestedId = new URL(window.location.href).searchParams.get("chapterId");
      const requested = normalized.find((item) => item.id === requestedId);
      const initial = requested ?? normalized.find((item) => item.hasContent) ?? normalized[0] ?? null;

      setProject(normalizeProject(body.project, projectId));
      setStats(body.stats ?? {});
      setChapters(normalized);
      setSelectedId(initial?.id ?? null);
    } catch (requestError) {
      setDirectoryError(requestError instanceof Error ? requestError.message : "无法加载小说目录");
    } finally {
      setLoadingDirectory(false);
    }
  }, [projectId]);

  useEffect(() => {
    setSettings(loadSettings(projectId));
    setSettingsReady(true);
    void loadDirectory();
  }, [loadDirectory, projectId]);

  useEffect(() => {
    if (!settingsReady) return;
    window.localStorage.setItem(settingsKey(projectId), JSON.stringify(settings));
  }, [projectId, settings, settingsReady]);

  useEffect(() => {
    if (!selectedId || !selectedSummary) {
      setChapter(null);
      return;
    }

    scrollRef.current?.scrollTo({ top: 0 });
    setScrollProgress(0);
    setChapterError(null);
    if (!selectedSummary.hasContent) {
      setChapter({ ...selectedSummary, content: "" });
      setLoadingChapter(false);
      return;
    }

    const controller = new AbortController();
    async function loadChapter() {
      setLoadingChapter(true);
      setChapter(null);
      try {
        const response = await apiFetch(
          `/api/projects/${projectId}/reader?chapterId=${encodeURIComponent(selectedId ?? "")}`,
          { cache: "no-store", signal: controller.signal },
        );
        const body = await response.json().catch(() => ({})) as ChapterPayload;
        if (!response.ok) throw new Error(body.error ?? "无法加载章节正文");
        const normalized = normalizeChapter(body.chapter);
        if (!normalized) throw new Error("章节正文格式不正确");
        if (body.project) setProject(normalizeProject(body.project, projectId));
        if (body.stats) setStats(body.stats);
        setChapter(normalized);
      } catch (requestError) {
        if (controller.signal.aborted) return;
        setChapterError(requestError instanceof Error ? requestError.message : "无法加载章节正文");
      } finally {
        if (!controller.signal.aborted) setLoadingChapter(false);
      }
    }
    void loadChapter();
    return () => controller.abort();
  }, [chapterReloadToken, projectId, selectedId, selectedSummary]);

  useEffect(() => {
    const update = () => {
      const element = scrollRef.current;
      if (!element) return;
      const available = element.scrollHeight - element.clientHeight;
      setScrollProgress(available <= 0 ? 100 : Math.min(100, Math.max(0, (element.scrollTop / available) * 100)));
    };
    const frame = window.requestAnimationFrame(update);
    window.addEventListener("resize", update);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
    };
  }, [chapter?.content, settings.fontSize, settings.lineHeight]);

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setDrawerOpen(false);
        setSettingsOpen(false);
      }
      if (event.key === "ArrowLeft" && previousChapter && !drawerOpen && !settingsOpen) {
        selectChapter(previousChapter);
      }
      if (event.key === "ArrowRight" && nextChapter && !drawerOpen && !settingsOpen) {
        selectChapter(nextChapter);
      }
    }
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  });

  function selectChapter(item: ReaderChapterSummary) {
    if (!item.hasContent || item.id === selectedId) return;
    const url = new URL(window.location.href);
    url.searchParams.set("chapterId", item.id);
    window.history.replaceState(null, "", url);
    setSelectedId(item.id);
    setDrawerOpen(false);
  }

  function updateScrollProgress() {
    const element = scrollRef.current;
    if (!element) return;
    const available = element.scrollHeight - element.clientHeight;
    setScrollProgress(available <= 0 ? 100 : Math.min(100, Math.max(0, (element.scrollTop / available) * 100)));
  }

  if (loadingDirectory) {
    return (
      <main className="flex h-[100dvh] items-center justify-center bg-[#f2efe8] text-slate-600">
        <div className="text-center">
          <LoaderCircle className="mx-auto h-7 w-7 animate-spin text-indigo-600" />
          <p className="mt-3 text-sm">正在打开小说…</p>
        </div>
      </main>
    );
  }

  if (directoryError) {
    return (
      <main className="flex h-[100dvh] items-center justify-center bg-[#f2efe8] px-6 text-slate-700">
        <div className="max-w-sm text-center">
          <FileX2 className="mx-auto h-10 w-10 text-slate-400" />
          <h1 className="mt-4 text-lg font-semibold">小说暂时打不开</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">{directoryError}</p>
          <div className="mt-5 flex justify-center gap-3">
            <Link href={`/projects/${projectId}`} className="rounded-xl border border-stone-300 px-4 py-2 text-sm">回工作台</Link>
            <button type="button" onClick={() => void loadDirectory()} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm text-white">
              <RotateCw className="h-4 w-4" />重试
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main
      className={`flex h-[100dvh] min-h-[100dvh] flex-col overflow-hidden transition-colors ${colors.root}`}
      style={{ colorScheme: settings.theme === "night" ? "dark" : "light" }}
    >
      <header
        className={`relative z-30 shrink-0 border-b backdrop-blur-xl ${colors.chrome}`}
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="flex h-14 items-center gap-2 px-3 sm:h-16 sm:px-6">
          <Link
            href={`/projects/${projectId}`}
            aria-label="返回项目工作台"
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors ${colors.hover}`}
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className={`inline-flex h-11 items-center gap-2 rounded-xl px-3 text-sm transition-colors ${colors.hover}`}
          >
            <List className="h-5 w-5" />
            <span className="hidden sm:inline">目录</span>
          </button>

          <div className="min-w-0 flex-1 text-center">
            <p className="truncate text-sm font-semibold sm:text-base">{project?.title}</p>
            {selectedSummary && (
              <p className={`mt-0.5 truncate text-[11px] sm:text-xs ${colors.muted}`}>
                第 {chapterPosition} / {chapters.length} 章 · {selectedSummary.title}
              </p>
            )}
          </div>

          {selectedSummary && (
            <Link
              href={`/projects/${projectId}/chapters?chapterId=${encodeURIComponent(selectedSummary.id)}`}
              className={`hidden h-11 items-center gap-2 rounded-xl px-3 text-sm transition-colors sm:inline-flex ${colors.hover}`}
            >
              <PenLine className="h-4 w-4" />编辑章节
            </Link>
          )}
          <button
            type="button"
            aria-label="阅读设置"
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen((open) => !open)}
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors ${colors.hover}`}
          >
            <Settings2 className="h-5 w-5" />
          </button>
        </div>

        <div className="absolute inset-x-0 bottom-0 h-0.5 bg-black/5">
          <div className={`h-full transition-[width] duration-150 ${colors.accent}`} style={{ width: `${scrollProgress}%` }} />
        </div>

        {settingsOpen && (
          <section className={`absolute right-3 top-[calc(100%+8px)] max-h-[calc(100dvh-5.5rem)] w-[min(22rem,calc(100vw-1.5rem))] overflow-y-auto overscroll-contain rounded-2xl border p-4 shadow-2xl sm:right-6 ${colors.panel}`}>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">阅读设置</h2>
              <button type="button" aria-label="关闭设置" onClick={() => setSettingsOpen(false)} className={`rounded-lg p-2 ${colors.hover}`}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {THEME_OPTIONS.map((option) => {
                const Icon = option.icon;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setSettings((current) => ({ ...current, theme: option.value }))}
                    className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border text-xs transition-colors ${settings.theme === option.value ? colors.active : colors.subtle}`}
                  >
                    <Icon className="h-4 w-4" />{option.label}
                  </button>
                );
              })}
            </div>
            <label className="mt-5 block text-sm">
              <span className="flex justify-between"><span>字号</span><span className={colors.muted}>{settings.fontSize}px</span></span>
              <input
                type="range"
                min="16"
                max="26"
                step="1"
                value={settings.fontSize}
                onChange={(event) => setSettings((current) => ({ ...current, fontSize: Number(event.target.value) }))}
                className="mt-3 w-full accent-indigo-600"
              />
            </label>
            <label className="mt-4 block text-sm">
              <span className="flex justify-between"><span>行距</span><span className={colors.muted}>{settings.lineHeight.toFixed(1)}</span></span>
              <input
                type="range"
                min="1.6"
                max="2.4"
                step="0.1"
                value={settings.lineHeight}
                onChange={(event) => setSettings((current) => ({ ...current, lineHeight: Number(event.target.value) }))}
                className="mt-3 w-full accent-indigo-600"
              />
            </label>
          </section>
        )}
      </header>

      <section
        ref={scrollRef}
        onScroll={updateScrollProgress}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-smooth"
      >
        <article className={`mx-auto min-h-full w-full max-w-[800px] px-4 py-8 transition-colors sm:my-8 sm:min-h-[calc(100%-4rem)] sm:rounded-2xl sm:px-16 sm:py-16 sm:shadow-xl lg:px-20 ${colors.article}`}>
          {loadingChapter ? (
            <div className={`flex min-h-[55vh] items-center justify-center ${colors.muted}`}>
              <LoaderCircle className="mr-2 h-5 w-5 animate-spin" />正在加载正文…
            </div>
          ) : chapterError ? (
            <div className="flex min-h-[55vh] flex-col items-center justify-center text-center">
              <FileX2 className={`h-10 w-10 ${colors.muted}`} />
              <h2 className="mt-4 text-lg font-semibold">正文加载失败</h2>
              <p className={`mt-2 max-w-sm text-sm leading-6 ${colors.muted}`}>{chapterError}</p>
              {selectedSummary && (
                <button type="button" onClick={() => setChapterReloadToken((value) => value + 1)} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm text-white">
                  <RotateCw className="h-4 w-4" />重新加载
                </button>
              )}
            </div>
          ) : selectedSummary && chapterParagraphs.length > 0 ? (
            <>
              <div className="mb-10 border-b border-current/10 pb-8 text-center">
                <p className={`text-xs tracking-[0.25em] ${colors.muted}`}>第 {selectedSummary.number} 章</p>
                <h1 className="mt-4 text-2xl font-semibold tracking-wide sm:text-3xl">{selectedSummary.title}</h1>
                <div className={`mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs ${colors.muted}`}>
                  <span>{formatWordCount(chapter?.wordCount ?? selectedSummary.wordCount)}</span>
                  <span aria-hidden="true">·</span>
                  <span>{statusLabel(chapter ?? selectedSummary)}</span>
                  {selectedSummary.volumeTitle && <><span aria-hidden="true">·</span><span>第 {selectedSummary.volumeNumber} 卷 {selectedSummary.volumeTitle}</span></>}
                </div>
              </div>

              <div
                className="font-serif tracking-[0.015em]"
                style={{ fontSize: `${settings.fontSize}px`, lineHeight: settings.lineHeight } as CSSProperties}
              >
                {chapterParagraphs.map((paragraph, index) => (
                  <p key={`${index}-${paragraph.slice(0, 12)}`} className="mb-[1em] break-words text-justify [text-indent:2em]">
                    {paragraph}
                  </p>
                ))}
              </div>
              <div className={`mx-auto my-12 flex items-center justify-center gap-3 text-xs ${colors.muted}`}>
                <span className="h-px w-12 bg-current opacity-20" />本章完<span className="h-px w-12 bg-current opacity-20" />
              </div>
              <nav className="hidden items-center justify-between gap-4 border-t border-current/10 pt-8 sm:flex">
                <button type="button" disabled={!previousChapter} onClick={() => previousChapter && selectChapter(previousChapter)} className={`inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border px-4 text-sm disabled:cursor-not-allowed disabled:opacity-35 ${colors.subtle} ${colors.hover}`}>
                  <ChevronLeft className="h-5 w-5" />上一章
                </button>
                <button type="button" onClick={() => setDrawerOpen(true)} className={`inline-flex min-h-12 items-center justify-center rounded-xl border px-5 ${colors.subtle} ${colors.hover}`}>
                  <List className="h-5 w-5" />
                </button>
                <button type="button" disabled={!nextChapter} onClick={() => nextChapter && selectChapter(nextChapter)} className={`inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border px-4 text-sm disabled:cursor-not-allowed disabled:opacity-35 ${colors.subtle} ${colors.hover}`}>
                  下一章<ChevronRight className="h-5 w-5" />
                </button>
              </nav>
            </>
          ) : (
            <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
              <BookOpenText className={`h-12 w-12 ${colors.muted}`} />
              <h1 className="mt-5 text-xl font-semibold">这一章还没有正文</h1>
              <p className={`mt-2 max-w-sm text-sm leading-6 ${colors.muted}`}>这里只展示已保存的小说正文，不会用大纲摘要代替。完成创作并保存草稿后，就可以在这里预览。</p>
              {selectedSummary && (
                <Link href={`/projects/${projectId}/chapters?chapterId=${encodeURIComponent(selectedSummary.id)}`} className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2 text-sm font-medium text-white">
                  <PenLine className="h-4 w-4" />去创作本章
                </Link>
              )}
            </div>
          )}
        </article>
      </section>

      <nav
        aria-label="章节导航"
        className={`z-20 grid shrink-0 grid-cols-3 border-t backdrop-blur-xl sm:hidden ${colors.chrome}`}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <button type="button" disabled={!previousChapter} onClick={() => previousChapter && selectChapter(previousChapter)} className={`flex min-h-14 items-center justify-center gap-1 text-sm disabled:opacity-30 ${colors.hover}`}>
          <ChevronLeft className="h-5 w-5" />上一章
        </button>
        <button type="button" onClick={() => setDrawerOpen(true)} className={`flex min-h-14 items-center justify-center gap-1 border-x border-current/10 text-sm ${colors.hover}`}>
          <List className="h-5 w-5" />目录
        </button>
        <button type="button" disabled={!nextChapter} onClick={() => nextChapter && selectChapter(nextChapter)} className={`flex min-h-14 items-center justify-center gap-1 text-sm disabled:opacity-30 ${colors.hover}`}>
          下一章<ChevronRight className="h-5 w-5" />
        </button>
      </nav>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label="小说目录">
          <button type="button" aria-label="关闭目录" onClick={() => setDrawerOpen(false)} className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" />
          <aside
            className={`relative flex h-[100dvh] w-[min(90vw,420px)] flex-col border-r shadow-2xl ${colors.panel}`}
            style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-current/10 px-5">
              <div className="min-w-0">
                <h2 className="truncate font-semibold">{project?.title}</h2>
                <p className={`mt-0.5 text-xs ${colors.muted}`}>
                  {stats.readableChapters ?? stats.readableChapterCount ?? readableChapters.length} / {stats.totalChapters ?? stats.chapterCount ?? chapters.length} 章可阅读
                </p>
              </div>
              <button type="button" aria-label="关闭目录" onClick={() => setDrawerOpen(false)} className={`rounded-xl p-2.5 ${colors.hover}`}><X className="h-5 w-5" /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              {chapters.length === 0 ? (
                <p className={`px-3 py-10 text-center text-sm ${colors.muted}`}>还没有章节，请先生成大纲。</p>
              ) : chapters.map((item, index) => {
                const previous = chapters[index - 1];
                const showVolume = item.volumeNumber !== previous?.volumeNumber;
                const active = item.id === selectedId;
                return (
                  <div key={item.id}>
                    {showVolume && item.volumeNumber !== null && (
                      <p className={`px-3 pb-2 pt-5 text-xs font-semibold tracking-wider first:pt-2 ${colors.muted}`}>
                        第 {item.volumeNumber} 卷{item.volumeTitle ? ` · ${item.volumeTitle}` : ""}
                      </p>
                    )}
                    <button
                      type="button"
                      disabled={!item.hasContent}
                      onClick={() => selectChapter(item)}
                      className={`flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${active ? colors.active : colors.hover}`}
                    >
                      <span className={`w-9 shrink-0 text-right text-xs tabular-nums ${colors.muted}`}>{item.number}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{item.title}</span>
                        <span className={`mt-0.5 block text-[11px] ${colors.muted}`}>
                          {item.hasContent ? `${formatWordCount(item.wordCount)} · ${statusLabel(item)}` : "待创作 · 暂无正文"}
                        </span>
                      </span>
                      {item.hasContent && <ChevronRight className={`h-4 w-4 shrink-0 ${colors.muted}`} />}
                    </button>
                  </div>
                );
              })}
            </div>
            {selectedSummary && (
              <div className="shrink-0 border-t border-current/10 p-3">
                <Link href={`/projects/${projectId}/chapters?chapterId=${encodeURIComponent(selectedSummary.id)}`} className={`flex min-h-11 items-center justify-center gap-2 rounded-xl border text-sm ${colors.subtle} ${colors.hover}`}>
                  <PenLine className="h-4 w-4" />编辑当前章节
                </Link>
              </div>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}
