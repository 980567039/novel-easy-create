import {
  authErrorResponse,
  noStoreJson,
  requireAuthenticatedUser,
} from "@/server/auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireAuthenticatedUser(request);
    return noStoreJson({ user });
  } catch (error) {
    return authErrorResponse(error);
  }
}
