import {
  authErrorResponse,
  getAuthenticatedUser,
  getRegistrationStatus,
  noStoreJson,
} from "@/server/auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const [user, registration] = await Promise.all([
      getAuthenticatedUser(request),
      getRegistrationStatus(),
    ]);
    return noStoreJson({
      authenticated: Boolean(user),
      user,
      ...registration,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
