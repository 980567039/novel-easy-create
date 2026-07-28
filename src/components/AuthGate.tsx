"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LoaderCircle, RefreshCw } from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { currentPath, safeNextPath } from "@/lib/api-client";

const PUBLIC_PATHS = new Set(["/login", "/register"]);

export function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { status, error, refresh } = useAuth();
  const isPublic = PUBLIC_PATHS.has(pathname);

  useEffect(() => {
    if (!isPublic && status === "unauthenticated") {
      const next = safeNextPath(currentPath());
      router.replace(`/login?next=${encodeURIComponent(next)}`);
    }
  }, [isPublic, router, status]);

  if (isPublic) return children;

  if (status === "error") {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-slate-50 px-6 text-center text-slate-700">
        <div className="max-w-sm">
          <h1 className="text-lg font-bold">暂时无法确认登录状态</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">{error ?? "请检查网络连接后重试。"}</p>
          <button type="button" onClick={() => void refresh()} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
            <RefreshCw className="h-4 w-4" />重新连接
          </button>
        </div>
      </main>
    );
  }

  if (status !== "authenticated") {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-slate-50 text-sm text-slate-500">
        <LoaderCircle className="mr-2 h-5 w-5 animate-spin text-indigo-600" />正在确认登录状态…
      </main>
    );
  }

  return children;
}
