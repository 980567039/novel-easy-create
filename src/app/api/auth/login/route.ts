import {
  authErrorResponse,
  LoginInputSchema,
  loginUser,
  noStoreJson,
  setSessionCookie,
} from "@/server/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return noStoreJson({ code: "INVALID_JSON", error: "请求体必须是有效 JSON。" }, { status: 400 });
  }

  const parsed = LoginInputSchema.safeParse(body);
  if (!parsed.success) {
    return noStoreJson(
      {
        code: "VALIDATION_ERROR",
        error: "登录信息格式不正确。",
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  try {
    const result = await loginUser(parsed.data);
    const response = noStoreJson({ user: result.user });
    setSessionCookie(response, result.sessionToken);
    return response;
  } catch (error) {
    return authErrorResponse(error);
  }
}
