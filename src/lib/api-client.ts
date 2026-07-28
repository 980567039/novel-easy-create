export const AUTH_UNAUTHORIZED_EVENT = "novel-role:auth-unauthorized";

export interface ApiFetchOptions {
  handleUnauthorized?: boolean;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  options: ApiFetchOptions = {},
) {
  const response = await fetch(input, {
    ...init,
    credentials: init?.credentials ?? "same-origin",
  });

  if (response.status === 401 && options.handleUnauthorized !== false && typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_UNAUTHORIZED_EVENT));
  }

  return response;
}

export async function responseError(response: Response, fallback: string) {
  try {
    const body = await response.clone().json() as { error?: string; message?: string; code?: string };
    return new ApiError(body.error ?? body.message ?? fallback, response.status, body.code);
  } catch {
    return new ApiError(fallback, response.status);
  }
}

export function safeNextPath(value: string | null | undefined, fallback = "/") {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  try {
    const base = new URL("https://novel-role.local");
    const destination = new URL(value, base);
    if (destination.origin !== base.origin) return fallback;
    if (destination.pathname === "/login" || destination.pathname === "/register") return fallback;
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return fallback;
  }
}

export function currentPath() {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}
