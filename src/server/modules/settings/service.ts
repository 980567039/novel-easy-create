import type { PrismaClient } from "@prisma/client";

import { getOrCreateLocalUser } from "@/server/modules/project/service";
import type { AiSettingsInput } from "./schema";

export const defaultAiSettings = {
  provider: "lm-studio" as const,
  baseUrl: "http://localhost:1234/v1",
  model: "local-model",
  enabled: true,
};

type AiProviderConfigRecord = {
  id: string;
  userId: string;
  provider: string;
  baseUrl: string;
  model: string;
  apiKey?: string | null;
  enabled: boolean;
  updatedAt: Date;
};

type AiProviderConfigDelegate = {
  findUnique(args: { where: { userId: string } }): Promise<AiProviderConfigRecord | null>;
  upsert(args: {
    where: { userId: string };
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }): Promise<AiProviderConfigRecord>;
};

function getConfigDelegate(db: PrismaClient): AiProviderConfigDelegate {
  const delegate = (db as unknown as { aiProviderConfig?: AiProviderConfigDelegate }).aiProviderConfig;
  if (!delegate) {
    throw new Error("数据库尚未包含 AiProviderConfig 模型，请先运行最新迁移");
  }
  return delegate;
}
export async function getAiSettings(db: PrismaClient) {
  const user = await getOrCreateLocalUser(db);
  const config = await getConfigDelegate(db).findUnique({ where: { userId: user.id } });
  return config ?? { ...defaultAiSettings, apiKey: null, updatedAt: null };
}

export async function saveAiSettings(db: PrismaClient, input: AiSettingsInput) {
  const user = await getOrCreateLocalUser(db);
  const delegate = getConfigDelegate(db);
  const existing = await delegate.findUnique({ where: { userId: user.id } });
  const baseUrl = input.baseUrl || (input.provider === "openai"
    ? "https://api.openai.com/v1"
    : input.provider === "lm-studio" ? "http://localhost:1234/v1" : "");

  const data = {
    provider: input.provider,
    baseUrl,
    model: input.model,
    enabled: input.enabled,
    ...(input.apiKey?.trim() ? { apiKey: input.apiKey.trim() } : {}),
  };

  return delegate.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...data, ...(existing?.apiKey ? { apiKey: existing.apiKey } : {}) },
    update: data,
  });
}
