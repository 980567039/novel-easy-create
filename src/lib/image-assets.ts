export const IMAGE_ASSET_ALLOWED_EMAIL = "lingyouce@gmail.com";

export function hasImageAssetAccess(email: string | null | undefined) {
  return email?.trim().toLowerCase() === IMAGE_ASSET_ALLOWED_EMAIL;
}
