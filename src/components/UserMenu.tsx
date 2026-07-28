"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, LoaderCircle, LogOut, Settings } from "lucide-react";

import { useAuth } from "@/context/AuthContext";

function initial(value: string) {
  return Array.from(value.trim())[0]?.toUpperCase() ?? "作";
}

export function UserMenu() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  if (!user) return null;
  const name = user.displayName ?? user.email;

  async function handleLogout() {
    setLoggingOut(true);
    setError(null);
    try {
      await logout();
      router.replace("/login");
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "退出失败，请稍后重试");
      setLoggingOut(false);
    }
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => { setOpen((current) => !current); setError(null); }}
        className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-left shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-700">{initial(name)}</span>
        <span className="hidden min-w-0 sm:block">
          <span className="block max-w-32 truncate text-xs font-semibold text-slate-800">{name}</span>
          {user.displayName && <span className="block max-w-32 truncate text-[11px] text-slate-400">{user.email}</span>}
        </span>
        <ChevronDown className={`hidden h-4 w-4 text-slate-400 transition sm:block ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
          <div className="border-b border-slate-100 px-3 py-3">
            <p className="truncate text-sm font-semibold text-slate-900">{name}</p>
            <p className="mt-1 truncate text-xs text-slate-500">{user.email}</p>
          </div>
          <Link href="/settings/ai" role="menuitem" onClick={() => setOpen(false)} className="mt-1 flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-indigo-600">
            <Settings className="h-4 w-4" />AI 设置
          </Link>
          <button type="button" role="menuitem" disabled={loggingOut} onClick={() => void handleLogout()} className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-sm font-medium text-slate-600 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-wait disabled:opacity-60">
            {loggingOut ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
            {loggingOut ? "正在退出…" : "退出登录"}
          </button>
          {error && <p className="px-3 pb-2 pt-1 text-xs leading-5 text-rose-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
