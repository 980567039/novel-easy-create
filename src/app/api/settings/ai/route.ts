import { NextResponse } from "next/server";

import { authenticateApiRequest } from "@/server/api-auth";
import { getDatabase } from "@/server/db";
import {
  defaultAiSettings,
  getAiSettings,
  saveAiSettings,
} from "@/server/modules/settings/service";
import { AiSettingsInputSchema } from "@/server/modules/settings/schema";

export const runtime = "nodejs";

function publicSettings(config: Awaited<ReturnType<typeof getAiSettings>>) {
  return {
    provider: config.provider,
    baseUrl: config.baseUrl,
    model: config.model,
    enabled: config.enabled,
    apiKeyConfigured: Boolean(config.apiKey),
    updatedAt: config.updatedAt instanceof Date ? config.updatedAt.toISOString() : null,
  };
}

function unavailable(error: unknown) {
  console.error("[settings/ai] database unavailable", error);
  return NextResponse.json(
    { code: "DATABASE_UNAVAILABLE", error: "AI 设置需要数据库中的 AiProviderConfig 模型，请先运行最新迁移。" },
    { status: 503 },
  );
}

export async function GET(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;
  try {
    const config = await getAiSettings(getDatabase(), auth.user.id);
    return NextResponse.json({ settings: publicSettings(config) });
  } catch (error) {
    return unavailable(error);
  }
}

export async function PUT(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: "INVALID_JSON", error: "请求体必须是有效 JSON。" }, { status: 400 });
  }

  const parsed = AiSettingsInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { code: "VALIDATION_ERROR", error: "AI 设置格式不正确。", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  try {
    const config = await saveAiSettings(getDatabase(), auth.user.id, parsed.data);
    return NextResponse.json({ settings: publicSettings(config) });
  } catch (error) {
    return unavailable(error);
  }
}

export async function POST(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const parsed = AiSettingsInputSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ code: "VALIDATION_ERROR", error: "连接测试参数不正确。" }, { status: 400 });
  }

  try {
    const stored = await getAiSettings(getDatabase(), auth.user.id);
    const provider = parsed.data.provider ?? stored.provider ?? defaultAiSettings.provider;
    const providerDefaultBaseUrl = provider === "openai"
      ? "https://api.openai.com/v1"
      : provider === "lm-studio" ? "http://localhost:1234/v1" : defaultAiSettings.baseUrl;
    const baseUrl = (parsed.data.baseUrl || stored.baseUrl || providerDefaultBaseUrl).replace(/\/$/, "");
    const model = parsed.data.model || stored.model || defaultAiSettings.model;
    const apiKey = parsed.data.apiKey?.trim() || stored.apiKey || undefined;
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "请只回复：连接成功" }],
          max_tokens: 8,
          temperature: 0,
        }),
      });
      if (!response.ok) {
        return NextResponse.json({ ok: false, error: `模型服务返回 HTTP ${response.status}。` }, { status: 502 });
      }
      return NextResponse.json({ ok: true, model, latencyMs: Date.now() - startedAt });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    const message = error instanceof DOMException && error.name === "AbortError"
      ? "连接超时，请检查地址和模型服务是否已启动。"
      : "无法连接到 AI 模型服务，请检查 Base URL、模型名和 API Key。";
    console.error("[settings/ai] connection test failed", error);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
