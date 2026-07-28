import type { Prisma } from "@prisma/client";
import { z } from "zod";

const IdSchema = z.string().trim().min(1).max(200);
const NullableTextSchema = z.string().max(20_000).nullable();
const ContentSourceSchema = z.enum(["USER", "AI", "SYSTEM", "IMPORT"]);
const SuggestionStatusSchema = z.enum(["SUGGESTED", "CONFIRMED", "REJECTED", "ARCHIVED"]);
const RevisionStatusSchema = z.enum(["DRAFT", "REVIEWING", "FINAL", "ARCHIVED"]);
function isJsonValue(value: unknown): value is Prisma.JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value === "object") return Object.values(value).every((item) => item !== undefined && isJsonValue(item));
  return false;
}

const JsonValueSchema = z.custom<Prisma.JsonValue>(isJsonValue, "必须是有效的 JSON 值");

const VersionedSuggestionSchema = {
  version: z.number().int().positive().max(1_000_000),
  createdBy: ContentSourceSchema,
  status: SuggestionStatusSchema,
  locked: z.boolean(),
};

const ProjectDataSchema = z.object({
  title: z.string().trim().min(1).max(200),
  logline: NullableTextSchema,
  genre: z.string().max(100).nullable(),
  targetWordCount: z.number().int().positive().max(100_000_000).nullable(),
  targetChapterCount: z.number().int().positive().max(1_000_000).nullable(),
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"]),
  version: z.number().int().positive().max(1_000_000),
  lifecycleStatus: SuggestionStatusSchema,
  locked: z.boolean(),
}).strict();

const StoryBibleDataSchema = z.object({
  premise: NullableTextSchema,
  theme: NullableTextSchema,
  tone: NullableTextSchema,
  pointOfView: NullableTextSchema,
  styleGuide: JsonValueSchema.nullable(),
  forbiddenExpressions: JsonValueSchema.nullable(),
  ...VersionedSuggestionSchema,
}).strict().nullable();

const CharacterDataSchema = z.object({
  id: IdSchema,
  name: z.string().trim().min(1).max(500),
  aliases: JsonValueSchema.nullable(),
  role: NullableTextSchema,
  summary: NullableTextSchema,
  desire: NullableTextSchema,
  fear: NullableTextSchema,
  secret: NullableTextSchema,
  personality: NullableTextSchema,
  abilities: JsonValueSchema.nullable(),
  speechPattern: NullableTextSchema,
  arc: NullableTextSchema,
  sourceChapterId: IdSchema.nullable(),
  ...VersionedSuggestionSchema,
}).strict();

const CharacterRelationDataSchema = z.object({
  id: IdSchema,
  fromCharacterId: IdSchema,
  toCharacterId: IdSchema,
  relationType: z.string().trim().min(1).max(500),
  description: NullableTextSchema,
  strength: z.number().int().min(-1_000_000).max(1_000_000).nullable(),
  publicState: NullableTextSchema,
  trueState: NullableTextSchema,
  sourceChapterId: IdSchema.nullable(),
  ...VersionedSuggestionSchema,
}).strict();

const WorldRuleDataSchema = z.object({
  id: IdSchema,
  name: z.string().trim().min(1).max(1_000),
  content: z.string().max(1_000_000),
  scope: NullableTextSchema,
  exceptions: NullableTextSchema,
  sourceChapterId: IdSchema.nullable(),
  ...VersionedSuggestionSchema,
}).strict();

const VolumeDataSchema = z.object({
  id: IdSchema,
  number: z.number().int().positive().max(1_000_000),
  title: NullableTextSchema,
  summary: NullableTextSchema,
  goal: NullableTextSchema,
  climax: NullableTextSchema,
  endingCondition: NullableTextSchema,
  plannedWordCount: z.number().int().nonnegative().max(100_000_000).nullable(),
  ...VersionedSuggestionSchema,
}).strict();

const ChapterDataSchema = z.object({
  id: IdSchema,
  volumeId: IdSchema.nullable(),
  number: z.number().int().positive().max(1_000_000),
  title: NullableTextSchema,
  summary: NullableTextSchema,
  objective: NullableTextSchema,
  conflict: NullableTextSchema,
  expectedOutcome: NullableTextSchema,
  requiredChanges: JsonValueSchema.nullable(),
  plannedWordCount: z.number().int().nonnegative().max(10_000_000).nullable(),
  isFinale: z.boolean(),
  ...VersionedSuggestionSchema,
}).strict();

const RevisionDataSchema = z.object({
  id: IdSchema,
  chapterPlanId: IdSchema,
  parentRevisionId: IdSchema.nullable(),
  revisionNumber: z.number().int().positive().max(1_000_000),
  content: z.string().max(20_000_000),
  wordCount: z.number().int().nonnegative().max(100_000_000).nullable(),
  summary: NullableTextSchema,
  source: ContentSourceSchema,
  createdBy: ContentSourceSchema,
  status: RevisionStatusSchema,
  version: z.number().int().positive().max(1_000_000),
  locked: z.boolean(),
}).strict();

const CanonFactDataSchema = z.object({
  id: IdSchema,
  subjectType: z.string().trim().min(1).max(500),
  subjectId: IdSchema.nullable(),
  attribute: z.string().trim().min(1).max(1_000),
  value: JsonValueSchema,
  validFromChapter: z.number().int().nonnegative().max(1_000_000).nullable(),
  validToChapter: z.number().int().nonnegative().max(1_000_000).nullable(),
  confidence: z.number().finite().min(0).max(1).nullable(),
  sourceChapterId: IdSchema.nullable(),
  sourceExcerpt: z.string().max(100_000).nullable(),
  ...VersionedSuggestionSchema,
}).strict();

const StoryEventDataSchema = z.object({
  id: IdSchema,
  title: z.string().trim().min(1).max(2_000),
  description: z.string().max(1_000_000),
  storyTime: NullableTextSchema,
  chapterNumber: z.number().int().nonnegative().max(1_000_000).nullable(),
  location: NullableTextSchema,
  participantIds: JsonValueSchema.nullable(),
  cause: NullableTextSchema,
  consequence: NullableTextSchema,
  sourceChapterId: IdSchema.nullable(),
  ...VersionedSuggestionSchema,
}).strict();

const StateSnapshotDataSchema = z.object({
  id: IdSchema,
  chapterPlanId: IdSchema.nullable(),
  chapterNumber: z.number().int().nonnegative().max(1_000_000).nullable(),
  state: JsonValueSchema,
  delta: JsonValueSchema.nullable(),
  ...VersionedSuggestionSchema,
}).strict();

const PlotThreadDataSchema = z.object({
  id: IdSchema,
  title: z.string().trim().min(1).max(2_000),
  description: NullableTextSchema,
  type: z.enum(["MAIN", "SUBPLOT", "CHARACTER_ARC", "FORESHADOWING", "MYSTERY"]),
  status: z.enum(["PLANNED", "ACTIVE", "RESOLVED", "ABANDONED"]),
  startChapter: z.number().int().nonnegative().max(1_000_000).nullable(),
  plannedPayoffChapter: z.number().int().nonnegative().max(1_000_000).nullable(),
  actualPayoffChapter: z.number().int().nonnegative().max(1_000_000).nullable(),
  endingCondition: NullableTextSchema,
  version: z.number().int().positive().max(1_000_000),
  createdBy: ContentSourceSchema,
  suggestionStatus: SuggestionStatusSchema,
  locked: z.boolean(),
  sourceChapterId: IdSchema.nullable(),
}).strict();

const QualityIssueDataSchema = z.object({
  id: IdSchema,
  chapterRevisionId: IdSchema.nullable(),
  type: z.enum(["CONSISTENCY", "CAUSALITY", "CHARACTER", "PACING", "STYLE", "LANGUAGE", "CONTINUITY", "CANON_CONFLICT"]),
  severity: z.enum(["INFO", "WARNING", "ERROR", "BLOCKER"]),
  status: z.enum(["OPEN", "ACCEPTED", "FIXED", "IGNORED"]),
  message: z.string().max(100_000),
  evidence: z.string().max(1_000_000).nullable(),
  conflictingFactId: IdSchema.nullable(),
  suggestion: z.string().max(1_000_000).nullable(),
  autoFixAllowed: z.boolean(),
  version: z.number().int().positive().max(1_000_000),
  createdBy: ContentSourceSchema,
  locked: z.boolean(),
}).strict();

const UserDecisionDataSchema = z.object({
  id: IdSchema,
  chapterPlanId: IdSchema.nullable(),
  decisionType: z.string().trim().min(1).max(1_000),
  question: z.string().max(100_000),
  selectedOption: JsonValueSchema.nullable(),
  alternatives: JsonValueSchema.nullable(),
  rationale: NullableTextSchema,
  impact: JsonValueSchema.nullable(),
  status: z.enum(["PROPOSED", "ACCEPTED", "REJECTED", "SUPERSEDED"]),
  createdBy: ContentSourceSchema,
  version: z.number().int().positive().max(1_000_000),
}).strict();

export const ProjectTransferDocumentSchema = z.object({
  format: z.literal("novel-role-project"),
  version: z.literal(1),
  exportedAt: z.iso.datetime({ offset: true }),
  project: ProjectDataSchema,
  storyBible: StoryBibleDataSchema,
  characters: z.array(CharacterDataSchema).max(100_000),
  characterRelations: z.array(CharacterRelationDataSchema).max(200_000),
  worldRules: z.array(WorldRuleDataSchema).max(100_000),
  volumes: z.array(VolumeDataSchema).max(100_000),
  chapters: z.array(ChapterDataSchema).max(1_000_000),
  revisions: z.array(RevisionDataSchema).max(1_000_000),
  canonFacts: z.array(CanonFactDataSchema).max(1_000_000),
  storyEvents: z.array(StoryEventDataSchema).max(1_000_000),
  stateSnapshots: z.array(StateSnapshotDataSchema).max(1_000_000),
  plotThreads: z.array(PlotThreadDataSchema).max(1_000_000),
  qualityIssues: z.array(QualityIssueDataSchema).max(1_000_000),
  userDecisions: z.array(UserDecisionDataSchema).max(1_000_000),
}).strict().superRefine((document, context) => {
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
  const seenIds = new Set<string>();
  for (const collection of entityCollections) {
    for (const entity of collection) {
      if (seenIds.has(entity.id)) {
        context.addIssue({ code: "custom", message: `实体 ID 重复：${entity.id}` });
      }
      seenIds.add(entity.id);
    }
  }

  const characterIds = new Set(document.characters.map((item) => item.id));
  const volumeIds = new Set(document.volumes.map((item) => item.id));
  const chapterIds = new Set(document.chapters.map((item) => item.id));
  const revisionIds = new Set(document.revisions.map((item) => item.id));
  const factIds = new Set(document.canonFacts.map((item) => item.id));
  const requireReference = (value: string | null, ids: Set<string>, label: string) => {
    if (value !== null && !ids.has(value)) {
      context.addIssue({ code: "custom", message: `${label} 引用了不存在的实体：${value}` });
    }
  };
  for (const relation of document.characterRelations) {
    requireReference(relation.fromCharacterId, characterIds, "人物关系");
    requireReference(relation.toCharacterId, characterIds, "人物关系");
  }
  for (const chapter of document.chapters) requireReference(chapter.volumeId, volumeIds, "章节卷引用");
  for (const revision of document.revisions) {
    requireReference(revision.chapterPlanId, chapterIds, "正文章节引用");
    requireReference(revision.parentRevisionId, revisionIds, "正文父版本引用");
  }
  for (const snapshot of document.stateSnapshots) requireReference(snapshot.chapterPlanId, chapterIds, "状态快照章节引用");
  for (const issue of document.qualityIssues) {
    requireReference(issue.chapterRevisionId, revisionIds, "质量问题正文引用");
    requireReference(issue.conflictingFactId, factIds, "质量问题事实引用");
  }
  for (const decision of document.userDecisions) requireReference(decision.chapterPlanId, chapterIds, "创作决策章节引用");
});

export type ProjectTransferDocument = z.infer<typeof ProjectTransferDocumentSchema>;
