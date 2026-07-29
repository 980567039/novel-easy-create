import { NextResponse } from "next/server";
import { z } from "zod";

import { authenticateApiRequest } from "@/server/api-auth";
import { getDatabase } from "@/server/db";
import { hasImageAssetAccess } from "@/lib/image-assets";
import {
  generateImageAsset,
  ImageGenerationError,
  listImageAssets,
} from "@/server/modules/image-asset/service";

export const runtime = "nodejs";

function forbidden() {
  return NextResponse.json({ code: "IMAGE_ASSET_FORBIDDEN", error: "图片素材功能仅对指定账号开放。" }, { status: 403 });
}

const GenerateImageSchema = z.object({
  prompt: z.string().trim().min(2, "请至少输入两个字的图片描述。").max(4_000, "图片描述不能超过 4000 字。"),
  size: z.enum(["1024x1024", "1024x1536", "1536x1024"]).optional(),
}).strict();

export async function GET(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;
  if (!hasImageAssetAccess(auth.user.email)) return forbidden();
  try {
    return NextResponse.json({ assets: await listImageAssets(getDatabase(), auth.user.id) });
  } catch (error) {
    console.error("[image-assets] list failed", error);
    return NextResponse.json({ code: "IMAGE_ASSET_LIST_FAILED", error: "暂时无法读取图片素材。" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;
  if (!hasImageAssetAccess(auth.user.email)) return forbidden();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: "INVALID_JSON", error: "请求体必须是有效的 JSON。" }, { status: 400 });
  }
  const parsed = GenerateImageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({
      code: "VALIDATION_ERROR",
      error: parsed.error.issues[0]?.message ?? "图片生成参数不正确。",
      details: parsed.error.flatten().fieldErrors,
    }, { status: 400 });
  }
  try {
    const asset = await generateImageAsset(getDatabase(), auth.user.id, parsed.data.prompt, parsed.data.size);
    return NextResponse.json({ asset }, { status: 201 });
  } catch (error) {
    if (error instanceof ImageGenerationError) {
      return NextResponse.json({ code: "IMAGE_GENERATION_FAILED", error: error.message }, { status: error.status });
    }
    console.error("[image-assets] generation failed", error);
    return NextResponse.json({ code: "IMAGE_GENERATION_FAILED", error: "图片生成失败，请稍后重试。" }, { status: 502 });
  }
}
