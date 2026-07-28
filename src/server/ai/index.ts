import type { AiProvider } from "@/server/ai/types";
import { OpenAiCompatibleProvider } from "@/server/ai/providers/openai-compatible";

let provider: AiProvider | undefined;

export function getAiProvider(): AiProvider {
  if (provider) return provider;

  const providerName = process.env.AI_PROVIDER ?? "openai-compatible";
  if (providerName !== "openai-compatible") {
    throw new Error(`不支持的 AI_PROVIDER：${providerName}`);
  }

  provider = new OpenAiCompatibleProvider();
  return provider;
}

export * from "@/server/ai/schemas";
export * from "@/server/ai/types";
export * from "@/server/ai/configured";
