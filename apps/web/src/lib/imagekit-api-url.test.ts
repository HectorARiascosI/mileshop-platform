import assert from "node:assert/strict";
import test from "node:test";

import { getImageKitFileDetailsUrl, getImageKitFileUrl } from "./imagekit-api-url";

test("uses ImageKit's file details endpoint when verifying a file", () => {
  assert.equal(
    getImageKitFileDetailsUrl("file_123"),
    "https://api.imagekit.io/v1/files/file_123/details",
  );
});

test("encodes file IDs in ImageKit API URLs", () => {
  assert.equal(
    getImageKitFileUrl("file/id"),
    "https://api.imagekit.io/v1/files/file%2Fid",
  );
});
