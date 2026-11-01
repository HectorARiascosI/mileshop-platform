import { cookies } from "next/headers";

import { fetchApiGateway, getApiGatewayEndpoint } from "@/lib/api-gateway-url";
import { identifyImageType } from "@/lib/image-file-type";
import { getImageKitFileDetailsUrl, getImageKitFileUrl } from "@/lib/imagekit-api-url";

export const runtime = "nodejs";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" };
const MAX_IMAGE_SIZE_BYTES = 4 * 1024 * 1024;
const MAX_REQUEST_SIZE_BYTES = MAX_IMAGE_SIZE_BYTES + 64 * 1024;
const IMAGEKIT_UPLOAD_URL = "https://upload.imagekit.io/api/v1/files/upload";

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status, headers: PRIVATE_HEADERS });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function getAuthorizedCatalog(): Promise<
  | { products: unknown[] }
  | { error: Response }
> {
  const accessToken = (await cookies()).get("accessToken")?.value?.trim();
  if (!accessToken) {
    return { error: jsonError("Inicia sesión con una cuenta autorizada.", 401) };
  }

  const endpoint = getApiGatewayEndpoint("/admin/catalog/products");
  if (!endpoint) {
    return { error: jsonError("El servicio de administración no está disponible.", 503) };
  }

  let response: Response;
  try {
    response = await fetchApiGateway(endpoint, {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { error: jsonError("No pudimos verificar los permisos de administración.", 503) };
  }

  if (!response.ok) {
    const status = response.status === 401 || response.status === 403 ? response.status : 503;
    return {
      error: jsonError(
        status === 401
          ? "Tu sesión ya no está activa. Inicia sesión de nuevo."
          : status === 403
            ? "Tu cuenta no tiene permisos para administrar el catálogo."
            : "No pudimos verificar los permisos de administración.",
        status,
      ),
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { error: jsonError("El servicio devolvió datos de catálogo inválidos.", 502) };
  }
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    return { error: jsonError("El servicio devolvió datos de catálogo inválidos.", 502) };
  }
  return { products: payload.data };
}

function getImageKitAuthorization(): string | null {
  const privateKey = process.env.IMAGEKIT_PRIVATE_KEY?.trim();
  return privateKey ? `Basic ${Buffer.from(`${privateKey}:`).toString("base64")}` : null;
}

export async function POST(request: Request): Promise<Response> {
  const adminCatalog = await getAuthorizedCatalog();
  if ("error" in adminCatalog) return adminCatalog.error;

  const authorization = getImageKitAuthorization();
  if (!authorization) {
    return jsonError("La carga de fotos no está configurada en el servidor.", 503);
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const requestSize = Number(contentLength);
    if (!Number.isSafeInteger(requestSize) || requestSize > MAX_REQUEST_SIZE_BYTES) {
      return jsonError("La solicitud de imagen supera el tamaño permitido.", 413);
    }
  }

  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("file");
  } catch {
    return jsonError("No se pudo leer el archivo de imagen.", 400);
  }
  if (!(file instanceof File) || file.size === 0) {
    return jsonError("Selecciona una foto para cargar.", 400);
  }
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    return jsonError("La foto no puede superar los 4 MB.", 413);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const imageType = identifyImageType(bytes);
  if (!imageType) {
    return jsonError("Usa una imagen JPG, PNG, WebP o AVIF válida.", 415);
  }

  const fileName = `product-${crypto.randomUUID()}.${imageType.extension}`;
  const form = new FormData();
  form.set("file", new Blob([bytes], { type: imageType.contentType }), fileName);
  form.set("fileName", fileName);
  form.set("folder", "/products");
  form.set("useUniqueFileName", "true");
  form.set("overwriteFile", "false");

  let imageResponse: Response;
  try {
    imageResponse = await fetch(IMAGEKIT_UPLOAD_URL, {
      method: "POST",
      headers: { authorization },
      body: form,
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    return jsonError("No pudimos conectar con el almacenamiento de fotos. Inténtalo de nuevo.", 502);
  }
  if (!imageResponse.ok) {
    return jsonError("No se pudo guardar la foto. Revisa el formato e inténtalo de nuevo.", 502);
  }

  let uploaded: unknown;
  try {
    uploaded = await imageResponse.json();
  } catch {
    return jsonError("El almacenamiento devolvió una respuesta inválida.", 502);
  }
  if (
    !isRecord(uploaded) ||
    typeof uploaded.fileId !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(uploaded.fileId) ||
    typeof uploaded.url !== "string"
  ) {
    return jsonError("El almacenamiento devolvió una respuesta inválida.", 502);
  }
  let imageUrl: URL;
  try {
    imageUrl = new URL(uploaded.url);
  } catch {
    return jsonError("El almacenamiento devolvió una dirección de imagen inválida.", 502);
  }
  if (imageUrl.protocol !== "https:") {
    return jsonError("El almacenamiento devolvió una dirección de imagen inválida.", 502);
  }
  if (imageUrl.hostname !== "ik.imagekit.io") {
    return jsonError("El almacenamiento devolvió una dirección de imagen inválida.", 502);
  }

  return Response.json(
    { data: { fileId: uploaded.fileId, imageUrl: imageUrl.toString() } },
    { status: 201, headers: PRIVATE_HEADERS },
  );
}

export async function DELETE(request: Request): Promise<Response> {
  const adminCatalog = await getAuthorizedCatalog();
  if ("error" in adminCatalog) return adminCatalog.error;

  const authorization = getImageKitAuthorization();
  if (!authorization) {
    return jsonError("La eliminación de fotos no está configurada en el servidor.", 503);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonError("La solicitud de eliminación no es válida.", 400);
  }
  const fileId = isRecord(payload) ? payload.fileId : null;
  if (typeof fileId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(fileId)) {
    return jsonError("La referencia de la foto no es válida.", 400);
  }

  if (
    adminCatalog.products.some(
      (product) => isRecord(product) && product.imageFileId === fileId,
    )
  ) {
    return jsonError("La foto todavía está asociada a un producto.", 409);
  }

  const fileUrl = getImageKitFileUrl(fileId);
  let detailsResponse: Response;
  try {
    detailsResponse = await fetch(getImageKitFileDetailsUrl(fileId), {
      headers: { authorization },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return jsonError("No pudimos verificar la foto en el almacenamiento.", 502);
  }
  if (detailsResponse.status === 404) {
    return Response.json({ data: { deleted: true } }, { headers: PRIVATE_HEADERS });
  }
  if (!detailsResponse.ok) {
    return jsonError("No pudimos verificar la foto en el almacenamiento.", 502);
  }

  let details: unknown;
  try {
    details = await detailsResponse.json();
  } catch {
    return jsonError("El almacenamiento devolvió datos de foto inválidos.", 502);
  }
  if (!isRecord(details) || typeof details.filePath !== "string" || !details.filePath.startsWith("/products/")) {
    return jsonError("La foto no pertenece al catálogo de MileShop.", 400);
  }

  let deleteResponse: Response;
  try {
    deleteResponse = await fetch(fileUrl, {
      method: "DELETE",
      headers: { authorization },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return jsonError("No pudimos retirar la foto del almacenamiento. Puedes volver a intentarlo.", 502);
  }
  if (!deleteResponse.ok && deleteResponse.status !== 404) {
    return jsonError("No pudimos retirar la foto del almacenamiento. Puedes volver a intentarlo.", 502);
  }

  return Response.json({ data: { deleted: true } }, { headers: PRIVATE_HEADERS });
}
