export { clearSessionCookie, sessionCookieName, setSessionCookie } from "./cookie";
export { AuthError } from "./errors";
export { authErrorResponse, noStoreJson, unauthorizedResponse } from "./http";
export { LoginInputSchema, RegisterInputSchema } from "./schema";
export {
  getAuthenticatedUser,
  getRegistrationStatus,
  loginUser,
  normalizeEmail,
  registerUser,
  requireAuthenticatedUser,
  revokeCurrentSession,
} from "./service";
export type { LoginResult, RegistrationResult, SafeUser } from "./types";
