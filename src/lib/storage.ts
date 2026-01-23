import fs from 'fs';
import path from 'path';
import { AnalysisRecord } from '@/types';

// 数据存储路径
const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'analyses.json');

// 确保数据目录存在
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// 读取所有分析记录
export function getAllAnalyses(): AnalysisRecord[] {
  ensureDataDir();
  if (!fs.existsSync(DATA_FILE)) {
    return [];
  }
  try {
    const data = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('读取数据失败:', error);
    return [];
  }
}

// 获取单个分析记录
export function getAnalysisById(id: string): AnalysisRecord | null {
  const analyses = getAllAnalyses();
  return analyses.find(a => a.id === id) || null;
}

// 保存新的分析记录
export function saveAnalysis(record: AnalysisRecord): void {
  ensureDataDir();
  const analyses = getAllAnalyses();
  analyses.unshift(record); // 新记录放在最前面
  fs.writeFileSync(DATA_FILE, JSON.stringify(analyses, null, 2), 'utf-8');
}

// 删除分析记录
export function deleteAnalysis(id: string): boolean {
  const analyses = getAllAnalyses();
  const index = analyses.findIndex(a => a.id === id);
  if (index === -1) {
    return false;
  }
  analyses.splice(index, 1);
  fs.writeFileSync(DATA_FILE, JSON.stringify(analyses, null, 2), 'utf-8');
  return true;
}
