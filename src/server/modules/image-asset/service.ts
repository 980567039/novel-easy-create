import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ImageAsset, PrismaClient } from "@prisma/client";

import {
  aspectRatioFromLegacySize,
  DEFAULT_IMAGE_ASPECT_RATIO,
  imageProviderEndpoint,
  imageProviderSizeForAspectRatio,
  type ImageAspectRatio,
} from "@/lib/image-assets";
import {
  detectImageMimeType,
  readImageDimensions,
  type SupportedImageMimeType,
} from "@/server/modules/image-asset/dimensions";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_REFERENCE_IMAGE_BYTES = 20 * 1024 * 1024;
const GENERATION_TIMEOUT_MS = 300_000;
const DOWNLOAD_TIMEOUT_MS = 90_000;

type Database = PrismaClient;

export interface ImageProviderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  defaultSize: string;
}

export class ImageGenerationError extends Error {
  readonly status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = "ImageGenerationError";
    this.status = status;
  }
}

function configuredValue(...values: Array<string | undefined>) {
  return values.map((value) => value?.trim()).find(Boolean) ?? "";
}

export function getImageProviderConfig(): ImageProviderConfig {
  // This is deliberately separate from AiProviderConfig in PostgreSQL. The
  // fallback environment variables only preserve compatibility with existing
  // server deployments; browser/user AI settings are never read here.
  const apiKey = configuredValue(process.env.IMAGE_API_KEY, process.env.REDINK_IMAGE_API_KEY, process.env.AI_API_KEY);
  const baseUrl = configuredValue(process.env.IMAGE_BASE_URL, process.env.REDINK_IMAGE_BASE_URL, process.env.AI_BASE_URL, "https://codex.quat.cc/v1");
  const model = configuredValue(process.env.IMAGE_MODEL, "gpt-image-2");
  const defaultSize = configuredValue(process.env.IMAGE_SIZE, "1024x1024");
  if (!apiKey) {
    throw new ImageGenerationError("图片生成服务尚未配置，请在服务器设置 IMAGE_API_KEY。", 503);
  }
  return { apiKey, baseUrl, model, defaultSize };
}

function storageRoot() {
  const configuredRoot = process.env.IMAGE_STORAGE_DIR?.trim();
  if (configuredRoot) return path.resolve(/* turbopackIgnore: true */ configuredRoot);
  return path.join(/* turbopackIgnore: true */ process.cwd(), "data", "image-assets");
}

export function resolveImageStoragePath(storageKey: string) {
  const root = storageRoot();
  const filePath = path.resolve(/* turbopackIgnore: true */ root, storageKey);
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
    throw new Error("非法图片存储路径");
  }
  return filePath;
}

function validateImageBytes(bytes: Uint8Array) {
  if (bytes.byteLength === 0) throw new ImageGenerationError("图片服务返回了空文件。");
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new ImageGenerationError("生成图片超过 20MB 限制。");
  const mimeType = detectImageMimeType(bytes);
  if (!mimeType) throw new ImageGenerationError("图片服务返回了不支持的文件格式。");
  return { bytes, mimeType };
}

export function validateReferenceImageBytes(bytes: Uint8Array) {
  if (bytes.byteLength === 0) throw new ImageGenerationError("参考图片不能为空。", 400);
  if (bytes.byteLength > MAX_REFERENCE_IMAGE_BYTES) throw new ImageGenerationError("参考图片不能超过 20MB。", 413);
  const mimeType = detectImageMimeType(bytes);
  if (!mimeType) throw new ImageGenerationError("参考图片只支持 PNG、JPEG 或 WebP。", 400);
  return { bytes, mimeType };
}

async function downloadImage(urlValue: string) {
  if (urlValue.startsWith("data:")) {
    const match = urlValue.match(/^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/=\s]+)$/i);
    if (!match) throw new ImageGenerationError("图片服务返回了无效的数据地址。");
    return validateImageBytes(Buffer.from(match[1], "base64"));
  }
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    throw new ImageGenerationError("图片服务返回了无效的下载地址。");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ImageGenerationError("图片下载地址协议不受支持。");
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS), redirect: "follow" });
  if (!response.ok) throw new ImageGenerationError(`图片下载失败（HTTP ${response.status}）。`);
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
    throw new ImageGenerationError("生成图片超过 20MB 限制。");
  }
  return validateImageBytes(new Uint8Array(await response.arrayBuffer()));
}

function providerMessage(body: unknown, status: number) {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const record = body as Record<string, unknown>;
    const error = record.error;
    if (typeof error === "string" && error.trim()) return error.trim();
    if (error && typeof error === "object" && !Array.isArray(error)) {
      const message = (error as Record<string, unknown>).message;
      if (typeof message === "string" && message.trim()) return message.trim();
    }
    if (typeof record.message === "string" && record.message.trim()) return record.message.trim();
  }
  return `图片服务请求失败（HTTP ${status}）。`;
}

const ASPECT_RATIO_PROMPT_REQUIREMENTS: Record<ImageAspectRatio, string> = {
  "1:1": "正方形画幅，宽高必须相等，最终宽高比严格为 1:1",
  "2:3": "竖版小说封面画幅，高度大于宽度，最终宽高比严格为 2:3",
  "3:2": "横版章节插图画幅，宽度大于高度，最终宽高比严格为 3:2",
  "9:16": "手机竖屏画幅，高度明显大于宽度，最终宽高比严格为 9:16",
  "16:9": "宽银幕横版画幅，宽度明显大于高度，最终宽高比严格为 16:9",
};

export function promptWithAspectRatio(prompt: string, aspectRatio: ImageAspectRatio) {
  return `${prompt.trim()}\n\n【画幅硬性要求】${ASPECT_RATIO_PROMPT_REQUIREMENTS[aspectRatio]}。必须按该比例构图和输出，不得改为其他横竖比例。`;
}

export function editPromptWithAspectRatio(prompt: string, aspectRatio: ImageAspectRatio) {
  return promptWithAspectRatio(
    `请以提供的参考图片为基础进行编辑。只修改下述要求明确涉及的内容，未提及的主体身份、核心构图和视觉细节尽量保持一致。\n\n编辑要求：${prompt.trim()}`,
    aspectRatio,
  );
}

async function imageFromProviderRequest(request: () => Promise<Response>) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await request();
      const body = await response.json().catch(() => null) as unknown;
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        if (retryable && attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 1_500));
          continue;
        }
        throw new ImageGenerationError(providerMessage(body, response.status));
      }
      const record = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
      const data = Array.isArray(record.data) ? record.data : [];
      const first = data[0] && typeof data[0] === "object" && !Array.isArray(data[0]) ? data[0] as Record<string, unknown> : {};
      if (typeof first.b64_json === "string" && first.b64_json.trim()) {
        return validateImageBytes(Buffer.from(first.b64_json, "base64"));
      }
      if (typeof first.url === "string" && first.url.trim()) return downloadImage(first.url.trim());
      throw new ImageGenerationError("图片服务没有返回可用图片。");
    } catch (error) {
      lastError = error;
      if (error instanceof ImageGenerationError) throw error;
      if (attempt === 0) continue;
    }
  }
  if (lastError instanceof Error && lastError.name === "TimeoutError") {
    throw new ImageGenerationError("图片生成超时，请稍后重试。", 504);
  }
  throw new ImageGenerationError("无法连接图片生成服务，请稍后重试。");
}

async function requestGeneratedImage(prompt: string, aspectRatio: ImageAspectRatio, size: string, config: ImageProviderConfig) {
  const endpoint = imageProviderEndpoint(config.baseUrl, "generations");
  const constrainedPrompt = promptWithAspectRatio(prompt, aspectRatio);
  return imageFromProviderRequest(() => fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: config.model, prompt: constrainedPrompt, n: 1, size, aspect_ratio: aspectRatio }),
    signal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
  }));
}

function imageFileName(mimeType: SupportedImageMimeType) {
  if (mimeType === "image/jpeg") return "reference.jpg";
  if (mimeType === "image/webp") return "reference.webp";
  return "reference.png";
}

async function requestEditedImage(
  prompt: string,
  aspectRatio: ImageAspectRatio,
  size: string,
  reference: ReturnType<typeof validateReferenceImageBytes>,
  config: ImageProviderConfig,
) {
  const endpoint = imageProviderEndpoint(config.baseUrl, "edits");
  const constrainedPrompt = editPromptWithAspectRatio(prompt, aspectRatio);
  return imageFromProviderRequest(() => {
    const formData = new FormData();
    formData.set("model", config.model);
    formData.set("prompt", constrainedPrompt);
    formData.set("n", "1");
    formData.set("size", size);
    formData.set("image", new Blob([Buffer.from(reference.bytes)], { type: reference.mimeType }), imageFileName(reference.mimeType));
    return fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: formData,
      signal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
    });
  });
}

export function serializeImageAsset(asset: ImageAsset) {
  return {
    id: asset.id,
    prompt: asset.prompt,
    model: asset.model,
    size: asset.size,
    generationMode: asset.generationMode,
    aspectRatio: asset.aspectRatio,
    actualWidth: asset.actualWidth,
    actualHeight: asset.actualHeight,
    mimeType: asset.mimeType,
    byteSize: asset.byteSize,
    status: asset.status,
    error: asset.error,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
    previewUrl: asset.status === "READY" ? `/api/image-assets/${asset.id}/file` : null,
    downloadUrl: asset.status === "READY" ? `/api/image-assets/${asset.id}/file?download=1` : null,
  };
}

export async function listImageAssets(db: Database, ownerId: string) {
  const assets = await db.imageAsset.findMany({ where: { ownerId }, orderBy: { createdAt: "desc" }, take: 100 });
  const hydratedAssets: ImageAsset[] = [];
  for (const asset of assets) {
    const legacyAspectRatio = asset.aspectRatio ?? aspectRatioFromLegacySize(asset.size);
    if (asset.status !== "READY" || (asset.actualWidth && asset.actualHeight)) {
      if (!asset.aspectRatio && legacyAspectRatio) {
        const updated = await db.imageAsset.update({ where: { id: asset.id }, data: { aspectRatio: legacyAspectRatio } });
        hydratedAssets.push(updated);
      } else {
        hydratedAssets.push(asset);
      }
      continue;
    }
    try {
      const bytes = await readFile(/* turbopackIgnore: true */ resolveImageStoragePath(asset.storageKey));
      const mimeType = detectImageMimeType(bytes);
      if (!mimeType) throw new Error("不支持的历史图片格式");
      const dimensions = readImageDimensions(bytes, mimeType);
      const updated = await db.imageAsset.update({
        where: { id: asset.id },
        data: {
          aspectRatio: legacyAspectRatio,
          actualWidth: dimensions?.width,
          actualHeight: dimensions?.height,
          mimeType,
        },
      });
      hydratedAssets.push(updated);
    } catch (error) {
      console.warn(`[image-assets] unable to read dimensions for ${asset.id}`, error);
      hydratedAssets.push(asset);
    }
  }
  return hydratedAssets.map(serializeImageAsset);
}

export async function generateImageAsset(
  db: Database,
  ownerId: string,
  prompt: string,
  requestedAspectRatio?: ImageAspectRatio,
  legacyRequestedSize?: string,
) {
  const config = getImageProviderConfig();
  const aspectRatio = requestedAspectRatio
    ?? aspectRatioFromLegacySize(legacyRequestedSize)
    ?? aspectRatioFromLegacySize(config.defaultSize)
    ?? DEFAULT_IMAGE_ASPECT_RATIO;
  const size = imageProviderSizeForAspectRatio(aspectRatio);
  const assetId = crypto.randomUUID();
  const storageKey = `${ownerId}/${assetId}.image`;
  const asset = await db.imageAsset.create({
    data: { id: assetId, ownerId, prompt, model: config.model, size, aspectRatio, generationMode: "TEXT_TO_IMAGE", storageKey, status: "GENERATING" },
  });
  try {
    const generated = await requestGeneratedImage(prompt, aspectRatio, size, config);
    const dimensions = readImageDimensions(generated.bytes, generated.mimeType);
    if (!dimensions) throw new ImageGenerationError("无法读取图片服务返回文件的真实尺寸。");
    const filePath = resolveImageStoragePath(storageKey);
    await mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporaryPath, generated.bytes, { flag: "wx" });
    await rename(temporaryPath, filePath);
    const updated = await db.imageAsset.update({
      where: { id: asset.id },
      data: {
        status: "READY",
        mimeType: generated.mimeType,
        byteSize: generated.bytes.byteLength,
        actualWidth: dimensions.width,
        actualHeight: dimensions.height,
        error: null,
      },
    });
    return serializeImageAsset(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "图片生成失败，请稍后重试。";
    await db.imageAsset.update({ where: { id: asset.id }, data: { status: "FAILED", error: message.slice(0, 1_000) } }).catch(() => undefined);
    throw error;
  }
}

export async function editImageAsset(
  db: Database,
  ownerId: string,
  prompt: string,
  referenceBytes: Uint8Array,
  requestedAspectRatio?: ImageAspectRatio,
) {
  const config = getImageProviderConfig();
  const reference = validateReferenceImageBytes(referenceBytes);
  const referenceDimensions = readImageDimensions(reference.bytes, reference.mimeType);
  if (!referenceDimensions) throw new ImageGenerationError("无法读取参考图片尺寸。", 400);
  const aspectRatio = requestedAspectRatio ?? DEFAULT_IMAGE_ASPECT_RATIO;
  const size = imageProviderSizeForAspectRatio(aspectRatio);
  const assetId = crypto.randomUUID();
  const storageKey = `${ownerId}/${assetId}.image`;
  const asset = await db.imageAsset.create({
    data: {
      id: assetId,
      ownerId,
      prompt,
      model: config.model,
      size,
      aspectRatio,
      generationMode: "IMAGE_TO_IMAGE",
      storageKey,
      status: "GENERATING",
    },
  });
  try {
    const generated = await requestEditedImage(prompt, aspectRatio, size, reference, config);
    const dimensions = readImageDimensions(generated.bytes, generated.mimeType);
    if (!dimensions) throw new ImageGenerationError("无法读取图片服务返回文件的真实尺寸。");
    const filePath = resolveImageStoragePath(storageKey);
    await mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporaryPath, generated.bytes, { flag: "wx" });
    await rename(temporaryPath, filePath);
    const updated = await db.imageAsset.update({
      where: { id: asset.id },
      data: {
        status: "READY",
        mimeType: generated.mimeType,
        byteSize: generated.bytes.byteLength,
        actualWidth: dimensions.width,
        actualHeight: dimensions.height,
        error: null,
      },
    });
    return serializeImageAsset(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "图片编辑失败，请稍后重试。";
    await db.imageAsset.update({ where: { id: asset.id }, data: { status: "FAILED", error: message.slice(0, 1_000) } }).catch(() => undefined);
    throw error;
  }
}

export async function getImageAssetFile(db: Database, ownerId: string, assetId: string) {
  const asset = await db.imageAsset.findFirst({ where: { id: assetId, ownerId, status: "READY" } });
  if (!asset) return null;
  try {
    return { asset, bytes: await readFile(/* turbopackIgnore: true */ resolveImageStoragePath(asset.storageKey)) };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

export async function deleteImageAsset(db: Database, ownerId: string, assetId: string) {
  const asset = await db.imageAsset.findFirst({ where: { id: assetId, ownerId } });
  if (!asset) return null;
  await db.imageAsset.delete({ where: { id: asset.id } });
  await unlink(resolveImageStoragePath(asset.storageKey)).catch((error: unknown) => {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
  });
  return { id: asset.id };
}
