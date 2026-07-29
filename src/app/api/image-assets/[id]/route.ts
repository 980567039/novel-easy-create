import { NextResponse } from "next/server";

import { authenticateApiRequest } from "@/server/api-auth";
import { getDatabase } from "@/server/db";
import { hasImageAssetAccess } from "@/lib/image-assets";
import { deleteImageAsset } from "@/server/modules/image-asset/service";

export const runtime = "nodejs";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;
  if (!hasImageAssetAccess(auth.user.email)) {
    return NextResponse.json({ code: "IMAGE_ASSET_FORBIDDEN", error: "图片素材功能仅对指定账号开放。" }, { status: 403 });
  }
  const { id } = await params;
  try {
    const deleted = await deleteImageAsset(getDatabase(), auth.user.id, id);
    if (!deleted) return NextResponse.json({ code: "IMAGE_ASSET_NOT_FOUND", error: "图片素材不存在。" }, { status: 404 });
    return NextResponse.json({ deletedAsset: deleted });
  } catch (error) {
    console.error("[image-assets] delete failed", error);
    return NextResponse.json({ code: "IMAGE_ASSET_DELETE_FAILED", error: "图片素材删除失败，请稍后重试。" }, { status: 500 });
  }
}
