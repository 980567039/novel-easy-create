import { z } from "zod";

const NonEmptyString = z.string().trim().min(1);

// The compatible model may return a concise string or a richer, structured
// value for editorial fields. Keep validation permissive here and normalize
// those values at the API boundary before writing relational columns.
const FlexibleValue = z.union([
  NonEmptyString,
  z.array(z.unknown()),
  z.record(z.string(), z.unknown()),
]);

export const CharacterExtractionSchema = z.object({
  characters: z.array(
    z.object({
      name: NonEmptyString,
      importance: z.number().int().min(1).max(10).optional(),
      description: NonEmptyString,
      personality: z.string().trim().optional(),
      sdxl_prompt: z.string().trim().optional(),
    }),
  ),
});

export const StoryBibleDraftSchema = z.object({
  premise: FlexibleValue,
  theme: FlexibleValue.default(""),
  tone: FlexibleValue.default(""),
  pointOfView: FlexibleValue.default(""),
  endingDirection: FlexibleValue.default(""),
  constraints: FlexibleValue.default([]),
  characters: z.array(
    z.object({
      name: NonEmptyString,
      role: NonEmptyString,
      desire: NonEmptyString,
      fear: z.string().trim().default(""),
      secret: z.string().trim().default(""),
      arc: z.string().trim().default(""),
    }),
  ).default([]),
});

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function firstValue(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

function asText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join("\n");
  if (value && typeof value === "object") {
    return Object.values(asRecord(value)).map(asText).filter(Boolean).join("\n");
  }
  return "";
}

function asPositiveInt(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function asPositiveIntOrUndefined(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function asList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(asRecord(value));
  return [];
}

function normalizeChapter(rawChapter: unknown, chapterIndex: number) {
  const chapter = asRecord(rawChapter);
  return {
    order: asPositiveInt(firstValue(chapter, ["order", "number", "chapterNumber", "index"]), chapterIndex + 1),
    // Aliases are compatibility only. Missing story content must stay empty so
    // the canonical schema rejects it instead of treating a fabricated
    // placeholder chapter as a completed model response.
    title: asText(firstValue(chapter, ["title", "name"])),
    objective: asText(firstValue(chapter, ["objective", "goal", "purpose"])),
    conflict: asText(firstValue(chapter, ["conflict", "obstacle", "problem"])),
    result: asText(firstValue(chapter, ["result", "outcome", "expectedOutcome", "summary", "ending"])),
    requiredChange: asText(firstValue(chapter, ["requiredChange", "requiredChanges", "required_changes", "change", "stateChange"])),
    estimatedWords: (() => {
      const raw = firstValue(chapter, ["estimatedWords", "plannedWordCount", "wordCount"]);
      const parsed = typeof raw === "number" ? raw : Number(raw);
      return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
    })(),
  };
}

const OutlineChapterSchema = z.object({
  order: z.number().int().positive(),
  title: NonEmptyString,
  objective: NonEmptyString,
  conflict: NonEmptyString,
  result: NonEmptyString,
  requiredChange: NonEmptyString,
  estimatedWords: z.number().int().positive().optional(),
});

function normalizeBookSkeleton(value: unknown) {
  const wrapper = asRecord(value);
  const source = asRecord(firstValue(wrapper, ["skeleton", "bookSkeleton", "bookPlan", "outline"]) ?? wrapper);
  const volumes = asList(firstValue(source, ["volumes", "volumePlans", "parts"]));
  return {
    ending: asText(firstValue(source, ["ending", "finale", "endingDirection", "conclusion"])),
    volumes: volumes.map((rawVolume, volumeIndex) => {
      const volume = asRecord(rawVolume);
      return {
        number: asPositiveInt(firstValue(volume, ["number", "order", "volumeNumber", "index"]), volumeIndex + 1),
        title: asText(firstValue(volume, ["title", "name"])),
        goal: asText(firstValue(volume, ["goal", "objective", "purpose", "summary"])),
        climax: asText(firstValue(volume, ["climax", "turningPoint", "peak"])),
        endingCondition: asText(firstValue(volume, ["endingCondition", "ending_condition", "endCondition", "completion", "resolution"])),
        chapterCount: asPositiveIntOrUndefined(firstValue(volume, ["chapterCount", "plannedChapterCount", "chaptersCount", "count"])),
      };
    }),
  };
}

export const OutlineBookSkeletonSchema = z.preprocess((value) => normalizeBookSkeleton(value), z.object({
  ending: NonEmptyString,
  volumes: z.array(z.object({
    number: z.number().int().positive(),
    title: NonEmptyString,
    goal: NonEmptyString,
    climax: NonEmptyString,
    endingCondition: NonEmptyString,
    chapterCount: z.number().int().positive(),
  })).min(1),
}));

function normalizeVolumeChapters(value: unknown) {
  const wrapper = asRecord(value);
  const source = asRecord(firstValue(wrapper, ["volume", "volumePlan", "outline"]) ?? wrapper);
  const rawChapters = Array.isArray(value)
    ? value
    : asList(firstValue(source, ["chapters", "chapterPlans", "episodes"]));
  return { chapters: rawChapters.map(normalizeChapter) };
}

export const OutlineVolumeDraftSchema = z.preprocess((value) => normalizeVolumeChapters(value), z.object({
  chapters: z.array(OutlineChapterSchema).min(1),
}));

/**
 * Different compatible models use small naming/shape variations for an
 * outline (for example `chapterPlans`, `outcome`, or an object-valued goal).
 * Normalize those variations before applying the canonical contract.
 */
function normalizeOutlineDraft(value: unknown) {
  const wrapper = asRecord(value);
  const source = asRecord(firstValue(wrapper, ["outline", "storyOutline"]) ?? wrapper);
  const rawVolumes = firstValue(source, ["volumes", "volumePlans", "parts"]);
  const topLevelChapters = firstValue(source, ["chapters", "chapterPlans", "episodes"]);
  const volumes = asList(rawVolumes);
  const normalizedVolumes = volumes.length > 0
    ? volumes
    : asList(topLevelChapters).length > 0
      ? [{
          title: firstValue(source, ["title", "name"]),
          goal: firstValue(source, ["goal", "objective", "purpose"]),
          climax: firstValue(source, ["climax", "turningPoint", "peak"]),
          endingCondition: firstValue(source, ["endingCondition", "endCondition", "resolution"]),
          chapters: topLevelChapters,
        }]
      : [];

  return {
    ending: asText(firstValue(source, ["ending", "finale", "endingDirection", "conclusion"])),
    volumes: normalizedVolumes.map((rawVolume) => {
      const volume = asRecord(rawVolume);
      const rawChapters = firstValue(volume, ["chapters", "chapterPlans", "episodes"]);
      const chapters = asList(rawChapters);
      return {
        title: asText(firstValue(volume, ["title", "name"])),
        goal: asText(firstValue(volume, ["goal", "objective", "purpose", "summary"])),
        climax: asText(firstValue(volume, ["climax", "turningPoint", "peak"])),
        endingCondition: asText(firstValue(volume, ["endingCondition", "ending_condition", "endCondition", "completion", "resolution"])),
        chapters: chapters.map(normalizeChapter),
      };
    }),
  };
}

export const OutlineDraftSchema = z.preprocess((value) => normalizeOutlineDraft(value), z.object({
  ending: NonEmptyString,
  volumes: z.array(
    z.object({
      title: NonEmptyString,
      goal: NonEmptyString,
      climax: NonEmptyString,
      endingCondition: NonEmptyString,
      chapters: z.array(OutlineChapterSchema).min(1),
    }),
  ).min(1),
}));

export const QualityCheckSchema = z.object({
  passed: z.boolean(),
  issues: z.array(
    z.object({
      type: z.enum([
        "canon",
        "timeline",
        "location",
        "character",
        "causality",
        "pacing",
        "style",
        "foreshadowing",
      ]),
      severity: z.enum(["low", "medium", "high", "critical"]),
      evidence: NonEmptyString,
      conflict: z.string().trim().default(""),
      suggestion: NonEmptyString,
      autoFixable: z.boolean().default(false),
    }),
  ),
});

export type CharacterExtraction = z.infer<typeof CharacterExtractionSchema>;
export type StoryBibleDraft = z.infer<typeof StoryBibleDraftSchema>;
export type OutlineBookSkeleton = z.infer<typeof OutlineBookSkeletonSchema>;
export type OutlineVolumeDraft = z.infer<typeof OutlineVolumeDraftSchema>;
export type OutlineDraft = z.infer<typeof OutlineDraftSchema>;
export type QualityCheck = z.infer<typeof QualityCheckSchema>;
