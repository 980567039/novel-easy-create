import type { Prisma, PrismaClient } from "@prisma/client";

type Database = PrismaClient | Prisma.TransactionClient;

type ReaderRevision = {
  content: string;
  status: string;
  wordCount: number | null;
  updatedAt: Date;
};

type ReaderChapterRecord = {
  id: string;
  number: number;
  title: string | null;
  isFinale: boolean;
  updatedAt: Date;
  volume: { number: number; title: string | null } | null;
  revisions: ReaderRevision[];
};

function countWords(content: string) {
  return content.replace(/\s+/g, "").length;
}

function latestRevision(chapter: ReaderChapterRecord) {
  return chapter.revisions[0] ?? null;
}

function revisionWordCount(revision: ReaderRevision | null) {
  if (!revision) return 0;
  return revision.wordCount ?? countWords(revision.content);
}

function toReaderChapter(chapter: ReaderChapterRecord) {
  const revision = latestRevision(chapter);
  const hasContent = Boolean(revision?.content.trim());

  return {
    id: chapter.id,
    number: chapter.number,
    title: chapter.title ?? `第 ${chapter.number} 章`,
    volumeNumber: chapter.volume?.number ?? null,
    volumeTitle: chapter.volume?.title ?? null,
    isFinale: chapter.isFinale,
    hasContent,
    revisionStatus: revision?.status ?? null,
    wordCount: hasContent ? revisionWordCount(revision) : 0,
    updatedAt: revision?.updatedAt ?? chapter.updatedAt,
  };
}

const readerChapterSelect = {
  id: true,
  number: true,
  title: true,
  isFinale: true,
  updatedAt: true,
  volume: { select: { number: true, title: true } },
  revisions: {
    orderBy: { revisionNumber: "desc" as const },
    take: 1,
    select: { content: true, status: true, wordCount: true, updatedAt: true },
  },
} satisfies Prisma.ChapterPlanSelect;

export async function getProjectReader(db: Database, userId: string, projectId: string) {
  const project = await db.novelProject.findFirst({
    where: { id: projectId, ownerId: userId },
    select: {
      id: true,
      title: true,
      genre: true,
      chapters: {
        orderBy: { number: "asc" },
        select: readerChapterSelect,
      },
    },
  });

  if (!project) return null;

  const chapters = project.chapters.map(toReaderChapter);

  return {
    project: { id: project.id, title: project.title, genre: project.genre },
    stats: {
      chapterCount: chapters.length,
      readableChapterCount: chapters.filter((chapter) => chapter.hasContent).length,
      finalChapterCount: chapters.filter((chapter) => chapter.revisionStatus === "FINAL").length,
      totalWordCount: chapters.reduce((total, chapter) => total + chapter.wordCount, 0),
    },
    chapters,
  };
}

export async function getReaderChapter(db: Database, userId: string, projectId: string, chapterId: string) {
  const project = await db.novelProject.findFirst({
    where: { id: projectId, ownerId: userId },
    select: { id: true },
  });

  if (!project) return { projectFound: false as const, chapter: null };

  const chapter = await db.chapterPlan.findFirst({
    where: { id: chapterId, projectId },
    select: readerChapterSelect,
  });

  if (!chapter) return { projectFound: true as const, chapter: null };

  const revision = latestRevision(chapter);

  return {
    projectFound: true as const,
    chapter: {
      ...toReaderChapter(chapter),
      content: revision?.content ?? "",
    },
  };
}
