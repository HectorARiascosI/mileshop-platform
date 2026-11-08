"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import type { CatalogAnnouncement, CatalogAnnouncementInput } from "@mileshop/contracts";
import { AdminConfirmDialog } from "@/components/admin-confirm-dialog";
import { AdminCatalogImageField } from "@/components/admin-catalog-image-field";
import { deleteCatalogImage, uploadCatalogImage } from "@/lib/catalog-media";

const localDateTime = (date: Date) => {
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return adjusted.toISOString().slice(0, 16);
};

function blankForm(): CatalogAnnouncementInput {
  const startsAt = new Date();
  const endsAt = new Date(startsAt.getTime() + 7 * 24 * 60 * 60 * 1000);
  return {
    title: "",
    message: "",
    imageUrl: null,
    imageFileId: null,
    linkUrl: null,
    linkLabel: null,
    startsAt: localDateTime(startsAt),
    endsAt: localDateTime(endsAt),
    isActive: true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function responseError(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (isRecord(body) && typeof body.message === "string") return body.message;
    if (isRecord(body) && typeof body.error === "string") return body.error;
  } catch {
    return "No se pudo completar la solicitud.";
  }
  return "No se pudo completar la solicitud.";
}

function isAnnouncement(value: unknown): value is CatalogAnnouncement {
  return isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.message === "string" &&
    (!("imageUrl" in value) || typeof value.imageUrl === "string" || value.imageUrl === null) &&
    (!("imageFileId" in value) || typeof value.imageFileId === "string" || value.imageFileId === null) &&
    (typeof value.linkUrl === "string" || value.linkUrl === null) &&
    (typeof value.linkLabel === "string" || value.linkLabel === null) &&
    typeof value.startsAt === "string" &&
    typeof value.endsAt === "string" &&
    typeof value.isActive === "boolean";
}

export default function AdminAnnouncementsPage() {
  const [authorized, setAuthorized] = useState<boolean>(true);
  const [announcements, setAnnouncements] = useState<CatalogAnnouncement[]>([]);
  const [form, setForm] = useState<CatalogAnnouncementInput>(blankForm);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CatalogAnnouncement | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingImageCleanup, setPendingImageCleanup] = useState<string[]>([]);

  const refresh = useCallback(async (): Promise<CatalogAnnouncement[] | null> => {
    try {
      const response = await fetch("/api/admin/catalog/announcements", { cache: "no-store" });
      if (response.status === 401 || response.status === 403) {
        setAuthorized(false);
        return null;
      }
      if (!response.ok) throw new Error(await responseError(response));
      const payload: unknown = await response.json();
      if (!isRecord(payload) || !Array.isArray(payload.data)) {
        throw new Error("El servicio devolvió anuncios inválidos.");
      }
      const items = payload.data.filter(isAnnouncement);
      if (items.length !== payload.data.length) throw new Error("El servicio devolvió anuncios inválidos.");
      setAnnouncements(items);
      return items;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Error inesperado.");
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const reset = () => {
    setForm(blankForm());
    setImageFile(null);
    setEditingId(null);
  };

  const beginEdit = (announcement: CatalogAnnouncement) => {
    setEditingId(announcement.id);
    setForm({
      title: announcement.title,
      message: announcement.message,
      imageUrl: announcement.imageUrl ?? null,
      imageFileId: announcement.imageFileId ?? null,
      linkUrl: announcement.linkUrl,
      linkLabel: announcement.linkLabel,
      startsAt: localDateTime(new Date(announcement.startsAt)),
      endsAt: localDateTime(new Date(announcement.endsAt)),
      isActive: announcement.isActive,
    });
    setImageFile(null);
    setError(null);
    setNotice(null);
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (Boolean(form.linkUrl?.trim()) !== Boolean(form.linkLabel?.trim())) {
      setError("Completa tanto la URL como el texto del enlace, o deja ambos vacíos.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    const previousImageFileId = editingId
      ? announcements.find((announcement) => announcement.id === editingId)?.imageFileId ?? null
      : null;
    let uploadedImage: { fileId: string; imageUrl: string } | null = null;
    let requestMayHaveSaved = false;
    try {
      if (imageFile) uploadedImage = await uploadCatalogImage(imageFile, "announcements");
      const input: CatalogAnnouncementInput = {
        ...form,
        imageUrl: uploadedImage?.imageUrl ?? form.imageUrl ?? null,
        imageFileId: uploadedImage?.fileId ?? form.imageFileId ?? null,
        linkUrl: form.linkUrl?.trim() || null,
        linkLabel: form.linkLabel?.trim() || null,
        startsAt: new Date(form.startsAt).toISOString(),
        endsAt: new Date(form.endsAt).toISOString(),
      };
      const response = await fetch(
        editingId
          ? `/api/admin/catalog/announcements/${encodeURIComponent(editingId)}`
          : "/api/admin/catalog/announcements",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      requestMayHaveSaved = response.status >= 500;
      if (response.status === 401 || response.status === 403) {
        setAuthorized(false);
        throw new Error("La sesión de administración venció o ya no tiene permisos.");
      }
      if (!response.ok) throw new Error(await responseError(response));
      requestMayHaveSaved = true;
      const payload: unknown = await response.json();
      if (!isRecord(payload)) {
        throw new Error("El servicio devolvió un anuncio inválido.");
      }
      const savedAnnouncement = payload.data;
      if (!isAnnouncement(savedAnnouncement)) {
        throw new Error("El servicio devolvió un anuncio inválido.");
      }
      const refreshedAnnouncements = await refresh();
      const confirmedAnnouncement = refreshedAnnouncements?.find((announcement) =>
        announcement.id === savedAnnouncement.id &&
        announcement.title === input.title.trim() &&
        announcement.message === input.message.trim() &&
        announcement.imageUrl === input.imageUrl,
      );
      if (!confirmedAnnouncement) {
        throw new Error("El servidor aceptó el anuncio, pero no pudimos confirmarlo en la lista. Actualiza antes de volver a crearlo.");
      }
      reset();
      let cleanupFailed = false;
      if (previousImageFileId && previousImageFileId !== confirmedAnnouncement.imageFileId) {
        try {
          await deleteCatalogImage(previousImageFileId);
        } catch {
          cleanupFailed = true;
          setPendingImageCleanup((current) =>
            current.includes(previousImageFileId) ? current : [...current, previousImageFileId],
          );
        }
      }
      setNotice(cleanupFailed
        ? "Anuncio guardado y verificado. La foto anterior sigue pendiente de retirar."
        : editingId ? "Anuncio actualizado y verificado." : "Anuncio creado y verificado.");
    } catch (requestError) {
      const imageToClean = uploadedImage;
      if (imageToClean && !requestMayHaveSaved) {
        try {
          await deleteCatalogImage(imageToClean.fileId);
        } catch {
          setPendingImageCleanup((current) =>
            current.includes(imageToClean.fileId) ? current : [...current, imageToClean.fileId],
          );
        }
      }
      setError(requestError instanceof Error ? requestError.message : "Error inesperado.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (announcement: CatalogAnnouncement) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/admin/catalog/announcements/${encodeURIComponent(announcement.id)}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error(await responseError(response));
      const refreshedAnnouncements = await refresh();
      if (!refreshedAnnouncements || refreshedAnnouncements.some((item) => item.id === announcement.id)) {
        throw new Error("El servidor aceptó la eliminación, pero no pudimos confirmarla en la lista.");
      }
      if (editingId === announcement.id) reset();
      let cleanupFailed = false;
      if (announcement.imageFileId) {
        try {
          await deleteCatalogImage(announcement.imageFileId);
        } catch {
          cleanupFailed = true;
          setPendingImageCleanup((current) =>
            current.includes(announcement.imageFileId!) ? current : [...current, announcement.imageFileId!],
          );
        }
      }
      setNotice(cleanupFailed
        ? "Anuncio eliminado y verificado. Su imagen sigue pendiente de retirar."
        : "Anuncio eliminado y verificado.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Error inesperado.");
    } finally {
      setBusy(false);
    }
  };

  const retryImageCleanup = async (fileId: string) => {
    try {
      await deleteCatalogImage(fileId);
      setPendingImageCleanup((current) => current.filter((pendingId) => pendingId !== fileId));
    } catch (cleanupError) {
      setError(cleanupError instanceof Error ? cleanupError.message : "No se pudo retirar la foto.");
    }
  };

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-8 text-slate-900">
      <header className="admin-console-header mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">MileShop</p>
          <h1 className="text-3xl font-bold">Anuncios de la tienda</h1>
          <p className="mt-1 text-slate-600">Publica avisos informativos independientes de precios y promociones.</p>
        </div>
      </header>

      {authorized === false && (
        <section className="rounded-lg border border-amber-300 bg-amber-50 p-5">
          Inicia sesión con la cuenta de administradora de tienda. <Link className="font-semibold underline" href="/login">Iniciar sesión</Link>
        </section>
      )}
      {authorized && (
        <>
          {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-red-800" role="alert">{error}</p>}
          {notice && <p className="mb-4 rounded-lg bg-emerald-50 p-3 text-emerald-800" role="status">{notice}</p>}
          {pendingImageCleanup.length > 0 && (
            <section className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="status">
              <p>Hay fotos sin asociar que todavía no se han podido retirar del almacenamiento.</p>
              {pendingImageCleanup.map((fileId) => (
                <button className="mr-3 mt-2 underline" key={fileId} type="button" onClick={() => void retryImageCleanup(fileId)}>
                  Reintentar limpieza
                </button>
              ))}
            </section>
          )}
          <section className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <form className="grid content-start gap-4 rounded-xl border bg-white p-5 shadow-sm" onSubmit={save}>
              <div>
                <h2 className="text-xl font-semibold">{editingId ? "Editar anuncio" : "Nuevo anuncio"}</h2>
                <p className="mt-1 text-sm text-slate-600">El anuncio solo se muestra mientras esté activo y dentro de sus fechas.</p>
              </div>
              <label className="grid gap-1 text-sm font-medium">Título
                <input className="rounded border px-3 py-2" required minLength={3} maxLength={100} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
              </label>
              <label className="grid gap-1 text-sm font-medium">Mensaje
                <textarea className="rounded border px-3 py-2" required minLength={3} maxLength={500} rows={4} value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} />
              </label>
              <AdminCatalogImageField
                label="Imagen del anuncio (opcional)"
                imageUrl={form.imageUrl ?? null}
                file={imageFile}
                onFileChange={setImageFile}
                onClear={() => setForm({ ...form, imageUrl: null, imageFileId: null })}
              />
              <label className="grid gap-1 text-sm font-medium">URL HTTPS opcional
                <input className="rounded border px-3 py-2" type="url" placeholder="https://…" value={form.linkUrl ?? ""} onChange={(event) => setForm({ ...form, linkUrl: event.target.value || null })} />
              </label>
              <label className="grid gap-1 text-sm font-medium">Texto del enlace
                <input className="rounded border px-3 py-2" maxLength={40} placeholder="Ver más" value={form.linkLabel ?? ""} onChange={(event) => setForm({ ...form, linkLabel: event.target.value || null })} />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-sm font-medium">Empieza
                  <input className="rounded border px-3 py-2" type="datetime-local" required value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} />
                </label>
                <label className="grid gap-1 text-sm font-medium">Termina
                  <input className="rounded border px-3 py-2" type="datetime-local" required value={form.endsAt} onChange={(event) => setForm({ ...form, endsAt: event.target.value })} />
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />
                Anuncio activo durante la vigencia indicada
              </label>
              <div className="flex flex-wrap gap-2">
                <button className="rounded bg-slate-900 px-4 py-2 font-semibold text-white disabled:opacity-50" type="submit" disabled={busy}>{busy ? "Guardando…" : editingId ? "Guardar cambios" : "Crear anuncio"}</button>
                {editingId && <button className="rounded border px-4 py-2 font-medium" type="button" onClick={reset}>Cancelar edición</button>}
              </div>
            </form>

            <section className="rounded-xl border bg-white p-5 shadow-sm" aria-labelledby="announcement-list-title">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold" id="announcement-list-title">Anuncios</h2>
                  <p className="text-sm text-slate-600">{announcements.length} registrados, incluidos los inactivos.</p>
                </div>
                <button className="rounded border px-3 py-2 text-sm font-medium" type="button" onClick={() => { setBusy(true); setError(null); void refresh(); }} disabled={busy}>Actualizar</button>
              </div>
              {announcements.length === 0 ? <p className="rounded bg-slate-50 p-4 text-slate-600">Aún no hay anuncios.</p> : (
                <ul className="grid gap-3">
                  {announcements.map((announcement) => (
                    <li className="rounded-lg border p-4" key={announcement.id}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="font-semibold">{announcement.title}</h3>
                          <p className="text-sm text-slate-600">{new Date(announcement.startsAt).toLocaleString("es-CO")} – {new Date(announcement.endsAt).toLocaleString("es-CO")}</p>
                          <p className="mt-1 text-xs font-semibold uppercase tracking-wide">{announcement.isActive ? "Activo" : "Desactivado"}</p>
                        </div>
                        <div className="flex gap-2">
                          <button className="rounded border px-3 py-1.5 text-sm" type="button" onClick={() => beginEdit(announcement)}>Editar</button>
                          <button className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700" type="button" disabled={busy} onClick={() => setPendingDelete(announcement)}>Eliminar</button>
                        </div>
                      </div>
                      <p className="mt-2 text-sm text-slate-700">{announcement.message}</p>
                      {announcement.linkUrl && announcement.linkLabel && (
                        <p className="mt-2 break-all text-sm text-blue-700">{announcement.linkLabel}: {announcement.linkUrl}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </section>
        </>
      )}
      {pendingDelete && (
        <AdminConfirmDialog
          title="Eliminar anuncio"
          message={`El anuncio «${pendingDelete.title}» dejará de mostrarse en la tienda.`}
          confirmLabel="Eliminar anuncio"
          busy={busy}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            const announcement = pendingDelete;
            setPendingDelete(null);
            void remove(announcement);
          }}
        />
      )}
    </main>
  );
}
