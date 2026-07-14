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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary via-primary-600 to-accent p-4">
      <form onSubmit={onSubmit} className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-primary to-accent rounded-xl flex items-center justify-center text-white font-bold text-xl">
            L
          </div>
          <div>
            <h1 className="font-bold text-xl text-primary">LIMS IDIC</h1>
            <p className="text-xs text-slate-500">Instituto de Investigaciones y Control · Ejército de Chile</p>
          </div>
        </div>

        <h2 className="text-2xl font-bold text-primary">Ingreso al sistema</h2>
        <p className="text-sm text-slate-600">Use sus credenciales institucionales.</p>

        <div className="bg-slate-50 border-l-4 border-accent p-3 rounded text-xs text-slate-700">
          🔐 <b>Autenticación</b> · cuentas locales y, en producción, LDAP/Active Directory ·{" "}
          <code className="text-accent">ad.ejercito.cl</code>
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase text-slate-500 mb-1.5">Usuario</label>
          <input
            type="text"
            value={username}
            autoFocus
            onChange={(e) => setUsername(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase text-slate-500 mb-1.5">Contraseña</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        {error && (
          <div className="bg-red-50 text-red-800 border border-red-200 px-3 py-2 rounded text-sm">{error}</div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 bg-primary text-white font-semibold rounded-lg hover:bg-primary-600 transition disabled:opacity-60"
        >
          {loading ? "Iniciando sesión…" : "Entrar al sistema"}
        </button>

        <p className="text-[11px] text-center text-slate-400 leading-relaxed">
          Aiuken · LIMS IDIC — Preproducción
        </p>
      </form>
    </div>
  );
}
