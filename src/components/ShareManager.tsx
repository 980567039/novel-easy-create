"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  Link2,
  LoaderCircle,
  RefreshCw,
  RotateCw,
  ShieldCheck,
  Unlink,
} from "lucide-react";

import { apiFetch, responseError } from "@/lib/api-client";

interface ShareManagerProps {
  projectId: string;
}

interface ShareState {
  enabled: boolean;
  url: string | null;
  updatedAt: string | null;
}

type BusyAction = "load" | "enable" | "regenerate" | "disable" | null;
type ConfirmAction = "regenerate" | "disable" | null;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function absoluteShareUrl(value: string | null, token: string | null) {
  const candidate = value ?? (token ? `/share/${encodeURIComponent(token)}` : null);
  if (!candidate) return null;
  try {
    return new URL(candidate, window.location.origin).toString();
  } catch {
    return null;
  }
}

function shareUrlStorageKey(projectId: string) {
  return `novel-role:share-url:${projectId}`;
}

function restoreStoredUrl(projectId: string, updatedAt: string | null) {
  try {
    const raw = window.sessionStorage.getItem(shareUrlStorageKey(projectId));
    if (!raw) return null;
    const stored = JSON.parse(raw) as { url?: unknown; updatedAt?: unknown };
    if (typeof stored.url !== "string" || !stored.url.trim()) return null;
    if (updatedAt && stored.updatedAt !== updatedAt) {
      window.sessionStorage.removeItem(shareUrlStorageKey(projectId));
      return null;
    }
    return absoluteShareUrl(stored.url, null);
  } catch {
    window.sessionStorage.removeItem(shareUrlStorageKey(projectId));
    return null;
  }
}

function rememberShareUrl(projectId: string, share: ShareState) {
  if (!share.url) return;
  window.sessionStorage.setItem(shareUrlStorageKey(projectId), JSON.stringify({
    url: share.url,
    updatedAt: share.updatedAt,
  }));
}

function forgetShareUrl(projectId: string) {
  window.sessionStorage.removeItem(shareUrlStorageKey(projectId));
}

function normalizeShare(value: unknown): ShareState {
  const root = asRecord(value);
  const nestedValue = root.share ?? root.publicShare ?? root.readerShare;
  const item = nestedValue === null ? {} : Object.keys(asRecord(nestedValue)).length > 0 ? asRecord(nestedValue) : root;
  const token = text(item.token) ?? text(item.shareToken) ?? text(root.token) ?? text(root.shareToken);
  const url = text(item.url)
    ?? text(item.shareUrl)
    ?? text(item.publicUrl)
    ?? text(root.url)
    ?? text(root.shareUrl)
    ?? text(root.publicUrl);
  const enabled = item.enabled === true
    || item.active === true
    || item.isEnabled === true
    || root.enabled === true
    || root.active === true
    || Boolean(token || url);
  return {
    enabled,
    url: enabled ? absoluteShareUrl(url, token) : null,
    updatedAt: text(item.updatedAt) ?? text(root.updatedAt),
  };
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("浏览器未允许复制，请手动选择链接复制");
}

export function ShareManager({ projectId }: ShareManagerProps) {
  const endpoint = `/api/projects/${projectId}/share`;
  const [share, setShare] = useState<ShareState>({ enabled: false, url: null, updatedAt: null });
  const [busy, setBusy] = useState<BusyAction>("load");
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setBusy("load");
    setError(null);
    try {
      const response = await apiFetch(endpoint, { cache: "no-store" });
      if (response.status === 404) {
        forgetShareUrl(projectId);
        setShare({ enabled: false, url: null, updatedAt: null });
        return;
      }
      if (!response.ok) throw await responseError(response, "无法读取分享状态");
      const body = await response.json().catch(() => ({})) as unknown;
      const currentShare = normalizeShare(body);
      if (!currentShare.enabled) forgetShareUrl(projectId);
      setShare({
        ...currentShare,
        url: currentShare.url ?? (currentShare.enabled ? restoreStoredUrl(projectId, currentShare.updatedAt) : null),
      });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "无法读取分享状态");
    } finally {
      setBusy(null);
    }
  }, [endpoint, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function mutate(action: Exclude<BusyAction, "load" | null>) {
    setBusy(action);
    setError(null);
    setNotice(null);
    setCopied(false);
    try {
      const method = action === "enable" ? "POST" : action === "regenerate" ? "PUT" : "DELETE";
      const response = await apiFetch(endpoint, {
        method,
        ...(action === "regenerate" ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: true }),
        } : {}),
      });
      if (!response.ok) throw await responseError(response, action === "disable" ? "关闭分享失败" : "生成分享链接失败");

      if (action === "disable") {
        forgetShareUrl(projectId);
        setShare({ enabled: false, url: null, updatedAt: null });
        setNotice("公开分享已关闭，原链接已立即失效。");
      } else {
        const body = await response.json().catch(() => ({})) as unknown;
        const nextShare = normalizeShare(body);
        if (!nextShare.enabled || !nextShare.url) throw new Error("分享链接返回格式不正确，请刷新后重试");
        rememberShareUrl(projectId, nextShare);
        setShare(nextShare);
        setNotice(action === "regenerate" ? "新链接已生成，旧链接已立即失效。" : "公开分享已开启。可复制链接发给读者。");
      }
      setConfirmAction(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "分享操作失败，请稍后重试");
    } finally {
      setBusy(null);
    }
  }

  async function copyLink() {
    if (!share.url) return;
    setError(null);
    try {
      await copyText(share.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "复制失败，请手动选择链接");
    }
  }

  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:mt-8 sm:p-6" aria-labelledby="share-heading">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-xl bg-indigo-50 p-2.5 text-indigo-600"><Link2 size={20} /></div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="share-heading" className="font-bold text-slate-900">公开阅读分享</h2>
              {busy !== "load" && (
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${share.enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                  {share.enabled ? "已开启" : "未开启"}
                </span>
              )}
            </div>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">生成一个无需登录的只读链接。链接只展示公开阅读正文，不会暴露故事大纲、AI 设置或编辑能力。</p>
          </div>
        </div>
        {!share.enabled && busy !== "load" && (
          <button type="button" disabled={busy !== null} onClick={() => void mutate("enable")} className="inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-60 sm:w-auto">
            {busy === "enable" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {busy === "enable" ? "正在开启…" : "开启公开分享"}
          </button>
        )}
      </div>

      {busy === "load" ? (
        <div className="mt-5 flex items-center gap-2 rounded-xl bg-slate-50 px-4 py-4 text-sm text-slate-500"><LoaderCircle className="h-4 w-4 animate-spin" />正在读取分享状态…</div>
      ) : share.enabled ? (
        <div className="mt-5">
          {share.url ? (
            <>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">读者访问链接</label>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <input readOnly value={share.url} onFocus={(event) => event.currentTarget.select()} className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100" />
                <button type="button" onClick={() => void copyLink()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700">
                  {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}{copied ? "已复制" : "复制链接"}
                </button>
                <a href={share.url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"><ExternalLink className="h-4 w-4" />打开</a>
              </div>
            </>
          ) : (
            <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">分享已开启。为保护链接安全，原始链接只在生成时展示；如果尚未保存，请重新生成一个新链接，旧链接会立即失效。</p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" disabled={busy !== null} onClick={() => setConfirmAction("regenerate")} className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-slate-600 hover:bg-amber-50 hover:text-amber-700 disabled:opacity-50"><RotateCw className="h-4 w-4" />重新生成链接</button>
            <button type="button" disabled={busy !== null} onClick={() => setConfirmAction("disable")} className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-slate-600 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"><Unlink className="h-4 w-4" />关闭分享</button>
          </div>
        </div>
      ) : null}

      {confirmAction && (
        <div className={`mt-4 rounded-xl border px-4 py-4 text-sm ${confirmAction === "disable" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
          <p className="font-semibold">{confirmAction === "disable" ? "确认关闭公开分享？" : "确认重新生成公开链接？"}</p>
          <p className="mt-1 leading-6">{confirmAction === "disable" ? "关闭后，当前链接会立即失效，读者将无法继续访问。" : "生成新链接后，当前旧链接会立即失效，需要把新链接重新发给读者。"}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={busy !== null} onClick={() => void mutate(confirmAction)} className={`inline-flex min-h-10 items-center gap-2 rounded-lg px-4 font-semibold text-white disabled:opacity-60 ${confirmAction === "disable" ? "bg-rose-600 hover:bg-rose-700" : "bg-amber-600 hover:bg-amber-700"}`}>
              {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}确认{confirmAction === "disable" ? "关闭" : "重新生成"}
            </button>
            <button type="button" disabled={busy !== null} onClick={() => setConfirmAction(null)} className="min-h-10 rounded-lg px-4 font-semibold hover:bg-white/60">取消</button>
          </div>
        </div>
      )}

      {notice && <p className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</p>}
      {error && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <span>{error}</span>
          {busy === null && !share.enabled && <button type="button" onClick={() => void load()} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 font-semibold hover:bg-rose-100"><RefreshCw className="h-4 w-4" />重试</button>}
        </div>
      )}
    </section>
  );
}
