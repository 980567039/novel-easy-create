export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface GenerateTextInput {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "json_object";
  /** Maximum time to wait for a provider response (milliseconds). */
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface GenerateStructuredInput extends GenerateTextInput {
  schemaName: string;
}

export interface AiUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface AiTextResult {
  content: string;
  model?: string;
  usage?: AiUsage;
  requestId?: string;
}

export interface AiStructuredResult<T> extends AiTextResult {
  data: T;
}

export interface AiProvider {
  generateText(input: GenerateTextInput): Promise<AiTextResult>;
  generateStructured<T>(
    input: GenerateStructuredInput,
    schema: import("zod").ZodType<T>,
  ): Promise<AiStructuredResult<T>>;
}

export class AiProviderError extends Error {
  constructor(
    message: string,
    public readonly code: "configuration" | "request" | "response" | "aborted",
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

export class AiStructuredOutputError extends AiProviderError {
  constructor(
    message: string,
    public readonly rawContent: string,
    public readonly issues: readonly unknown[] = [],
  ) {
    super(message, "response");
    this.name = "AiStructuredOutputError";
  }
}
