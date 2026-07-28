import { NextResponse } from "next/server";

import { authenticateApiRequest } from "@/server/api-auth";
import { getDatabase } from "@/server/db";
import { ProjectTransferDocumentSchema } from "@/server/modules/project/transfer-schema";
import { importProject, ProjectTitleConflictError } from "@/server/modules/project/transfer-service";

export const runtime = "nodejs";

const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

async function readImportDocument(request: Request): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_IMPORT_BYTES) {
    throw new Error("IMPORT_FILE_TOO_LARGE");
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) throw new Error("IMPORT_FILE_MISSING");
    if (file.size > MAX_IMPORT_BYTES) throw new Error("IMPORT_FILE_TOO_LARGE");
    return JSON.parse(await file.text());
  }
  return request.json();
}

export async function POST(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;
  let body: unknown;
  try {
    body = await readImportDocument(request);
  } catch (error) {
    const code = error instanceof Error ? error.message : "INVALID_JSON";
    if (code === "IMPORT_FILE_TOO_LARGE") {
      return NextResponse.json({ code, error: "导入文件不能超过 50 MB。" }, { status: 413 });
    }
    if (code === "IMPORT_FILE_MISSING") {
      return NextResponse.json({ code, error: "请选择要导入的项目 JSON 文件。" }, { status: 400 });
    }
    return NextResponse.json({ code: "INVALID_JSON", error: "导入文件不是有效的 JSON。" }, { status: 400 });
  }

  const parsed = ProjectTransferDocumentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        code: "VALIDATION_ERROR",
        error: "导入文件不是受支持的小说项目格式，或内容不完整。",
        details: parsed.error.issues.slice(0, 50).map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      },
      { status: 400 },
    );
  }

  try {
    const db = getDatabase();
    const overwrite = new URL(request.url).searchParams.get("overwrite") === "true";
    const project = await importProject(db, auth.user.id, parsed.data, { overwrite });
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    if (error instanceof ProjectTitleConflictError) {
      return NextResponse.json(
        {
          code: "PROJECT_TITLE_CONFLICT",
          error: `已存在名为《${error.title}》的项目。`,
          title: error.title,
          conflictCount: error.conflictCount,
        },
        { status: 409 },
      );
    }
    console.error("[projects/import] failed", error);
    return NextResponse.json({ code: "IMPORT_FAILED", error: "项目导入失败，未写入任何数据。" }, { status: 500 });
  }
}
