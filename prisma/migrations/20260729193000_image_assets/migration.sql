-- CreateEnum
CREATE TYPE "ImageAssetStatus" AS ENUM ('GENERATING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "ImageAsset" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "model" TEXT,
    "size" TEXT,
    "mimeType" TEXT NOT NULL DEFAULT 'image/png',
    "byteSize" INTEGER,
    "storageKey" TEXT NOT NULL,
    "status" "ImageAssetStatus" NOT NULL DEFAULT 'GENERATING',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImageAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ImageAsset_storageKey_key" ON "ImageAsset"("storageKey");

-- CreateIndex
CREATE INDEX "ImageAsset_ownerId_createdAt_idx" ON "ImageAsset"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "ImageAsset_ownerId_status_idx" ON "ImageAsset"("ownerId", "status");

-- AddForeignKey
ALTER TABLE "ImageAsset" ADD CONSTRAINT "ImageAsset_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
