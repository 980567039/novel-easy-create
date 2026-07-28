import { NextResponse } from "next/server";

import { authenticateApiRequest } from "@/server/api-auth";
import { getDatabase } from "@/server/db";
import { databaseUnavailable, readJson } from "@/server/modules/chapter/http";
import { finalizeChapter } from "@/server/modules/chapter/service";
import { FinalizeChapterInputSchema } from "@/server/modules/chapter/schema";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = await readJson(request);
  if (body.error) return body.error;
  const parsed = FinalizeChapterInputSchema.safeParse(body.value ?? {});
  if (!parsed.success) return NextResponse.json({ code: "VALIDATION_ERROR", error: "定稿参数格式不正确。", details: parsed.error.flatten().fieldErrors }, { status: 400 });
  try {
    const projectId = new URL(request.url).searchParams.get("projectId") ?? undefined;
    const revision = await finalizeChapter(getDatabase(), auth.user.id, id, projectId, parsed.data.revisionId);
    if (!revision) return NextResponse.json({ code: "CHAPTER_NOT_FOUND", error: "章节不存在。" }, { status: 404 });
    return NextResponse.json({ revision });
  } catch (error) {
    if (error instanceof Error && error.message.includes("没有可定稿")) return NextResponse.json({ code: "REVISION_NOT_FOUND", error: error.message }, { status: 409 });
    console.error("[chapter] finalize failed", error);
    return databaseUnavailable();
  }
}
