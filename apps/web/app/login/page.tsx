"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("c.vargas");
  const [password, setPassword] = useState("demo");
  const [perfil, setPerfil] = useState("JEFEDCO");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) throw new Error("Credenciales inválidas");
      const data = await res.json();
      localStorage.setItem("accessToken", data.accessToken);
      localStorage.setItem("user", JSON.stringify(data.user));
      router.push("/dashboard");
    } catch (err: any) {
      setError(err.message ?? "Error al iniciar sesión");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary via-primary-600 to-accent p-4">
      <form
        onSubmit={onSubmit}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8 space-y-5"
      >
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-primary to-primary-600 rounded-xl flex items-center justify-center text-white font-bold text-xl">
            L
          </div>
          <div>
            <h1 className="font-bold text-xl text-primary">LIMS IDIC</h1>
            <p className="text-xs text-slate-500">
              Instituto Investigaciones y Control · Ejército
            </p>
          </div>
        </div>

        <h2 className="text-2xl font-bold text-primary">Ingreso al sistema</h2>
        <p className="text-sm text-slate-600">
          Use sus credenciales del dominio institucional.
        </p>

        <div className="bg-slate-50 border-l-4 border-accent p-3 rounded text-xs text-slate-700">
          🔐 <b>Autenticación LDAP/Active Directory</b> ·{" "}
          <code className="text-accent">ad.ejercito.cl</code>
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase text-slate-500 mb-1.5">
            Usuario LDAP
          </label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase text-slate-500 mb-1.5">
            Contraseña
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase text-slate-500 mb-1.5">
            Perfil de sesión
          </label>
          <select
            value={perfil}
            onChange={(e) => setPerfil(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
          >
            <option value="JEFEDCO">JEFEDCO · Jefe DCO</option>
            <option value="JEFELAB">JEFELAB · Jefe de Laboratorio</option>
            <option value="DCO">DCO · Operativo</option>
            <option value="LAB">LAB · Analista</option>
            <option value="CTRLPRES">CTRLPRES · Control Presupuesto</option>
            <option value="CALIDAD">CALIDAD</option>
            <option value="DIR">DIR · Dirección</option>
            <option value="ADM">ADM · Administrador</option>
          </select>
        </div>

        {error && (
          <div className="bg-red-50 text-red-800 border border-red-200 px-3 py-2 rounded text-sm">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 bg-primary text-white font-semibold rounded-lg hover:bg-primary-600 transition disabled:opacity-60"
        >
          {loading ? "Iniciando sesión..." : "Entrar al sistema"}
        </button>

        <p className="text-xs text-center text-slate-500 leading-relaxed">
          <b>Demo:</b> cualquier usuario · password "demo"
          <br />
          Producción: integración LDAP/AD del Ejército
        </p>
      </form>
    </div>
  );
}
