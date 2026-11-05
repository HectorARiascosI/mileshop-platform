"use client";

type AdminConfirmDialogProps = {
  title: string;
  message: string;
  confirmLabel: string;
  busy?: boolean;
  tone?: "danger" | "neutral";
  onConfirm: () => void;
  onCancel: () => void;
};

export function AdminConfirmDialog({
  title,
  message,
  confirmLabel,
  busy = false,
  tone = "danger",
  onConfirm,
  onCancel,
}: AdminConfirmDialogProps) {
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/60 p-4">
      <section
        aria-labelledby="admin-confirm-dialog-title"
        aria-modal="true"
        className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"
        role="alertdialog"
      >
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-800">
          MileShop · Confirmación
        </p>
        <h2 className="mt-2 text-xl font-bold" id="admin-confirm-dialog-title">
          {title}
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">{message}</p>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button
            className="rounded-lg border border-slate-300 px-4 py-2 font-semibold text-slate-800 disabled:opacity-50"
            disabled={busy}
            onClick={onCancel}
            type="button"
          >
            Volver
          </button>
          <button
            className={`rounded-lg px-4 py-2 font-semibold text-white disabled:opacity-50 ${
              tone === "danger" ? "bg-rose-700 hover:bg-rose-800" : "bg-slate-900 hover:bg-slate-800"
            }`}
            disabled={busy}
            onClick={onConfirm}
            type="button"
          >
            {busy ? "Procesando…" : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
