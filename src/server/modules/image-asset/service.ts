import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ImageAsset, PrismaClient } from "@prisma/client";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
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
  const defaultSize = configuredValue(process.env.IMAGE_SIZE, "1024x1536");
  if (!apiKey) {
    throw new ImageGenerationError("图片生成服务尚未配置，请在服务器设置 IMAGE_API_KEY。", 503);
  }
  return { apiKey, baseUrl, model, defaultSize };
}

function generationEndpoint(baseUrl: string) {
  const normalized = baseUrl.replace(/\/+$/, "");
  return normalized.endsWith("/images/generations") ? normalized : `${normalized}/images/generations`;
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

function sniffMimeType(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/webp" {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  throw new ImageGenerationError("图片服务返回了不支持的文件格式。");
}

function validateImageBytes(bytes: Uint8Array) {
  if (bytes.byteLength === 0) throw new ImageGenerationError("图片服务返回了空文件。");
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new ImageGenerationError("生成图片超过 20MB 限制。");
  const mimeType = sniffMimeType(bytes);
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

async function requestGeneratedImage(prompt: string, size: string, config: ImageProviderConfig) {
  const endpoint = generationEndpoint(config.baseUrl);
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: config.model, prompt, n: 1, size }),
        signal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
      });
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

export function serializeImageAsset(asset: ImageAsset) {
  return {
    id: asset.id,
    prompt: asset.prompt,
    model: asset.model,
    size: asset.size,
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
  return assets.map(serializeImageAsset);
}

export async function generateImageAsset(db: Database, ownerId: string, prompt: string, requestedSize?: string) {
  const config = getImageProviderConfig();
  const size = requestedSize?.trim() || config.defaultSize;
  const assetId = crypto.randomUUID();
  const storageKey = `${ownerId}/${assetId}.image`;
  const asset = await db.imageAsset.create({
    data: { id: assetId, ownerId, prompt, model: config.model, size, storageKey, status: "GENERATING" },
  });
  try {
    const generated = await requestGeneratedImage(prompt, size, config);
    const filePath = resolveImageStoragePath(storageKey);
    await mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporaryPath, generated.bytes, { flag: "wx" });
    await rename(temporaryPath, filePath);
    const updated = await db.imageAsset.update({
      where: { id: asset.id },
      data: { status: "READY", mimeType: generated.mimeType, byteSize: generated.bytes.byteLength, error: null },
    });
    return serializeImageAsset(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "图片生成失败，请稍后重试。";
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
