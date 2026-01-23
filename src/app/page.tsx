"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Upload, 
  Zap, 
  BookOpen, 
  ChevronRight
} from 'lucide-react';
import { useNovel } from '@/context/NovelContext';

import { ExtractionResult } from '@/types/novel';

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const { addNovel, getNovelByName, novels } = useNovel();
  const router = useRouter();

  // 临时存储待处理的数据，用于覆盖确认
  const [pendingData, setPendingData] = useState<{name: string, data: ExtractionResult} | null>(null);

  // 处理文件上传
  const processFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);

    try {
      const text = await file.text();
      const sampleText = text.slice(0, 50000); 

      const response = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.NEXT_PUBLIC_API_KEY}`
        },
        body: JSON.stringify({
          model: "glm-4-plus",
          messages: [
            {
              role: "system",
              content: `你是一个专业的小说角色分析助手。请分析用户提供的小说片段，提取角色信息。
                请严格输出合法的 JSON 格式，不要包含 Markdown 代码块标记（如 \`\`\`json ... \`\`\`），直接返回 JSON 对象。

                JSON 结构如下：
                {
                  "characters": [
                    {
                      "name": "角色名",
                      "importance": 1-10之间的数字,
                      "description": "外貌描述",
                      "personality": "性格特征",
                      "sdxl_prompt": "英文SDXL提示词"
                    }
                  ]
                }`
            },
            {
              role: "user",
              content: `请从以下小说片段中提取关键角色。
        
        对于每个角色：
        1. 识别他们的名字。
        2. 根据他们在故事中的地位和出现频率给出重要性评分（1-10）。
        3. 提供简洁的外貌描述（中文）。
        4. 总结性格特征（中文）。
        5. 编写一个详细的 SDXL (Stable Diffusion XL) 图像生成提示词（必须是英文，以便模型理解）。提示词应包含艺术风格、光影、构图以及体现角色外貌的细节。

        小说片段内容：
        ${sampleText}`
            }
          ],
          temperature: 0.1
        })
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.statusText}`);
      }

      const result = await response.json();
      const content = result.choices[0]?.message?.content || "{}";
      
      // 清理可能存在的 Markdown 标记
      const jsonStr = content.replace(/```json\n?|```/g, "").trim();
      const data = JSON.parse(jsonStr);
      
      const existing = getNovelByName(file.name);
      if (existing) {
        // 如果已存在，暂存数据并显示确认对话框
        setPendingData({ name: file.name, data });
      } else {
        // 直接添加
        addNovel(file.name, data);
        router.push('/results');
      }
    } catch (err) {
      console.error(err);
      setError("分析文本失败，请尝试上传其他 .txt 文件。");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen pb-20">
      {/* 页面头部 */}
      <header className="pt-12 pb-8 px-6 text-center max-w-4xl mx-auto">
        <div className="inline-flex items-center justify-center p-3 mb-6 rounded-2xl bg-indigo-50 text-indigo-600">
          <BookOpen size={32} />
        </div>
        <h1 className="text-4xl md:text-5xl font-extrabold text-slate-900 mb-4 tracking-tight">
          小说 <span className="gradient-text">角色设计器</span>
        </h1>
        <p className="text-lg text-slate-600 max-w-2xl mx-auto leading-relaxed">
          上传您的原稿，让 AI 智能提取角色、自动判定权重，并为您设计专业的 SDXL 视觉生成提示词。
        </p>
      </header>

      {/* 主要内容区域 */}
      <main className="max-w-7xl mx-auto px-6">
        {/* 如果已有结果，显示查看按钮 */}
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

        {/* 覆盖确认对话框 */}
        {pendingData && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 animate-in zoom-in-95 duration-200">
              <h3 className="text-xl font-bold text-slate-900 mb-2">文件已存在</h3>
              <p className="text-slate-600 mb-6">
                小说 <span className="font-semibold text-indigo-600">{pendingData.name}</span> 的分析结果已存在。是否覆盖旧的结果？
              </p>
              <div className="flex gap-3 justify-end">
                <button 
                  onClick={() => {
                    setPendingData(null);
                    setLoading(false);
                  }}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium transition-colors"
                >
                  取消
                </button>
                <button 
                  onClick={() => {
                    addNovel(pendingData.name, pendingData.data);
                    setPendingData(null);
                    router.push('/results');
                  }}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors"
                >
                  覆盖并保存
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 上传区域 */}
        {!loading ? (
          <div className="mt-8 flex flex-col items-center">
            <label className="w-full max-w-xl cursor-pointer">
              <div className="group relative border-2 border-dashed border-slate-300 rounded-3xl p-12 text-center transition-all hover:border-indigo-400 hover:bg-indigo-50/50 bg-white shadow-sm">
                <div className="flex flex-col items-center">
                  <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-indigo-100 group-hover:text-indigo-600 transition-all text-slate-500">
                    <Upload size={32} />
                  </div>
                  <h2 className="text-xl font-semibold text-slate-900 mb-2">上传小说原稿 (.txt)</h2>
                  <p className="text-slate-500 mb-6 text-sm">拖放文件到此处或点击浏览</p>
                  <div className="flex items-center gap-2 px-6 py-2 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors shadow-lg">
                    选择文件 <ChevronRight size={16} />
                  </div>
                </div>
                <input 
                  type="file" 
                  className="hidden" 
                  accept=".txt"
                  onChange={processFile}
                />
              </div>
            </label>
            <p className="mt-6 text-xs text-slate-400 flex items-center gap-1">
              <Zap size={12} /> 由 GLM-4 提供智能分析支持
            </p>
          </div>
        ) : null}

        {/* 加载状态 */}
        {loading && (
          <div className="mt-20 flex flex-col items-center text-center">
            <div className="relative">
              <div className="w-24 h-24 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin"></div>
              <div className="absolute inset-0 flex items-center justify-center text-indigo-600">
                <BookOpen size={32} className="animate-pulse-slow" />
              </div>
            </div>
            <h3 className="mt-8 text-2xl font-bold text-slate-900">正在深度分析原稿...</h3>
            <p className="mt-2 text-slate-500 max-w-sm">
              我们正在自动识别角色、判定故事地位并编写提示词。这可能需要几秒钟时间，请稍候。
            </p>
          </div>
        )}

        {/* 错误提示 */}
        {error && (
          <div className="mt-8 p-4 bg-red-50 text-red-700 rounded-xl border border-red-100 text-center">
            {error}
            <button onClick={() => {setLoading(false);}} className="block mx-auto mt-2 underline font-semibold">重试</button>
          </div>
        )}
      </main>
    </div>
  );
}
