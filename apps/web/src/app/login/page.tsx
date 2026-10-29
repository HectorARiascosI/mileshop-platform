"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    email: "",
    password: "",
  });
  const [error, setError] = useState("");

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
    }
  };

  return (
    <main className="checkout-page">
      <section className="checkout-card" style={{ maxWidth: 640 }}>
        <p className="eyebrow">Bienvenido de vuelta</p>
        <h1>Inicia sesión en MileShop</h1>
        <p style={{ color: "#6e7770", marginBottom: 24 }}>
          Ingresa con tu correo y contraseña para continuar con tu compra.
        </p>

        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 18 }}>
          <label style={{ display: "grid", gap: 8 }}>
            <span>Correo electrónico</span>
            <input
              type="email"
              value={form.email}
              onChange={(event) => handleChange("email", event.target.value)}
              placeholder="correo@ejemplo.com"
              style={{ padding: 12, border: "1px solid #d8d5cc", borderRadius: 8 }}
            />
          </label>

          <label style={{ display: "grid", gap: 8 }}>
            <span>Contraseña</span>
            <input
              type="password"
              value={form.password}
              onChange={(event) => handleChange("password", event.target.value)}
              placeholder="Tu contraseña"
              style={{ padding: 12, border: "1px solid #d8d5cc", borderRadius: 8 }}
            />
          </label>

          {error ? (
            <p role="alert" style={{ color: "#bc4c2c", margin: 0 }}>
              {error}
            </p>
          ) : null}

          <button type="submit" className="checkout-button" style={{ width: "100%" }}>
            Iniciar sesión
          </button>
        </form>

        <p style={{ marginTop: 20, color: "#6e7770", textAlign: "center" }}>
          ¿No tienes cuenta?{" "}
          <Link href="/register" style={{ color: "#2d6a4f" }}>
            Regístrate aquí
          </Link>
        </p>
      </section>
    </main>
  );
}
