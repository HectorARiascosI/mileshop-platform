"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    phone: "",
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

    const name = form.name.trim();
    const phone = form.phone.trim();
    const email = form.email.trim();
    const password = form.password;

    if (!name || !phone || !email || !password) {
      setError("Necesitamos nombre, teléfono, correo y contraseña para completar el registro.");
      return;
    }

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
    }
  };

  return (
    <main className="checkout-page">
      <section className="checkout-card" style={{ maxWidth: 640 }}>
        <p className="eyebrow">Registro requerido</p>
        <h1>Completa tu perfil para comprar</h1>
        <p style={{ color: "#6e7770", marginBottom: 24 }}>
          La compra en MileShop requiere identidad válida antes de confirmar la orden.
        </p>

        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 18 }}>
          <label style={{ display: "grid", gap: 8 }}>
            <span>Nombre completo</span>
            <input
              type="text"
              value={form.name}
              onChange={(event) => handleChange("name", event.target.value)}
              placeholder="Tu nombre"
              style={{ padding: 12, border: "1px solid #d8d5cc", borderRadius: 8 }}
            />
          </label>

          <label style={{ display: "grid", gap: 8 }}>
            <span>Teléfono</span>
            <input
              type="tel"
              value={form.phone}
              onChange={(event) => handleChange("phone", event.target.value)}
              placeholder="300 123 4567"
              style={{ padding: 12, border: "1px solid #d8d5cc", borderRadius: 8 }}
            />
          </label>

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
              placeholder="Mínimo 8 caracteres"
              style={{ padding: 12, border: "1px solid #d8d5cc", borderRadius: 8 }}
            />
          </label>

          {error ? (
            <p role="alert" style={{ color: "#bc4c2c", margin: 0 }}>
              {error}
            </p>
          ) : null}

          <button type="submit" className="checkout-button" style={{ width: "100%" }}>
            Continuar con la compra
          </button>
        </form>
      </section>
    </main>
  );
}
