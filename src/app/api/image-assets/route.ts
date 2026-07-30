import { NextResponse } from "next/server";
import { z } from "zod";

import { authenticateApiRequest } from "@/server/api-auth";
import { getDatabase } from "@/server/db";
import { hasImageAssetAccess, IMAGE_ASPECT_RATIOS } from "@/lib/image-assets";
import {
  editImageAsset,
  generateImageAsset,
  ImageGenerationError,
  listImageAssets,
  MAX_REFERENCE_IMAGE_BYTES,
} from "@/server/modules/image-asset/service";

export const runtime = "nodejs";

function forbidden() {
  return NextResponse.json({ code: "IMAGE_ASSET_FORBIDDEN", error: "图片素材功能仅对指定账号开放。" }, { status: 403 });
}

const GenerateImageSchema = z.object({
  prompt: z.string().trim().min(2, "请至少输入两个字的图片描述。").max(4_000, "图片描述不能超过 4000 字。"),
  aspectRatio: z.enum(IMAGE_ASPECT_RATIOS).optional(),
  size: z.enum(["1024x1024", "1024x1536", "1536x1024"]).optional(),
}).strict();

const EditImageSchema = z.object({
  prompt: z.string().trim().min(2, "请至少输入两个字的修改要求。").max(4_000, "修改要求不能超过 4000 字。"),
  aspectRatio: z.enum(IMAGE_ASPECT_RATIOS).optional(),
}).strict();

function validationError(parsed: { error: z.ZodError }) {
  return NextResponse.json({
    code: "VALIDATION_ERROR",
    error: parsed.error.issues[0]?.message ?? "图片生成参数不正确。",
    details: parsed.error.flatten().fieldErrors,
  }, { status: 400 });
}

async function imageOperationResponse(operation: () => Promise<unknown>, action: "generation" | "edit") {
  try {
    const asset = await operation();
    return NextResponse.json({ asset }, { status: 201 });
  } catch (error) {
    if (error instanceof ImageGenerationError) {
      return NextResponse.json({ code: "IMAGE_GENERATION_FAILED", error: error.message }, { status: error.status });
    }
    console.error(`[image-assets] ${action} failed`, error);
    return NextResponse.json({ code: "IMAGE_GENERATION_FAILED", error: action === "edit" ? "图片编辑失败，请稍后重试。" : "图片生成失败，请稍后重试。" }, { status: 502 });
  }
}

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
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

  if (contentType.includes("multipart/form-data")) {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json({ code: "INVALID_FORM_DATA", error: "图片编辑请求格式不正确。" }, { status: 400 });
    }
    const parsed = EditImageSchema.safeParse({
      prompt: formData.get("prompt"),
      aspectRatio: formData.get("aspectRatio") || undefined,
    });
    if (!parsed.success) return validationError(parsed);
    const referenceImage = formData.get("image");
    if (!(referenceImage instanceof File) || referenceImage.size === 0) {
      return NextResponse.json({ code: "REFERENCE_IMAGE_REQUIRED", error: "请上传一张参考图片。" }, { status: 400 });
    }
    if (referenceImage.size > MAX_REFERENCE_IMAGE_BYTES) {
      return NextResponse.json({ code: "REFERENCE_IMAGE_TOO_LARGE", error: "参考图片不能超过 20MB。" }, { status: 413 });
    }
    const referenceBytes = new Uint8Array(await referenceImage.arrayBuffer());
    return imageOperationResponse(
      () => editImageAsset(getDatabase(), auth.user.id, parsed.data.prompt, referenceBytes, parsed.data.aspectRatio),
      "edit",
    );
  }

  if (!contentType.includes("application/json")) {
    return NextResponse.json({ code: "UNSUPPORTED_MEDIA_TYPE", error: "仅支持 JSON 文生图或表单格式的图生图请求。" }, { status: 415 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: "INVALID_JSON", error: "请求体必须是有效的 JSON。" }, { status: 400 });
  }
  const parsed = GenerateImageSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed);
  return imageOperationResponse(
    () => generateImageAsset(
      getDatabase(),
      auth.user.id,
      parsed.data.prompt,
      parsed.data.aspectRatio,
      parsed.data.size,
    ),
    "generation",
  );
}
