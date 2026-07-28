import { NextResponse } from "next/server";

import { authenticateApiRequest } from "@/server/api-auth";
import { getDatabase } from "@/server/db";
import { exportProject } from "@/server/modules/project/transfer-service";

export const runtime = "nodejs";

function safeFilename(title: string) {
  const cleaned = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().slice(0, 100);
  return `${cleaned || "novel-project"}.novel-role.json`;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    const document = await exportProject(getDatabase(), auth.user.id, id);
    if (!document) {
      return NextResponse.json({ code: "PROJECT_NOT_FOUND", error: "小说项目不存在。" }, { status: 404 });
    }
    const filename = safeFilename(document.project.title);
    return new NextResponse(JSON.stringify(document, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="project.novel-role.json"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[projects/export] failed", error);
    return NextResponse.json({ code: "DATABASE_UNAVAILABLE", error: "项目导出失败，请确认数据库可用。" }, { status: 503 });
  }
}
