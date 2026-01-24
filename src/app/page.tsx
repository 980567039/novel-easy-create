"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Upload, 
  Zap, 
  BookOpen, 
  ChevronRight,
  Loader2 // 新增 Loading 图标
} from 'lucide-react';
import { useNovel } from '@/context/NovelContext';

import { ExtractionResult } from '@/types/novel';

// === 工具函数区 ===

// 1. 文本分块（安全长度 10000 字，留 500 字重叠防止切断人名）
function chunkText(text: string, chunkSize: number = 10000, overlap: number = 500): string[] {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    if (end === text.length) break;
    start += chunkSize - overlap;
  }
  return chunks;
}

// 2. 增强版合并函数
function mergeCharacters(existing: any[], incoming: any[]) {
  const map = new Map();
  
  // 辅助函数：标准化名字（去空格、去特殊符号）
  const normalize = (name: string) => name.replace(/['"“”\s]/g, '').trim();

  // 先把旧数据放入 Map (Key 是标准化后的名字)
  existing.forEach(c => {
    const key = normalize(c.name);
    if (key) map.set(key, c);
  });
  
  // 处理新数据
  incoming.forEach(c => {
    const key = normalize(c.name);
    if (!key) return; // 跳过空名

    if (map.has(key)) {
      const old = map.get(key);
      
      // 1. 描述合并：保留更长的描述，或者简单的拼接
      if (c.description && c.description.length > old.description.length) {
        old.description = c.description; // 只要更详细的
      }
      
      // 2. 权重累加：出现次数越多，重要性越高
      old.importance = Math.min(10, (old.importance || 5) + 1);

      // 3. Prompt 更新：如果有新的 Prompt 且看起来更完整，就替换
      if (c.sdxl_prompt && c.sdxl_prompt.length > old.sdxl_prompt.length) {
        old.sdxl_prompt = c.sdxl_prompt;
      }
    } else {
      // 这是一个新角色
      map.set(key, {
        ...c,
        importance: 5 // 初始分
      });
    }
  });
  
  return Array.from(map.values());
}

// === 组件区 ===

export default function Home() {
  const [loading, setLoading] = useState(false);
  // 新增：显示具体的进度文字
  const [loadingText, setLoadingText] = useState("准备中..."); 
  const [error, setError] = useState<string | null>(null);
  
  const { addNovel, getNovelByName, novels } = useNovel();
  const router = useRouter();
  const [pendingData, setPendingData] = useState<{name: string, data: ExtractionResult} | null>(null);

  const processFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);
    setLoadingText("正在读取文件...");

    try {
      const text = await file.text();
      // 切分文本
      const chunks = chunkText(text);
      console.log(`[System] 全文共切分为 ${chunks.length} 个片段`);

      let allCharacters: any[] = [];

      // === 核心循环 ===
      // 修改：这里不再有 Math.min，会跑完所有 chunks
      for (let i = 0; i < chunks.length; i++) {
        setLoadingText(`正在分析第 ${i + 1} / ${chunks.length} 部分...`);
        
        try {
          // 调用本地 API
          const response = await fetch("/api/local/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": "Bearer local-model"
            },
            body: JSON.stringify({
              model: "local-model",
              max_tokens: -1, // 让模型尽可能写完
              temperature: 0.1, // 低温，保证格式稳定
              messages: [
                {
                  role: "system",
                  content: `你是一个小说角色提取专家。
请从给定的文本中提取**所有**登场角色（包括主角、配角、反派）。

【输出要求】
1. 必须输出为 JSON 格式，包裹在 \`\`\`json 代码块中。
2. "sdxl_prompt" 必须是 Danbooru 风格的英文标签（Tags），不要写句子。

【JSON 格式示例】
\`\`\`json
{
  "characters": [
    {
      "name": "萧炎",
      "description": "黑袍少年，背负重尺，眼神坚毅",
      "sdxl_prompt": "1boy, solo, black robe, giant heavy sword on back, short black hair, determination, upper body, masterpiece, best quality"
    }
  ]
}
\`\`\` `
                },
                {
                  role: "user",
                  // 强调“列出所有”
                  content: `请仔细阅读以下片段，列出这段文字中出现的所有角色名字、外貌和SDXL标签。\n\n${chunks[i]}`
                }
              ]
            })
          });

          if (!response.ok) {
            console.warn(`片段 ${i} 请求失败，跳过`);
            continue; 
          }

          const result = await response.json();
          const content = result.choices[0]?.message?.content || "";
          
          // 正则提取 JSON
          const jsonMatch = content.match(/```json([\s\S]*?)```/) || content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const cleanJson = jsonMatch[1] || jsonMatch[0];
            // 简单的清理，防止末尾逗号报错
            const safeJson = cleanJson.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
            
            const data = JSON.parse(safeJson);
            if (data.characters && Array.isArray(data.characters)) {
              // 实时合并
              allCharacters = mergeCharacters(allCharacters, data.characters);
              console.log(`片段 ${i} 完成，当前累计识别 ${allCharacters.length} 个角色`);
            }
          } else {
            console.warn(`片段 ${i} 未找到有效 JSON`, content.slice(0, 50));
          }

        } catch (chunkErr) {
          console.error(`片段 ${i} 处理出错`, chunkErr);
          // 不中断循环，继续下一个片段
        }
      }

      // 循环结束，检查结果
      if (allCharacters.length === 0) {
        throw new Error("未能从任何片段中提取到角色，请检查模型连接或Context长度设置。");
      }

      const finalData = { characters: allCharacters };
      
      const existing = getNovelByName(file.name);
      if (existing) {
        setPendingData({ name: file.name, data: finalData });
      } else {
        addNovel(file.name, finalData);
        router.push('/results');
      }

    } catch (err: any) {
      console.error(err);
      setError(err.message || "分析过程中发生错误");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen pb-20">
      <header className="pt-12 pb-8 px-6 text-center max-w-4xl mx-auto">
        <div className="inline-flex items-center justify-center p-3 mb-6 rounded-2xl bg-indigo-50 text-indigo-600">
          <BookOpen size={32} />
        </div>
        <h1 className="text-4xl md:text-5xl font-extrabold text-slate-900 mb-4 tracking-tight">
          小说 <span className="gradient-text">角色设计器</span>
        </h1>
        <p className="text-lg text-slate-600 max-w-2xl mx-auto leading-relaxed">
          本地模型版：支持全本扫描，SDXL Tag 生成。
        </p>
      </header>

      <main className="max-w-7xl mx-auto px-6">
        {novels.length > 0 && !loading && (
          <div className="mb-8 text-center">
             <button 
                onClick={() => router.push('/results')}
                className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-50 text-indigo-600 rounded-xl font-semibold hover:bg-indigo-100 transition-colors"
              >
                <BookOpen size={20} /> 查看已分析的小说 ({novels.length})
              </button>
          </div>
        )}

        {/* 覆盖确认弹窗 (保持不变) */}
        {pendingData && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
              <h3 className="text-xl font-bold text-slate-900 mb-2">文件已存在</h3>
              <p className="text-slate-600 mb-6">
                <span className="font-semibold text-indigo-600">{pendingData.name}</span> 已存在。是否覆盖？
              </p>
              <div className="flex gap-3 justify-end">
                <button 
                  onClick={() => { setPendingData(null); setLoading(false); }}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg"
                >取消</button>
                <button 
                  onClick={() => {
                    addNovel(pendingData.name, pendingData.data);
                    setPendingData(null);
                    router.push('/results');
                  }}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                >覆盖</button>
              </div>
            </div>
          </div>
        )}

        {!loading ? (
          <div className="mt-8 flex flex-col items-center">
            <label className="w-full max-w-xl cursor-pointer">
              <div className="group relative border-2 border-dashed border-slate-300 rounded-3xl p-12 text-center transition-all hover:border-indigo-400 hover:bg-indigo-50/50 bg-white shadow-sm">
                <div className="flex flex-col items-center">
                  <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-indigo-100 group-hover:text-indigo-600 transition-all text-slate-500">
                    <Upload size={32} />
                  </div>
                  <h2 className="text-xl font-semibold text-slate-900 mb-2">上传小说 (.txt)</h2>
                  <p className="text-slate-500 mb-6 text-sm">将全文切片并逐一发送给本地模型</p>
                </div>
                <input type="file" className="hidden" accept=".txt" onChange={processFile} />
              </div>
            </label>
          </div>
        ) : null}

        {/* 加载状态 (显示进度文字) */}
        {loading && (
          <div className="mt-20 flex flex-col items-center text-center">
            <div className="relative">
              <Loader2 className="w-16 h-16 text-indigo-600 animate-spin" />
            </div>
            <h3 className="mt-8 text-2xl font-bold text-slate-900">{loadingText}</h3>
            <p className="mt-2 text-slate-500">
              请不要关闭浏览器窗口，这可能需要几分钟...
            </p>
          </div>
        )}

        {error && (
          <div className="mt-8 p-4 bg-red-50 text-red-700 rounded-xl border border-red-100 text-center">
            {error}
            <button onClick={() => setLoading(false)} className="block mx-auto mt-2 underline font-semibold">返回</button>
          </div>
        )}
      </main>
    </div>
  );
}