import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";

import type { CreateProjectInput } from "./schema";

export const LOCAL_USER_EMAIL = "local@novel-role.local";

function answerText(answers: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = answers[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}
export async function getOrCreateLocalUser(db: PrismaClient) {
  return db.user.upsert({
    where: { email: LOCAL_USER_EMAIL },
    create: { email: LOCAL_USER_EMAIL, displayName: "本地作者" },
    update: {},
  });
}

export async function createProject(db: PrismaClient, input: CreateProjectInput) {
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
    const owner = await tx.user.upsert({
      where: { email: LOCAL_USER_EMAIL },
      create: { email: LOCAL_USER_EMAIL, displayName: "本地作者" },
      update: {},
    });

    const project = await tx.novelProject.create({
      data: {
        ownerId: owner.id,
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

export async function listProjects(db: PrismaClient) {
  const owner = await getOrCreateLocalUser(db);
  return db.novelProject.findMany({
    where: { ownerId: owner.id },
    include: { storyBible: true },
    orderBy: { updatedAt: "desc" },
  });
}
