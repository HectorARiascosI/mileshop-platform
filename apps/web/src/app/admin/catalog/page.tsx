"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import {
  CATALOG_CATEGORY_THEMES,
  CATALOG_PRODUCT_IMAGE_LIMIT,
} from "@mileshop/contracts";
import type {
  CatalogCategory,
  CatalogCategoryInput,
  CatalogCategorySummary,
  CatalogProductImage,
} from "@mileshop/contracts";
import {
  CATEGORY_THEME_LABELS,
  isCatalogCategory,
  isCatalogCategorySummary,
  isCatalogCategoryTheme,
} from "@/lib/catalog-category";
import { getOptimizedImageUrl } from "@/lib/imagekit-url";
import { AdminConfirmDialog } from "@/components/admin-confirm-dialog";

type Product = {
  id: string;
  sku: string;
  name: string;
  description: string;
  priceCop: number;
  stock: number;
  imageUrl: string | null;
  imageFileId: string | null;
  images?: CatalogProductImage[];
  categoryId: string | null;
  category: CatalogCategorySummary | null;
  isActive: boolean;
};

type ProductForm = {
  sku: string;
  name: string;
  description: string;
  priceCop: string;
  images: ProductImageDraft[];
  categoryId: string | null;
  isActive: boolean;
};

type ProductImageDraft = {
  key: string;
  imageUrl: string;
  imageFileId: string | null;
  file: File | null;
  previewUrl: string | null;
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
  images: [],
  categoryId: null,
  isActive: true,
};

const EMPTY_CATEGORY_FORM: CatalogCategoryInput = {
  name: "",
  theme: "neutral",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProduct(value: unknown): value is Product {
  const validImages =
    isRecord(value) &&
    (value.images === undefined ||
      (Array.isArray(value.images) &&
        value.images.every(
          (image) =>
            isRecord(image) &&
            typeof image.imageUrl === "string" &&
            (image.imageFileId === undefined ||
              typeof image.imageFileId === "string" ||
              image.imageFileId === null) &&
            Number.isSafeInteger(image.position),
        )));
  return (
    isRecord(value) &&
    validImages &&
    typeof value.id === "string" &&
    typeof value.sku === "string" &&
    typeof value.name === "string" &&
    typeof value.description === "string" &&
    Number.isSafeInteger(value.priceCop) &&
    Number.isSafeInteger(value.stock) &&
    (typeof value.imageUrl === "string" || value.imageUrl === null) &&
    (typeof value.imageFileId === "string" || value.imageFileId === null) &&
    (typeof value.categoryId === "string" || value.categoryId === null) &&
    (value.category === null || isCatalogCategorySummary(value.category)) &&
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
  const [authorized, setAuthorized] = useState<boolean>(true);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [form, setForm] = useState<ProductForm>(EMPTY_FORM);
  const [categoryForm, setCategoryForm] = useState<CatalogCategoryInput>(EMPTY_CATEGORY_FORM);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [pendingCategoryDeletion, setPendingCategoryDeletion] = useState<CatalogCategory | null>(null);
  const [isSavingCategory, setIsSavingCategory] = useState(false);
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null);
  const [imageUrlDraft, setImageUrlDraft] = useState("");
  const [pendingImageCleanup, setPendingImageCleanup] = useState<string[]>([]);
  const [imageCleanupLoaded, setImageCleanupLoaded] = useState(false);
  const [cleaningImageId, setCleaningImageId] = useState<string | null>(null);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [stockProductId, setStockProductId] = useState("");
  const [stockQuantity, setStockQuantity] = useState("1");
  const [stockReason, setStockReason] = useState("");
  const [receiptRequest, setReceiptRequest] = useState<ReceiptRequest | null>(null);
  const [pendingProductVisibility, setPendingProductVisibility] = useState<{
    product: Product;
    isActive: boolean;
  } | null>(null);
  const [updatingProductVisibilityId, setUpdatingProductVisibilityId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingProduct, setIsSavingProduct] = useState(false);
  const [isReceivingStock, setIsReceivingStock] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const imagePreviewUrls = useRef(new Set<string>());

  useEffect(() => () => {
    for (const previewUrl of imagePreviewUrls.current) URL.revokeObjectURL(previewUrl);
    imagePreviewUrls.current.clear();
  }, []);

  const releaseImagePreviews = (images: ProductImageDraft[]) => {
    for (const image of images) {
      if (!image.previewUrl) continue;
      URL.revokeObjectURL(image.previewUrl);
      imagePreviewUrls.current.delete(image.previewUrl);
    }
  };

  const addImageFiles = (files: FileList | null) => {
    const selectedFiles = Array.from(files ?? []);
    if (selectedFiles.length === 0) return;
    if (form.images.length + selectedFiles.length > CATALOG_PRODUCT_IMAGE_LIMIT) {
      setError(`Puedes agregar hasta ${CATALOG_PRODUCT_IMAGE_LIMIT} fotos por producto.`);
      return;
    }
    const invalidFile = selectedFiles.find(
      (file) =>
        !["image/jpeg", "image/png", "image/webp", "image/avif"].includes(file.type) ||
        file.size > 4 * 1024 * 1024,
    );
    if (invalidFile) {
      setError("Cada foto debe ser JPG, PNG, WebP o AVIF y no superar 4 MB.");
      return;
    }
    setError(null);
    setForm((current) => ({
      ...current,
      images: [
        ...current.images,
        ...selectedFiles.map((file) => {
          const previewUrl = URL.createObjectURL(file);
          imagePreviewUrls.current.add(previewUrl);
          return {
            key: crypto.randomUUID(),
            imageUrl: "",
            imageFileId: null,
            file,
            previewUrl,
          };
        }),
      ],
    }));
  };

  const addImageUrl = () => {
    const imageUrl = imageUrlDraft.trim();
    if (!imageUrl) return;
    if (form.images.length >= CATALOG_PRODUCT_IMAGE_LIMIT) {
      setError(`Puedes agregar hasta ${CATALOG_PRODUCT_IMAGE_LIMIT} fotos por producto.`);
      return;
    }
    setForm((current) => ({
      ...current,
      images: [
        ...current.images,
        {
          key: crypto.randomUUID(),
          imageUrl,
          imageFileId: null,
          file: null,
          previewUrl: null,
        },
      ],
    }));
    setImageUrlDraft("");
    setError(null);
  };

  const removeProductImage = (key: string) => {
    setForm((current) => {
      const removedImage = current.images.find((image) => image.key === key);
      if (removedImage) releaseImagePreviews([removedImage]);
      return { ...current, images: current.images.filter((image) => image.key !== key) };
    });
  };

  const moveProductImage = (index: number, offset: -1 | 1) => {
    setForm((current) => {
      const destination = index + offset;
      if (destination < 0 || destination >= current.images.length) return current;
      const images = [...current.images];
      [images[index], images[destination]] = [images[destination]!, images[index]!];
      return { ...current, images };
    });
  };

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
    try {
      const [response, categoriesResponse] = await Promise.all([
        fetch("/api/admin/catalog/products", { cache: "no-store" }),
        fetch("/api/admin/catalog/categories", { cache: "no-store" }),
      ]);
      if (
        response.status === 401 ||
        response.status === 403 ||
        categoriesResponse.status === 401 ||
        categoriesResponse.status === 403
      ) {
        setAuthorized(false);
        setProducts([]);
        setCategories([]);
        return;
      }
      if (!response.ok) {
        throw new Error(await responseError(response, "No se pudo cargar el catálogo."));
      }
      if (!categoriesResponse.ok) {
        throw new Error(await responseError(categoriesResponse, "No se pudieron cargar las categorías."));
      }
      const payload: unknown = await response.json();
      const categoriesPayload: unknown = await categoriesResponse.json();
      if (
        !isRecord(payload) ||
        !Array.isArray(payload.data) ||
        !isRecord(categoriesPayload) ||
        !Array.isArray(categoriesPayload.data)
      ) {
        throw new Error("El servicio devolvió un catálogo inválido.");
      }
      const receivedProducts: unknown[] = payload.data;
      const receivedCategories: unknown[] = categoriesPayload.data;
      const validProducts = receivedProducts.filter(isProduct);
      const validCategories = receivedCategories.filter(isCatalogCategory);
      if (
        validProducts.length !== receivedProducts.length ||
        validCategories.length !== receivedCategories.length
      ) {
        throw new Error("El servicio devolvió un catálogo inválido.");
      }
      setProducts(validProducts);
      setCategories(validCategories);
      setStockProductId((current) =>
        validProducts.some((product) => product.id === current)
          ? current
          : (validProducts.find((product) => product.isActive) ?? validProducts[0])?.id ?? "",
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Error inesperado.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshProducts(), 0);
    return () => window.clearTimeout(timer);
  }, [refreshProducts]);

  const beginEdit = (product: Product) => {
    releaseImagePreviews(form.images);
    setEditingProductId(product.id);
    const productImages = product.images?.length
      ? product.images
      : product.imageUrl
        ? [{ imageUrl: product.imageUrl, imageFileId: product.imageFileId, position: 0 }]
        : [];
    setForm({
      sku: product.sku,
      name: product.name,
      description: product.description,
      priceCop: String(product.priceCop),
      images: productImages.map((image, index) => ({
        key: `existing-${product.id}-${index}`,
        imageUrl: image.imageUrl,
        imageFileId: image.imageFileId ?? null,
        file: null,
        previewUrl: null,
      })),
      categoryId: product.categoryId,
      isActive: product.isActive,
    });
    setImageUrlDraft("");
    setError(null);
    setNotice(null);
  };

  const resetForm = () => {
    releaseImagePreviews(form.images);
    setEditingProductId(null);
    setForm(EMPTY_FORM);
    setImageUrlDraft("");
  };

  const resetCategoryForm = () => {
    setEditingCategoryId(null);
    setCategoryForm(EMPTY_CATEGORY_FORM);
  };

  const beginEditCategory = (category: CatalogCategory) => {
    setEditingCategoryId(category.id);
    setCategoryForm({ name: category.name, theme: category.theme });
    setError(null);
    setNotice(null);
  };

  const saveCategory = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSavingCategory(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        editingCategoryId
          ? `/api/admin/catalog/categories/${encodeURIComponent(editingCategoryId)}`
          : "/api/admin/catalog/categories",
        {
          method: editingCategoryId ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(categoryForm),
        },
      );
      if (!response.ok) {
        throw new Error(await responseError(response, "No se pudo guardar la categoría."));
      }
      const payload: unknown = await response.json();
      if (!isRecord(payload) || !isCatalogCategory(payload.data)) {
        throw new Error("El servicio devolvió una categoría inválida.");
      }
      setNotice(editingCategoryId ? "Categoría actualizada." : "Categoría creada.");
      resetCategoryForm();
      await refreshProducts();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Error inesperado.");
    } finally {
      setIsSavingCategory(false);
    }
  };

  const deleteCategory = async (category: CatalogCategory) => {
    if (category.productCount > 0) {
      setError("Reasigna los productos antes de eliminar esta categoría.");
      return;
    }
    setDeletingCategoryId(category.id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/admin/catalog/categories/${encodeURIComponent(category.id)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        throw new Error(await responseError(response, "No se pudo eliminar la categoría."));
      }
      if (editingCategoryId === category.id) resetCategoryForm();
      setNotice("Categoría eliminada.");
      await refreshProducts();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Error inesperado.");
    } finally {
      setDeletingCategoryId(null);
    }
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
    const previousProduct = editingProductId
      ? products.find((product) => product.id === editingProductId)
      : undefined;
    const previousImageFileIds = [
      ...new Set([
        ...(previousProduct?.images ?? [])
          .map((image) => image.imageFileId)
          .filter((fileId): fileId is string => Boolean(fileId)),
        ...(previousProduct?.imageFileId ? [previousProduct.imageFileId] : []),
      ]),
    ];
    const uploadedImages: Array<{ fileId: string; imageUrl: string }> = [];
    let productSaved = false;
    try {
      const savedImages: Array<{ imageUrl: string; imageFileId: string | null }> = [];
      for (const image of form.images) {
        if (image.file) {
          const uploadedImage = await uploadProductImage(image.file);
          uploadedImages.push(uploadedImage);
          savedImages.push({
            imageUrl: uploadedImage.imageUrl,
            imageFileId: uploadedImage.fileId,
          });
        } else {
          savedImages.push({
            imageUrl: image.imageUrl,
            imageFileId: image.imageFileId,
          });
        }
      }
      const primaryImage = savedImages[0] ?? null;

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
            imageUrl: primaryImage?.imageUrl ?? null,
            imageFileId: primaryImage?.imageFileId ?? null,
            images: savedImages,
            categoryId: form.categoryId,
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
      let cleanupFailed = false;
      const retainedImageFileIds = new Set(
        savedImages
          .map((image) => image.imageFileId)
          .filter((fileId): fileId is string => Boolean(fileId)),
      );
      for (const fileId of previousImageFileIds) {
        if (retainedImageFileIds.has(fileId)) continue;
        try {
          await deleteProductImage(fileId);
        } catch {
          cleanupFailed = true;
          setPendingImageCleanup((current) =>
            current.includes(fileId)
              ? current
              : [...current, fileId],
          );
        }
      }
      if (cleanupFailed) {
        setError("El producto se guardó, pero algunas fotos anteriores siguen pendientes de retirar.");
      }
    } catch (requestError) {
      let cleanupFailed = false;
      if (!productSaved) {
        for (const image of uploadedImages) {
          try {
            await deleteProductImage(image.fileId);
          } catch {
            cleanupFailed = true;
            setPendingImageCleanup((current) =>
              current.includes(image.fileId)
                ? current
                : [...current, image.fileId],
            );
          }
        }
      }
      const requestMessage =
        requestError instanceof Error ? requestError.message : "Error inesperado.";
      setError(
        cleanupFailed
          ? `${requestMessage} Algunas fotos cargadas quedaron pendientes de retirar.`
          : requestMessage,
      );
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

  const updateProductVisibility = async (product: Product, isActive: boolean) => {
    setUpdatingProductVisibilityId(product.id);
    setError(null);
    setNotice(null);
    try {
      const images = product.images?.length
        ? product.images.map(({ imageUrl, imageFileId }) => ({
            imageUrl,
            imageFileId: imageFileId ?? null,
          }))
        : product.imageUrl
          ? [{ imageUrl: product.imageUrl, imageFileId: product.imageFileId }]
          : [];
      const primaryImage = images[0] ?? null;
      const response = await fetch(`/api/admin/catalog/products/${encodeURIComponent(product.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sku: product.sku,
          name: product.name,
          description: product.description,
          priceCop: product.priceCop,
          imageUrl: primaryImage?.imageUrl ?? null,
          imageFileId: primaryImage?.imageFileId ?? null,
          images,
          categoryId: product.categoryId,
          isActive,
        }),
      });
      if (!response.ok) {
        throw new Error(await responseError(
          response,
          isActive ? "No se pudo restaurar el producto." : "No se pudo retirar el producto.",
        ));
      }
      setNotice(isActive
        ? "Producto restaurado en la tienda."
        : "Producto retirado de la tienda. Se conservaron sus datos e historial.");
      await refreshProducts();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Error inesperado.");
    } finally {
      setUpdatingProductVisibilityId(null);
      setPendingProductVisibility(null);
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
      <header className="admin-console-header mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">MileShop</p>
          <h1 className="text-3xl font-bold">Catálogo e inventario</h1>
          <p className="mt-1 text-slate-600">
            Agrega lo que la tienda vende. Aquí también puedes indicar cuántas unidades tienes disponibles.
          </p>
        </div>
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

          <section className="mb-8 grid gap-6 lg:grid-cols-2" aria-labelledby="category-management-title">
            <form className="grid content-start gap-4 rounded-xl border bg-white p-5 shadow-sm" onSubmit={saveCategory}>
              <div>
                <h2 className="text-xl font-semibold" id="category-management-title">
                  {editingCategoryId ? "Editar categoría" : "Categorías"}
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Organiza los productos con temas visuales predefinidos. Cada producto puede tener una categoría principal.
                </p>
              </div>
              <label className="grid gap-1 text-sm font-medium">
                Nombre de la categoría
                <input
                  className="rounded border px-3 py-2"
                  required
                  minLength={2}
                  maxLength={60}
                  value={categoryForm.name}
                  onChange={(event) => setCategoryForm({ ...categoryForm, name: event.target.value })}
                />
              </label>
              <label className="grid gap-1 text-sm font-medium">
                Tema visual
                <select
                  className="rounded border px-3 py-2"
                  value={categoryForm.theme}
                  onChange={(event) => {
                    if (isCatalogCategoryTheme(event.target.value)) {
                      setCategoryForm({
                        ...categoryForm,
                        theme: event.target.value,
                      });
                    }
                  }}
                >
                  {CATALOG_CATEGORY_THEMES.map((theme) => (
                    <option key={theme} value={theme}>{CATEGORY_THEME_LABELS[theme]}</option>
                  ))}
                </select>
                <span className="text-xs font-normal text-slate-600">
                  El tema cambia el acento visual; no altera precios, descuentos ni disponibilidad.
                </span>
              </label>
              <div className="flex flex-wrap gap-2">
                <button className="rounded bg-slate-900 px-4 py-2 font-semibold text-white disabled:opacity-50" type="submit" disabled={isSavingCategory}>
                  {isSavingCategory ? "Guardando…" : editingCategoryId ? "Guardar categoría" : "Crear categoría"}
                </button>
                {editingCategoryId && (
                  <button className="rounded border px-4 py-2 font-medium" type="button" onClick={resetCategoryForm}>
                    Cancelar edición
                  </button>
                )}
              </div>
            </form>

            <div className="grid content-start gap-3 rounded-xl border bg-white p-5 shadow-sm">
              <h2 className="text-xl font-semibold">Categorías registradas</h2>
              {categories.length === 0 ? (
                <p className="text-sm text-slate-600">Aún no hay categorías. Los productos pueden permanecer sin categoría.</p>
              ) : (
                <ul className="divide-y">
                  {categories.map((category) => (
                    <li className="flex flex-wrap items-center justify-between gap-3 py-3" key={category.id}>
                      <div className="flex items-center gap-3">
                        <span
                          className="category-theme-swatch"
                          data-theme={category.theme}
                          aria-label={`Tema ${CATEGORY_THEME_LABELS[category.theme]}`}
                        />
                        <div>
                          <p className="font-semibold">{category.name}</p>
                          <p className="text-sm text-slate-600">
                            {CATEGORY_THEME_LABELS[category.theme]} · {category.productCount} productos
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button className="rounded border px-3 py-2 text-sm font-medium" type="button" onClick={() => beginEditCategory(category)}>
                          Editar
                        </button>
                        <button
                          className="rounded border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
                          type="button"
                          disabled={category.productCount > 0 || deletingCategoryId === category.id}
                          title={category.productCount > 0 ? "Reasigna sus productos antes de eliminarla." : undefined}
                          onClick={() => setPendingCategoryDeletion(category)}
                        >
                          {deletingCategoryId === category.id ? "Eliminando…" : "Eliminar"}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="mb-8 grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(18rem,0.7fr)]">
            <form className="grid min-w-0 gap-4 rounded-xl border bg-white p-5 shadow-sm" onSubmit={saveProduct}>
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
              <label className="grid gap-1 text-sm font-medium">
                Categoría principal
                <select
                  className="rounded border px-3 py-2"
                  value={form.categoryId ?? ""}
                  onChange={(event) => setForm({ ...form, categoryId: event.target.value || null })}
                >
                  <option value="">Sin categoría</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </select>
                <span className="text-xs font-normal text-slate-600">
                  La tienda usa el tema de esta categoría para distinguir el producto y ofrecer filtros.
                </span>
              </label>
              <fieldset className="grid gap-3 rounded-lg border p-4">
                <legend className="px-1 text-sm font-semibold">Galería del producto</legend>
                <p className="text-sm text-slate-600">
                  Agrega hasta {CATALOG_PRODUCT_IMAGE_LIMIT} perspectivas. La primera foto será la principal; puedes cambiar el orden antes de guardar.
                </p>
                <label className="grid gap-1 text-sm font-medium">
                  Importar fotos desde el dispositivo
                  <input
                    className="rounded border px-3 py-2 font-normal"
                    type="file"
                    multiple
                    accept="image/jpeg,image/png,image/webp,image/avif"
                    onChange={(event) => {
                      addImageFiles(event.target.files);
                      event.currentTarget.value = "";
                    }}
                  />
                  <span className="text-xs font-normal text-slate-600">
                    JPG, PNG, WebP o AVIF; hasta 4 MB por foto. Se cargan al guardar el producto.
                  </span>
                </label>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="grid min-w-0 flex-1 gap-1 text-sm font-medium">
                    Agregar una URL pública HTTPS
                    <input
                      className="rounded border px-3 py-2 font-normal"
                      type="url"
                      placeholder="https://"
                      value={imageUrlDraft}
                      onChange={(event) => setImageUrlDraft(event.target.value)}
                    />
                  </label>
                  <button
                    className="rounded border px-3 py-2 text-sm font-medium disabled:opacity-50"
                    type="button"
                    disabled={!imageUrlDraft.trim() || form.images.length >= CATALOG_PRODUCT_IMAGE_LIMIT}
                    onClick={addImageUrl}
                  >
                    Agregar enlace
                  </button>
                </div>
                {form.images.length > 0 ? (
                  <ol className="grid gap-3 sm:grid-cols-2" aria-label="Fotos del producto">
                    {form.images.map((image, index) => (
                      <li className="flex items-center gap-3 rounded-lg border p-3" key={image.key}>
                        {image.previewUrl || image.imageUrl ? (
                          <Image
                            className="h-16 w-16 shrink-0 rounded-lg object-cover"
                            src={getOptimizedImageUrl(image.previewUrl ?? image.imageUrl, 160)}
                            alt={`Vista previa de la foto ${index + 1} de ${form.images.length}`}
                            width={64}
                            height={64}
                            unoptimized
                          />
                        ) : null}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold">
                            {index === 0 ? "Foto principal" : `Perspectiva ${index + 1}`}
                          </p>
                          <p className="truncate text-xs text-slate-600">
                            {image.file?.name ?? image.imageUrl}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1">
                            <button
                              className="rounded border px-2 py-1 text-xs disabled:opacity-50"
                              type="button"
                              aria-label={`Mover foto ${index + 1} hacia adelante`}
                              disabled={index === 0}
                              onClick={() => moveProductImage(index, -1)}
                            >
                              Subir
                            </button>
                            <button
                              className="rounded border px-2 py-1 text-xs disabled:opacity-50"
                              type="button"
                              aria-label={`Mover foto ${index + 1} hacia atrás`}
                              disabled={index === form.images.length - 1}
                              onClick={() => moveProductImage(index, 1)}
                            >
                              Bajar
                            </button>
                            <button
                              className="rounded border px-2 py-1 text-xs"
                              type="button"
                              onClick={() => removeProductImage(image.key)}
                            >
                              Quitar
                            </button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-sm text-slate-600">
                    No hay fotos agregadas. Puedes publicar el producto sin imágenes.
                  </p>
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
                      Al guardar, el producto dejará de mostrarse. Sus fotos, datos e historial se conservarán para poder restaurarlo.
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

            <form className="grid min-w-0 content-start gap-4 rounded-xl border bg-white p-5 shadow-sm" onSubmit={receiveStock}>
              <div>
                <h2 className="text-xl font-semibold">Agregar unidades disponibles</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Registra las unidades reales recibidas antes de ofrecer el producto para la venta.
                </p>
              </div>
              <label className="grid gap-1 text-sm font-medium">
                ¿A qué producto agregar unidades?
                <select className="admin-stock-product-select min-h-12 rounded border px-3 py-2 text-base" required disabled={Boolean(receiptRequest) || products.length === 0} value={stockProductId} onChange={(event) => setStockProductId(event.target.value)}>
                  <option value="" disabled>Selecciona un producto</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name} · {product.stock} en stock{product.isActive ? "" : " · retirado"}
                    </option>
                  ))}
                </select>
                {products.length === 0 && (
                  <span className="text-xs font-normal text-slate-600">
                    Primero crea un producto para poder registrar unidades.
                  </span>
                )}
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
              <button className="rounded border px-3 py-2 text-sm font-medium" type="button" onClick={() => { setIsLoading(true); setError(null); void refreshProducts(); }} disabled={isLoading}>
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
                      <p className="text-sm text-slate-600">{formatPrice(product.priceCop)} · {product.stock} en stock · {product.isActive ? "Visible" : "Desactivado"}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button className="rounded border px-3 py-2 text-sm font-medium" type="button" onClick={() => beginEdit(product)}>
                        Editar
                      </button>
                      <button
                        className={`rounded border px-3 py-2 text-sm font-medium disabled:opacity-50 ${
                          product.isActive ? "border-amber-300 text-amber-900" : "border-emerald-300 text-emerald-900"
                        }`}
                        type="button"
                        disabled={updatingProductVisibilityId !== null}
                        onClick={() => setPendingProductVisibility({ product, isActive: !product.isActive })}
                      >
                        {product.isActive ? "Retirar de tienda" : "Restaurar en tienda"}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
      {pendingCategoryDeletion && (
        <AdminConfirmDialog
          title="Eliminar categoría"
          message={`La categoría «${pendingCategoryDeletion.name}» se eliminará. Esta acción no modifica productos.`}
          confirmLabel="Eliminar categoría"
          busy={deletingCategoryId === pendingCategoryDeletion.id}
          onCancel={() => setPendingCategoryDeletion(null)}
          onConfirm={() => {
            const category = pendingCategoryDeletion;
            setPendingCategoryDeletion(null);
            void deleteCategory(category);
          }}
        />
      )}
      {pendingProductVisibility && (
        <AdminConfirmDialog
          title={pendingProductVisibility.isActive ? "Restaurar producto" : "Retirar producto de la tienda"}
          message={pendingProductVisibility.isActive
            ? `«${pendingProductVisibility.product.name}» volverá a aparecer en la tienda con sus datos e imágenes actuales.`
            : `«${pendingProductVisibility.product.name}» dejará de aparecer en la tienda. Se conservarán el registro, las fotos, el stock y el historial; puedes restaurarlo después.`}
          confirmLabel={pendingProductVisibility.isActive ? "Restaurar producto" : "Retirar de tienda"}
          busy={updatingProductVisibilityId === pendingProductVisibility.product.id}
          onCancel={() => setPendingProductVisibility(null)}
          onConfirm={() => {
            const change = pendingProductVisibility;
            void updateProductVisibility(change.product, change.isActive);
          }}
        />
      )}
    </main>
  );
}
