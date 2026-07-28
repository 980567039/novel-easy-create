import { handleGenerationStatus } from "@/server/modules/chapter/http";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleGenerationStatus(id, "SCENE_PLAN", new URL(request.url).searchParams.get("jobId") ?? undefined);
}
