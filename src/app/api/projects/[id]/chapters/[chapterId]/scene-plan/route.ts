import { authenticateApiRequest } from "@/server/api-auth";
import { handleGenerationStatus } from "@/server/modules/chapter/http";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string; chapterId: string }> }) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;
  const { id: projectId, chapterId } = await params;
  return handleGenerationStatus(auth.user.id, chapterId, "SCENE_PLAN", new URL(request.url).searchParams.get("jobId") ?? undefined, projectId);
}
