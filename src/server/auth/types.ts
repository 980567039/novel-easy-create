import type { UserRole } from "@prisma/client";

export type SafeUser = {
  id: string;
  email: string;
  displayName: string | null;
  role: UserRole;
};

export type RegistrationResult = {
  user: SafeUser;
  sessionToken: string;
  claimedLegacyProjectCount: number;
};

export type LoginResult = {
  user: SafeUser;
  sessionToken: string;
};
