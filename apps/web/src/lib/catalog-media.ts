type UploadedCatalogImage = {
  fileId: string;
  imageUrl: string;
};

type CatalogMediaCollection = "products" | "promotions" | "announcements";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function responseError(response: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (isRecord(body) && typeof body.message === "string") return body.message;
    if (isRecord(body) && typeof body.error === "string") return body.error;
  } catch {
    return fallback;
  }
  return fallback;
}

export async function uploadCatalogImage(
  file: File,
  collection: CatalogMediaCollection = "products",
): Promise<UploadedCatalogImage> {
  const formData = new FormData();
  formData.set("file", file);
  formData.set("collection", collection);
  const response = await fetch("/api/admin/catalog/media", {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    throw new Error(await responseError(response, "No se pudo cargar la foto."));
  }
  const payload: unknown = await response.json();
  if (
    !isRecord(payload) ||
    !isRecord(payload.data) ||
    typeof payload.data.fileId !== "string" ||
    typeof payload.data.imageUrl !== "string"
  ) {
    throw new Error("El servicio devolvió una respuesta de imagen inválida.");
  }
  return { fileId: payload.data.fileId, imageUrl: payload.data.imageUrl };
}

export async function deleteCatalogImage(fileId: string): Promise<void> {
  const response = await fetch("/api/admin/catalog/media", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fileId }),
  });
  if (!response.ok) {
    throw new Error(await responseError(response, "No se pudo retirar la foto del almacenamiento."));
  }
}
