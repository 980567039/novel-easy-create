"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { Eye, EyeOff, LoaderCircle, LogIn } from "lucide-react";

import { LogoMark } from "@/components/LogoMark";
import { normalizeAuthUser, useAuth } from "@/context/AuthContext";
import { apiFetch, responseError, safeNextPath } from "@/lib/api-client";

function requestedNextPath() {
  if (typeof window === "undefined") return "/";
  return safeNextPath(new URL(window.location.href).searchParams.get("next"));
}

export default function LoginPage() {
  const router = useRouter();
  const { status, authenticate } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await apiFetch(
        "/api/auth/login",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim(), password }),
        },
        { handleUnauthorized: false },
      );
      if (!response.ok) throw await responseError(response, response.status === 401 ? "邮箱或密码不正确" : "登录失败，请稍后重试");
      const body = await response.json() as { user?: unknown };
      const user = normalizeAuthUser(body.user);
      if (!user) throw new Error("登录成功，但用户信息格式不正确");
      authenticate(user);
      router.replace(requestedNextPath());
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "登录失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-[100dvh] items-start justify-center bg-slate-50 pb-[max(1.5rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[max(1.5rem,env(safe-area-inset-top))] text-slate-900 sm:items-center sm:pb-[max(2.5rem,env(safe-area-inset-bottom))] sm:pl-[max(1.25rem,env(safe-area-inset-left))] sm:pr-[max(1.25rem,env(safe-area-inset-right))] sm:pt-[max(2.5rem,env(safe-area-inset-top))]">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center sm:mb-8">
          <Link href="/login" className="inline-flex items-center gap-3">
            <LogoMark className="h-12 w-12 drop-shadow-sm sm:h-14 sm:w-14" title="小白作家" />
            <span className="text-left"><span className="block text-sm font-semibold text-indigo-600">小白作家</span><span className="block text-lg font-extrabold sm:text-xl">把故事一直写到完结</span></span>
          </Link>
        </div>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-xl shadow-slate-200/50 sm:p-8">
          <h1 className="text-2xl font-extrabold tracking-tight">欢迎回来</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">登录后继续你的小说、大纲和章节创作。</p>

          <form onSubmit={submit} className="mt-7 space-y-5">
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">邮箱</span>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="author@example.com"
                className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
              />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">密码</span>
              <span className="relative mt-2 block">
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 py-3 pl-4 pr-12 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
                />
                <button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "隐藏密码" : "显示密码"} className="absolute inset-y-0 right-1 flex w-11 items-center justify-center rounded-lg text-slate-400 hover:text-indigo-600">
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </span>
            </label>

            {error && <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-700">{error}</p>}

            <button type="submit" disabled={submitting || !email.trim() || !password} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-55">
              {submitting ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <LogIn className="h-5 w-5" />}
              {submitting ? "正在登录…" : "登录"}
            </button>
          </form>

          <p className="mt-4 flex min-h-11 items-center justify-center text-center text-sm text-slate-500 sm:mt-6">还没有账号？<Link href={`/register?next=${encodeURIComponent(authLinkNext)}`} className="inline-flex min-h-11 items-center pl-1 font-semibold text-indigo-600 hover:text-indigo-700">注册成为作者</Link></p>
        </section>
      </div>
    </main>
  );
}
