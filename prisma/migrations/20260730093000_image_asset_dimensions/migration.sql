-- AlterTable
ALTER TABLE "ImageAsset"
ADD COLUMN "aspectRatio" TEXT,
ADD COLUMN "actualWidth" INTEGER,
ADD COLUMN "actualHeight" INTEGER,
ADD COLUMN "generationMode" TEXT NOT NULL DEFAULT 'TEXT_TO_IMAGE';
