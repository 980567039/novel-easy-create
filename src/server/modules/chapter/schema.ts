import { z } from "zod";

const NonEmptyString = z.string().trim().min(1);

/** 用户编辑章节计划时允许只更新部分字段。 */
export const UpdateChapterPlanInputSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  summary: z.string().trim().max(10_000).nullable().optional(),
  objective: z.string().trim().max(10_000).nullable().optional(),
  conflict: z.string().trim().max(10_000).nullable().optional(),
  expectedOutcome: z.string().trim().max(10_000).nullable().optional(),
  requiredChanges: z.unknown().nullable().optional(),
  plannedWordCount: z.coerce.number().int().positive().max(1_000_000).nullable().optional(),
});

export type UpdateChapterPlanInput = z.infer<typeof UpdateChapterPlanInputSchema>;

export const GenerateChapterInputSchema = z.object({
  /** Optional author guidance for this generation attempt. */
  instruction: z.string().trim().max(10_000).optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
  temperature: z.number().min(0).max(2).optional(),
});

export type GenerateChapterInput = z.infer<typeof GenerateChapterInputSchema>;

const SceneSchema = z.object({
  order: z.number().int().positive(),
  title: NonEmptyString,
  setting: z.string().trim().default(""),
  time: z.string().trim().default(""),
  participants: z.array(NonEmptyString).default([]),
  objective: NonEmptyString,
  obstacle: NonEmptyString,
  actions: z.array(NonEmptyString).default([]),
  turningPoint: NonEmptyString,
  outcome: NonEmptyString,
  estimatedWords: z.number().int().positive().optional(),
});

export const ScenePlanSchema = z.object({
  scenes: z.array(SceneSchema).min(1).max(30),
  chapterPromise: z.string().trim().default(""),
  endingState: z.string().trim().default(""),
});

export type ScenePlan = z.infer<typeof ScenePlanSchema>;

export const FinalizeChapterInputSchema = z.object({
  revisionId: z.string().uuid().optional(),
});

export type FinalizeChapterInput = z.infer<typeof FinalizeChapterInputSchema>;

export const SaveDraftInputSchema = z.object({
  content: z.string().trim().min(1, "正文内容不能为空").max(2_000_000),
  summary: z.string().trim().max(10_000).nullable().optional(),
});

export type SaveDraftInput = z.infer<typeof SaveDraftInputSchema>;
