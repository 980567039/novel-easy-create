import { randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

import { ProjectTransferDocumentSchema, type ProjectTransferDocument } from "./transfer-schema";

function jsonInput(value: Prisma.JsonValue): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === null) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function optionalJsonInput(value: Prisma.JsonValue | null) {
  return value === null ? undefined : jsonInput(value);
}

function remapJson(value: Prisma.JsonValue, idMap: Map<string, string>): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === null) return Prisma.JsonNull;
  if (typeof value === "string") return idMap.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => remapJson(item, idMap)) as Prisma.InputJsonArray;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, Prisma.JsonValue>);
    return Object.fromEntries(entries.map(([key, item]) => [key, remapJson(item, idMap)])) as Prisma.InputJsonObject;
  }
  return value;
}

function remapOptionalJson(value: Prisma.JsonValue | null, idMap: Map<string, string>) {
  return value === null ? undefined : remapJson(value, idMap);
}

function mapReference(value: string | null, idMap: Map<string, string>) {
  return value === null ? null : (idMap.get(value) ?? null);
}

export async function exportProject(db: PrismaClient, userId: string, projectId: string): Promise<ProjectTransferDocument | null> {
  const project = await db.novelProject.findFirst({
    where: { id: projectId, ownerId: userId },
    include: {
      storyBible: true,
      characters: { orderBy: { createdAt: "asc" } },
      relations: { orderBy: { createdAt: "asc" } },
      worldRules: { orderBy: { createdAt: "asc" } },
      volumes: { orderBy: { number: "asc" } },
      chapters: { orderBy: { number: "asc" } },
      revisions: { orderBy: [{ chapterPlanId: "asc" }, { revisionNumber: "asc" }] },
      canonFacts: { orderBy: { createdAt: "asc" } },
      storyEvents: { orderBy: { createdAt: "asc" } },
      snapshots: { orderBy: { createdAt: "asc" } },
      plotThreads: { orderBy: { createdAt: "asc" } },
      qualityIssues: { orderBy: { createdAt: "asc" } },
      decisions: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!project) return null;

  const {
    ownerId: _ownerId,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    createdBy: _createdBy,
    storyBible,
    characters,
    relations,
    worldRules,
    volumes,
    chapters,
    revisions,
    canonFacts,
    storyEvents,
    snapshots,
    plotThreads,
    qualityIssues,
    decisions,
    id: _projectId,
    ...projectData
  } = project;
  void _ownerId;
  void _createdAt;
  void _updatedAt;
  void _createdBy;
  void _projectId;

  const clean = <T extends { createdAt: Date; updatedAt: Date; projectId: string }>(entity: T) => {
    const { createdAt, updatedAt, projectId, ...data } = entity;
    void createdAt;
    void updatedAt;
    void projectId;
    return data;
  };

  const document = {
    format: "novel-role-project",
    version: 1,
    exportedAt: new Date().toISOString(),
    project: projectData,
    storyBible: storyBible ? (() => {
      const { id, ...data } = clean(storyBible);
      void id;
      return data;
    })() : null,
    characters: characters.map(clean),
    characterRelations: relations.map(clean),
    worldRules: worldRules.map(clean),
    volumes: volumes.map(clean),
    chapters: chapters.map(clean),
    revisions: revisions.map((revision) => {
      const { authorId, ...data } = clean(revision);
      void authorId;
      return data;
    }),
    canonFacts: canonFacts.map(clean),
    storyEvents: storyEvents.map(clean),
    stateSnapshots: snapshots.map(clean),
    plotThreads: plotThreads.map(clean),
    qualityIssues: qualityIssues.map(clean),
    userDecisions: decisions.map((decision) => {
      const { userId, generationJobId, ...data } = clean(decision);
      void userId;
      void generationJobId;
      return data;
    }),
  };
  // Keep the producer and consumer on the exact same portable format. This
  // also guarantees that accidentally added database fields never leak.
  return ProjectTransferDocumentSchema.parse(document);
}

export class ProjectTitleConflictError extends Error {
  readonly title: string;
  readonly conflictCount: number;

  constructor(title: string, conflictCount: number) {
    super(`项目名称已存在：${title}`);
    this.name = "ProjectTitleConflictError";
    this.title = title;
    this.conflictCount = conflictCount;
  }
}

export async function importProject(
  db: PrismaClient,
  userId: string,
  document: ProjectTransferDocument,
  options: { overwrite?: boolean } = {},
) {
  const entityCollections = [
    document.characters,
    document.characterRelations,
    document.worldRules,
    document.volumes,
    document.chapters,
    document.revisions,
    document.canonFacts,
    document.storyEvents,
    document.stateSnapshots,
    document.plotThreads,
    document.qualityIssues,
    document.userDecisions,
  ];
  const idMap = new Map<string, string>();
  for (const collection of entityCollections) {
    for (const item of collection) idMap.set(item.id, randomUUID());
  }

  return db.$transaction(async (tx) => {
    const title = document.project.title;
    // Serialize imports of the same title for this user. Without this lock,
    // two concurrent first-time imports could both observe zero conflicts.
    await tx.$queryRaw<Array<{ lock: string }>>`
      SELECT pg_advisory_xact_lock(hashtext(${`project-import:${userId}:${title}`}))::text AS lock
    `;
    const conflictCount = await tx.novelProject.count({ where: { ownerId: userId, title } });
    if (conflictCount > 0 && !options.overwrite) {
      throw new ProjectTitleConflictError(title, conflictCount);
    }
    if (conflictCount > 0) {
      // This deletion and every create below share one transaction. Any
      // validation/database failure restores all projects removed here.
      await tx.novelProject.deleteMany({ where: { ownerId: userId, title } });
    }

    const project = await tx.novelProject.create({
      data: {
        ...document.project,
        ownerId: userId,
        createdBy: "IMPORT",
      },
    });
    const projectId = project.id;

    if (document.storyBible) {
      await tx.storyBible.create({
        data: {
          ...document.storyBible,
          projectId,
          styleGuide: optionalJsonInput(document.storyBible.styleGuide),
          forbiddenExpressions: optionalJsonInput(document.storyBible.forbiddenExpressions),
        },
      });
    }
    if (document.characters.length) await tx.character.createMany({ data: document.characters.map((item) => ({
      ...item,
      id: idMap.get(item.id)!,
      projectId,
      aliases: optionalJsonInput(item.aliases),
      abilities: optionalJsonInput(item.abilities),
      sourceChapterId: mapReference(item.sourceChapterId, idMap),
    })) });
    if (document.characterRelations.length) await tx.characterRelation.createMany({ data: document.characterRelations.map((item) => ({
      ...item,
      id: idMap.get(item.id)!,
      projectId,
      fromCharacterId: idMap.get(item.fromCharacterId)!,
      toCharacterId: idMap.get(item.toCharacterId)!,
      sourceChapterId: mapReference(item.sourceChapterId, idMap),
    })) });
    if (document.worldRules.length) await tx.worldRule.createMany({ data: document.worldRules.map((item) => ({
      ...item,
      id: idMap.get(item.id)!,
      projectId,
      sourceChapterId: mapReference(item.sourceChapterId, idMap),
    })) });
    if (document.volumes.length) await tx.volumePlan.createMany({ data: document.volumes.map((item) => ({
      ...item,
      id: idMap.get(item.id)!,
      projectId,
    })) });
    if (document.chapters.length) await tx.chapterPlan.createMany({ data: document.chapters.map((item) => ({
      ...item,
      id: idMap.get(item.id)!,
      projectId,
      volumeId: mapReference(item.volumeId, idMap),
      requiredChanges: optionalJsonInput(item.requiredChanges),
    })) });
    if (document.revisions.length) await tx.chapterRevision.createMany({ data: document.revisions.map((item) => ({
      ...item,
      id: idMap.get(item.id)!,
      projectId,
      authorId: userId,
      chapterPlanId: idMap.get(item.chapterPlanId)!,
      parentRevisionId: mapReference(item.parentRevisionId, idMap),
    })) });
    if (document.canonFacts.length) await tx.canonFact.createMany({ data: document.canonFacts.map((item) => ({
      ...item,
      id: idMap.get(item.id)!,
      projectId,
      subjectId: mapReference(item.subjectId, idMap) ?? item.subjectId,
      value: remapJson(item.value, idMap),
      sourceChapterId: mapReference(item.sourceChapterId, idMap),
    })) });
    if (document.storyEvents.length) await tx.storyEvent.createMany({ data: document.storyEvents.map((item) => ({
      ...item,
      id: idMap.get(item.id)!,
      projectId,
      participantIds: remapOptionalJson(item.participantIds, idMap),
      sourceChapterId: mapReference(item.sourceChapterId, idMap),
    })) });
    if (document.stateSnapshots.length) await tx.stateSnapshot.createMany({ data: document.stateSnapshots.map((item) => ({
      ...item,
      id: idMap.get(item.id)!,
      projectId,
      chapterPlanId: mapReference(item.chapterPlanId, idMap),
      state: remapJson(item.state, idMap),
      delta: remapOptionalJson(item.delta, idMap),
    })) });
    if (document.plotThreads.length) await tx.plotThread.createMany({ data: document.plotThreads.map((item) => ({
      ...item,
      id: idMap.get(item.id)!,
      projectId,
      sourceChapterId: mapReference(item.sourceChapterId, idMap),
    })) });
    if (document.qualityIssues.length) await tx.qualityIssue.createMany({ data: document.qualityIssues.map((item) => ({
      ...item,
      id: idMap.get(item.id)!,
      projectId,
      chapterRevisionId: mapReference(item.chapterRevisionId, idMap),
      conflictingFactId: mapReference(item.conflictingFactId, idMap),
    })) });
    if (document.userDecisions.length) await tx.userDecision.createMany({ data: document.userDecisions.map((item) => ({
      ...item,
      id: idMap.get(item.id)!,
      projectId,
      userId,
      generationJobId: null,
      chapterPlanId: mapReference(item.chapterPlanId, idMap),
      selectedOption: optionalJsonInput(item.selectedOption),
      alternatives: optionalJsonInput(item.alternatives),
      impact: optionalJsonInput(item.impact),
    })) });

    return tx.novelProject.findUniqueOrThrow({ where: { id: projectId }, include: { storyBible: true } });
  }, { timeout: 60_000 });
}
