import { handleGenerationStatus } from "@/server/modules/chapter/http";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string; chapterId: string }> }) {
  const { id: projectId, chapterId } = await params;
  return handleGenerationStatus(chapterId, "SCENE_PLAN", new URL(request.url).searchParams.get("jobId") ?? undefined, projectId);
}
