"use client";

import React, { useState } from 'react';
import Image from 'next/image';
import { 
  Copy, 
  Image as ImageIcon, 
  CheckCircle2, 
  User, 
  Loader2
} from 'lucide-react';
import { Character } from '@/types/novel';

const CharacterCard: React.FC<{ character: Character }> = ({ character }) => {
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  // 复制 SDXL 提示词到剪贴板
  const copyToClipboard = () => {
    navigator.clipboard.writeText(character.sdxl_prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // 生成角色画像
  const generatePortrait = async () => {
    setGenerating(true);
    try {
      const response = await fetch("https://open.bigmodel.cn/api/paas/v4/images/generations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.NEXT_PUBLIC_API_KEY}`
        },
        body: JSON.stringify({
          model: "cogview-3-plus",
          prompt: `A high-quality cinematic portrait based on this prompt: ${character.sdxl_prompt}. Focus on character accuracy: ${character.description}. Professional lighting, masterpiece.`
        })
      });

      const data = await response.json();
      if (data.data?.[0]?.url) {
        setImageUrl(data.data[0].url);
      }
    } catch (err) {
      console.error("生成图像失败", err);
    } finally {
      setGenerating(false);
    }
  };

  // 根据重要程度设置不同的颜色样式
  const importanceColor = character.importance >= 8 ? 'bg-indigo-100 text-indigo-700' : 
                         character.importance >= 5 ? 'bg-blue-100 text-blue-700' : 
                         'bg-slate-100 text-slate-700';

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden transition-all hover:shadow-md group">
      <div className="p-6">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h3 className="text-xl font-bold text-slate-900 mb-1 group-hover:text-indigo-600 transition-colors">
              {character.name}
            </h3>
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full uppercase tracking-wider ${importanceColor}`}>
              重要程度: {character.importance}/10
            </span>
          </div>
          <div className="flex gap-2">
            <button 
              onClick={copyToClipboard}
              className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
              title="复制 SDXL 提示词"
            >
              {copied ? <CheckCircle2 size={20} className="text-green-500" /> : <Copy size={20} />}
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <h4 className="text-xs font-bold text-slate-400 uppercase mb-1 flex items-center gap-1">
              <User size={14} /> 角色描述
            </h4>
            <p className="text-sm text-slate-600 leading-relaxed">{character.description}</p>
          </div>

          <div>
            <h4 className="text-xs font-bold text-slate-400 uppercase mb-1">SDXL 提示词 (英文)</h4>
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 text-xs text-slate-500 italic leading-snug break-words">
              {character.sdxl_prompt}
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-4">
          {imageUrl && (
            <div className="relative aspect-square w-full rounded-xl overflow-hidden shadow-inner border border-slate-100">
              <Image
                src={imageUrl}
                alt={character.name}
                fill
                unoptimized
                sizes="(max-width: 768px) 100vw, 33vw"
                loader={({ src }) => src}
                className="object-cover"
              />
            </div>
          )}
          
          <button 
            onClick={generatePortrait}
            disabled={generating}
            className="flex items-center justify-center gap-2 w-full py-3 px-4 bg-slate-900 text-white rounded-xl font-semibold hover:bg-slate-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          >
            {generating ? (
              <Loader2 className="animate-spin" size={18} />
            ) : (
              <ImageIcon size={18} />
            )}
            {generating ? '正在绘制中...' : imageUrl ? '重新生成画像' : '生成角色画像'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CharacterCard;
