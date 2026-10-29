"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", phone: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const handleChange = (field: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setError("");
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const name = form.name.trim();
    const phone = form.phone.trim();
    const email = form.email.trim();
    const password = form.password;

    if (!name || !phone || !email || !password) {
      setError("Necesitamos nombre, teléfono, correo y contraseña para completar el registro.");
      return;
    }

    setPending(true);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name, phone }),
      });

      if (response.status === 201) {
        router.push("/");
        return;
      }

      if (response.status === 409) {
        setError("Este correo ya está registrado.");
        return;
      }

      setError("No pudimos completar el registro. Intenta de nuevo.");
    } catch {
      setError("No pudimos completar el registro. Intenta de nuevo.");
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="checkout-page">
      <section className="checkout-card auth-card">
        <p className="eyebrow">Registro requerido</p>
        <h1>Completa tu perfil para comprar</h1>
        <p className="auth-subtitle">
          La compra en MileShop requiere identidad válida antes de confirmar la orden.
        </p>

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <label className="form-field">
            <span>Nombre completo</span>
            <input
              type="text"
              value={form.name}
              onChange={(e) => handleChange("name", e.target.value)}
              placeholder="Tu nombre"
              autoComplete="name"
              required
            />
          </label>

          <label className="form-field">
            <span>Teléfono</span>
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => handleChange("phone", e.target.value)}
              placeholder="300 123 4567"
              autoComplete="tel"
            />
          </label>

          <label className="form-field">
            <span>Correo electrónico</span>
            <input
              type="email"
              value={form.email}
              onChange={(e) => handleChange("email", e.target.value)}
              placeholder="correo@ejemplo.com"
              autoComplete="email"
              required
            />
          </label>

          <label className="form-field">
            <span>Contraseña</span>
            <input
              type="password"
              value={form.password}
              onChange={(e) => handleChange("password", e.target.value)}
              placeholder="Mínimo 8 caracteres"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>

          {error ? (
            <p role="alert" className="form-error">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            className="checkout-button"
            disabled={pending}
            aria-busy={pending}
          >
            {pending ? "Registrando…" : "Continuar con la compra"}
          </button>
        </form>

        <p className="auth-hint">
          ¿Ya tienes cuenta?{" "}
          <Link href="/login">Inicia sesión aquí</Link>
        </p>
      </section>
    </main>
  );
}
