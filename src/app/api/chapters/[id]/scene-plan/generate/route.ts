import { handleGeneration } from "@/server/modules/chapter/http";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleGeneration(request, id, undefined, "SCENE_PLAN");
}
