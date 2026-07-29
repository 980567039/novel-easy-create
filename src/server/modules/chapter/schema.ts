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
  mode: z.enum(["generate", "rewrite"]).optional(),
}).superRefine((value, context) => {
  if (value.mode === "rewrite" && !value.instruction?.trim()) {
    context.addIssue({
      code: "custom",
      path: ["instruction"],
      message: "重写章节时必须填写修改意见。",
    });
  }
});

export type GenerateChapterInput = z.infer<typeof GenerateChapterInputSchema>;

export const BatchDraftCountSchema = z.union([
  z.literal(5),
  z.literal(10),
  z.literal(20),
  z.literal(50),
  z.literal("all"),
]);

export const BatchDraftInputSchema = z.object({
  count: BatchDraftCountSchema,
}).strict();

export type BatchDraftInput = z.infer<typeof BatchDraftInputSchema>;

export const BatchDraftChapterSchema = z.object({
  id: z.string().uuid(),
  number: z.number().int().positive(),
  title: z.string(),
  status: z.enum(["pending", "running", "succeeded", "failed", "skipped", "cancelled"]),
  error: z.string().optional(),
});

export const BatchDraftJobOutputSchema = z.object({
  kind: z.literal("BATCH_DRAFT"),
  phase: z.enum(["queued", "running", "succeeded", "failed", "cancelled"]),
  message: z.string(),
  requestedCount: BatchDraftCountSchema,
  total: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  currentChapter: BatchDraftChapterSchema.pick({ id: true, number: true, title: true }).nullable(),
  chapters: z.array(BatchDraftChapterSchema),
});

export type BatchDraftJobOutput = z.infer<typeof BatchDraftJobOutputSchema>;

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
