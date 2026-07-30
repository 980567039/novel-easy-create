export const IMAGE_ASSET_ALLOWED_EMAIL = "lingyouce@gmail.com";

export const IMAGE_ASPECT_RATIOS = ["1:1", "2:3", "3:2", "9:16", "16:9"] as const;

export type ImageAspectRatio = (typeof IMAGE_ASPECT_RATIOS)[number];

export const DEFAULT_IMAGE_ASPECT_RATIO: ImageAspectRatio = "1:1";

export const IMAGE_ASPECT_RATIO_OPTIONS: ReadonlyArray<{
  value: ImageAspectRatio;
  label: string;
  hint: string;
  providerSize: "1024x1024" | "1024x1536" | "1536x1024";
}> = [
  { value: "1:1", label: "方图", hint: "头像、方形封面", providerSize: "1024x1024" },
  { value: "2:3", label: "竖版", hint: "小说封面、人物", providerSize: "1024x1536" },
  { value: "3:2", label: "横版", hint: "场景、章节插图", providerSize: "1536x1024" },
  { value: "9:16", label: "手机竖屏", hint: "H5、短视频封面", providerSize: "1024x1536" },
  { value: "16:9", label: "宽屏", hint: "横幅、电影场景", providerSize: "1536x1024" },
];

const optionByAspectRatio = new Map(IMAGE_ASPECT_RATIO_OPTIONS.map((option) => [option.value, option]));

export function imageProviderSizeForAspectRatio(aspectRatio: ImageAspectRatio) {
  return optionByAspectRatio.get(aspectRatio)?.providerSize ?? "1024x1024";
}

export function imageAspectRatioLabel(aspectRatio: string | null | undefined) {
  if (!aspectRatio) return null;
  const option = optionByAspectRatio.get(aspectRatio as ImageAspectRatio);
  return option ? `${option.label} ${option.value}` : aspectRatio;
}

export function aspectRatioFromLegacySize(size: string | null | undefined): ImageAspectRatio | null {
  if (size === "1024x1024") return "1:1";
  if (size === "1024x1536") return "2:3";
  if (size === "1536x1024") return "3:2";
  return null;
}

export function imageProviderEndpoint(baseUrl: string, operation: "generations" | "edits") {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  if (normalized.endsWith(`/images/${operation}`)) return normalized;
  if (normalized.endsWith("/images/generations") || normalized.endsWith("/images/edits")) {
    return normalized.replace(/\/images\/(?:generations|edits)$/, `/images/${operation}`);
  }
  return `${normalized}/images/${operation}`;
}

export function hasImageAssetAccess(email: string | null | undefined) {
  return email?.trim().toLowerCase() === IMAGE_ASSET_ALLOWED_EMAIL;
}
