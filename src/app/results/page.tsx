"use client";

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  BookOpen, 
  Users, 
  User, 
  Star,
  X,
  Plus
} from 'lucide-react';
import { useNovel } from '@/context/NovelContext';
import CharacterCard from '@/components/CharacterCard';

export default function ResultsPage() {
  const { novels, currentNovelId, setCurrentNovelId, removeNovel } = useNovel();
  const router = useRouter();

  useEffect(() => {
    if (novels.length === 0) {
      router.push('/');
    }
  }, [novels, router]);

  const currentNovel = novels.find(n => n.id === currentNovelId);

  if (!currentNovel) {
    return null; 
  }

  const { result, name: fileName } = currentNovel;

  // 按重要程度分类角色
  const protagonists = result.characters.filter(c => c.importance >= 8).sort((a,b) => b.importance - a.importance) || [];
  const supporting = result.characters.filter(c => c.importance >= 5 && c.importance < 8).sort((a,b) => b.importance - a.importance) || [];
  const minor = result.characters.filter(c => c.importance < 5).sort((a,b) => b.importance - a.importance) || [];

  return (
    <div className="min-h-screen pb-20 bg-slate-50/50">
      {/* 顶部导航栏 */}
      <div className="sticky top-0 z-20 bg-white/80 backdrop-blur-md border-b border-slate-200 px-4">
        <div className="max-w-7xl mx-auto flex items-center gap-2 overflow-x-auto py-2 no-scrollbar">
          <button 
            onClick={() => router.push('/')}
            className="p-2 mr-2 hover:bg-slate-100 rounded-lg transition-colors text-slate-600 flex-shrink-0"
            title="返回上传页"
          >
            <Plus size={20} />
            <span className="sr-only">添加新小说</span>
          </button>
          
          {novels.map(novel => (
            <div 
              key={novel.id}
              onClick={() => setCurrentNovelId(novel.id)}
              className={`
                group flex items-center gap-2 px-4 py-2 rounded-lg cursor-pointer transition-all flex-shrink-0 border
                ${novel.id === currentNovelId 
                  ? 'bg-indigo-50 border-indigo-200 text-indigo-700 shadow-sm' 
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300'}
              `}
            >
              <BookOpen size={14} className={novel.id === currentNovelId ? 'text-indigo-500' : 'text-slate-400'} />
              <span className="text-sm font-medium max-w-[120px] truncate">{novel.name}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeNovel(novel.id);
                }}
                className={`
                  p-0.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity
                  ${novel.id === currentNovelId ? 'hover:bg-indigo-200 text-indigo-500' : 'hover:bg-slate-200 text-slate-400'}
                `}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-6 pt-8">
        <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
          {/* 摘要栏 */}
          <div className="glass-panel px-6 py-4 rounded-2xl flex flex-wrap items-center justify-between gap-4 border-slate-200 shadow-sm bg-white">
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-slate-500 flex items-center gap-1.5 max-w-[200px] truncate">
                <BookOpen size={16} /> {fileName}
              </span>
              <span className="h-4 w-px bg-slate-200"></span>
              <span className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <Users size={16} /> 已识别 {result.characters.length} 个角色
              </span>
            </div>
          </div>

          {/* 核心主角区块 */}
          {protagonists.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-6 border-l-4 border-amber-400 pl-3">
                <div className="p-1.5 bg-amber-100 text-amber-600 rounded-lg">
                  <Star size={20} fill="currentColor" />
                </div>
                <h2 className="text-2xl font-bold text-slate-900">核心主角</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {protagonists.map((char, idx) => (
                  <CharacterCard key={`pro-${idx}`} character={char} />
                ))}
              </div>
            </section>
          )}

          {/* 重要配角区块 */}
          {supporting.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-6 border-l-4 border-blue-400 pl-3">
                <div className="p-1.5 bg-blue-100 text-blue-600 rounded-lg">
                  <Users size={20} />
                </div>
                <h2 className="text-2xl font-bold text-slate-900">重要配角</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {supporting.map((char, idx) => (
                  <CharacterCard key={`sup-${idx}`} character={char} />
                ))}
              </div>
            </section>
          )}

          {/* 次要角色区块 */}
          {minor.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-6 border-l-4 border-slate-300 pl-3">
                <div className="p-1.5 bg-slate-100 text-slate-600 rounded-lg">
                  <User size={20} />
                </div>
                <h2 className="text-2xl font-bold text-slate-900">次要角色</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 opacity-80 hover:opacity-100 transition-opacity">
                {minor.map((char, idx) => (
                  <CharacterCard key={`min-${idx}`} character={char} />
                ))}
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
