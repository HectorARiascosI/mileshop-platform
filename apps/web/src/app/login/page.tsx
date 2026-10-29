"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const handleChange = (field: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setError("");
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const email = form.email.trim();
    const password = form.password;

    if (!email || !password) {
      setError("Ingresa tu correo y contraseña para continuar.");
      return;
    }

    setPending(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (response.ok) {
        router.push("/");
        return;
      }

      if (response.status === 401) {
        setError("Correo o contraseña incorrectos.");
        return;
      }

      setError("No pudimos iniciar sesión. Intenta de nuevo.");
    } catch {
      setError("No pudimos iniciar sesión. Intenta de nuevo.");
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="checkout-page">
      <section className="checkout-card auth-card">
        <p className="eyebrow">Bienvenido de vuelta</p>
        <h1>Inicia sesión en MileShop</h1>
        <p className="auth-subtitle">
          Ingresa con tu correo y contraseña para continuar con tu compra.
        </p>

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
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
              placeholder="Tu contraseña"
              autoComplete="current-password"
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
            {pending ? "Iniciando sesión…" : "Iniciar sesión"}
          </button>
        </form>

        <p className="auth-hint">
          ¿No tienes cuenta?{" "}
          <Link href="/register">Regístrate aquí</Link>
        </p>
      </section>
    </main>
  );
}
