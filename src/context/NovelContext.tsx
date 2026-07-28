"use client";

import React, { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import { ExtractionResult } from '@/types/novel';
import { useAuth } from '@/context/AuthContext';

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

const STORAGE_KEY_PREFIX = 'novel-manage-data';

export function NovelProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const storageKey = user ? `${STORAGE_KEY_PREFIX}:${user.id}` : null;
  const [novels, setNovels] = useState<NovelData[]>([]);
  const [currentNovelId, setCurrentNovelId] = useState<string | null>(null);
  const [loadedStorageKey, setLoadedStorageKey] = useState<string | null>(null);

  // Load the current account's browser-only legacy analyses. Tracking the key
  // that has finished loading prevents one user's in-memory state from being
  // written into another user's storage namespace during an account switch.
  useEffect(() => {
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;

      if (!storageKey) {
        setNovels([]);
        setCurrentNovelId(null);
        setLoadedStorageKey(null);
        return;
      }

      let nextNovels: NovelData[] = [];
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        try {
          const parsed: unknown = JSON.parse(stored);
          if (Array.isArray(parsed)) {
            nextNovels = parsed.filter((novel): novel is NovelData => (
              typeof novel === 'object' && novel !== null &&
              typeof novel.id === 'string' &&
              typeof novel.name === 'string' &&
              typeof novel.createdAt === 'number' &&
              typeof novel.result === 'object' && novel.result !== null &&
              Array.isArray((novel as NovelData).result.characters)
            ));
          }
        } catch (e) {
          console.error("Failed to load novels from storage", e);
        }
      }

      setNovels(nextNovels);
      setCurrentNovelId(nextNovels[0]?.id ?? null);
      setLoadedStorageKey(storageKey);
    });

    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  // Save to localStorage whenever novels change
  useEffect(() => {
    if (storageKey && loadedStorageKey === storageKey) {
      localStorage.setItem(storageKey, JSON.stringify(novels));
    }
  }, [loadedStorageKey, novels, storageKey]);

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
