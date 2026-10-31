import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse as parsePath } from "node:path";

import {
  createPaymentEvidenceStorage,
  LocalPaymentEvidenceStorage,
  MAX_PAYMENT_EVIDENCE_SIZE_BYTES,
  PaymentEvidenceValidationError,
  validatePaymentEvidence,
  type UploadedPaymentEvidence,
} from "../src/payment-evidence/payment-evidence.storage.js";

const fixtures: Array<{
  fileName: string;
  contentType: string;
  bytes: Buffer;
}> = [
  {
    fileName: "receipt.pdf",
    contentType: "application/pdf",
    bytes: Buffer.from("%PDF-1.7\nreceipt\n%%EOF\n"),
  },
  {
    fileName: "receipt.jpg",
    contentType: "image/jpeg",
    bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00]),
  },
  {
    fileName: "receipt.png",
    contentType: "image/png",
    bytes: Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    ]),
  },
];

function upload(
  fixture: typeof fixtures[number],
  overrides: Partial<UploadedPaymentEvidence> = {},
): UploadedPaymentEvidence {
  return {
    originalFileName: fixture.fileName,
    contentType: fixture.contentType,
    bytes: fixture.bytes,
    ...overrides,
  };
}

test("validates PDF, JPEG, and PNG content signatures and records exact size", () => {
  for (const fixture of fixtures) {
    const validated = validatePaymentEvidence(upload(fixture));
    assert.equal(validated.originalFileName, fixture.fileName);
    assert.equal(validated.contentType, fixture.contentType);
    assert.equal(validated.sizeBytes, fixture.bytes.byteLength);
    assert.deepEqual(validated.bytes, fixture.bytes);
  }
});

test("strips client path components from the retained display file name", () => {
  const validated = validatePaymentEvidence(
    upload(fixtures[0]!, { originalFileName: "C:\\fakepath\\receipt.pdf" }),
  );
  assert.equal(validated.originalFileName, "receipt.pdf");
});

test("rejects unsupported, mismatched, or signature-invalid evidence", () => {
  assert.throws(
    () => validatePaymentEvidence(upload(fixtures[0]!, { contentType: "text/plain" })),
    PaymentEvidenceValidationError,
  );
  assert.throws(
    () => validatePaymentEvidence(upload(fixtures[0]!, { originalFileName: "receipt.png" })),
    /extension does not match/,
  );
  assert.throws(
    () => validatePaymentEvidence(upload(fixtures[0]!, { bytes: Buffer.from("not a PDF") })),
    /content does not match/,
  );
  assert.throws(
    () => validatePaymentEvidence(upload(fixtures[1]!, { contentType: "image/png" })),
    /extension does not match/,
  );
});

test("rejects empty files, invalid names, control characters, and files over 10 MiB", () => {
  assert.throws(
    () => validatePaymentEvidence(upload(fixtures[0]!, { bytes: Buffer.alloc(0) })),
    /cannot be empty/,
  );
  assert.throws(
    () => validatePaymentEvidence(upload(fixtures[0]!, { originalFileName: "receipt.pdf\n" })),
    /file name is invalid/,
  );
  const oversizedPdf = Buffer.alloc(MAX_PAYMENT_EVIDENCE_SIZE_BYTES + 1);
  Buffer.from("%PDF-1.7").copy(oversizedPdf);
  Buffer.from("%%EOF").copy(oversizedPdf, oversizedPdf.length - 5);
  assert.throws(
    () => validatePaymentEvidence(upload(fixtures[0]!, { bytes: oversizedPdf })),
    /exceeds the 10 MiB limit/,
  );
});

test("accepts a valid file at the 10 MiB limit", () => {
  const maximumPdf = Buffer.alloc(MAX_PAYMENT_EVIDENCE_SIZE_BYTES);
  Buffer.from("%PDF-1.7").copy(maximumPdf);
  Buffer.from("%%EOF").copy(maximumPdf, maximumPdf.length - 5);

  assert.equal(
    validatePaymentEvidence(upload(fixtures[0]!, { bytes: maximumPdf })).sizeBytes,
    MAX_PAYMENT_EVIDENCE_SIZE_BYTES,
  );
});

test("local private storage uses opaque keys, supports read/delete, and rejects traversal", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "mileshop-evidence-test-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const storage = new LocalPaymentEvidenceStorage(join(directory, "private"));
  const file = validatePaymentEvidence(upload(fixtures[0]!));

  const stored = await storage.store(file);
  assert.match(stored.storageKey, /^[0-9a-f-]{36}$/i);
  assert.equal((await readdir(join(directory, "private"))).length, 1);

  const chunks: Buffer[] = [];
  for await (const chunk of await storage.openRead(stored.storageKey)) {
    chunks.push(Buffer.from(chunk));
  }
  assert.deepEqual(
    Buffer.concat(chunks),
    await readFile(join(directory, "private", stored.storageKey)),
  );
  await storage.delete(stored.storageKey);
  await storage.delete(stored.storageKey);
  assert.deepEqual(await readdir(join(directory, "private")), []);
  await assert.rejects(
    storage.openRead("..\\private-file"),
    /Invalid payment evidence storage key/,
  );
});

test("uses local storage only with an explicit persistent path in production", () => {
  assert.ok(createPaymentEvidenceStorage({ NODE_ENV: "test" }) instanceof LocalPaymentEvidenceStorage);
  assert.throws(
    () => new LocalPaymentEvidenceStorage(parsePath(tmpdir()).root),
    /cannot be a filesystem root/,
  );
  assert.throws(
    () => createPaymentEvidenceStorage({ NODE_ENV: "production" }),
    /absolute PAYMENT_EVIDENCE_LOCAL_DIR/,
  );
  assert.throws(
    () => createPaymentEvidenceStorage({
      NODE_ENV: "production",
      PAYMENT_EVIDENCE_LOCAL_DIR: join(tmpdir(), "mileshop-evidence"),
    }),
    /cannot be inside the temporary directory/,
  );
  assert.throws(
    () => createPaymentEvidenceStorage({
      NODE_ENV: "development",
      PAYMENT_EVIDENCE_STORAGE: "public",
    }),
    /Unsupported payment evidence storage adapter/,
  );

  const productionStorage = createPaymentEvidenceStorage({
    NODE_ENV: "production",
    PAYMENT_EVIDENCE_STORAGE: "local",
    PAYMENT_EVIDENCE_LOCAL_DIR: join(parsePath(tmpdir()).root, "var", "lib", "mileshop", "payment-evidence"),
  });
  assert.ok(productionStorage instanceof LocalPaymentEvidenceStorage);
});
