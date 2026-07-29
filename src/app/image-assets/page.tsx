"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  Download,
  Expand,
  ImagePlus,
  Images,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

import { LogoMark } from "@/components/LogoMark";
import { UserMenu } from "@/components/UserMenu";
import { useAuth } from "@/context/AuthContext";
import { apiFetch, responseError } from "@/lib/api-client";
import { hasImageAssetAccess } from "@/lib/image-assets";

type ImageAssetStatus = "GENERATING" | "READY" | "FAILED";

interface ImageAsset {
  id: string;
  prompt: string;
  model?: string | null;
  size?: string | null;
  mimeType?: string | null;
  byteSize?: number | null;
  status: ImageAssetStatus;
  error?: string | null;
  createdAt: string;
  previewUrl?: string | null;
  downloadUrl?: string | null;
}

const sizeOptions = [
  { value: "1024x1536", label: "竖图 2:3", hint: "角色、封面素材" },
  { value: "1024x1024", label: "方图 1:1", hint: "头像、社交素材" },
  { value: "1536x1024", label: "横图 3:2", hint: "场景、插图素材" },
] as const;

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatBytes(value?: number | null) {
  if (!value) return "—";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export default function ImageAssetsPage() {
  const { user } = useAuth();
  const canGenerateImages = hasImageAssetAccess(user?.email);
  const [assets, setAssets] = useState<ImageAsset[]>([]);
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState<(typeof sizeOptions)[number]["value"]>("1024x1536");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ImageAsset | null>(null);
  const [previewAsset, setPreviewAsset] = useState<ImageAsset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadAssets = useCallback(async () => {
    if (!canGenerateImages) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch("/api/image-assets", { cache: "no-store" });
      if (!response.ok) throw await responseError(response, "暂时无法读取图片素材");
      const body = await response.json() as { assets?: ImageAsset[] };
      setAssets(body.assets ?? []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "暂时无法读取图片素材");
    } finally {
      setLoading(false);
    }
  }, [canGenerateImages]);

  useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  const generate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedPrompt = prompt.trim();
    if (trimmedPrompt.length < 2 || generating) return;
    setGenerating(true);
    setError(null);
    setMessage(null);
    try {
      const response = await apiFetch("/api/image-assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: trimmedPrompt, size }),
      });
      if (!response.ok) throw await responseError(response, "图片生成失败，请稍后重试");
      const body = await response.json() as { asset?: ImageAsset };
      if (!body.asset) throw new Error("图片服务没有返回生成结果");
      setAssets((current) => [body.asset!, ...current.filter((asset) => asset.id !== body.asset!.id)]);
      setMessage("图片已经生成并保存到你的素材库。");
      setPreviewAsset(body.asset);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "图片生成失败，请稍后重试");
      await loadAssets();
    } finally {
      setGenerating(false);
    }
  };

  const deleteAsset = async () => {
    if (!deleteTarget || deletingId) return;
    const target = deleteTarget;
    setDeletingId(target.id);
    setError(null);
    try {
      const response = await apiFetch(`/api/image-assets/${target.id}`, { method: "DELETE" });
      if (!response.ok) throw await responseError(response, "图片删除失败，请稍后重试");
      setAssets((current) => current.filter((asset) => asset.id !== target.id));
      if (previewAsset?.id === target.id) setPreviewAsset(null);
      setDeleteTarget(null);
      setMessage("图片素材已删除。");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "图片删除失败，请稍后重试");
    } finally {
      setDeletingId(null);
    }
  };

  if (!canGenerateImages) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-slate-50 px-5 text-center text-slate-900">
        <div className="max-w-md rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-500"><Images size={25} /></div>
          <h1 className="mt-5 text-xl font-extrabold">图片素材功能暂未开放</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">当前账号没有访问图片素材库的权限。</p>
          <Link href="/" className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white hover:bg-indigo-700"><ArrowLeft size={17} />返回首页</Link>
        </div>
      </main>
    );
  }

  return (
    <>
      <main className="min-h-[100dvh] bg-slate-50 pb-[max(2rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[max(1.25rem,env(safe-area-inset-top))] text-slate-900 sm:px-8 sm:py-8">
        <div className="mx-auto max-w-6xl">
          <header className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <LogoMark className="h-11 w-11 shrink-0 drop-shadow-sm" title="小白作家" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-indigo-600">小白作家</p>
                <h1 className="truncate text-xl font-extrabold sm:text-2xl">图片素材库</h1>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/" className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-slate-500 hover:bg-white hover:text-indigo-600"><ArrowLeft size={17} />返回首页</Link>
              <UserMenu />
            </div>
          </header>

          <section className="mt-7 overflow-hidden rounded-3xl bg-slate-900 p-5 text-white shadow-xl sm:p-8">
            <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-indigo-200"><Sparkles size={14} />服务端独立图片引擎</div>
                <h2 className="mt-4 text-2xl font-extrabold tracking-tight sm:text-3xl">描述你想要的画面</h2>
                <p className="mt-3 max-w-xl text-sm leading-7 text-slate-300">可以生成角色画像、场景概念图、封面底图或宣传素材。这里使用独立图片服务，不读取账号中的小说 AI 设置。</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
                <p className="font-semibold text-white">提示词建议</p>
                <p className="mt-2 leading-6">写清主体、场景、光线、构图和画面风格，例如：“明代县城雨夜，年轻账房撑伞回望，电影感侧光，写实插画”。</p>
              </div>
            </div>

            <form onSubmit={generate} className="mt-7 space-y-4">
              <label className="block">
                <span className="sr-only">图片提示词</span>
                <textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  rows={5}
                  maxLength={4_000}
                  disabled={generating}
                  placeholder="输入图片提示词，越具体越容易获得符合预期的结果……"
                  className="w-full resize-y rounded-2xl border border-white/15 bg-white px-4 py-3 text-base leading-7 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:ring-4 focus:ring-indigo-400/20 disabled:opacity-70"
                />
              </label>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <label className="block min-w-0 flex-1 sm:max-w-xs">
                  <span className="mb-1.5 block text-xs font-semibold text-slate-300">图片比例</span>
                  <select value={size} onChange={(event) => setSize(event.target.value as typeof size)} disabled={generating} className="min-h-11 w-full rounded-xl border border-white/15 bg-slate-800 px-3 text-sm text-white outline-none focus:border-indigo-300">
                    {sizeOptions.map((option) => <option key={option.value} value={option.value}>{option.label} · {option.hint}</option>)}
                  </select>
                </label>
                <button type="submit" disabled={generating || prompt.trim().length < 2} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-500 px-5 text-sm font-bold text-white shadow-lg transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">
                  {generating ? <LoaderCircle size={18} className="animate-spin" /> : <ImagePlus size={18} />}
                  {generating ? "正在生成，可能需要几分钟…" : "生成图片素材"}
                </button>
              </div>
              <div className="flex items-center justify-between gap-3 text-xs text-slate-400"><span>生成完成后会自动保存，可以随时预览、下载或删除。</span><span>{prompt.length} / 4000</span></div>
            </form>
          </section>

          <section className="mt-8">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-indigo-600">我的图片</p>
                <h2 className="mt-1 text-2xl font-extrabold">已生成素材</h2>
              </div>
              <button type="button" onClick={() => void loadAssets()} disabled={loading || generating} className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-slate-500 hover:bg-white hover:text-indigo-600 disabled:opacity-50"><RefreshCw size={16} className={loading ? "animate-spin" : ""} />刷新</button>
            </div>

            {message && <p className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</p>}
            {error && <p role="alert" className="mb-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-relaxed text-rose-800">{error}</p>}

            {loading && assets.length === 0 ? (
              <div className="flex min-h-48 items-center justify-center rounded-3xl border border-slate-200 bg-white text-sm text-slate-500"><LoaderCircle className="mr-2 animate-spin" size={18} />正在读取图片素材…</div>
            ) : assets.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-500"><Images size={29} /></div>
                <h3 className="mt-5 text-lg font-bold">还没有图片素材</h3>
                <p className="mt-2 text-sm text-slate-500">在上方描述一个画面，第一张素材会出现在这里。</p>
              </div>
            ) : (
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {assets.map((asset) => (
                  <article key={asset.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    {asset.status === "READY" && asset.previewUrl ? (
                      <button type="button" onClick={() => setPreviewAsset(asset)} className="group relative block aspect-[2/3] w-full overflow-hidden bg-slate-100 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500" aria-label="预览生成图片">
                        <Image src={asset.previewUrl} alt={asset.prompt} fill unoptimized sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw" className="object-contain transition duration-300 group-hover:scale-[1.02]" />
                        <span className="absolute right-3 top-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950/65 text-white opacity-0 backdrop-blur transition group-hover:opacity-100"><Expand size={17} /></span>
                      </button>
                    ) : (
                      <div className="flex aspect-[2/3] flex-col items-center justify-center bg-slate-100 px-6 text-center">
                        {asset.status === "GENERATING" ? <LoaderCircle className="animate-spin text-indigo-500" size={28} /> : <Images className="text-rose-400" size={28} />}
                        <p className="mt-3 text-sm font-semibold text-slate-700">{asset.status === "GENERATING" ? "正在生成" : "生成失败"}</p>
                        {asset.error && <p className="mt-2 line-clamp-4 text-xs leading-5 text-rose-600">{asset.error}</p>}
                      </div>
                    )}
                    <div className="p-4">
                      <p className="line-clamp-3 min-h-[3.75rem] text-sm leading-5 text-slate-700">{asset.prompt}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400"><span>{asset.size ?? "默认尺寸"}</span><span>{formatBytes(asset.byteSize)}</span><span>{formatDate(asset.createdAt)}</span></div>
                      <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3">
                        {asset.downloadUrl && <a href={asset.downloadUrl} download className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg bg-indigo-50 px-3 text-sm font-semibold text-indigo-700 hover:bg-indigo-100"><Download size={15} />下载</a>}
                        <button type="button" onClick={() => setDeleteTarget(asset)} disabled={deletingId !== null} className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-slate-500 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"><Trash2 size={15} />删除</button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>

      {previewAsset?.previewUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="图片预览">
          <button type="button" onClick={() => setPreviewAsset(null)} className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-10 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 text-white hover:bg-white/20" aria-label="关闭预览"><X size={21} /></button>
          <div className="relative h-[calc(100dvh-7rem)] w-full max-w-5xl">
            <Image src={previewAsset.previewUrl} alt={previewAsset.prompt} fill unoptimized sizes="100vw" className="object-contain" priority />
          </div>
          <div className="absolute bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-3 right-3 flex items-center justify-center gap-2">
            {previewAsset.downloadUrl && <a href={previewAsset.downloadUrl} download className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-bold text-slate-900"><Download size={17} />下载原图</a>}
            <button type="button" onClick={() => setDeleteTarget(previewAsset)} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-rose-600 px-4 text-sm font-bold text-white"><Trash2 size={17} />删除</button>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/55 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="delete-image-title">
          <div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl sm:p-7">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-rose-100 text-rose-700"><Trash2 size={21} /></div>
            <h2 id="delete-image-title" className="mt-4 text-xl font-extrabold">删除这张图片？</h2>
            <p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-600">删除后无法恢复。提示词：{deleteTarget.prompt}</p>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setDeleteTarget(null)} disabled={deletingId !== null} className="min-h-11 rounded-xl px-4 text-sm font-semibold text-slate-600 hover:bg-slate-100">取消</button>
              <button type="button" onClick={() => void deleteAsset()} disabled={deletingId !== null} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-60">{deletingId ? <LoaderCircle size={16} className="animate-spin" /> : <Trash2 size={16} />}{deletingId ? "正在删除…" : "确认删除"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
