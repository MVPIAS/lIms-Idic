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

  return (
    <div>
      <h1 className="page">Usuarios y Roles</h1>
      <p className="subtitle">Control de acceso RBAC. Cada usuario recibe un rol que define sus permisos efectivos ({roles.length} roles disponibles).</p>
      {error && <div className="alert warn">{error}</div>}

      <div className="toolbar">
        <div className="spacer"></div>
        <button className="btn primary sm" onClick={() => setShow((s) => !s)}>
          {show ? "Cerrar" : "＋ Nuevo usuario"}
        </button>
      </div>

      {show && (
        <form onSubmit={crear} className="card">
          <div className="form-grid">
            <div className="field"><label>Usuario <span className="req">*</span></label><input required value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /></div>
            <div className="field"><label>Nombre completo <span className="req">*</span></label><input required value={f.nombreCompleto} onChange={(e) => setF({ ...f, nombreCompleto: e.target.value })} /></div>
            <div className="field"><label>Email</label><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
            <div className="field"><label>Contraseña <span className="req">*</span></label><input type="password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></div>
            <div className="field"><label>Grado / Cargo</label><input value={f.grado} onChange={(e) => setF({ ...f, grado: e.target.value })} /></div>
            <div className="field"><label>Rol</label>
              <select value={f.rolId} onChange={(e) => setF({ ...f, rolId: e.target.value })}>
                <option value="">— sin rol —</option>
                {roles.map((r) => <option key={r.id} value={r.id}>{r.codigo} · {r.nombre}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}><button className="btn primary sm">Guardar usuario</button></div>
        </form>
      )}

      <div className="card card--table">
        <table className="data">
          <thead>
            <tr>
              <th>Usuario</th><th>Nombre completo</th><th>Grado/Cargo</th><th>Roles</th><th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td><span className="codigo">{u.username}</span></td>
                <td>{u.nombreCompleto}</td>
                <td>{u.grado ?? u.cargo ?? "—"}</td>
                <td>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {(u.usuarioRoles ?? []).map((ur: any) => <span key={ur.rolId} className="tag">{ur.rol?.codigo}</span>)}
                    {(!u.usuarioRoles || u.usuarioRoles.length === 0) && <span style={{ color: "var(--muted)", fontSize: 11 }}>sin rol</span>}
                  </div>
                </td>
                <td><span className={`pill ${u.estado === "activo" ? "green" : "gray"}`}>{u.estado}</span></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", padding: 24, color: "var(--muted)" }}>Sin usuarios</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
