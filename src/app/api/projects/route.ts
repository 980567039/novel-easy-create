import { NextResponse } from "next/server";

import { authenticateApiRequest } from "@/server/api-auth";
import { getDatabase } from "@/server/db";
import { createProject, listProjects } from "@/server/modules/project/service";
import { CreateProjectInputSchema } from "@/server/modules/project/schema";

export const runtime = "nodejs";

function databaseUnavailableResponse() {
  return NextResponse.json(
    {
      code: "DATABASE_UNAVAILABLE",
      error: "数据库暂不可用，请配置 DATABASE_URL 并确认数据库已启动。",
    },
    { status: 503 },
  );
}
export async function GET(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;
  try {
    const projects = await listProjects(getDatabase(), auth.user.id);
    return NextResponse.json({ projects });
  } catch (error) {
    console.error("[projects] list failed", error);
    return databaseUnavailableResponse();
  }
}

export async function POST(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { code: "INVALID_JSON", error: "请求体必须是有效的 JSON。" },
      { status: 400 },
    );
  }

  const parsed = CreateProjectInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        code: "VALIDATION_ERROR",
        error: "项目参数不完整或格式不正确。",
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  try {
    const project = await createProject(getDatabase(), auth.user.id, parsed.data);
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    console.error("[projects] create failed", error);
    return databaseUnavailableResponse();
  }
}
