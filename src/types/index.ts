// 角色类型定义
export interface Character {
  name: string;           // 角色名称
  importance: number;     // 重要程度 (1-10)
  description: string;    // 外貌描述
  personality: string;    // 性格特征
  sdxl_prompt: string;    // SDXL 图像生成提示词
}

// 分析结果类型
export interface ExtractionResult {
  characters: Character[];
}

// 分析记录类型（保存到数据库）
export interface AnalysisRecord {
  id: string;             // 唯一标识
  fileName: string;       // 文件名
  createdAt: string;      // 创建时间
  characters: Character[]; // 提取的角色列表
}
