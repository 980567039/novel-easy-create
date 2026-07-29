import { notFound, redirect } from "next/navigation";

import { hasImageAssetAccess } from "@/lib/image-assets";
import { getAuthenticatedUser } from "@/server/auth";

export const dynamic = "force-dynamic";

export default async function ImageAssetsLayout({ children }: { children: React.ReactNode }) {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login?next=%2Fimage-assets");
  if (!hasImageAssetAccess(user.email)) notFound();
  return children;
}
