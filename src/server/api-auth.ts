import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/server/auth";

function isSafeMethod(method: string) {
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const requestUrl = new URL(request.url);
    const originUrl = new URL(origin);
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    const host = forwardedHost || request.headers.get("host") || requestUrl.host;
    return originUrl.host === host;
  } catch {
    return false;
  }
}

export async function authenticateApiRequest(request: Request) {
  if (!isSafeMethod(request.method) && !sameOrigin(request)) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { code: "CROSS_SITE_REQUEST_BLOCKED", error: "已拒绝跨站写入请求。" },
        { status: 403 },
      ),
    };
  }

  const user = await getAuthenticatedUser(request);
  if (!user) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { code: "UNAUTHENTICATED", error: "请先登录。" },
        { status: 401 },
      ),
    };
  }

  return { ok: true as const, user };
}
