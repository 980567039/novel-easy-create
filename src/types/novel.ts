export interface Character {
  name: string;
  importance: number; // 1-10
  description: string;
  personality: string;
  sdxl_prompt: string;
}

export interface ExtractionResult {
  characters: Character[];
}
