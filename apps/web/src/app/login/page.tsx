"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

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
        const requestedNext = new URLSearchParams(window.location.search).get("next");
        const destination = requestedNext?.startsWith("/admin/") ? requestedNext : "/";
        router.push(destination);
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
          Ingresa con tu correo y contraseña para acceder a tu cuenta.
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
            <div className="password-field">
              <input
                type={showPassword ? "text" : "password"}
                value={form.password}
                onChange={(e) => handleChange("password", e.target.value)}
                placeholder="Tu contraseña"
                autoComplete="current-password"
                required
              />
              <button
                className="password-toggle"
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                aria-pressed={showPassword}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  {showPassword ? (
                    <path d="M3 3l18 18M10.6 10.7a2 2 0 0 0 2.7 2.7M9.9 4.2A10.8 10.8 0 0 1 12 4c5.5 0 9 5.5 9 5.5a16.7 16.7 0 0 1-2.1 2.7M6.1 6.1C4.1 7.5 3 9.5 3 9.5S6.5 15 12 15c1.1 0 2.1-.2 3-.6M14.1 14.1 9.9 9.9" />
                  ) : (
                    <path d="M12 5c5.5 0 9 5.5 9 5.5s-3.5 5.5-9 5.5S3 10.5 3 10.5 6.5 5 12 5Zm0 3.2a2.3 2.3 0 1 0 0 4.6 2.3 2.3 0 0 0 0-4.6Z" />
                  )}
                </svg>
              </button>
            </div>
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
