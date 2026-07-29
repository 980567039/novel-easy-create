import { NextResponse } from "next/server";

import { authenticateApiRequest } from "@/server/api-auth";
import { getDatabase } from "@/server/db";
import { hasImageAssetAccess } from "@/lib/image-assets";
import { getImageAssetFile } from "@/server/modules/image-asset/service";

export const runtime = "nodejs";

const contentDispositionName: Record<string, string> = {
  "image/png": "image.png",
  "image/jpeg": "image.jpg",
  "image/webp": "image.webp",
};

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;
  if (!hasImageAssetAccess(auth.user.email)) {
    return NextResponse.json({ code: "IMAGE_ASSET_FORBIDDEN", error: "图片素材功能仅对指定账号开放。" }, { status: 403 });
  }
  const { id } = await params;
  try {
    const result = await getImageAssetFile(getDatabase(), auth.user.id, id);
    if (!result) return NextResponse.json({ code: "IMAGE_ASSET_NOT_FOUND", error: "图片素材不存在。" }, { status: 404 });
    const download = new URL(request.url).searchParams.get("download") === "1";
    const filename = contentDispositionName[result.asset.mimeType] ?? "image.bin";
    const disposition = download ? "attachment" : "inline";
    return new NextResponse(new Uint8Array(result.bytes), {
      headers: {
        "Content-Type": result.asset.mimeType,
        "Content-Length": String(result.bytes.byteLength),
        "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[image-assets] file failed", error);
    return NextResponse.json({ code: "IMAGE_ASSET_FILE_FAILED", error: "图片素材读取失败，请稍后重试。" }, { status: 500 });
  }
}
