import type { Prisma, PrismaClient } from "@prisma/client";

type Database = PrismaClient | Prisma.TransactionClient;

export async function ownsProject(db: Database, userId: string, projectId: string) {
  const project = await db.novelProject.findFirst({
    where: { id: projectId, ownerId: userId },
    select: { id: true },
  });
  return Boolean(project);
}

export async function ownsChapter(
  db: Database,
  userId: string,
  chapterId: string,
  projectId?: string,
) {
  const chapter = await db.chapterPlan.findFirst({
    where: {
      id: chapterId,
      ...(projectId ? { projectId } : {}),
      project: { ownerId: userId },
    },
    select: { id: true, projectId: true },
  });
  return chapter;
}
