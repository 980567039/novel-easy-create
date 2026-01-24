"use client";

import React, { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import { ExtractionResult } from '@/types/novel';

export interface NovelData {
  id: string;
  name: string;
  result: ExtractionResult;
  createdAt: number;
}

interface NovelContextType {
  novels: NovelData[];
  currentNovelId: string | null;
  addNovel: (name: string, result: ExtractionResult) => string;
  removeNovel: (id: string) => void;
  setCurrentNovelId: (id: string | null) => void;
  getNovelByName: (name: string) => NovelData | undefined;
}

const NovelContext = createContext<NovelContextType | undefined>(undefined);

const STORAGE_KEY = 'novel-manage-data';

export function NovelProvider({ children }: { children: ReactNode }) {
  const [novels, setNovels] = useState<NovelData[]>([]);
  const [currentNovelId, setCurrentNovelId] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setNovels(parsed);
        if (parsed.length > 0) {
          // Default to the most recent one or the first one
          setCurrentNovelId(parsed[0].id);
        }
      } catch (e) {
        console.error("Failed to load novels from storage", e);
      }
    }
    setIsInitialized(true);
  }, []);

  // Save to localStorage whenever novels change
  useEffect(() => {
    if (isInitialized) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(novels));
    }
  }, [novels, isInitialized]);

  const addNovel = (name: string, result: ExtractionResult): string => {
    const newId = crypto.randomUUID();
    const newNovel: NovelData = {
      id: newId,
      name,
      result,
      createdAt: Date.now()
    };
    
    setNovels(prev => {
      const filtered = prev.filter(n => n.name !== name);
      return [newNovel, ...filtered];
    });
    setCurrentNovelId(newId);
    
    return newId;
  };

  const removeNovel = (id: string) => {
    setNovels(prev => {
      const updated = prev.filter(n => n.id !== id);
      if (currentNovelId === id) {
        setCurrentNovelId(updated.length > 0 ? updated[0].id : null);
      }
      return updated;
    });
  };

  const getNovelByName = (name: string) => {
    return novels.find(n => n.name === name);
  };

  return (
    <NovelContext.Provider value={{ 
      novels, 
      currentNovelId, 
      addNovel, 
      removeNovel, 
      setCurrentNovelId,
      getNovelByName
    }}>
      {children}
    </NovelContext.Provider>
  );
}

export function useNovel() {
  const context = useContext(NovelContext);
  if (context === undefined) {
    throw new Error('useNovel must be used within a NovelProvider');
  }
  return context;
}
