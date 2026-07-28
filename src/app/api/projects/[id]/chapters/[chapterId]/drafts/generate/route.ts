import { authenticateApiRequest } from "@/server/api-auth";
import { handleGeneration } from "@/server/modules/chapter/http";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; chapterId: string }> }) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;
  const { id: projectId, chapterId } = await params;
  return handleGeneration(request, auth.user.id, chapterId, projectId, "DRAFT");
}
