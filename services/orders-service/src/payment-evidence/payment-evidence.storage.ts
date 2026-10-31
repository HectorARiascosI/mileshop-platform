import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import {
  chmod,
  link,
  mkdir,
  open,
  unlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  isAbsolute,
  join,
  parse as parsePath,
  relative,
  resolve,
  sep,
} from "node:path";
import { randomUUID } from "node:crypto";

export const MAX_PAYMENT_EVIDENCE_SIZE_BYTES = 10 * 1024 * 1024;
export const PAYMENT_EVIDENCE_STORAGE = "PAYMENT_EVIDENCE_STORAGE";

export type PaymentEvidenceContentType =
  | "application/pdf"
  | "image/jpeg"
  | "image/png";

export type UploadedPaymentEvidence = {
  originalFileName: string;
  contentType: string;
  bytes: Uint8Array;
};

export type ValidatedPaymentEvidence = {
  originalFileName: string;
  contentType: PaymentEvidenceContentType;
  sizeBytes: number;
  bytes: Buffer;
};

export type StoredPaymentEvidence = {
  storageKey: string;
};

export interface PaymentEvidenceStorage {
  store(file: ValidatedPaymentEvidence): Promise<StoredPaymentEvidence>;
  openRead(storageKey: string): Promise<Readable>;
  delete(storageKey: string): Promise<void>;
}

export class PaymentEvidenceValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PaymentEvidenceValidationError";
  }
}

const MIME_EXTENSIONS: Record<PaymentEvidenceContentType, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
};

function isPdf(bytes: Uint8Array): boolean {
  const headerEnd = Math.min(bytes.length - 4, 1024);
  let hasHeader = false;
  for (let offset = 0; offset <= headerEnd; offset += 1) {
    if (
      bytes[offset] === 0x25 &&
      bytes[offset + 1] === 0x50 &&
      bytes[offset + 2] === 0x44 &&
      bytes[offset + 3] === 0x46 &&
      bytes[offset + 4] === 0x2d
    ) {
      hasHeader = true;
      break;
    }
  }
  if (!hasHeader) {
    return false;
  }

  const tailStart = Math.max(0, bytes.length - 1024);
  const eof = Buffer.from(bytes.subarray(tailStart)).includes(Buffer.from("%%EOF"));
  return eof;
}

function hasExpectedSignature(
  bytes: Uint8Array,
  contentType: PaymentEvidenceContentType,
): boolean {
  if (contentType === "application/pdf") {
    return isPdf(bytes);
  }
  if (contentType === "image/jpeg") {
    return bytes.length >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff;
  }

  return bytes.length >= 12 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a &&
    Buffer.from(bytes.subarray(12, 16)).toString("ascii") === "IHDR";
}

export function validatePaymentEvidence(
  input: UploadedPaymentEvidence,
): ValidatedPaymentEvidence {
  if (
    typeof input !== "object" ||
    input === null ||
    typeof input.originalFileName !== "string" ||
    typeof input.contentType !== "string" ||
    !(input.bytes instanceof Uint8Array)
  ) {
    throw new PaymentEvidenceValidationError("A file name, content type, and file content are required");
  }

  if (/[\u0000-\u001f\u007f]/.test(input.originalFileName)) {
    throw new PaymentEvidenceValidationError("The payment evidence file name is invalid");
  }
  const originalFileName = input.originalFileName
    .split(/[\\/]/)
    .at(-1)
    ?.trim();
  if (
    !originalFileName ||
    originalFileName.length > 255
  ) {
    throw new PaymentEvidenceValidationError("The payment evidence file name is invalid");
  }
  if (input.bytes.byteLength === 0) {
    throw new PaymentEvidenceValidationError("The payment evidence file cannot be empty");
  }
  if (input.bytes.byteLength > MAX_PAYMENT_EVIDENCE_SIZE_BYTES) {
    throw new PaymentEvidenceValidationError("The payment evidence file exceeds the 10 MiB limit");
  }

  const contentType = input.contentType.trim().toLowerCase();
  if (!Object.hasOwn(MIME_EXTENSIONS, contentType)) {
    throw new PaymentEvidenceValidationError("Only PDF, JPEG, and PNG payment evidence is supported");
  }
  const supportedContentType = contentType as PaymentEvidenceContentType;
  if (
    !originalFileName.toLowerCase().endsWith(MIME_EXTENSIONS[supportedContentType]) &&
    !(supportedContentType === "image/jpeg" && originalFileName.toLowerCase().endsWith(".jpeg"))
  ) {
    throw new PaymentEvidenceValidationError("The file extension does not match its declared content type");
  }
  if (!hasExpectedSignature(input.bytes, supportedContentType)) {
    throw new PaymentEvidenceValidationError("The file content does not match its declared content type");
  }

  const bytes = Buffer.from(input.bytes);
  return {
    originalFileName,
    contentType: supportedContentType,
    sizeBytes: bytes.byteLength,
    bytes,
  };
}

export class LocalPaymentEvidenceStorage implements PaymentEvidenceStorage {
  private readonly directory: string;

  public constructor(directory = join(tmpdir(), "mileshop-private-payment-evidence")) {
    this.directory = resolve(directory);
    if (this.directory === parsePath(this.directory).root) {
      throw new Error("Payment evidence storage directory cannot be a filesystem root");
    }
  }

  public async store(file: ValidatedPaymentEvidence): Promise<StoredPaymentEvidence> {
    const storageKey = randomUUID();
    const temporaryPath = resolve(this.directory, `.${storageKey}.tmp`);
    const destinationPath = this.resolveKeyPath(storageKey);

    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);

    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(file.bytes);
      await handle.sync();
    } catch (error) {
      await handle.close();
      await unlink(temporaryPath);
      throw error;
    }
    await handle.close();
    try {
      await link(temporaryPath, destinationPath);
    } catch (error) {
      await unlink(temporaryPath);
      throw error;
    }
    await unlink(temporaryPath);

    return { storageKey };
  }

  public async openRead(storageKey: string): Promise<Readable> {
    return createReadStream(this.resolveKeyPath(storageKey));
  }

  public async delete(storageKey: string): Promise<void> {
    try {
      await unlink(this.resolveKeyPath(storageKey));
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return;
      }
      throw error;
    }
  }

  private resolveKeyPath(storageKey: string): string {
    const filePath = resolve(this.directory, validateStorageKey(storageKey));
    if (!filePath.startsWith(`${this.directory}${process.platform === "win32" ? "\\" : "/"}`)) {
      throw new Error("Payment evidence storage key escapes its private directory");
    }
    return filePath;
  }
}

export function createPaymentEvidenceStorage(
  environment: NodeJS.ProcessEnv,
): PaymentEvidenceStorage {
  const adapter = environment.PAYMENT_EVIDENCE_STORAGE ?? "local";
  if (adapter !== "local") {
    throw new Error(`Unsupported payment evidence storage adapter: ${adapter}`);
  }
  const configuredDirectory = environment.PAYMENT_EVIDENCE_LOCAL_DIR?.trim();
  if (environment.NODE_ENV === "production") {
    if (!configuredDirectory || !isAbsolute(configuredDirectory)) {
      throw new Error(
        "Production requires an absolute PAYMENT_EVIDENCE_LOCAL_DIR on a persistent private volume",
      );
    }
    const directory = resolve(configuredDirectory);
    const relativeToTemporaryDirectory = relative(resolve(tmpdir()), directory);
    const isInsideTemporaryDirectory =
      relativeToTemporaryDirectory === "" ||
      (relativeToTemporaryDirectory !== ".." &&
        !relativeToTemporaryDirectory.startsWith(`..${sep}`) &&
        !isAbsolute(relativeToTemporaryDirectory));
    if (isInsideTemporaryDirectory) {
      throw new Error("Production payment evidence storage cannot be inside the temporary directory");
    }
    return new LocalPaymentEvidenceStorage(directory);
  }

  return new LocalPaymentEvidenceStorage(
    configuredDirectory ||
      join(tmpdir(), "mileshop-private-payment-evidence"),
  );
}

function validateStorageKey(storageKey: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(storageKey)) {
    throw new Error("Invalid payment evidence storage key");
  }
  return storageKey;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
