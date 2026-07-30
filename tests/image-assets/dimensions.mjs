import assert from "node:assert/strict";
import { detectImageMimeType, readImageDimensions } from "../../src/server/modules/image-asset/dimensions.ts";

function png(width, height) {
  const bytes = Buffer.alloc(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function jpeg(width, height) {
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9,
  ]);
}

function webpVp8x(width, height) {
  const bytes = Buffer.alloc(30);
  bytes.write("RIFF", 0, "ascii");
  bytes.write("WEBP", 8, "ascii");
  bytes.write("VP8X", 12, "ascii");
  const encodedWidth = width - 1;
  const encodedHeight = height - 1;
  bytes[24] = encodedWidth & 0xff;
  bytes[25] = (encodedWidth >> 8) & 0xff;
  bytes[26] = (encodedWidth >> 16) & 0xff;
  bytes[27] = encodedHeight & 0xff;
  bytes[28] = (encodedHeight >> 8) & 0xff;
  bytes[29] = (encodedHeight >> 16) & 0xff;
  return bytes;
}

const pngBytes = png(1254, 1254);
const jpegBytes = jpeg(1672, 941);
const webpBytes = webpVp8x(941, 1672);

assert.equal(detectImageMimeType(pngBytes), "image/png");
assert.equal(detectImageMimeType(jpegBytes), "image/jpeg");
assert.equal(detectImageMimeType(webpBytes), "image/webp");
assert.equal(detectImageMimeType(Buffer.from("not an image")), null);
assert.deepEqual(readImageDimensions(pngBytes, "image/png"), { width: 1254, height: 1254 });
assert.deepEqual(readImageDimensions(jpegBytes, "image/jpeg"), { width: 1672, height: 941 });
assert.deepEqual(readImageDimensions(webpBytes, "image/webp"), { width: 941, height: 1672 });
assert.equal(readImageDimensions(Buffer.from("not an image"), "image/png"), null);

console.log("image dimension parser: passed");
