"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { Eye, EyeOff, LoaderCircle, UserPlus } from "lucide-react";

import { LogoMark } from "@/components/LogoMark";
import {
  CLAIMED_PROJECTS_NOTICE_KEY,
  normalizeAuthUser,
  useAuth,
} from "@/context/AuthContext";
import { apiFetch, responseError, safeNextPath } from "@/lib/api-client";

interface SiteAuthStatus {
  registrationOpen: boolean;
  bootstrapRequired: boolean;
  bootstrapConfigured: boolean;
}

function requestedNextPath() {
  if (typeof window === "undefined") return "/";
  return safeNextPath(new URL(window.location.href).searchParams.get("next"));
}

function normalizeSiteStatus(value: unknown): SiteAuthStatus {
  const response = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const item = response.status && typeof response.status === "object" && !Array.isArray(response.status)
    ? response.status as Record<string, unknown>
    : response;
  const explicitlyClosed = item.registrationOpen === false
    || item.registrationEnabled === false
    || item.allowRegistration === false
    || item.registrationAllowed === false
    || item.canRegister === false;
  return {
    registrationOpen: !explicitlyClosed,
    bootstrapRequired: item.bootstrapRequired === true
      || item.requiresBootstrapToken === true
      || item.bootstrapTokenRequired === true,
    bootstrapConfigured: item.bootstrapConfigured === true,
  };
}

export default function RegisterPage() {
  const router = useRouter();
  const { status, authenticate } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [bootstrapToken, setBootstrapToken] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [siteStatus, setSiteStatus] = useState<SiteAuthStatus | null>(null);
  const [statusWarning, setStatusWarning] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authLinkNext, setAuthLinkNext] = useState("/");

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setAuthLinkNext(requestedNextPath());
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (status === "authenticated") router.replace(requestedNextPath());
  }, [router, status]);

  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/auth/status", { cache: "no-store" }, { handleUnauthorized: false })
      .then(async (response) => {
        if (!response.ok) throw await responseError(response, "暂时无法读取注册状态");
        const body = await response.json() as unknown;
        if (!cancelled) setSiteStatus(normalizeSiteStatus(body));
      })
      .catch((requestError: unknown) => {
        if (!cancelled) setStatusWarning(requestError instanceof Error ? requestError.message : "暂时无法读取注册状态");
      });
    return () => { cancelled = true; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("密码至少需要 8 个字符");
      return;
    }
    if (password !== confirmation) {
      setError("两次输入的密码不一致");
      return;
    }
    if (siteStatus?.bootstrapRequired && !siteStatus.bootstrapConfigured) {
      setError("站点尚未配置初始化口令，请先联系部署者完成配置");
      return;
    }
    if (siteStatus?.bootstrapRequired && !bootstrapToken.trim()) {
      setError("首次注册需要填写站点初始化口令");
      return;
    }

    setSubmitting(true);
    try {
      const response = await apiFetch(
        "/api/auth/register",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: email.trim(),
            password,
            displayName: displayName.trim(),
            ...(bootstrapToken.trim() ? { bootstrapToken: bootstrapToken.trim() } : {}),
          }),
        },
        { handleUnauthorized: false },
      );
      if (!response.ok) throw await responseError(response, "注册失败，请稍后重试");
      const body = await response.json() as { user?: unknown; claimedLegacyProjectCount?: unknown };
      const user = normalizeAuthUser(body.user);
      if (!user) throw new Error("注册成功，但用户信息格式不正确");
      const claimedCount = typeof body.claimedLegacyProjectCount === "number" && Number.isFinite(body.claimedLegacyProjectCount)
        ? Math.max(0, Math.floor(body.claimedLegacyProjectCount))
        : 0;
      if (claimedCount > 0) window.sessionStorage.setItem(CLAIMED_PROJECTS_NOTICE_KEY, String(claimedCount));
      authenticate(user);
      router.replace(requestedNextPath());
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "注册失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  const registrationClosed = siteStatus?.registrationOpen === false;
  const bootstrapUnavailable = siteStatus?.bootstrapRequired === true && !siteStatus.bootstrapConfigured;

  return (
    <main className="flex min-h-[100dvh] items-start justify-center bg-slate-50 pb-[max(1.5rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[max(1.5rem,env(safe-area-inset-top))] text-slate-900 sm:items-center sm:pb-[max(2.5rem,env(safe-area-inset-bottom))] sm:pl-[max(1.25rem,env(safe-area-inset-left))] sm:pr-[max(1.25rem,env(safe-area-inset-right))] sm:pt-[max(2.5rem,env(safe-area-inset-top))]">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center sm:mb-8">
          <Link href="/register" className="inline-flex items-center gap-3">
            <LogoMark className="h-12 w-12 drop-shadow-sm sm:h-14 sm:w-14" title="小白作家" />
            <span className="text-left"><span className="block text-sm font-semibold text-indigo-600">小白作家</span><span className="block text-lg font-extrabold sm:text-xl">创建你的作者账号</span></span>
          </Link>
        </div>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-xl shadow-slate-200/50 sm:p-8">
          <h1 className="text-2xl font-extrabold tracking-tight">开始创作</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">你的小说、AI 设置和创作进度只会归属于这个账号。</p>

          {statusWarning && <p className="mt-5 rounded-xl bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-700">{statusWarning}，仍可尝试提交注册。</p>}
          {bootstrapUnavailable && (
            <div role="alert" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm leading-6 text-amber-800">
              <p className="font-semibold">站点还没有完成首次注册配置</p>
              <p className="mt-1">请部署者设置服务端环境变量 <code className="break-all rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs">AUTH_BOOTSTRAP_TOKEN</code> 并重启服务，然后刷新本页。</p>
            </div>
          )}
          {registrationClosed ? (
            <div className="mt-6 rounded-xl bg-amber-50 px-4 py-4 text-sm leading-6 text-amber-800">当前站点已关闭新用户注册。请使用已有账号登录。</div>
          ) : (
            <form onSubmit={submit} className="mt-7 space-y-4">
              <label className="block"><span className="text-sm font-semibold text-slate-700">昵称</span><input required minLength={2} maxLength={40} autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="怎么称呼你" className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100" /></label>
              <label className="block"><span className="text-sm font-semibold text-slate-700">邮箱</span><input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="author@example.com" className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100" /></label>
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">密码</span>
                <span className="relative mt-2 block"><input type={showPassword ? "text" : "password"} required minLength={8} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 8 个字符" className="w-full rounded-xl border border-slate-200 py-3 pl-4 pr-12 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100" /><button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "隐藏密码" : "显示密码"} className="absolute inset-y-0 right-1 flex w-11 items-center justify-center rounded-lg text-slate-400 hover:text-indigo-600">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></span>
              </label>
              <label className="block"><span className="text-sm font-semibold text-slate-700">确认密码</span><input type={showPassword ? "text" : "password"} required minLength={8} autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100" /></label>
              {siteStatus?.bootstrapRequired && <label className="block"><span className="text-sm font-semibold text-slate-700">站点初始化口令</span><input type="password" required disabled={bootstrapUnavailable} autoComplete="off" value={bootstrapToken} onChange={(event) => setBootstrapToken(event.target.value)} placeholder={bootstrapUnavailable ? "请先由部署者完成服务端配置" : "由部署者提供"} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400" /><span className="mt-1.5 block text-xs leading-5 text-slate-400">仅首位站点所有者注册时需要。</span></label>}

              {error && <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-700">{error}</p>}
              <button type="submit" disabled={bootstrapUnavailable || submitting || !displayName.trim() || !email.trim() || !password || !confirmation} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-55">
                {submitting ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <UserPlus className="h-5 w-5" />}
                {submitting ? "正在创建账号…" : "注册并进入工作台"}
              </button>
            </form>
          )}

          <p className="mt-4 flex min-h-11 items-center justify-center text-center text-sm text-slate-500 sm:mt-6">已有账号？<Link href={`/login?next=${encodeURIComponent(authLinkNext)}`} className="inline-flex min-h-11 items-center pl-1 font-semibold text-indigo-600 hover:text-indigo-700">返回登录</Link></p>
        </section>
      </div>
    </main>
  );
}
