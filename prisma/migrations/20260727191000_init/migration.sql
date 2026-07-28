-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ContentSource" AS ENUM ('USER', 'AI', 'SYSTEM', 'IMPORT');

-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('SUGGESTED', 'CONFIRMED', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'EDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RevisionStatus" AS ENUM ('DRAFT', 'REVIEWING', 'FINAL', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PlotThreadType" AS ENUM ('MAIN', 'SUBPLOT', 'CHARACTER_ARC', 'FORESHADOWING', 'MYSTERY');

-- CreateEnum
CREATE TYPE "PlotThreadStatus" AS ENUM ('PLANNED', 'ACTIVE', 'RESOLVED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "QualityIssueType" AS ENUM ('CONSISTENCY', 'CAUSALITY', 'CHARACTER', 'PACING', 'STYLE', 'LANGUAGE', 'CONTINUITY', 'CANON_CONFLICT');

-- CreateEnum
CREATE TYPE "QualitySeverity" AS ENUM ('INFO', 'WARNING', 'ERROR', 'BLOCKER');

-- CreateEnum
CREATE TYPE "QualityIssueStatus" AS ENUM ('OPEN', 'ACCEPTED', 'FIXED', 'IGNORED');

-- CreateEnum
CREATE TYPE "GenerationJobType" AS ENUM ('STORY_BIBLE', 'OUTLINE', 'SCENE_PLAN', 'DRAFT', 'QUALITY_CHECK', 'REPAIR', 'FACT_EXTRACTION', 'REPLAN', 'IMPORT', 'EXPORT');

-- CreateEnum
CREATE TYPE "GenerationJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "UserDecisionStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'REJECTED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'OWNER',
    "preferences" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NovelProject" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "logline" TEXT,
    "genre" TEXT,
    "targetWordCount" INTEGER,
    "targetChapterCount" INTEGER,
    "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" "ContentSource" NOT NULL DEFAULT 'USER',
    "lifecycleStatus" "SuggestionStatus" NOT NULL DEFAULT 'CONFIRMED',
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NovelProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoryBible" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "premise" TEXT,
    "theme" TEXT,
    "tone" TEXT,
    "pointOfView" TEXT,
    "styleGuide" JSONB,
    "forbiddenExpressions" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" "ContentSource" NOT NULL DEFAULT 'AI',
    "status" "SuggestionStatus" NOT NULL DEFAULT 'SUGGESTED',
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoryBible_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Character" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" JSONB,
    "role" TEXT,
    "summary" TEXT,
    "desire" TEXT,
    "fear" TEXT,
    "secret" TEXT,
    "personality" TEXT,
    "abilities" JSONB,
    "speechPattern" TEXT,
    "arc" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" "ContentSource" NOT NULL DEFAULT 'AI',
    "status" "SuggestionStatus" NOT NULL DEFAULT 'SUGGESTED',
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "sourceChapterId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Character_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterRelation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fromCharacterId" TEXT NOT NULL,
    "toCharacterId" TEXT NOT NULL,
    "relationType" TEXT NOT NULL,
    "description" TEXT,
    "strength" INTEGER,
    "publicState" TEXT,
    "trueState" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" "ContentSource" NOT NULL DEFAULT 'AI',
    "status" "SuggestionStatus" NOT NULL DEFAULT 'SUGGESTED',
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "sourceChapterId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CharacterRelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorldRule" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "scope" TEXT,
    "exceptions" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" "ContentSource" NOT NULL DEFAULT 'AI',
    "status" "SuggestionStatus" NOT NULL DEFAULT 'SUGGESTED',
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "sourceChapterId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorldRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VolumePlan" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT,
    "summary" TEXT,
    "goal" TEXT,
    "climax" TEXT,
    "endingCondition" TEXT,
    "plannedWordCount" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" "ContentSource" NOT NULL DEFAULT 'AI',
    "status" "SuggestionStatus" NOT NULL DEFAULT 'SUGGESTED',
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VolumePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChapterPlan" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "volumeId" TEXT,
    "number" INTEGER NOT NULL,
    "title" TEXT,
    "summary" TEXT,
    "objective" TEXT,
    "conflict" TEXT,
    "expectedOutcome" TEXT,
    "requiredChanges" JSONB,
    "plannedWordCount" INTEGER,
    "isFinale" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" "ContentSource" NOT NULL DEFAULT 'AI',
    "status" "SuggestionStatus" NOT NULL DEFAULT 'SUGGESTED',
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChapterPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChapterRevision" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "chapterPlanId" TEXT NOT NULL,
    "authorId" TEXT,
    "parentRevisionId" TEXT,
    "revisionNumber" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "wordCount" INTEGER,
    "summary" TEXT,
    "source" "ContentSource" NOT NULL DEFAULT 'AI',
    "createdBy" "ContentSource" NOT NULL DEFAULT 'AI',
    "status" "RevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChapterRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanonFact" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT,
    "attribute" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "validFromChapter" INTEGER,
    "validToChapter" INTEGER,
    "confidence" DOUBLE PRECISION,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" "ContentSource" NOT NULL DEFAULT 'AI',
    "status" "SuggestionStatus" NOT NULL DEFAULT 'SUGGESTED',
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "sourceChapterId" TEXT,
    "sourceExcerpt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanonFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoryEvent" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "storyTime" TEXT,
    "chapterNumber" INTEGER,
    "location" TEXT,
    "participantIds" JSONB,
    "cause" TEXT,
    "consequence" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" "ContentSource" NOT NULL DEFAULT 'AI',
    "status" "SuggestionStatus" NOT NULL DEFAULT 'SUGGESTED',
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "sourceChapterId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StateSnapshot" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "chapterPlanId" TEXT,
    "chapterNumber" INTEGER,
    "state" JSONB NOT NULL,
    "delta" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" "ContentSource" NOT NULL DEFAULT 'AI',
    "status" "SuggestionStatus" NOT NULL DEFAULT 'SUGGESTED',
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StateSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlotThread" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "PlotThreadType" NOT NULL,
    "status" "PlotThreadStatus" NOT NULL DEFAULT 'PLANNED',
    "startChapter" INTEGER,
    "plannedPayoffChapter" INTEGER,
    "actualPayoffChapter" INTEGER,
    "endingCondition" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" "ContentSource" NOT NULL DEFAULT 'AI',
    "suggestionStatus" "SuggestionStatus" NOT NULL DEFAULT 'SUGGESTED',
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "sourceChapterId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlotThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityIssue" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "chapterRevisionId" TEXT,
    "type" "QualityIssueType" NOT NULL,
    "severity" "QualitySeverity" NOT NULL,
    "status" "QualityIssueStatus" NOT NULL DEFAULT 'OPEN',
    "message" TEXT NOT NULL,
    "evidence" TEXT,
    "conflictingFactId" TEXT,
    "suggestion" TEXT,
    "autoFixAllowed" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" "ContentSource" NOT NULL DEFAULT 'AI',
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualityIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenerationJob" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "requesterId" TEXT,
    "chapterPlanId" TEXT,
    "chapterRevisionId" TEXT,
    "type" "GenerationJobType" NOT NULL,
    "status" "GenerationJobStatus" NOT NULL DEFAULT 'QUEUED',
    "createdBy" "ContentSource" NOT NULL DEFAULT 'SYSTEM',
    "provider" TEXT,
    "model" TEXT,
    "promptVersion" TEXT,
    "inputHash" TEXT,
    "output" JSONB,
    "error" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "tokensInput" INTEGER,
    "tokensOutput" INTEGER,
    "costMicros" INTEGER,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GenerationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserDecision" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT,
    "chapterPlanId" TEXT,
    "generationJobId" TEXT,
    "decisionType" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "selectedOption" JSONB,
    "alternatives" JSONB,
    "rationale" TEXT,
    "impact" JSONB,
    "status" "UserDecisionStatus" NOT NULL DEFAULT 'PROPOSED',
    "createdBy" "ContentSource" NOT NULL DEFAULT 'USER',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "NovelProject_ownerId_status_idx" ON "NovelProject"("ownerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StoryBible_projectId_key" ON "StoryBible"("projectId");

-- CreateIndex
CREATE INDEX "StoryBible_status_idx" ON "StoryBible"("status");

-- CreateIndex
CREATE INDEX "Character_projectId_name_idx" ON "Character"("projectId", "name");

-- CreateIndex
CREATE INDEX "CharacterRelation_projectId_relationType_idx" ON "CharacterRelation"("projectId", "relationType");

-- CreateIndex
CREATE UNIQUE INDEX "CharacterRelation_fromCharacterId_toCharacterId_relationTyp_key" ON "CharacterRelation"("fromCharacterId", "toCharacterId", "relationType");

-- CreateIndex
CREATE INDEX "WorldRule_projectId_status_idx" ON "WorldRule"("projectId", "status");

-- CreateIndex
CREATE INDEX "VolumePlan_projectId_status_idx" ON "VolumePlan"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "VolumePlan_projectId_number_key" ON "VolumePlan"("projectId", "number");

-- CreateIndex
CREATE INDEX "ChapterPlan_volumeId_number_idx" ON "ChapterPlan"("volumeId", "number");

-- CreateIndex
CREATE INDEX "ChapterPlan_projectId_status_idx" ON "ChapterPlan"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ChapterPlan_projectId_number_key" ON "ChapterPlan"("projectId", "number");

-- CreateIndex
CREATE INDEX "ChapterRevision_projectId_status_idx" ON "ChapterRevision"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ChapterRevision_chapterPlanId_revisionNumber_key" ON "ChapterRevision"("chapterPlanId", "revisionNumber");

-- CreateIndex
CREATE INDEX "CanonFact_projectId_subjectType_subjectId_idx" ON "CanonFact"("projectId", "subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "CanonFact_projectId_attribute_idx" ON "CanonFact"("projectId", "attribute");

-- CreateIndex
CREATE INDEX "StoryEvent_projectId_chapterNumber_idx" ON "StoryEvent"("projectId", "chapterNumber");

-- CreateIndex
CREATE INDEX "StoryEvent_projectId_status_idx" ON "StoryEvent"("projectId", "status");

-- CreateIndex
CREATE INDEX "StateSnapshot_projectId_chapterNumber_idx" ON "StateSnapshot"("projectId", "chapterNumber");

-- CreateIndex
CREATE INDEX "PlotThread_projectId_type_status_idx" ON "PlotThread"("projectId", "type", "status");

-- CreateIndex
CREATE INDEX "QualityIssue_projectId_severity_status_idx" ON "QualityIssue"("projectId", "severity", "status");

-- CreateIndex
CREATE INDEX "QualityIssue_chapterRevisionId_status_idx" ON "QualityIssue"("chapterRevisionId", "status");

-- CreateIndex
CREATE INDEX "GenerationJob_projectId_status_createdAt_idx" ON "GenerationJob"("projectId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "GenerationJob_chapterPlanId_type_idx" ON "GenerationJob"("chapterPlanId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "GenerationJob_projectId_idempotencyKey_key" ON "GenerationJob"("projectId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "UserDecision_projectId_status_createdAt_idx" ON "UserDecision"("projectId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "NovelProject" ADD CONSTRAINT "NovelProject_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryBible" ADD CONSTRAINT "StoryBible_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "NovelProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "NovelProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterRelation" ADD CONSTRAINT "CharacterRelation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "NovelProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterRelation" ADD CONSTRAINT "CharacterRelation_fromCharacterId_fkey" FOREIGN KEY ("fromCharacterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterRelation" ADD CONSTRAINT "CharacterRelation_toCharacterId_fkey" FOREIGN KEY ("toCharacterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorldRule" ADD CONSTRAINT "WorldRule_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "NovelProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VolumePlan" ADD CONSTRAINT "VolumePlan_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "NovelProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChapterPlan" ADD CONSTRAINT "ChapterPlan_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "NovelProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChapterPlan" ADD CONSTRAINT "ChapterPlan_volumeId_fkey" FOREIGN KEY ("volumeId") REFERENCES "VolumePlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChapterRevision" ADD CONSTRAINT "ChapterRevision_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "NovelProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChapterRevision" ADD CONSTRAINT "ChapterRevision_chapterPlanId_fkey" FOREIGN KEY ("chapterPlanId") REFERENCES "ChapterPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChapterRevision" ADD CONSTRAINT "ChapterRevision_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChapterRevision" ADD CONSTRAINT "ChapterRevision_parentRevisionId_fkey" FOREIGN KEY ("parentRevisionId") REFERENCES "ChapterRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanonFact" ADD CONSTRAINT "CanonFact_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "NovelProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryEvent" ADD CONSTRAINT "StoryEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "NovelProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StateSnapshot" ADD CONSTRAINT "StateSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "NovelProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StateSnapshot" ADD CONSTRAINT "StateSnapshot_chapterPlanId_fkey" FOREIGN KEY ("chapterPlanId") REFERENCES "ChapterPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlotThread" ADD CONSTRAINT "PlotThread_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "NovelProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityIssue" ADD CONSTRAINT "QualityIssue_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "NovelProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityIssue" ADD CONSTRAINT "QualityIssue_chapterRevisionId_fkey" FOREIGN KEY ("chapterRevisionId") REFERENCES "ChapterRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationJob" ADD CONSTRAINT "GenerationJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "NovelProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationJob" ADD CONSTRAINT "GenerationJob_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationJob" ADD CONSTRAINT "GenerationJob_chapterPlanId_fkey" FOREIGN KEY ("chapterPlanId") REFERENCES "ChapterPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationJob" ADD CONSTRAINT "GenerationJob_chapterRevisionId_fkey" FOREIGN KEY ("chapterRevisionId") REFERENCES "ChapterRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDecision" ADD CONSTRAINT "UserDecision_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "NovelProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDecision" ADD CONSTRAINT "UserDecision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDecision" ADD CONSTRAINT "UserDecision_chapterPlanId_fkey" FOREIGN KEY ("chapterPlanId") REFERENCES "ChapterPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDecision" ADD CONSTRAINT "UserDecision_generationJobId_fkey" FOREIGN KEY ("generationJobId") REFERENCES "GenerationJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
