"use client";

import { useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("lims_token")}`, "Content-Type": "application/json" });

export default function UsuariosPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [show, setShow] = useState(false);
  const [f, setF] = useState<any>({ username: "", nombreCompleto: "", email: "", password: "", grado: "", rolId: "" });

  async function cargar() {
    try {
      const [u, r] = await Promise.all([
        fetch(`${API}/usuarios`, { headers: auth() }).then((x) => x.json()),
        fetch(`${API}/roles`, { headers: auth() }).then((x) => x.json()),
      ]);
      setRows(u.data ?? []);
      setRoles(r.data ?? []);
    } catch (e: any) { setError(e.message); }
  }
  useEffect(() => { cargar(); }, []);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const res = await fetch(`${API}/usuarios`, { method: "POST", headers: auth(), body: JSON.stringify(f) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `Error ${res.status}`);
      setShow(false);
      setF({ username: "", nombreCompleto: "", email: "", password: "", grado: "", rolId: "" });
      cargar();
    } catch (e: any) { setError(Array.isArray(e.message) ? e.message.join(", ") : e.message); }
  }

  const inp = "w-full border rounded px-2 py-1.5 text-sm";
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold">Usuarios y Roles</h1>
        <button className="bg-primary text-white text-sm font-semibold rounded-md px-3.5 py-2" onClick={() => setShow((s) => !s)}>
          {show ? "Cerrar" : "＋ Nuevo usuario"}
        </button>
      </div>
      <p className="text-sm text-slate-500 mb-3">Control de acceso RBAC. Cada usuario recibe un rol que define sus permisos efectivos ({roles.length} roles disponibles).</p>
      {error && <div className="mb-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{error}</div>}

      {show && (
        <form onSubmit={crear} className="bg-white border rounded-lg p-4 mb-3 shadow-sm grid grid-cols-2 md:grid-cols-3 gap-3">
          <label className="block"><span className="block text-[11px] uppercase text-slate-500 font-semibold mb-1">Usuario *</span><input className={inp} required value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /></label>
          <label className="block"><span className="block text-[11px] uppercase text-slate-500 font-semibold mb-1">Nombre completo *</span><input className={inp} required value={f.nombreCompleto} onChange={(e) => setF({ ...f, nombreCompleto: e.target.value })} /></label>
          <label className="block"><span className="block text-[11px] uppercase text-slate-500 font-semibold mb-1">Email</span><input type="email" className={inp} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
          <label className="block"><span className="block text-[11px] uppercase text-slate-500 font-semibold mb-1">Contraseña *</span><input type="password" className={inp} required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
          <label className="block"><span className="block text-[11px] uppercase text-slate-500 font-semibold mb-1">Grado / Cargo</span><input className={inp} value={f.grado} onChange={(e) => setF({ ...f, grado: e.target.value })} /></label>
          <label className="block"><span className="block text-[11px] uppercase text-slate-500 font-semibold mb-1">Rol</span>
            <select className={inp} value={f.rolId} onChange={(e) => setF({ ...f, rolId: e.target.value })}>
              <option value="">— sin rol —</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.codigo} · {r.nombre}</option>)}
            </select>
          </label>
          <div className="col-span-full flex justify-end"><button className="bg-primary text-white text-sm font-semibold rounded-md px-3.5 py-2">Guardar usuario</button></div>
        </form>
      )}

      <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase text-slate-500 bg-slate-50 border-b">
              <th className="px-3 py-2">Usuario</th><th className="px-3 py-2">Nombre completo</th><th className="px-3 py-2">Grado/Cargo</th><th className="px-3 py-2">Roles</th><th className="px-3 py-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2 font-medium">{u.username}</td>
                <td className="px-3 py-2">{u.nombreCompleto}</td>
                <td className="px-3 py-2">{u.grado ?? u.cargo ?? "—"}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {(u.usuarioRoles ?? []).map((ur: any) => <span key={ur.rolId} className="text-[11px] px-2 py-0.5 rounded-full bg-accent/10 text-accent font-medium">{ur.rol?.codigo}</span>)}
                    {(!u.usuarioRoles || u.usuarioRoles.length === 0) && <span className="text-slate-400 text-xs">sin rol</span>}
                  </div>
                </td>
                <td className="px-3 py-2"><span className={`text-[11px] px-2 py-0.5 rounded-full ${u.estado === "activo" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{u.estado}</span></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-400">Sin usuarios</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
