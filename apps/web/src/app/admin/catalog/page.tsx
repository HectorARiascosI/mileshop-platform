"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { getOptimizedImageUrl } from "@/lib/imagekit-url";

type Product = {
  id: string;
  sku: string;
  name: string;
  description: string;
  priceCop: number;
  stock: number;
  imageUrl: string | null;
  imageFileId: string | null;
  isActive: boolean;
};

type ProductForm = {
  sku: string;
  name: string;
  description: string;
  priceCop: string;
  imageUrl: string;
  imageFileId: string | null;
  isActive: boolean;
};

type ReceiptRequest = {
  idempotencyKey: string;
  productId: string;
  quantity: number;
  reason: string;
};

const EMPTY_FORM: ProductForm = {
  sku: "",
  name: "",
  description: "",
  priceCop: "",
  imageUrl: "",
  imageFileId: null,
  isActive: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProduct(value: unknown): value is Product {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.sku === "string" &&
    typeof value.name === "string" &&
    typeof value.description === "string" &&
    Number.isSafeInteger(value.priceCop) &&
    Number.isSafeInteger(value.stock) &&
    (typeof value.imageUrl === "string" || value.imageUrl === null) &&
    (typeof value.imageFileId === "string" || value.imageFileId === null) &&
    typeof value.isActive === "boolean"
  );
}

function isUploadedImage(value: unknown): value is { fileId: string; imageUrl: string } {
  return (
    isRecord(value) &&
    typeof value.fileId === "string" &&
    typeof value.imageUrl === "string"
  );
}

function formatPrice(priceCop: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(priceCop);
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

async function uploadProductImage(file: File): Promise<{ fileId: string; imageUrl: string }> {
  const formData = new FormData();
  formData.set("file", file);
  const response = await fetch("/api/admin/catalog/media", {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    throw new Error(await responseError(response, "No se pudo cargar la foto."));
  }
  const payload: unknown = await response.json();
  if (!isRecord(payload) || !isUploadedImage(payload.data)) {
    throw new Error("El servicio devolvió una respuesta de imagen inválida.");
  }
  return payload.data;
}

async function deleteProductImage(fileId: string): Promise<void> {
  const response = await fetch("/api/admin/catalog/media", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fileId }),
  });
  if (!response.ok) {
    throw new Error(await responseError(response, "No se pudo retirar la foto del almacenamiento."));
  }
}

export default function AdminCatalogPage() {
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [form, setForm] = useState<ProductForm>(EMPTY_FORM);
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [pendingImageCleanup, setPendingImageCleanup] = useState<string[]>([]);
  const [imageCleanupLoaded, setImageCleanupLoaded] = useState(false);
  const [cleaningImageId, setCleaningImageId] = useState<string | null>(null);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [stockProductId, setStockProductId] = useState("");
  const [stockQuantity, setStockQuantity] = useState("1");
  const [stockReason, setStockReason] = useState("");
  const [receiptRequest, setReceiptRequest] = useState<ReceiptRequest | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingProduct, setIsSavingProduct] = useState(false);
  const [isReceivingStock, setIsReceivingStock] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selectImageFile = (file: File | null) => {
    setSelectedImageFile(file);
    setPreviewImageUrl(file ? URL.createObjectURL(file) : null);
  };

  useEffect(() => {
    if (previewImageUrl) return () => URL.revokeObjectURL(previewImageUrl);
  }, [previewImageUrl]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      try {
        const savedCleanup = window.localStorage.getItem("mileshop-pending-image-cleanup-v1");
        if (savedCleanup) {
          const parsed: unknown = JSON.parse(savedCleanup);
          if (
            !Array.isArray(parsed) ||
            !parsed.every(
              (fileId) =>
                typeof fileId === "string" &&
                /^[A-Za-z0-9_-]{1,128}$/.test(fileId),
            )
          ) {
            throw new Error("La lista guardada de fotos pendientes no es válida.");
          }
          setPendingImageCleanup([...new Set(parsed)]);
        }
      } catch (requestError) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "No se pudo recuperar la lista de fotos pendientes.",
        );
      } finally {
        setImageCleanupLoaded(true);
      }
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    if (!imageCleanupLoaded) return;
    try {
      window.localStorage.setItem(
        "mileshop-pending-image-cleanup-v1",
        JSON.stringify(pendingImageCleanup),
      );
    } catch {
      window.setTimeout(
        () => setError("No pudimos guardar en este navegador la lista de fotos pendientes."),
        0,
      );
    }
  }, [imageCleanupLoaded, pendingImageCleanup]);

  const refreshProducts = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/catalog/products", { cache: "no-store" });
      if (response.status === 401 || response.status === 403) {
        setAuthorized(false);
        setProducts([]);
        return;
      }
      if (!response.ok) {
        throw new Error(await responseError(response, "No se pudo cargar el catálogo."));
      }
      const payload: unknown = await response.json();
      if (!isRecord(payload) || !Array.isArray(payload.data)) {
        throw new Error("El servicio devolvió un catálogo inválido.");
      }
      const receivedProducts: unknown[] = payload.data;
      const validProducts = receivedProducts.filter(isProduct);
      if (validProducts.length !== receivedProducts.length) {
        throw new Error("El servicio devolvió un catálogo inválido.");
      }
      setAuthorized(true);
      setProducts(validProducts);
      setStockProductId((current) =>
        validProducts.some((product) => product.id === current)
          ? current
          : validProducts[0]?.id ?? "",
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Error inesperado.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void fetch("/api/auth/me", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          if (active) setAuthorized(false);
          return;
        }
        const profile: unknown = await response.json();
        const isAdmin = isRecord(profile) && profile.role === "STORE_ADMIN";
        if (active) {
          setAuthorized(isAdmin);
          if (isAdmin) await refreshProducts();
        }
      })
      .catch(() => {
        if (active) {
          setAuthorized(false);
          setError("No pudimos verificar tu cuenta. Inténtalo de nuevo.");
          setIsLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [refreshProducts]);

  const beginEdit = (product: Product) => {
    setEditingProductId(product.id);
    setForm({
      sku: product.sku,
      name: product.name,
      description: product.description,
      priceCop: String(product.priceCop),
      imageUrl: product.imageUrl ?? "",
      imageFileId: product.imageFileId,
      isActive: product.isActive,
    });
    selectImageFile(null);
    setError(null);
    setNotice(null);
  };

  const resetForm = () => {
    setEditingProductId(null);
    setForm(EMPTY_FORM);
    selectImageFile(null);
  };

  const saveProduct = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const priceCop = Number(form.priceCop);
    if (!Number.isSafeInteger(priceCop) || priceCop < 0 || priceCop > 2_000_000_000) {
      setError("El precio debe ser un valor entero en pesos colombianos.");
      return;
    }
    setIsSavingProduct(true);
    setError(null);
    setNotice(null);
    const previousImageFileId = editingProductId
      ? products.find((product) => product.id === editingProductId)?.imageFileId ?? null
      : null;
    let uploadedImage: { fileId: string; imageUrl: string } | null = null;
    let productSaved = false;
    let imageFileId = form.imageFileId;
    try {
      let imageUrl: string | null = form.imageUrl.trim() || null;
      if (!form.isActive) {
        imageUrl = null;
        imageFileId = null;
      } else if (selectedImageFile) {
        uploadedImage = await uploadProductImage(selectedImageFile);
        imageUrl = uploadedImage.imageUrl;
        imageFileId = uploadedImage.fileId;
      }

      const response = await fetch(
        editingProductId
          ? `/api/admin/catalog/products/${encodeURIComponent(editingProductId)}`
          : "/api/admin/catalog/products",
        {
          method: editingProductId ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sku: form.sku,
            name: form.name,
            description: form.description,
            priceCop,
            imageUrl,
            imageFileId,
            isActive: form.isActive,
          }),
        },
      );
      if (!response.ok) {
        throw new Error(await responseError(response, "No se pudo guardar el producto."));
      }
      productSaved = true;
      setNotice(editingProductId ? "Producto actualizado." : "Producto creado.");
      resetForm();
      await refreshProducts();
      if (previousImageFileId && previousImageFileId !== imageFileId) {
        try {
          await deleteProductImage(previousImageFileId);
        } catch {
          setPendingImageCleanup((current) =>
            current.includes(previousImageFileId)
              ? current
              : [...current, previousImageFileId],
          );
          setError("El producto se guardó, pero no se pudo retirar la foto anterior del almacenamiento.");
        }
      }
    } catch (requestError) {
      const failedUploadFileId = !productSaved ? uploadedImage?.fileId : null;
      if (failedUploadFileId) {
        try {
          await deleteProductImage(failedUploadFileId);
        } catch {
          setPendingImageCleanup((current) =>
            current.includes(failedUploadFileId)
              ? current
              : [...current, failedUploadFileId],
          );
        }
      }
      setError(requestError instanceof Error ? requestError.message : "Error inesperado.");
    } finally {
      setIsSavingProduct(false);
    }
  };

  const retryImageCleanup = async (fileId: string) => {
    setCleaningImageId(fileId);
    setError(null);
    try {
      await deleteProductImage(fileId);
      setPendingImageCleanup((current) => current.filter((pendingId) => pendingId !== fileId));
      setNotice("Foto retirada del almacenamiento.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No se pudo retirar la foto.");
    } finally {
      setCleaningImageId(null);
    }
  };

  const receiveStock = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    let request = receiptRequest;
    if (!request) {
      const quantity = Number(stockQuantity);
      if (!stockProductId || !Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 1_000_000) {
        setError("Selecciona un producto y una cantidad válida (máximo 1.000.000).");
        return;
      }
      if (stockReason.trim().length < 3) {
        setError("Indica el motivo de la recepción de inventario.");
        return;
      }
      request = {
        idempotencyKey: window.crypto.randomUUID(),
        productId: stockProductId,
        quantity,
        reason: stockReason.trim(),
      };
      setReceiptRequest(request);
    }
    setIsReceivingStock(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/catalog/stock-receipts", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": request.idempotencyKey,
        },
        body: JSON.stringify({
          reason: request.reason,
          lines: [{ productId: request.productId, quantity: request.quantity }],
        }),
      });
      if (!response.ok) {
        throw new Error(await responseError(response, "No se pudo registrar la entrada."));
      }
      setNotice("Entrada registrada y stock actualizado. El movimiento quedó auditado.");
      setStockQuantity("1");
      setStockReason("");
      setReceiptRequest(null);
      await refreshProducts();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Error inesperado.");
    } finally {
      setIsReceivingStock(false);
    }
  };

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-8 text-slate-900">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">MileShop</p>
          <h1 className="text-3xl font-bold">Catálogo e inventario</h1>
          <p className="mt-1 text-slate-600">
            Agrega lo que la tienda vende. Aquí también puedes indicar cuántas unidades tienes disponibles.
          </p>
        </div>
        <nav className="flex flex-wrap gap-2">
          <Link className="rounded border px-4 py-2 font-medium hover:bg-slate-50" href="/admin/orders">
            Pedidos y ventas
          </Link>
          <Link className="rounded border px-4 py-2 font-medium hover:bg-slate-50" href="/">
            Volver a la tienda
          </Link>
        </nav>
      </header>

      {authorized === false && (
        <section className="rounded-lg border border-amber-300 bg-amber-50 p-5">
          Inicia sesión con la cuenta de administradora de tienda.
          <Link className="ml-2 font-semibold underline" href="/login">Iniciar sesión</Link>
        </section>
      )}

      {authorized && (
        <>
          {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-red-800" role="alert">{error}</p>}
          {notice && <p className="mb-4 rounded-lg bg-emerald-50 p-3 text-emerald-800" role="status">{notice}</p>}

          <section className="mb-8 grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(18rem,0.7fr)]">
            <form className="grid gap-4 rounded-xl border bg-white p-5 shadow-sm" onSubmit={saveProduct}>
              <div>
                <h2 className="text-xl font-semibold">{editingProductId ? "Editar producto" : "Agregar producto"}</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Guarda primero los datos del producto. Después podrás agregar las unidades que tengas; hasta entonces no aparecerá disponible para comprar.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-1 text-sm font-medium">
                  Código del producto (SKU)
                  <input className="rounded border px-3 py-2" required maxLength={64} value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} />
                  <span className="text-xs font-normal text-slate-600">
                    Es un código único para distinguir este producto. Si no tienes uno, crea un código interno, por ejemplo: MS-PITILLOS-NKD125-001.
                  </span>
                </label>
                <label className="grid gap-1 text-sm font-medium">
                  Nombre
                  <input className="rounded border px-3 py-2" required minLength={2} maxLength={160} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
                </label>
              </div>
              <label className="grid gap-1 text-sm font-medium">
                Descripción
                <textarea className="min-h-24 rounded border px-3 py-2" maxLength={5000} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-1 text-sm font-medium">
                  Precio de venta (pesos colombianos)
                  <input className="rounded border px-3 py-2" type="number" required min="0" max="2000000000" step="1" value={form.priceCop} onChange={(event) => setForm({ ...form, priceCop: event.target.value })} />
                  <span className="text-xs font-normal text-slate-600">
                    Escribe solo números, sin puntos ni signo de pesos. Ejemplo: 10000.
                  </span>
                </label>
              </div>
              <fieldset className="grid gap-3 rounded-lg border p-4">
                <legend className="px-1 text-sm font-semibold">Foto del producto</legend>
                <label className="grid gap-1 text-sm font-medium">
                  Cargar desde el dispositivo
                  <input
                    key={selectedImageFile?.name ?? "product-image-input"}
                    className="rounded border px-3 py-2 font-normal"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/avif"
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null;
                      selectImageFile(file);
                      setError(null);
                    }}
                  />
                  <span className="text-xs font-normal text-slate-600">
                    JPG, PNG, WebP o AVIF; hasta 4 MB. La foto se carga al guardar el producto.
                  </span>
                </label>
                <label className="grid gap-1 text-sm font-medium">
                  O pegar un enlace público HTTPS
                  <input
                    className="rounded border px-3 py-2 font-normal"
                    type="url"
                    placeholder="https://"
                    value={form.imageUrl}
                    onChange={(event) => {
                      selectImageFile(null);
                      setForm({
                        ...form,
                        imageUrl: event.target.value,
                        imageFileId: null,
                      });
                    }}
                  />
                  <span className="text-xs font-normal text-slate-600">
                    Usa un enlace HTTPS que abra directamente la imagen. Al quitarlo, MileShop solo desvincula el archivo externo.
                  </span>
                </label>
                {(previewImageUrl || form.imageUrl) && (
                  <div className="flex items-center gap-3">
                    <Image
                      className="h-20 w-20 rounded-lg object-cover"
                      src={getOptimizedImageUrl(previewImageUrl ?? form.imageUrl, 160)}
                      alt="Vista previa de la foto del producto"
                      width={80}
                      height={80}
                      unoptimized
                    />
                    <button
                      className="rounded border px-3 py-2 text-sm font-medium"
                      type="button"
                      onClick={() => {
                        selectImageFile(null);
                        setForm({ ...form, imageUrl: "", imageFileId: null });
                      }}
                    >
                      Quitar foto
                    </button>
                  </div>
                )}
              </fieldset>
              {editingProductId && (
                <div className="grid gap-1">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />
                    Producto visible en la tienda
                  </label>
                  {!form.isActive && (
                    <span className="text-xs text-slate-600">
                      Al guardar, el producto dejará de mostrarse. Las fotos cargadas aquí se eliminarán; los enlaces externos solo se desvinculan.
                    </span>
                  )}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <button className="rounded bg-emerald-700 px-4 py-2 font-semibold text-white disabled:opacity-50" type="submit" disabled={isSavingProduct}>
                  {isSavingProduct ? "Guardando…" : editingProductId ? "Guardar cambios" : "Crear producto"}
                </button>
                {editingProductId && (
                  <button className="rounded border px-4 py-2 font-medium" type="button" onClick={resetForm}>
                    Cancelar edición
                  </button>
                )}
              </div>
            </form>

            <form className="grid content-start gap-4 rounded-xl border bg-white p-5 shadow-sm" onSubmit={receiveStock}>
              <div>
                <h2 className="text-xl font-semibold">Agregar unidades disponibles</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Registra las unidades reales recibidas antes de ofrecer el producto para la venta.
                </p>
              </div>
              <label className="grid gap-1 text-sm font-medium">
                ¿A qué producto agregar unidades?
                <select className="rounded border px-3 py-2" required disabled={Boolean(receiptRequest) || products.length === 0} value={stockProductId} onChange={(event) => setStockProductId(event.target.value)}>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>{product.name} · {product.stock} disponibles</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm font-medium">
                ¿Cuántas unidades vas a agregar?
                <input className="rounded border px-3 py-2" type="number" required min="1" max="1000000" step="1" disabled={Boolean(receiptRequest)} value={stockQuantity} onChange={(event) => setStockQuantity(event.target.value)} />
                <span className="text-xs font-normal text-slate-600">
                  Cuenta cómo vendes el producto: si vendes paquetes, 3 paquetes se registran como 3 unidades.
                </span>
              </label>
              <label className="grid gap-1 text-sm font-medium">
                Nota: ¿de dónde salen estas unidades?
                <textarea className="min-h-20 rounded border px-3 py-2" required minLength={3} maxLength={500} disabled={Boolean(receiptRequest)} value={stockReason} onChange={(event) => setStockReason(event.target.value)} />
                <span className="text-xs font-normal text-slate-600">
                  Describe la procedencia para mantener la trazabilidad; por ejemplo, compra a proveedor o ajuste de inventario.
                </span>
              </label>
              <button className="rounded bg-slate-900 px-4 py-2 font-semibold text-white disabled:opacity-50" type="submit" disabled={isReceivingStock || products.length === 0}>
                {isReceivingStock ? "Guardando unidades…" : "Agregar unidades"}
              </button>
            </form>
          </section>

          {pendingImageCleanup.length > 0 && (
            <section className="mb-8 rounded-lg border border-amber-300 bg-amber-50 p-4" aria-labelledby="image-cleanup-title">
              <h2 id="image-cleanup-title" className="font-semibold">Fotos pendientes de retirar</h2>
              <p className="mt-1 text-sm">
                Una foto no pudo eliminarse del almacenamiento. Puedes volver a intentarlo.
              </p>
              <ul className="mt-3 grid gap-2">
                {pendingImageCleanup.map((fileId) => (
                  <li className="flex flex-wrap items-center justify-between gap-2" key={fileId}>
                    <span className="text-xs text-slate-700">Referencia: {fileId}</span>
                    <button
                      className="rounded border bg-white px-3 py-2 text-sm font-medium disabled:opacity-50"
                      type="button"
                      disabled={cleaningImageId !== null}
                      onClick={() => void retryImageCleanup(fileId)}
                    >
                      {cleaningImageId === fileId ? "Retirando…" : "Reintentar"}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="rounded-xl border bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">Productos</h2>
                <p className="text-sm text-slate-600">{products.length} productos registrados, incluidos los desactivados.</p>
              </div>
              <button className="rounded border px-3 py-2 text-sm font-medium" type="button" onClick={() => void refreshProducts()} disabled={isLoading}>
                {isLoading ? "Actualizando…" : "Actualizar"}
              </button>
            </div>
            {isLoading ? (
              <p role="status">Cargando catálogo…</p>
            ) : products.length === 0 ? (
              <p className="rounded bg-slate-50 p-4 text-slate-600">Aún no hay productos. Agrega el primero desde el formulario.</p>
            ) : (
              <ul className="divide-y">
                {products.map((product) => (
                  <li className="flex flex-wrap items-center gap-4 py-4" key={product.id}>
                    {product.imageUrl ? (
                      <Image className="h-16 w-16 rounded-lg object-cover" src={getOptimizedImageUrl(product.imageUrl, 128)} alt="" width={64} height={64} unoptimized />
                    ) : (
                      <div className="grid h-16 w-16 place-items-center rounded-lg bg-emerald-50 text-2xl font-bold text-emerald-800" aria-hidden="true">
                        {product.name.slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-48 flex-1">
                      <p className="font-semibold">{product.name} <span className="text-xs font-normal text-slate-500">{product.sku}</span></p>
                      <p className="text-sm text-slate-600">{formatPrice(product.priceCop)} · {product.stock} disponibles · {product.isActive ? "Visible" : "Desactivado"}</p>
                    </div>
                    <button className="rounded border px-3 py-2 text-sm font-medium" type="button" onClick={() => beginEdit(product)}>
                      Editar
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
