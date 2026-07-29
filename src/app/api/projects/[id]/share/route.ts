import { NextResponse } from "next/server";

import { authenticateApiRequest } from "@/server/api-auth";
import { getDatabase } from "@/server/db";
import { UpdatePublicShareInputSchema } from "@/server/modules/share/schema";
import {
  getProjectShare,
  issueProjectShare,
  revokeProjectShare,
} from "@/server/modules/share/service";

export const runtime = "nodejs";

function projectNotFound() {
  return NextResponse.json(
    { code: "PROJECT_NOT_FOUND", error: "小说项目不存在。" },
    { status: 404, headers: { "Cache-Control": "no-store" } },
  );
}

function databaseUnavailable() {
  return NextResponse.json(
    { code: "DATABASE_UNAVAILABLE", error: "公开分享设置暂不可用，请稍后重试。" },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;
  const { id: projectId } = await params;
  try {
    const share = await getProjectShare(getDatabase(), auth.user.id, projectId);
    if (!share) return projectNotFound();
    return noStoreJson({ share });
  } catch (error) {
    console.error("[project/share] read failed", error);
    return databaseUnavailable();
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;
  const { id: projectId } = await params;
  try {
    const result = await issueProjectShare(getDatabase(), auth.user.id, projectId);
    if (!result) return projectNotFound();
    return noStoreJson(result, 201);
  } catch (error) {
    console.error("[project/share] create failed", error);
    return databaseUnavailable();
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;
  const { id: projectId } = await params;
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ code: "INVALID_JSON", error: "请求体必须是有效的 JSON。" }, { status: 400 });
  }
  const parsed = UpdatePublicShareInputSchema.safeParse(input);
  if (!parsed.success) {
    return NextResponse.json({ code: "VALIDATION_ERROR", error: "公开分享设置格式不正确。", details: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  try {
    const result = parsed.data.enabled
      ? await issueProjectShare(getDatabase(), auth.user.id, projectId)
      : await revokeProjectShare(getDatabase(), auth.user.id, projectId);
    if (!result) return projectNotFound();
    return noStoreJson(parsed.data.enabled ? result : { share: result });
  } catch (error) {
    console.error("[project/share] update failed", error);
    return databaseUnavailable();
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;
  const { id: projectId } = await params;
  try {
    const share = await revokeProjectShare(getDatabase(), auth.user.id, projectId);
    if (!share) return projectNotFound();
    return noStoreJson({ share });
  } catch (error) {
    console.error("[project/share] delete failed", error);
    return databaseUnavailable();
  }
}
