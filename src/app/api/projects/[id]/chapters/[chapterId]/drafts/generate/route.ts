import { handleGeneration } from "@/server/modules/chapter/http";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; chapterId: string }> }) {
  const { id: projectId, chapterId } = await params;
  return handleGeneration(request, chapterId, projectId, "DRAFT");
}
