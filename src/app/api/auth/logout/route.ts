import {
  authErrorResponse,
  clearSessionCookie,
  noStoreJson,
  requireAuthenticatedUser,
  revokeCurrentSession,
} from "@/server/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await requireAuthenticatedUser(request);
    await revokeCurrentSession(request);
    const response = noStoreJson({ user });
    clearSessionCookie(response);
    return response;
  } catch (error) {
    return authErrorResponse(error);
  }
}
