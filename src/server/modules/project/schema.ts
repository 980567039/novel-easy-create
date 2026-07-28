import { z } from "zod";

const OptionalPositiveInt = z
  .coerce
  .number()
  .int("必须是整数")
  .positive("必须是正数")
  .max(10_000_000, "数值过大")
  .nullable()
  .optional();

/** 问答内容故意保持开放，以便后续向导增加问题而不需要改数据库模型。 */
export const OnboardingAnswersSchema = z.record(z.string(), z.unknown()).default({});

export const CreateProjectInputSchema = z.object({
  title: z.string().trim().min(1, "请输入小说标题").max(200, "标题不能超过 200 个字符"),
  genre: z.string().trim().max(100, "题材不能超过 100 个字符").nullable().optional(),
  targetWordCount: OptionalPositiveInt,
  targetChapterCount: OptionalPositiveInt,
  onboardingAnswers: OnboardingAnswersSchema.optional(),
  // 兼容早期向导可能使用的简短字段名。
  onboarding: OnboardingAnswersSchema.optional(),
});

export type CreateProjectInput = z.infer<typeof CreateProjectInputSchema>;
