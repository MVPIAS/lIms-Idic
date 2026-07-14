"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.login(username.trim(), password);
      router.push("/dashboard");
    } catch (err: any) {
      setError(err.message ?? "Error al iniciar sesión");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-bg">
      <form onSubmit={onSubmit} className="login-card">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
          <div style={{ width: 46, height: 46, background: "linear-gradient(135deg,#1d4856,#2c6878)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontFamily: "Georgia,serif", fontSize: 20 }}>
            I
          </div>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--primary)", margin: 0 }}>LIMS IDIC</h1>
            <p style={{ fontSize: 11, color: "var(--muted)", margin: 0 }}>Instituto de Investigaciones y Control · Ejército de Chile</p>
          </div>
        </div>

        <h2 style={{ fontSize: 22, fontWeight: 700, color: "var(--primary)", margin: "0 0 4px" }}>Ingreso al sistema</h2>
        <p className="subtitle" style={{ marginBottom: 14 }}>Use sus credenciales institucionales.</p>

        <div className="alert info" style={{ fontSize: 11.5 }}>
          🔐 <b>Autenticación</b> · cuentas locales y, en producción, LDAP/Active Directory · <span className="codigo">ad.ejercito.cl</span>
        </div>

        <div className="field" style={{ marginBottom: 12 }}>
          <label>Usuario</label>
          <input type="text" value={username} autoFocus onChange={(e) => setUsername(e.target.value)} />
        </div>

        <div className="field" style={{ marginBottom: 12 }}>
          <label>Contraseña</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>

        {error && <div className="alert warn" style={{ borderLeftColor: "var(--red)", background: "#fdecec", color: "#7d1f1f" }}>{error}</div>}

        <button type="submit" disabled={loading} className="btn primary" style={{ width: "100%", justifyContent: "center", padding: "11px", marginTop: 4 }}>
          {loading ? "Iniciando sesión…" : "Entrar al sistema"}
        </button>

        <p style={{ fontSize: 11, textAlign: "center", color: "var(--muted)", marginTop: 16 }}>
          Aiuken · LIMS IDIC — Preproducción
        </p>
      </form>
    </div>
  );
}
