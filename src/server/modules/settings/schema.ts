import { z } from "zod";

export const AiProviderSchema = z.enum(["openai", "openai-compatible", "lm-studio"]);

export const AiSettingsInputSchema = z.object({
  provider: AiProviderSchema,
  baseUrl: z.string().trim().url("Base URL 必须是有效的 URL").optional().or(z.literal("")),
  model: z.string().trim().min(1, "模型名称不能为空").max(200),
  apiKey: z.string().max(500).optional(),
  enabled: z.boolean().optional().default(true),
});
export type AiSettingsInput = z.infer<typeof AiSettingsInputSchema>;

export const AiSettingsResponseSchema = z.object({
  provider: AiProviderSchema,
  baseUrl: z.string(),
  model: z.string(),
  enabled: z.boolean(),
  apiKeyConfigured: z.boolean(),
  updatedAt: z.string().nullable(),
});
