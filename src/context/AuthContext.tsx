"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { apiFetch, AUTH_UNAUTHORIZED_EVENT, responseError } from "@/lib/api-client";

export const CLAIMED_PROJECTS_NOTICE_KEY = "novel-role:claimed-legacy-projects";

export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  role?: string;
}

export type AuthStatus = "loading" | "authenticated" | "unauthenticated" | "error";

interface AuthContextValue {
  user: AuthUser | null;
  status: AuthStatus;
  error: string | null;
  authenticate: (user: AuthUser) => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function normalizeAuthUser(value: unknown): AuthUser | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || typeof item.email !== "string") return null;
  return {
    id: item.id,
    email: item.email,
    displayName: typeof item.displayName === "string" && item.displayName.trim()
      ? item.displayName.trim()
      : typeof item.name === "string" && item.name.trim() ? item.name.trim() : null,
    role: typeof item.role === "string" ? item.role : undefined,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const response = await apiFetch(
        "/api/auth/me",
        { cache: "no-store" },
        { handleUnauthorized: false },
      );
      if (response.status === 401) {
        setUser(null);
        setStatus("unauthenticated");
        return;
      }
      if (!response.ok) throw await responseError(response, "暂时无法确认登录状态");
      const body = await response.json() as { user?: unknown };
      const nextUser = normalizeAuthUser(body.user);
      if (!nextUser) throw new Error("登录状态返回格式不正确");
      setUser(nextUser);
      setStatus("authenticated");
    } catch (requestError) {
      setUser(null);
      setStatus("error");
      setError(requestError instanceof Error ? requestError.message : "暂时无法确认登录状态");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const handleUnauthorized = () => {
      setUser(null);
      setError(null);
      setStatus("unauthenticated");
    };
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized);
    return () => window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized);
  }, []);

  const authenticate = useCallback((nextUser: AuthUser) => {
    setUser(nextUser);
    setError(null);
    setStatus("authenticated");
  }, []);

  const logout = useCallback(async () => {
    const response = await apiFetch(
      "/api/auth/logout",
      { method: "POST" },
      { handleUnauthorized: false },
    );
    if (!response.ok && response.status !== 401) throw await responseError(response, "退出登录失败，请稍后重试");
    setUser(null);
    setError(null);
    setStatus("unauthenticated");
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    status,
    error,
    authenticate,
    refresh,
    logout,
  }), [authenticate, error, logout, refresh, status, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth 必须在 AuthProvider 内使用");
  return context;
}
