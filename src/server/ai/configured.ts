import { getDatabase } from "@/server/db";
import { getAiSettings } from "@/server/modules/settings/service";
import { OpenAiCompatibleProvider } from "@/server/ai/providers/openai-compatible";

/**
 * Resolve the provider selected in the settings page. The API key is read on
 * the server and never returned to the browser.
 */
export async function getConfiguredAiProvider() {
  const settings = await getAiSettings(getDatabase());
  if (!settings.enabled) {
    throw new Error("当前 AI 配置已停用，请到 AI 设置中重新启用。 ");
  }

  return new OpenAiCompatibleProvider({
    baseUrl: settings.baseUrl,
    model: settings.model,
    apiKey: settings.apiKey ?? undefined,
  });
}
