"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

type AdminCatalogImageFieldProps = {
  label: string;
  imageUrl: string | null;
  file: File | null;
  onFileChange: (file: File | null) => void;
  onClear: () => void;
};

const ACCEPTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
]);

export function AdminCatalogImageField({
  label,
  imageUrl,
  file,
  onFileChange,
  onClear,
}: AdminCatalogImageFieldProps) {
  const [filePreview, setFilePreview] = useState<{ file: File; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current && !file) inputRef.current.value = "";
  }, [file]);

  const previewUrl =
    file && filePreview?.file === file
      ? filePreview.url
      : imageUrl;

  return (
    <fieldset className="grid gap-2 rounded-lg border p-3">
      <legend className="px-1 text-sm font-semibold">{label}</legend>
      <label className="grid gap-1 text-sm font-medium">
        Subir desde el dispositivo
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          onChange={(event) => {
            const selectedFile = event.target.files?.[0] ?? null;
            setFilePreview(null);
            if (
              selectedFile &&
              (!ACCEPTED_IMAGE_TYPES.has(selectedFile.type) ||
                selectedFile.size === 0 ||
                selectedFile.size > 4 * 1024 * 1024)
            ) {
              event.target.value = "";
              onFileChange(null);
              setError("Usa una imagen JPG, PNG, WebP o AVIF de hasta 4 MB.");
              return;
            }
            if (selectedFile) {
              const reader = new FileReader();
              reader.onload = () => {
                if (typeof reader.result !== "string") {
                  setError("No pudimos preparar la vista previa de la imagen.");
                  onFileChange(null);
                  if (inputRef.current) inputRef.current.value = "";
                  return;
                }
                setFilePreview({ file: selectedFile, url: reader.result });
              };
              reader.onerror = () => {
                setError("No pudimos preparar la vista previa de la imagen.");
                onFileChange(null);
                if (inputRef.current) inputRef.current.value = "";
              };
              reader.readAsDataURL(selectedFile);
            }
            setError(null);
            onFileChange(selectedFile);
          }}
        />
      </label>
      <p className="text-xs text-slate-600">La imagen aparecerá en el catálogo mientras la publicación esté activa y vigente.</p>
      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
      {previewUrl ? (
        <div className="relative aspect-[16/7] max-h-56 overflow-hidden rounded-lg bg-slate-100">
          <Image
            src={previewUrl}
            alt={`Vista previa: ${label}`}
            fill
            sizes="(max-width: 760px) 100vw, 480px"
            className="object-cover"
            unoptimized
          />
        </div>
      ) : (
        <p className="text-sm text-slate-500">Sin imagen. Puedes publicar sin imagen.</p>
      )}
      {previewUrl && (
        <button className="justify-self-start rounded border px-3 py-1.5 text-sm" type="button" onClick={() => {
          setError(null);
          onFileChange(null);
          onClear();
        }}>
          Retirar imagen
        </button>
      )}
    </fieldset>
  );
}
