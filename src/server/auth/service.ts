import { cookies } from "next/headers";
import { Prisma, type PrismaClient, type User } from "@prisma/client";

import { getDatabase } from "@/server/db";
import { SESSION_TTL_SECONDS, sessionCookieName } from "./cookie";
import {
  constantTimeTokenEqual,
  createSessionToken,
  hashPassword,
  hashSessionToken,
  verifyPassword,
} from "./crypto";
import { AuthError } from "./errors";
import type { LoginInput, RegisterInput } from "./schema";
import type { LoginResult, RegistrationResult, SafeUser } from "./types";

const AUTH_BOOTSTRAP_ID = "primary";
const AUTH_BOOTSTRAP_LOCK = "novel-role:auth-bootstrap";
const LEGACY_LOCAL_USER_EMAIL = "local@novel-role.local";
const MAX_TRANSACTION_RETRIES = 3;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const safeUserSelect = {
  id: true,
  email: true,
  displayName: true,
  role: true,
} satisfies Prisma.UserSelect;

type SafeUserRecord = Pick<User, "id" | "email" | "displayName" | "role">;

function toSafeUser(user: SafeUserRecord): SafeUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
  };
}

export function normalizeEmail(email: string) {
  return email.normalize("NFKC").trim().toLowerCase();
}

function defaultDisplayName(email: string) {
  return email.split("@", 1)[0]?.slice(0, 100) || "新作者";
}

function bootstrapTokenFromEnvironment() {
  const token = process.env.AUTH_BOOTSTRAP_TOKEN?.trim() ?? "";
  return token || null;
}

function assertBootstrapToken(provided: string | undefined) {
  const expected = bootstrapTokenFromEnvironment();
  if (!expected) {
    throw new AuthError("AUTH_BOOTSTRAP_NOT_CONFIGURED", "首次注册尚未配置安全令牌。", 503);
  }
  if (!provided || !constantTimeTokenEqual(provided, expected)) {
    throw new AuthError("UNAUTHORIZED", "首次注册凭据无效。", 401);
  }
}

function sessionExpiry() {
  return new Date(Date.now() + SESSION_TTL_SECONDS * 1_000);
}

function isRetryableTransactionError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

function translateUniqueConstraint(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new AuthError("EMAIL_ALREADY_REGISTERED", "该邮箱已注册。", 409);
  }
  throw error;
}

async function findEmailConflict(db: Prisma.TransactionClient, normalizedEmail: string, excludedUserId?: string) {
  return db.user.findFirst({
    where: {
      ...(excludedUserId ? { id: { not: excludedUserId } } : {}),
      OR: [
        { normalizedEmail },
        { email: { equals: normalizedEmail, mode: "insensitive" } },
      ],
    },
    select: { id: true },
  });
}

async function registerInTransaction(
  db: PrismaClient,
  input: RegisterInput,
  normalizedEmail: string,
  passwordHash: string,
  sessionToken: string,
): Promise<RegistrationResult> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ lock: string }>>`
      SELECT pg_advisory_xact_lock(hashtext(${AUTH_BOOTSTRAP_LOCK}))::text AS lock
    `;

    const bootstrap = await tx.authBootstrap.upsert({
      where: { id: AUTH_BOOTSTRAP_ID },
      create: { id: AUTH_BOOTSTRAP_ID },
      update: {},
      select: { id: true, claimedAt: true },
    });
    const isBootstrapRegistration = bootstrap.claimedAt === null;

    let user: SafeUserRecord;
    let claimedLegacyProjectCount = 0;

    if (isBootstrapRegistration) {
      assertBootstrapToken(input.bootstrapToken);

      let legacyUser = await tx.user.findUnique({
        where: { email: LEGACY_LOCAL_USER_EMAIL },
        select: { id: true, email: true, authInitializedAt: true },
      });
      if (!legacyUser) {
        const existingUserCount = await tx.user.count();
        if (existingUserCount > 0) {
          throw new AuthError("AUTH_BOOTSTRAP_STATE_INVALID", "首次注册状态异常，请联系管理员。", 409);
        }
        legacyUser = await tx.user.create({
          data: { email: LEGACY_LOCAL_USER_EMAIL, displayName: "本地作者" },
          select: { id: true, email: true, authInitializedAt: true },
        });
      }
      if (legacyUser.authInitializedAt) {
        throw new AuthError("REGISTRATION_CLOSED", "首次注册已完成。", 409);
      }
      if (normalizedEmail === normalizeEmail(LEGACY_LOCAL_USER_EMAIL)) {
        throw new AuthError("RESERVED_EMAIL", "该邮箱为系统保留地址。", 400);
      }
      if (await findEmailConflict(tx, normalizedEmail, legacyUser.id)) {
        throw new AuthError("EMAIL_ALREADY_REGISTERED", "该邮箱已注册。", 409);
      }

      claimedLegacyProjectCount = await tx.novelProject.count({ where: { ownerId: legacyUser.id } });
      const claimedAt = new Date();
      const claim = await tx.user.updateMany({
        where: {
          id: legacyUser.id,
          email: LEGACY_LOCAL_USER_EMAIL,
          authInitializedAt: null,
        },
        data: {
          email: normalizedEmail,
          normalizedEmail,
          passwordHash,
          authInitializedAt: claimedAt,
          displayName: input.displayName ?? defaultDisplayName(normalizedEmail),
        },
      });
      if (claim.count !== 1) {
        throw new AuthError("REGISTRATION_CLOSED", "首次注册已完成。", 409);
      }

      await tx.chapterRevision.updateMany({
        where: {
          authorId: null,
          source: "USER",
          project: { ownerId: legacyUser.id },
        },
        data: { authorId: legacyUser.id },
      });
      await tx.generationJob.updateMany({
        where: { requesterId: null, project: { ownerId: legacyUser.id } },
        data: { requesterId: legacyUser.id },
      });
      await tx.userDecision.updateMany({
        where: { userId: null, project: { ownerId: legacyUser.id } },
        data: { userId: legacyUser.id },
      });

      const bootstrapClaim = await tx.authBootstrap.updateMany({
        where: { id: AUTH_BOOTSTRAP_ID, claimedAt: null },
        data: { claimedAt, claimedById: legacyUser.id },
      });
      if (bootstrapClaim.count !== 1) {
        throw new AuthError("REGISTRATION_CLOSED", "首次注册已完成。", 409);
      }
      user = await tx.user.findUniqueOrThrow({ where: { id: legacyUser.id }, select: safeUserSelect });
    } else {
      if (normalizedEmail === normalizeEmail(LEGACY_LOCAL_USER_EMAIL)) {
        throw new AuthError("RESERVED_EMAIL", "该邮箱为系统保留地址。", 400);
      }
      if (await findEmailConflict(tx, normalizedEmail)) {
        throw new AuthError("EMAIL_ALREADY_REGISTERED", "该邮箱已注册。", 409);
      }
      user = await tx.user.create({
        data: {
          email: normalizedEmail,
          normalizedEmail,
          passwordHash,
          authInitializedAt: new Date(),
          displayName: input.displayName ?? defaultDisplayName(normalizedEmail),
        },
        select: safeUserSelect,
      });
    }

    await tx.session.create({
      data: {
        userId: user.id,
        tokenHash: hashSessionToken(sessionToken),
        expiresAt: sessionExpiry(),
      },
    });

    return { user: toSafeUser(user), sessionToken, claimedLegacyProjectCount };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 10_000,
    timeout: 20_000,
  });
}

export async function registerUser(input: RegisterInput): Promise<RegistrationResult> {
  const normalizedEmail = normalizeEmail(input.email);
  const passwordHash = await hashPassword(input.password);
  const sessionToken = createSessionToken();
  const db = getDatabase();

  for (let attempt = 0; attempt < MAX_TRANSACTION_RETRIES; attempt += 1) {
    try {
      return await registerInTransaction(db, input, normalizedEmail, passwordHash, sessionToken);
    } catch (error) {
      if (isRetryableTransactionError(error) && attempt + 1 < MAX_TRANSACTION_RETRIES) continue;
      translateUniqueConstraint(error);
    }
  }
  throw new AuthError("REGISTRATION_FAILED", "注册失败，请稍后重试。", 503);
}

async function createLoginSession(db: PrismaClient, userId: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const sessionToken = createSessionToken();
    try {
      await db.session.create({
        data: {
          userId,
          tokenHash: hashSessionToken(sessionToken),
          expiresAt: sessionExpiry(),
        },
      });
      return sessionToken;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") || attempt === 2) throw error;
    }
  }
  throw new AuthError("LOGIN_FAILED", "登录失败，请稍后重试。", 503);
}

export async function loginUser(input: LoginInput): Promise<LoginResult> {
  const db = getDatabase();
  const normalizedEmail = normalizeEmail(input.email);
  const user = await db.user.findFirst({
    where: { normalizedEmail },
    select: { ...safeUserSelect, passwordHash: true, authInitializedAt: true },
  });

  const passwordMatches = user?.passwordHash
    ? await verifyPassword(input.password, user.passwordHash)
    : (await hashPassword(input.password), false);
  if (!user || !user.authInitializedAt || !passwordMatches) {
    throw new AuthError("UNAUTHORIZED", "邮箱或密码不正确。", 401);
  }

  const sessionToken = await createLoginSession(db, user.id);
  return { user: toSafeUser(user), sessionToken };
}

function cookieValue(request?: Request) {
  if (!request) return null;
  const expectedName = sessionCookieName();
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (name === expectedName) return part.slice(separator + 1).trim();
  }
  return null;
}

async function currentSessionToken(request?: Request) {
  const fromRequest = cookieValue(request);
  if (fromRequest !== null) return fromRequest;
  if (request) return null;
  return (await cookies()).get(sessionCookieName())?.value ?? null;
}

export async function getAuthenticatedUser(request?: Request): Promise<SafeUser | null> {
  const token = await currentSessionToken(request);
  if (!token || !SESSION_TOKEN_PATTERN.test(token)) return null;

  const session = await getDatabase().session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    select: {
      expiresAt: true,
      revokedAt: true,
      user: { select: safeUserSelect },
    },
  });
  if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) return null;
  return toSafeUser(session.user);
}

export async function requireAuthenticatedUser(request?: Request): Promise<SafeUser> {
  const user = await getAuthenticatedUser(request);
  if (!user) throw new AuthError("UNAUTHORIZED", "请先登录。", 401);
  return user;
}

export async function revokeCurrentSession(request?: Request) {
  const token = await currentSessionToken(request);
  if (!token || !SESSION_TOKEN_PATTERN.test(token)) return false;
  const result = await getDatabase().session.updateMany({
    where: { tokenHash: hashSessionToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count > 0;
}

export async function getRegistrationStatus() {
  const bootstrap = await getDatabase().authBootstrap.findUnique({
    where: { id: AUTH_BOOTSTRAP_ID },
    select: { claimedAt: true },
  });
  return {
    bootstrapRequired: !bootstrap?.claimedAt,
    bootstrapConfigured: Boolean(bootstrapTokenFromEnvironment()),
  };
}
