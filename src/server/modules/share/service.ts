import { createHash, randomBytes } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";

type Database = PrismaClient | Prisma.TransactionClient;

const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function hashToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function newToken() {
  return randomBytes(32).toString("base64url");
}

function shareMetadata(share: {
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
} | null) {
  return {
    enabled: Boolean(share && !share.revokedAt),
    createdAt: share?.createdAt ?? null,
    updatedAt: share?.updatedAt ?? null,
    revokedAt: share?.revokedAt ?? null,
  };
}

export async function getProjectShare(db: Database, userId: string, projectId: string) {
  const project = await db.novelProject.findFirst({
    where: { id: projectId, ownerId: userId },
    select: {
      id: true,
      publicReaderShare: {
        select: { revokedAt: true, createdAt: true, updatedAt: true },
      },
    },
  });
  if (!project) return null;
  return shareMetadata(project.publicReaderShare);
}

/**
 * Creates or rotates a public reader token. The raw token is returned exactly
 * once; only its SHA-256 digest is persisted.
 */
export async function issueProjectShare(db: Database, userId: string, projectId: string) {
  const token = newToken();
  const tokenHash = hashToken(token);
  const share = await db.$transaction(async (tx) => {
    const project = await tx.novelProject.findFirst({
      where: { id: projectId, ownerId: userId },
      select: { id: true },
    });
    if (!project) return null;

    return tx.publicReaderShare.upsert({
      where: { projectId: project.id },
      create: { projectId: project.id, tokenHash },
      update: { tokenHash, revokedAt: null },
      select: { revokedAt: true, createdAt: true, updatedAt: true },
    });
  });
  if (!share) return null;
  return { token, share: shareMetadata(share) };
}

/** Removing the row makes revocation immediate and keeps old hashes out of storage. */
export async function revokeProjectShare(db: Database, userId: string, projectId: string) {
  return db.$transaction(async (tx) => {
    const project = await tx.novelProject.findFirst({
      where: { id: projectId, ownerId: userId },
      select: { id: true },
    });
    if (!project) return null;
    await tx.publicReaderShare.deleteMany({ where: { projectId: project.id } });
    return shareMetadata(null);
  });
}

async function resolvePublicProject(db: Database, token: string) {
  if (!SHARE_TOKEN_PATTERN.test(token)) return null;
  const share = await db.publicReaderShare.findFirst({
    where: { tokenHash: hashToken(token), revokedAt: null },
    select: {
      project: { select: { id: true, title: true, genre: true } },
    },
  });
  return share?.project ?? null;
}

const publicChapterSelect = {
  id: true,
  number: true,
  title: true,
  isFinale: true,
  volume: { select: { number: true, title: true } },
  revisions: {
    where: { status: "FINAL" as const, content: { not: "" } },
    orderBy: { revisionNumber: "desc" as const },
    take: 1,
    select: { content: true, wordCount: true },
  },
} satisfies Prisma.ChapterPlanSelect;

type PublicChapterRecord = {
  id: string;
  number: number;
  title: string | null;
  isFinale: boolean;
  volume: { number: number; title: string | null } | null;
  revisions: Array<{ content: string; wordCount: number | null }>;
};

function countWords(content: string) {
  return content.replace(/\s+/g, "").length;
}

function toPublicChapter(chapter: PublicChapterRecord) {
  const revision = chapter.revisions[0]!;
  return {
    id: chapter.id,
    number: chapter.number,
    title: chapter.title ?? `第 ${chapter.number} 章`,
    volumeNumber: chapter.volume?.number ?? null,
    volumeTitle: chapter.volume?.title ?? null,
    isFinale: chapter.isFinale,
    hasContent: true,
    wordCount: revision.wordCount ?? countWords(revision.content),
  };
}

export async function getPublicReaderDirectory(db: Database, token: string) {
  const project = await resolvePublicProject(db, token);
  if (!project) return null;

  const records = await db.chapterPlan.findMany({
    where: {
      projectId: project.id,
      revisions: { some: { status: "FINAL", content: { not: "" } } },
    },
    orderBy: { number: "asc" },
    select: publicChapterSelect,
  });
  const chapters = records.map(toPublicChapter);
  return {
    project: { title: project.title, genre: project.genre },
    stats: {
      chapterCount: chapters.length,
      readableChapterCount: chapters.length,
      totalWordCount: chapters.reduce((total, chapter) => total + chapter.wordCount, 0),
    },
    chapters,
  };
}

export async function getPublicReaderChapter(db: Database, token: string, chapterId: string) {
  const project = await resolvePublicProject(db, token);
  if (!project) return null;

  const record = await db.chapterPlan.findFirst({
    where: {
      id: chapterId,
      projectId: project.id,
      revisions: { some: { status: "FINAL", content: { not: "" } } },
    },
    select: publicChapterSelect,
  });
  if (!record || !record.revisions[0]) return null;
  return {
    ...toPublicChapter(record),
    content: record.revisions[0].content,
  };
}
