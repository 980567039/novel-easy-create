import { NextResponse } from "next/server";

import { AuthError } from "./errors";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export function unauthorizedResponse(message = "请先登录。") {
  return NextResponse.json(
    { code: "UNAUTHORIZED", error: message },
    { status: 401, headers: NO_STORE_HEADERS },
  );
}

export function authErrorResponse(error: unknown) {
  if (error instanceof AuthError) {
    if (error.status === 401) return unauthorizedResponse(error.message);
    return NextResponse.json(
      { code: error.code, error: error.message },
      { status: error.status, headers: NO_STORE_HEADERS },
    );
  }
  console.error("[auth] request failed");
  return NextResponse.json(
    { code: "AUTH_SERVICE_UNAVAILABLE", error: "认证服务暂不可用，请稍后重试。" },
    { status: 503, headers: NO_STORE_HEADERS },
  );
}

export function noStoreJson(body: unknown, init?: { status?: number }) {
  return NextResponse.json(body, {
    ...init,
    headers: NO_STORE_HEADERS,
  });
}
