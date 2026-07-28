import { z } from "zod";
import {
  AiProviderError,
  AiStructuredOutputError,
  type AiProvider,
  type AiStructuredResult,
  type AiTextResult,
  type GenerateStructuredInput,
  type GenerateTextInput,
} from "@/server/ai/types";

interface OpenAiChatResponse {
  id?: string;
  model?: string;
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string };
}

export interface OpenAiCompatibleConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

function getConfig(overrides: OpenAiCompatibleConfig = {}) {
  const pick = (value: string | undefined, fallback: string) => value?.trim() || fallback;
  const baseUrl = pick(overrides.baseUrl, pick(process.env.AI_BASE_URL, "http://localhost:1234/v1")).replace(/\/$/, "");
  return {
    baseUrl,
    apiKey: overrides.apiKey !== undefined ? overrides.apiKey.trim() || undefined : process.env.AI_API_KEY?.trim() || undefined,
    defaultModel: pick(
      overrides.model,
      pick(
        process.env.AI_WRITING_MODEL,
        pick(process.env.AI_MODEL, "local-model"),
      ),
    ),
  };
}

function parseJsonContent(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = (fenced ?? content).trim();

  try {
    return JSON.parse(candidate);
  } catch {
    const candidates = [candidate.indexOf("{"), candidate.indexOf("[")].filter((index) => index >= 0);
    const start = candidates.length > 0 ? Math.min(...candidates) : -1;
    if (start < 0) throw new Error("未找到 JSON 内容");
    return JSON.parse(candidate.slice(start));
  }
}

export class OpenAiCompatibleProvider implements AiProvider {
  constructor(private readonly configOverrides: OpenAiCompatibleConfig = {}) {}

  async generateText(input: GenerateTextInput): Promise<AiTextResult> {
    const config = getConfig(this.configOverrides);
    const controller = input.signal ? undefined : new AbortController();
    const timeout = controller ? setTimeout(() => controller.abort(), input.timeoutMs ?? 120_000) : undefined;

    try {
      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        },
        signal: input.signal ?? controller?.signal,
        body: JSON.stringify({
          model: input.model ?? config.defaultModel,
          messages: input.messages,
          temperature: input.temperature ?? 0.7,
          ...(input.maxTokens ? { max_tokens: input.maxTokens } : {}),
          ...(input.responseFormat ? { response_format: { type: input.responseFormat } } : {}),
        }),
      });

      const body = (await response.json()) as OpenAiChatResponse;
      if (!response.ok) {
        throw new AiProviderError(
          body.error?.message ?? `模型请求失败（HTTP ${response.status}）`,
          "request",
          body,
        );
      }

      const content = body.choices?.[0]?.message?.content;
      if (!content) {
        throw new AiProviderError("模型没有返回文本内容", "response", body);
      }

      return {
        content,
        model: body.model,
        requestId: body.id,
        usage: body.usage
          ? {
              promptTokens: body.usage.prompt_tokens,
              completionTokens: body.usage.completion_tokens,
              totalTokens: body.usage.total_tokens,
            }
          : undefined,
      };
    } catch (error) {
      if (error instanceof AiProviderError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new AiProviderError("模型请求已取消或超时", "aborted", error);
      }
      throw new AiProviderError("无法连接到 AI 模型服务", "request", error);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async generateStructured<T>(
    input: GenerateStructuredInput,
    schema: z.ZodType<T>,
  ): Promise<AiStructuredResult<T>> {
    const result = await this.generateText({
      ...input,
      responseFormat: "json_object",
      messages: [
        {
          role: "system",
          content: `你必须只返回合法 JSON，不要使用 Markdown 代码块。输出必须符合 ${input.schemaName} 的结构。`,
        },
        ...input.messages,
      ],
      temperature: input.temperature ?? 0.1,
    });

    let parsed: unknown;
    try {
      parsed = parseJsonContent(result.content);
    } catch (error) {
      throw new AiStructuredOutputError("模型返回的内容不是合法 JSON", result.content, [error]);
    }

    const validated = schema.safeParse(parsed);
    if (!validated.success) {
      throw new AiStructuredOutputError(
        "模型返回的 JSON 不符合预期结构",
        result.content,
        validated.error.issues,
      );
    }

    return { ...result, data: validated.data };
  }
}
