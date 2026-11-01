import assert from "node:assert/strict";
import test from "node:test";

import { identifyImageType } from "./image-file-type";

test("identifies supported image formats from their file signatures", () => {
  const cases = [
    {
      bytes: [0xff, 0xd8, 0xff, 0x00],
      contentType: "image/jpeg",
      extension: "jpg",
    },
    {
      bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      contentType: "image/png",
      extension: "png",
    },
    {
      bytes: [
        0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00,
        0x57, 0x45, 0x42, 0x50,
      ],
      contentType: "image/webp",
      extension: "webp",
    },
    {
      bytes: [
        0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
        0x61, 0x76, 0x69, 0x66,
      ],
      contentType: "image/avif",
      extension: "avif",
    },
  ] as const;

  for (const image of cases) {
    assert.deepEqual(identifyImageType(Uint8Array.from(image.bytes)), {
      contentType: image.contentType,
      extension: image.extension,
    });
  }
});

test("rejects unsupported, empty, and truncated file signatures", () => {
  assert.equal(identifyImageType(new Uint8Array()), null);
  assert.equal(identifyImageType(Uint8Array.from([0xff, 0xd8])), null);
  assert.equal(identifyImageType(Uint8Array.from([0x47, 0x49, 0x46, 0x38])), null);
});
