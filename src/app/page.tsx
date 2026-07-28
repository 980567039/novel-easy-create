"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Clock3,
  Download,
  LoaderCircle,
  Plus,
  RefreshCw,
  Settings,
  Sparkles,
  Upload,
} from "lucide-react";

interface ProjectSummary {
  id: string;
  title: string;
  genre?: string | null;
  targetWordCount?: number | null;
  targetChapterCount?: number | null;
  status?: string;
  updatedAt?: string;
  storyBible?: { premise?: string | null; status?: string } | null;
}

interface ProjectsResponse {
  projects?: ProjectSummary[];
  error?: string;
}

interface ImportProjectResponse {
  project?: Pick<ProjectSummary, "id" | "title">;
  title?: string;
  message?: string;
  error?: string;
}

interface OperationNotice {
  type: "success" | "error";
  message: string;
}

interface AiSettingsSummary {
  provider: "openai" | "openai-compatible" | "lm-studio";
  model: string;
  apiKeyConfigured: boolean;
  enabled: boolean;
}

function formatDate(value?: string) {
  if (!value) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(new Date(value));
}

async function getResponseError(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { error?: string; message?: string };
    return body.error ?? body.message ?? fallback;
  } catch {
    return fallback;
  }
}

function getDownloadFilename(response: Response, project: ProjectSummary) {
  const disposition = response.headers.get("content-disposition") ?? "";
  const encodedMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (encodedMatch?.[1]) {
    try {
      return decodeURIComponent(encodedMatch[1]);
    } catch {
      // Fall back to a predictable local filename if the header is malformed.
    }
  }
  const filenameMatch = disposition.match(/filename="?([^";]+)"?/i);
  return filenameMatch?.[1] ?? `${project.title || "novel-project"}.json`;
}

export default function Home() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [aiSettings, setAiSettings] = useState<AiSettingsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [exportingProjectId, setExportingProjectId] = useState<string | null>(null);
  const [operationNotice, setOperationNotice] = useState<OperationNotice | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const loadProjects = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/projects");
      const body = (await response.json()) as ProjectsResponse;
      if (!response.ok) throw new Error(body.error ?? "暂时无法读取小说项目");
      setProjects(body.projects ?? []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "暂时无法读取小说项目");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadProjects();
    fetch("/api/settings/ai")
      .then(async (response) => {
        if (!response.ok) return;
        const body = (await response.json()) as { settings?: AiSettingsSummary };
        if (body.settings) setAiSettings(body.settings);
      })
      .catch(() => undefined);
  }, []);

  const exportProject = async (project: ProjectSummary) => {
    setExportingProjectId(project.id);
    setOperationNotice(null);
    try {
      const response = await fetch(`/api/projects/${project.id}/export`);
      if (!response.ok) throw new Error(await getResponseError(response, "项目导出失败，请稍后重试"));

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = getDownloadFilename(response, project);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      setOperationNotice({ type: "success", message: `《${project.title}》已导出` });
    } catch (requestError) {
      setOperationNotice({
        type: "error",
        message: requestError instanceof Error ? requestError.message : "项目导出失败，请稍后重试",
      });
    } finally {
      setExportingProjectId(null);
    }
  };

  const importProject = async (file: File) => {
    setImporting(true);
    setOperationNotice(null);
    try {
      if (!file.name.toLowerCase().endsWith(".json")) {
        throw new Error("请选择 JSON 格式的项目备份文件");
      }

      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/projects/import", { method: "POST", body: formData });
      const body = (await response.json().catch(() => ({}))) as ImportProjectResponse;
      if (!response.ok) throw new Error(body.error ?? body.message ?? "项目导入失败，请检查备份文件");

      const importedTitle = body.project?.title ?? body.title;
      setOperationNotice({
        type: "success",
        message: importedTitle ? `《${importedTitle}》导入成功` : body.message ?? "项目导入成功",
      });
      await loadProjects();
    } catch (requestError) {
      setOperationNotice({
        type: "error",
        message: requestError instanceof Error ? requestError.message : "项目导入失败，请检查备份文件",
      });
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  const providerLabel = aiSettings?.provider === "openai"
    ? "OpenAI"
    : aiSettings?.provider === "openai-compatible"
      ? "OpenAI-compatible"
      : "LM Studio";

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-900 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-indigo-100 p-3 text-indigo-600"><BookOpen size={25} /></div>
            <div>
              <p className="text-sm font-semibold tracking-wide text-indigo-600">小白作家</p>
              <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">你的长篇小说工作台</h1>
            </div>
          </div>
          <nav className="flex items-center gap-2">
            <Link href="/settings/ai" className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-500 transition hover:bg-white hover:text-indigo-600">
              <Settings size={17} /> AI 设置
            </Link>
            <Link href="/projects/new" className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700">
              <Plus size={17} /> 新建小说
            </Link>
          </nav>
        </header>

        <section className="mt-10 overflow-hidden rounded-3xl bg-slate-900 px-6 py-8 text-white shadow-xl sm:px-10 sm:py-10">
          <div className="max-w-2xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-indigo-200">
              <Sparkles size={14} /> 从一个想法，写到故事完结
            </div>
            <h2 className="text-3xl font-extrabold leading-tight sm:text-4xl">AI 负责记住全书，<br />你负责做出关键选择。</h2>
            <p className="mt-4 max-w-xl leading-relaxed text-slate-300">用故事圣经、大纲和章节状态管理长篇创作，让每一章都有作用，让伏笔有地方回家。</p>
            <Link href="/projects/new" className="mt-7 inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-bold text-slate-900 transition hover:bg-indigo-50">
              <Plus size={17} /> 开始创建第一本小说
            </Link>
          </div>
        </section>

        <section className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className={`h-2.5 w-2.5 rounded-full ${aiSettings?.enabled ? "bg-emerald-500" : "bg-slate-300"}`} />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">当前 AI 分析引擎</p>
              <p className="mt-1 text-sm font-bold text-slate-800">
                {aiSettings ? `${providerLabel} · ${aiSettings.model}` : "正在读取模型设置..."}
                {aiSettings && !aiSettings.apiKeyConfigured && aiSettings.provider === "openai" ? " · 尚未配置 API Key" : ""}
              </p>
            </div>
          </div>
          <Link href="/settings/ai" className="text-sm font-semibold text-indigo-600 hover:text-indigo-700">更换模型设置 →</Link>
        </section>

        <section className="mt-10">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-indigo-600">我的项目</p>
              <h2 className="mt-1 text-2xl font-extrabold tracking-tight">继续你的故事</h2>
            </div>
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <input
                ref={importInputRef}
                type="file"
                accept="application/json,.json"
                className="sr-only"
                aria-label="选择要导入的项目备份文件"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void importProject(file);
                }}
              />
              <button
                type="button"
                onClick={() => importInputRef.current?.click()}
                disabled={importing}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 shadow-sm transition hover:border-indigo-200 hover:text-indigo-600 disabled:cursor-wait disabled:opacity-60 sm:flex-none"
              >
                {importing ? <LoaderCircle size={16} className="animate-spin" /> : <Upload size={16} />}
                {importing ? "导入中..." : "导入项目"}
              </button>
              <button type="button" onClick={() => void loadProjects()} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-400 hover:bg-white hover:text-indigo-600 disabled:cursor-wait disabled:opacity-60" title="刷新项目">
                <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> 刷新
              </button>
            </div>
          </div>

          <div aria-live="polite" aria-atomic="true">
            {operationNotice && (
              <div className={`mb-5 flex items-start gap-2 rounded-2xl border px-5 py-4 text-sm ${operationNotice.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"}`}>
                {operationNotice.type === "success" ? <CheckCircle2 size={17} className="mt-0.5 shrink-0" /> : <AlertCircle size={17} className="mt-0.5 shrink-0" />}
                <span>{operationNotice.message}</span>
              </div>
            )}
          </div>

          {error && (
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
              <span className="inline-flex items-center gap-2"><AlertCircle size={17} /> {error}</span>
              <Link href="/settings/ai" className="font-semibold underline decoration-amber-300 underline-offset-4">查看 AI/数据库设置</Link>
            </div>
          )}

          {!loading && !error && projects.length === 0 && (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center shadow-sm">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-500"><BookOpen size={29} /></div>
              <h3 className="mt-5 text-xl font-bold">还没有小说项目</h3>
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-500">先回答几个简单问题，系统会帮你整理故事圣经和后续创作计划。</p>
              <Link href="/projects/new" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-700"><Plus size={17} /> 新建小说</Link>
            </div>
          )}

          {!loading && !error && projects.length > 0 && (
            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {projects.map((project) => {
                const exporting = exportingProjectId === project.id;
                return (
                  <article key={project.id} className="group flex flex-col rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md">
                    <Link href={`/projects/${project.id}`} className="flex-1 rounded-t-2xl p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500" aria-label={`打开项目《${project.title}》`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="rounded-xl bg-indigo-50 p-2.5 text-indigo-600"><BookOpen size={20} /></div>
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">{project.status === "DRAFT" ? "草稿" : project.status ?? "进行中"}</span>
                      </div>
                      <h3 className="mt-5 truncate text-lg font-bold group-hover:text-indigo-600">{project.title}</h3>
                      <p className="mt-2 min-h-10 text-sm leading-relaxed text-slate-500">{project.storyBible?.premise ?? "故事圣经尚未完成，点击继续整理。"}</p>
                    </Link>
                    <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3.5">
                      <div className="min-w-0 text-xs text-slate-400">
                        <span className="block truncate">{project.genre || "未设置题材"}</span>
                        <span className="mt-1 inline-flex items-center gap-1"><Clock3 size={13} /> {formatDate(project.updatedAt)}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => void exportProject(project)}
                        disabled={exportingProjectId !== null}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 transition hover:bg-indigo-50 hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-wait disabled:opacity-50"
                        aria-label={`导出项目《${project.title}》`}
                      >
                        {exporting ? <LoaderCircle size={15} className="animate-spin" /> : <Download size={15} />}
                        {exporting ? "导出中..." : "导出"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
