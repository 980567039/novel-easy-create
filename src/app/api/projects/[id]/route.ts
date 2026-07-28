import { NextResponse } from "next/server";

import { authenticateApiRequest } from "@/server/api-auth";
import { getDatabase } from "@/server/db";
import { DeleteProjectInputSchema } from "@/server/modules/project/schema";
import { deleteProject } from "@/server/modules/project/service";

export const runtime = "nodejs";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: "INVALID_JSON", error: "请求体必须是有效的 JSON。" }, { status: 400 });
  }

  const parsed = DeleteProjectInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        code: "VALIDATION_ERROR",
        error: "请输入完整项目名称以确认删除。",
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  try {
    const db = getDatabase();
    const result = await deleteProject(db, auth.user.id, id, parsed.data.confirmationTitle);
    if (result.status === "not_found") {
      return NextResponse.json({ code: "PROJECT_NOT_FOUND", error: "小说项目不存在。" }, { status: 404 });
    }
    if (result.status === "title_mismatch") {
      return NextResponse.json(
        { code: "PROJECT_TITLE_MISMATCH", error: "项目名称不匹配，未删除项目。" },
        { status: 409 },
      );
    }
    return NextResponse.json({ deletedProject: result.deletedProject });
  } catch (error) {
    console.error("[projects/delete] failed", error);
    return NextResponse.json({ code: "DELETE_FAILED", error: "项目删除失败，请稍后重试。" }, { status: 500 });
  }
}
