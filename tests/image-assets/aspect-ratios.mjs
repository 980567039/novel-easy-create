import assert from "node:assert/strict";

import {
  aspectRatioFromLegacySize,
  DEFAULT_IMAGE_ASPECT_RATIO,
  IMAGE_ASPECT_RATIOS,
  imageProviderEndpoint,
  imageProviderSizeForAspectRatio,
} from "../../src/lib/image-assets.ts";

assert.equal(DEFAULT_IMAGE_ASPECT_RATIO, "1:1");
assert.deepEqual(IMAGE_ASPECT_RATIOS, ["1:1", "2:3", "3:2", "9:16", "16:9"]);
assert.equal(imageProviderSizeForAspectRatio("1:1"), "1024x1024");
assert.equal(imageProviderSizeForAspectRatio("2:3"), "1024x1536");
assert.equal(imageProviderSizeForAspectRatio("3:2"), "1536x1024");
assert.equal(imageProviderSizeForAspectRatio("9:16"), "1024x1536");
assert.equal(imageProviderSizeForAspectRatio("16:9"), "1536x1024");
assert.equal(aspectRatioFromLegacySize("1024x1024"), "1:1");
assert.equal(aspectRatioFromLegacySize("1024x1536"), "2:3");
assert.equal(aspectRatioFromLegacySize("1536x1024"), "3:2");
assert.equal(aspectRatioFromLegacySize("4096x4096"), null);
assert.equal(imageProviderEndpoint("https://example.com/v1", "generations"), "https://example.com/v1/images/generations");
assert.equal(imageProviderEndpoint("https://example.com/v1/", "edits"), "https://example.com/v1/images/edits");
assert.equal(imageProviderEndpoint("https://example.com/v1/images/generations", "edits"), "https://example.com/v1/images/edits");
assert.equal(imageProviderEndpoint("https://example.com/v1/images/edits", "generations"), "https://example.com/v1/images/generations");

console.log("image aspect ratio config: passed");
