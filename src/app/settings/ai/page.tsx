"use client";

import { FormEvent, useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, KeyRound, Loader2, Save, Server, Wifi } from "lucide-react";
import { useRouter } from "next/navigation";

type Provider = "openai" | "openai-compatible" | "lm-studio";
type Settings = { provider: Provider; baseUrl: string; model: string; enabled: boolean; apiKeyConfigured: boolean; updatedAt: string | null };

const defaults: Settings = { provider: "lm-studio", baseUrl: "http://localhost:1234/v1", model: "local-model", enabled: true, apiKeyConfigured: false, updatedAt: null };

export default function AiSettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings>(defaults);
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  useEffect(() => {
    fetch("/api/settings/ai")
      .then(async (response) => {
        const body = (await response.json()) as { settings?: Settings; error?: string };
        if (!response.ok) throw new Error(body.error ?? "无法读取 AI 设置");
        if (body.settings) setSettings(body.settings);
      })
      .catch((error: unknown) => setMessage({ text: error instanceof Error ? error.message : "无法读取 AI 设置", error: true }))
      .finally(() => setLoading(false));
  }, []);

  const updateProvider = (provider: Provider) => {
    setSettings((current) => ({
      ...current,
      provider,
      baseUrl: provider === "openai" ? "https://api.openai.com/v1" : provider === "lm-studio" ? "http://localhost:1234/v1" : current.baseUrl,
      model: provider === "lm-studio" && current.model === "gpt-4o" ? "local-model" : current.model,
    }));
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true); setMessage(null);
    try {
      const response = await fetch("/api/settings/ai", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...settings, apiKey: apiKey || undefined }) });
      const body = (await response.json()) as { settings?: Settings; error?: string };
      if (!response.ok) throw new Error(body.error ?? "保存失败");
      if (body.settings) setSettings(body.settings);
      setApiKey("");
      setMessage({ text: "AI 设置已保存。" });
    } catch (error: unknown) { setMessage({ text: error instanceof Error ? error.message : "保存失败", error: true }); }
    finally { setSaving(false); }
  };

  const testConnection = async () => {
    setTesting(true); setMessage(null);
    try {
      const response = await fetch("/api/settings/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: settings.provider, baseUrl: settings.baseUrl, model: settings.model, apiKey: apiKey || undefined }) });
      const body = (await response.json()) as { ok?: boolean; error?: string; latencyMs?: number };
      if (!response.ok || !body.ok) throw new Error(body.error ?? "连接测试失败");
      setMessage({ text: `连接成功（${body.latencyMs ?? 0} ms）。` });
    } catch (error: unknown) { setMessage({ text: error instanceof Error ? error.message : "连接测试失败", error: true }); }
    finally { setTesting(false); }
  };

  if (loading) return <main className="flex min-h-screen items-center justify-center text-slate-500"><Loader2 className="mr-2 animate-spin" size={18} />正在加载设置...</main>;

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-900 sm:px-8">
      <div className="mx-auto max-w-3xl">
        <button type="button" onClick={() => router.push("/")} className="mb-8 inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-indigo-600"><ArrowLeft size={16} /> 返回首页</button>
        <div className="mb-8 flex items-start gap-4"><div className="rounded-2xl bg-indigo-100 p-3 text-indigo-600"><Server size={26} /></div><div><p className="mb-1 text-sm font-semibold tracking-wide text-indigo-600">模型设置</p><h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">连接你的 AI</h1><p className="mt-2 text-slate-500">小说分析、故事规划和章节生成都会使用这里配置的模型。</p></div></div>
        <form onSubmit={save} className="space-y-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-9">
          <label className="block space-y-2"><span className="text-sm font-semibold text-slate-800">模型服务</span><select value={settings.provider} onChange={(event) => updateProvider(event.target.value as Provider)} className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"><option value="lm-studio">LM Studio（本地）</option><option value="openai">OpenAI</option><option value="openai-compatible">OpenAI-compatible（第三方 / 自建）</option></select></label>
          <label className="block space-y-2"><span className="text-sm font-semibold text-slate-800">Base URL</span><input value={settings.baseUrl} onChange={(event) => setSettings((current) => ({ ...current, baseUrl: event.target.value }))} placeholder="https://api.openai.com/v1" className="w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100" /><span className="text-xs text-slate-400">填写到 /v1，不要包含 /chat/completions。</span></label>
          <label className="block space-y-2"><span className="text-sm font-semibold text-slate-800">模型名称</span><input value={settings.model} onChange={(event) => setSettings((current) => ({ ...current, model: event.target.value }))} placeholder="例如：gpt-4o-mini、qwen2.5-7b-instruct" className="w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100" /></label>
          <label className="block space-y-2"><span className="flex items-center gap-2 text-sm font-semibold text-slate-800"><KeyRound size={16} /> API Key <span className="text-xs font-normal text-slate-400">{settings.apiKeyConfigured ? "已配置（留空则保持不变）" : "没有则留空"}</span></span><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={settings.apiKeyConfigured ? "••••••••  已保存" : "sk-..."} autoComplete="off" className="w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100" /></label>
          <label className="flex items-center gap-3 text-sm text-slate-700"><input type="checkbox" checked={settings.enabled} onChange={(event) => setSettings((current) => ({ ...current, enabled: event.target.checked }))} className="h-4 w-4 rounded border-slate-300 text-indigo-600" />启用此模型配置</label>
          {message && <div className={`rounded-xl px-4 py-3 text-sm ${message.error ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>{!message.error && <CheckCircle2 className="mr-2 inline" size={16} />}{message.text}</div>}
          <div className="flex flex-wrap justify-end gap-3 border-t border-slate-100 pt-5"><button type="button" onClick={testConnection} disabled={testing} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><Wifi size={17} />{testing ? "测试中..." : "测试连接"}</button><button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"><Save size={17} />{saving ? "保存中..." : "保存设置"}</button></div>
        </form>
      </div>
    </main>
  );
}
