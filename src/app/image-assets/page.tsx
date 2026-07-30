"use client";

import Image from "next/image";
import Link from "next/link";
import { ChangeEvent, FormEvent, SyntheticEvent, useCallback, useEffect, useRef, useState } from "react";
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
  Upload,
  WandSparkles,
  X,
} from "lucide-react";

import { LogoMark } from "@/components/LogoMark";
import { UserMenu } from "@/components/UserMenu";
import { useAuth } from "@/context/AuthContext";
import { apiFetch, responseError } from "@/lib/api-client";
import {
  DEFAULT_IMAGE_ASPECT_RATIO,
  hasImageAssetAccess,
  IMAGE_ASPECT_RATIO_OPTIONS,
  imageAspectRatioLabel,
  type ImageAspectRatio,
} from "@/lib/image-assets";

type ImageAssetStatus = "GENERATING" | "READY" | "FAILED";
type ImageCreationMode = "text" | "edit";

interface ImageAsset {
  id: string;
  prompt: string;
  model?: string | null;
  size?: string | null;
  generationMode?: "TEXT_TO_IMAGE" | "IMAGE_TO_IMAGE" | null;
  aspectRatio?: string | null;
  actualWidth?: number | null;
  actualHeight?: number | null;
  mimeType?: string | null;
  byteSize?: number | null;
  status: ImageAssetStatus;
  error?: string | null;
  createdAt: string;
  previewUrl?: string | null;
  downloadUrl?: string | null;
}

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

function cssAspectRatio(asset: ImageAsset) {
  if (asset.actualWidth && asset.actualHeight) return `${asset.actualWidth} / ${asset.actualHeight}`;
  if (asset.aspectRatio?.includes(":")) return asset.aspectRatio.replace(":", " / ");
  const sizeMatch = asset.size?.match(/^(\d+)x(\d+)$/);
  return sizeMatch ? `${sizeMatch[1]} / ${sizeMatch[2]}` : "1 / 1";
}

function actualDimensions(asset: ImageAsset) {
  if (!asset.actualWidth || !asset.actualHeight) return "实际尺寸待读取";
  return `实际 ${asset.actualWidth} × ${asset.actualHeight}`;
}

function nearestAspectRatio(width: number, height: number): ImageAspectRatio {
  const target = width / height;
  return IMAGE_ASPECT_RATIO_OPTIONS.reduce((nearest, option) => {
    const [optionWidth, optionHeight] = option.value.split(":").map(Number);
    const [nearestWidth, nearestHeight] = nearest.split(":").map(Number);
    return Math.abs(optionWidth / optionHeight - target) < Math.abs(nearestWidth / nearestHeight - target) ? option.value : nearest;
  }, DEFAULT_IMAGE_ASPECT_RATIO);
}

export default function ImageAssetsPage() {
  const { user } = useAuth();
  const canGenerateImages = hasImageAssetAccess(user?.email);
  const [assets, setAssets] = useState<ImageAsset[]>([]);
  const [creationMode, setCreationMode] = useState<ImageCreationMode>("text");
  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState<ImageAspectRatio>(DEFAULT_IMAGE_ASPECT_RATIO);
  const [referenceImage, setReferenceImage] = useState<File | null>(null);
  const [referencePreviewUrl, setReferencePreviewUrl] = useState<string | null>(null);
  const referencePreviewUrlRef = useRef<string | null>(null);
  const referenceInputRef = useRef<HTMLInputElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [preparingReferenceId, setPreparingReferenceId] = useState<string | null>(null);
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

  useEffect(() => () => {
    if (referencePreviewUrlRef.current) URL.revokeObjectURL(referencePreviewUrlRef.current);
  }, []);

  const clearReferenceImage = () => {
    if (referencePreviewUrlRef.current) URL.revokeObjectURL(referencePreviewUrlRef.current);
    referencePreviewUrlRef.current = null;
    setReferencePreviewUrl(null);
    setReferenceImage(null);
    if (referenceInputRef.current) referenceInputRef.current.value = "";
  };

  const applyReferenceImage = (file: File) => {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("参考图片只支持 PNG、JPEG 或 WebP。");
      return false;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError("参考图片不能超过 20MB。");
      return false;
    }
    if (referencePreviewUrlRef.current) URL.revokeObjectURL(referencePreviewUrlRef.current);
    const previewUrl = URL.createObjectURL(file);
    referencePreviewUrlRef.current = previewUrl;
    setReferenceImage(file);
    setReferencePreviewUrl(previewUrl);
    setError(null);
    return true;
  };

  const selectReferenceImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!applyReferenceImage(file)) event.target.value = "";
  };

  const matchReferenceAspectRatio = (event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    if (image.naturalWidth > 0 && image.naturalHeight > 0) {
      setAspectRatio(nearestAspectRatio(image.naturalWidth, image.naturalHeight));
    }
  };

  const prepareAssetAsReference = async (asset: ImageAsset) => {
    if (!asset.previewUrl || preparingReferenceId) return;
    setPreparingReferenceId(asset.id);
    setError(null);
    setMessage(null);
    try {
      const response = await apiFetch(asset.previewUrl, { cache: "no-store" });
      if (!response.ok) throw await responseError(response, "暂时无法读取这张素材");
      const blob = await response.blob();
      const mimeType = blob.type.split(";")[0];
      const extension = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png";
      const file = new File([blob], `素材-${asset.id}.${extension}`, { type: mimeType });
      if (!applyReferenceImage(file)) return;
      setCreationMode("edit");
      setMessage("已将这张素材设为参考图，可以在上方输入修改要求。");
      document.getElementById("image-generator")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "暂时无法读取这张素材");
    } finally {
      setPreparingReferenceId(null);
    }
  };

  const generate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedPrompt = prompt.trim();
    if (trimmedPrompt.length < 2 || generating) return;
    if (creationMode === "edit" && !referenceImage) {
      setError("请先上传一张参考图片。");
      return;
    }
    setGenerating(true);
    setError(null);
    setMessage(null);
    try {
      let requestInit: RequestInit;
      if (creationMode === "edit" && referenceImage) {
        const formData = new FormData();
        formData.set("prompt", trimmedPrompt);
        formData.set("aspectRatio", aspectRatio);
        formData.set("image", referenceImage);
        requestInit = { method: "POST", body: formData };
      } else {
        requestInit = {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: trimmedPrompt, aspectRatio }),
        };
      }
      const response = await apiFetch("/api/image-assets", {
        ...requestInit,
      });
      if (!response.ok) throw await responseError(response, "图片生成失败，请稍后重试");
      const body = await response.json() as { asset?: ImageAsset };
      if (!body.asset) throw new Error("图片服务没有返回生成结果");
      setAssets((current) => [body.asset!, ...current.filter((asset) => asset.id !== body.asset!.id)]);
      setMessage(creationMode === "edit" ? "图片已经按参考图完成编辑并保存。" : "图片已经生成并保存到你的素材库。");
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

          <section id="image-generator" className="mt-7 scroll-mt-4 overflow-hidden rounded-3xl bg-slate-900 p-5 text-white shadow-xl sm:scroll-mt-8 sm:p-8">
            <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-indigo-200"><Sparkles size={14} />服务端独立图片引擎</div>
                <h2 className="mt-4 text-2xl font-extrabold tracking-tight sm:text-3xl">{creationMode === "edit" ? "基于参考图进行创作" : "描述你想要的画面"}</h2>
                <p className="mt-3 max-w-xl text-sm leading-7 text-slate-300">{creationMode === "edit" ? "上传一张现有图片，描述要保留和修改的内容，生成新的小说素材。参考原图仅用于本次编辑，不会永久保存。" : "可以生成角色画像、场景概念图、封面底图或宣传素材。这里使用独立图片服务，不读取账号中的小说 AI 设置。"}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
                <p className="font-semibold text-white">提示词建议</p>
                <p className="mt-2 leading-6">{creationMode === "edit" ? "明确说明哪些内容保持不变、哪些需要修改，例如：“保留人物和构图，把灯笼暖光改成冷蓝色月光”。" : "写清主体、场景、光线、构图和画面风格，例如：“明代县城雨夜，年轻账房撑伞回望，电影感侧光，写实插画”。"}</p>
              </div>
            </div>

            <form onSubmit={generate} className="mt-7 space-y-4">
              <div className="grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-white/5 p-1.5" aria-label="生成方式">
                <button type="button" disabled={generating} aria-pressed={creationMode === "text"} onClick={() => setCreationMode("text")} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-bold transition ${creationMode === "text" ? "bg-white text-slate-900 shadow" : "text-slate-300 hover:bg-white/10 hover:text-white"}`}><ImagePlus size={17} />文生图</button>
                <button type="button" disabled={generating} aria-pressed={creationMode === "edit"} onClick={() => setCreationMode("edit")} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-bold transition ${creationMode === "edit" ? "bg-white text-slate-900 shadow" : "text-slate-300 hover:bg-white/10 hover:text-white"}`}><WandSparkles size={17} />图生图</button>
              </div>

              {creationMode === "edit" && (
                <div className="rounded-2xl border border-dashed border-white/20 bg-white/5 p-3 sm:p-4">
                  <input ref={referenceInputRef} id="reference-image" type="file" accept="image/png,image/jpeg,image/webp" disabled={generating} onChange={selectReferenceImage} className="sr-only" />
                  {referencePreviewUrl && referenceImage ? (
                    <div className="grid min-w-0 gap-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-center">
                      <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-slate-800 sm:w-40">
                        <Image src={referencePreviewUrl} alt="参考图片预览" fill unoptimized sizes="160px" onLoad={matchReferenceAspectRatio} className="object-contain" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-white">{referenceImage.name}</p>
                        <p className="mt-1 text-xs text-slate-400">{formatBytes(referenceImage.size)} · 自动匹配最近画幅 · 仅用于本次编辑</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <label htmlFor="reference-image" className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg bg-white/10 px-3 text-sm font-semibold text-white hover:bg-white/15"><Upload size={15} />更换图片</label>
                          <button type="button" disabled={generating} onClick={clearReferenceImage} className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-slate-300 hover:bg-rose-500/15 hover:text-rose-200"><X size={15} />移除</button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <label htmlFor="reference-image" className="flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-xl px-4 text-center transition hover:bg-white/5">
                      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500/20 text-indigo-200"><Upload size={22} /></span>
                      <span className="mt-3 text-sm font-bold text-white">上传参考图片</span>
                      <span className="mt-1 text-xs leading-5 text-slate-400">PNG、JPEG 或 WebP，最大 20MB</span>
                    </label>
                  )}
                </div>
              )}

              <label className="block">
                <span className="sr-only">{creationMode === "edit" ? "图片修改要求" : "图片提示词"}</span>
                <textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  rows={5}
                  maxLength={4_000}
                  disabled={generating}
                  placeholder={creationMode === "edit" ? "描述要保留和修改的内容，例如：保留人物和街道构图，把灯笼暖光改成冷蓝色月光……" : "输入图片提示词，越具体越容易获得符合预期的结果……"}
                  className="w-full resize-y rounded-2xl border border-white/15 bg-white px-4 py-3 text-base leading-7 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:ring-4 focus:ring-indigo-400/20 disabled:opacity-70"
                />
              </label>
              <fieldset disabled={generating}>
                <legend className="text-xs font-semibold text-slate-300">选择画幅比例</legend>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {IMAGE_ASPECT_RATIO_OPTIONS.map((option) => {
                    const selected = aspectRatio === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setAspectRatio(option.value)}
                        className={`min-w-0 rounded-xl border px-3 py-3 text-left transition ${selected ? "border-indigo-300 bg-indigo-500/25 ring-2 ring-indigo-400/30" : "border-white/15 bg-white/5 hover:border-white/30 hover:bg-white/10"}`}
                      >
                        <span className="flex items-center gap-2">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10">
                            <span className="block max-h-5 max-w-5 rounded-sm border-2 border-current" style={{ aspectRatio: option.value.replace(":", " / "), width: option.value === "9:16" || option.value === "2:3" ? 12 : option.value === "1:1" ? 18 : 22 }} />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-sm font-bold text-white">{option.label}</span>
                            <span className="block text-xs text-indigo-200">{option.value}</span>
                          </span>
                        </span>
                        <span className="mt-2 block truncate text-[11px] text-slate-400">{option.hint}</span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs leading-5 text-slate-400">实际像素由模型决定；当前服务最大实测长边为 1672px。</p>
                <button type="submit" disabled={generating || prompt.trim().length < 2 || (creationMode === "edit" && !referenceImage)} className="inline-flex min-h-12 w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-indigo-500 px-5 text-sm font-bold text-white shadow-lg transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">
                  {generating ? <LoaderCircle size={18} className="animate-spin" /> : creationMode === "edit" ? <WandSparkles size={18} /> : <ImagePlus size={18} />}
                  {generating ? (creationMode === "edit" ? "正在编辑，可能需要几分钟…" : "正在生成，可能需要几分钟…") : (creationMode === "edit" ? "根据参考图生成" : "生成图片素材")}
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
                      <button type="button" onClick={() => setPreviewAsset(asset)} style={{ aspectRatio: cssAspectRatio(asset) }} className="group relative block w-full overflow-hidden bg-slate-100 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500" aria-label="预览生成图片">
                        <Image src={asset.previewUrl} alt={asset.prompt} fill unoptimized sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw" className="object-contain transition duration-300 group-hover:scale-[1.02]" />
                        <span className="absolute left-3 top-3 inline-flex min-h-8 items-center rounded-lg bg-slate-950/70 px-2.5 text-xs font-bold text-white backdrop-blur">{asset.generationMode === "IMAGE_TO_IMAGE" ? "图生图" : "文生图"}</span>
                        <span className="absolute right-3 top-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950/65 text-white opacity-0 backdrop-blur transition group-hover:opacity-100"><Expand size={17} /></span>
                      </button>
                    ) : (
                      <div style={{ aspectRatio: cssAspectRatio(asset) }} className="flex min-h-44 flex-col items-center justify-center bg-slate-100 px-6 text-center">
                        {asset.status === "GENERATING" ? <LoaderCircle className="animate-spin text-indigo-500" size={28} /> : <Images className="text-rose-400" size={28} />}
                        <p className="mt-3 text-sm font-semibold text-slate-700">{asset.status === "GENERATING" ? "正在生成" : "生成失败"}</p>
                        {asset.error && <p className="mt-2 line-clamp-4 text-xs leading-5 text-rose-600">{asset.error}</p>}
                      </div>
                    )}
                    <div className="p-4">
                      <p className="line-clamp-3 min-h-[3.75rem] text-sm leading-5 text-slate-700">{asset.prompt}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400"><span className="font-medium text-slate-500">{actualDimensions(asset)}</span><span>{imageAspectRatioLabel(asset.aspectRatio) ?? "历史画幅"}</span><span>{formatBytes(asset.byteSize)}</span><span>{formatDate(asset.createdAt)}</span></div>
                      <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3">
                        {asset.previewUrl && <button type="button" onClick={() => void prepareAssetAsReference(asset)} disabled={preparingReferenceId !== null || generating} className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg bg-violet-50 px-2 text-sm font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-50">{preparingReferenceId === asset.id ? <LoaderCircle size={15} className="animate-spin" /> : <WandSparkles size={15} />}再创作</button>}
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
