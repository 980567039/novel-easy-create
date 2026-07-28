import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";

import type { CreateProjectInput } from "./schema";

function answerText(answers: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = answers[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export async function createProject(db: PrismaClient, userId: string, input: CreateProjectInput) {
  const answers = input.onboardingAnswers ?? input.onboarding ?? {};
  const premise = answerText(answers, ["premise", "storyPremise", "coreConflict"]);
  const theme = answerText(answers, ["theme"]);
  const tone = answerText(answers, ["tone", "style"]);
  const pointOfView = answerText(answers, ["pointOfView", "perspective", "narrativePerspective"]);
  const logline = answerText(answers, ["logline", "oneSentence", "premise"]);
  const styleGuide = {
    onboardingAnswers: answers as Prisma.InputJsonValue,
  } as Prisma.InputJsonValue;

  return db.$transaction(async (tx) => {
    const project = await tx.novelProject.create({
      data: {
        ownerId: userId,
        title: input.title,
        genre: input.genre ?? null,
        logline,
        targetWordCount: input.targetWordCount ?? null,
        targetChapterCount: input.targetChapterCount ?? null,
        createdBy: "USER",
        status: "DRAFT",
        lifecycleStatus: "CONFIRMED",
      },
    });

    await tx.storyBible.create({
      data: {
        projectId: project.id,
        premise,
        theme,
        tone,
        pointOfView,
        styleGuide,
        createdBy: "USER",
        status: "SUGGESTED",
      },
    });

    return tx.novelProject.findUniqueOrThrow({
      where: { id: project.id },
      include: { storyBible: true },
    });
  });
}

export async function listProjects(db: PrismaClient, userId: string) {
  return db.novelProject.findMany({
    where: { ownerId: userId },
    include: { storyBible: true },
    orderBy: { updatedAt: "desc" },
  });
}

export type DeleteProjectResult =
  | { status: "not_found" }
  | { status: "title_mismatch"; actualTitle: string }
  | { status: "deleted"; deletedProject: { id: string; title: string } };

export async function deleteProject(
  db: PrismaClient,
  userId: string,
  projectId: string,
  confirmationTitle: string,
): Promise<DeleteProjectResult> {
  return db.$transaction(async (tx) => {
    const project = await tx.novelProject.findFirst({
      where: { id: projectId, ownerId: userId },
      select: { id: true, title: true },
    });
    if (!project) return { status: "not_found" };
    if (project.title !== confirmationTitle) {
      return { status: "title_mismatch", actualTitle: project.title };
    }

    await tx.novelProject.delete({ where: { id: project.id } });
    return { status: "deleted", deletedProject: project };
  });
}
