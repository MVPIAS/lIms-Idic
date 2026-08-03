"use client";

/**
 * Gestión de PASOS / CAMPOS por método (StarLIMS ANALFIELDS).
 *
 * Flujo: 1) elegir un método (buscador sobre cat/metodos) → 2) ver/editar/
 * reordenar/añadir/eliminar sus pasos (nombre, tipo, unidad, formato,
 * instrucción, obligatorio). Autocontenida (fetch + Bearer de localStorage),
 * como el resto del catálogo v2. Sólo gestiona la DEFINICIÓN de pasos, no la
 * captura de valores.
 */

import { useCallback, useEffect, useState } from "react";
import { errorMensaje } from "@/lib/apiError";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";

function authHeaders(): Record<string, string> {
  const t = typeof window !== "undefined" ? localStorage.getItem("lims_token") : null;
  return { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) };
}

async function apiFetch(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${API}/${path}`, { ...init, headers: { ...authHeaders(), ...(init.headers ?? {}) } });
  if (!res.ok) throw new Error(await errorMensaje(res));
  return res.status === 204 ? undefined : res.json();
}

function filasDe(res: any): any[] {
  if (Array.isArray(res)) return res;
  if (Array.isArray(res?.data)) return res.data;
  return [];
}

type Metodo = { id: string; codigo: string; nombre: string; norma?: string | null };
type Paso = {
  id: string;
  catMetodoId: string;
  orden: number;
  nombre: string;
  tipoDato: string;
  unidad?: string | null;
  formato?: string | null;
  instruccion?: string | null;
  obligatorio: boolean;
  activo: boolean;
};

const TIPOS = ["numero", "texto", "seleccion"] as const;

const vacio = (catMetodoId: string, orden: number): Partial<Paso> => ({
  catMetodoId,
  orden,
  nombre: "",
  tipoDato: "numero",
  unidad: "",
  formato: "",
  instruccion: "",
  obligatorio: true,
  activo: true,
});

export default function PasosMetodoPage() {
  // --- selección de método ---
  const [busqueda, setBusqueda] = useState("");
  const [metodos, setMetodos] = useState<Metodo[]>([]);
  const [metodo, setMetodo] = useState<Metodo | null>(null);
  const [cargandoMet, setCargandoMet] = useState(false);

  // --- pasos del método elegido ---
  const [pasos, setPasos] = useState<Paso[]>([]);
  const [cargandoPasos, setCargandoPasos] = useState(false);
  const [error, setError] = useState("");

  // --- formulario alta/edición ---
  const [form, setForm] = useState<Partial<Paso> | null>(null);
  const [editId, setEditId] = useState<string | null>(null);

  const buscarMetodos = useCallback(async () => {
    setCargandoMet(true);
    try {
      const p = new URLSearchParams({ limit: "20" });
      if (busqueda.trim()) p.set("search", busqueda.trim());
      const res = await apiFetch(`cat/metodos?${p.toString()}`);
      setMetodos(filasDe(res));
      setError("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCargandoMet(false);
    }
  }, [busqueda]);

  useEffect(() => {
    const t = setTimeout(buscarMetodos, 250);
    return () => clearTimeout(t);
  }, [buscarMetodos]);

  const cargarPasos = useCallback(async (m: Metodo) => {
    setCargandoPasos(true);
    try {
      const res = await apiFetch(`pasos-metodo?catMetodoId=${encodeURIComponent(m.id)}&limit=100`);
      setPasos(filasDe(res));
      setError("");
    } catch (e: any) {
      setError(e.message);
      setPasos([]);
    } finally {
      setCargandoPasos(false);
    }
  }, []);

  function elegir(m: Metodo) {
    setMetodo(m);
    setForm(null);
    setEditId(null);
    cargarPasos(m);
  }

  function abrirCrear() {
    if (!metodo) return;
    const maxOrden = pasos.reduce((mx, p) => Math.max(mx, p.orden ?? 0), 0);
    setEditId(null);
    setForm(vacio(metodo.id, maxOrden + 1));
    setError("");
  }

  function abrirEditar(p: Paso) {
    setEditId(p.id);
    setForm({ ...p, unidad: p.unidad ?? "", formato: p.formato ?? "", instruccion: p.instruccion ?? "" });
    setError("");
  }

  function cerrar() {
    setForm(null);
    setEditId(null);
  }

  function cambiar<K extends keyof Paso>(k: K, v: Paso[K]) {
    setForm((f) => (f ? { ...f, [k]: v } : f));
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!form || !metodo) return;
    const payload: Record<string, any> = {
      catMetodoId: metodo.id,
      orden: Number(form.orden) || 0,
      nombre: form.nombre,
      tipoDato: form.tipoDato,
      obligatorio: !!form.obligatorio,
      activo: form.activo !== false,
    };
    // opcionales: sólo si tienen valor
    if (form.unidad) payload.unidad = form.unidad;
    if (form.formato) payload.formato = form.formato;
    if (form.instruccion) payload.instruccion = form.instruccion;
    try {
      if (editId) await apiFetch(`pasos-metodo/${editId}`, { method: "PATCH", body: JSON.stringify(payload) });
      else await apiFetch("pasos-metodo", { method: "POST", body: JSON.stringify(payload) });
      cerrar();
      await cargarPasos(metodo);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function eliminar(p: Paso) {
    if (!metodo) return;
    if (!confirm(`¿Eliminar el paso "${p.nombre}"?`)) return;
    try {
      await apiFetch(`pasos-metodo/${p.id}`, { method: "DELETE" });
      if (editId === p.id) cerrar();
      await cargarPasos(metodo);
    } catch (e: any) {
      setError(e.message);
    }
  }

  /** Reordena: intercambia el `orden` con el paso adyacente en la lista visible. */
  async function mover(idx: number, dir: -1 | 1) {
    if (!metodo) return;
    const otro = idx + dir;
    if (otro < 0 || otro >= pasos.length) return;
    const a = pasos[idx];
    const b = pasos[otro];
    try {
      await apiFetch(`pasos-metodo/${a.id}`, { method: "PATCH", body: JSON.stringify({ orden: b.orden }) });
      await apiFetch(`pasos-metodo/${b.id}`, { method: "PATCH", body: JSON.stringify({ orden: a.orden }) });
      await cargarPasos(metodo);
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div>
      <h1 className="page">Pasos / campos por método</h1>
      <p className="subtitle">
        Definición editable de los pasos que el analista captura para cada método (StarLIMS ANALFIELDS).
        Elige un método y gestiona sus pasos: nombre, tipo, unidad, formato, instrucción y si es obligatorio.
      </p>
      {error && <div className="alert warn">{error}</div>}

      {/* 1 · Selección de método */}
      <div className="card">
        <div className="toolbar">
          <input
            placeholder="Buscar método por código, nombre o norma…"
            style={{ flex: 1 }}
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>
        <div className="card card--table" style={{ maxHeight: 240, overflow: "auto", marginTop: 8 }}>
          <table className="data">
            <thead>
              <tr><th>Código</th><th>Método</th><th>Norma</th><th></th></tr>
            </thead>
            <tbody>
              {metodos.map((m) => {
                const sel = metodo?.id === m.id;
                return (
                  <tr key={m.id} className="row-action" onClick={() => elegir(m)} style={sel ? { background: "#eff5ff" } : undefined}>
                    <td><span className="codigo">{m.codigo}</span></td>
                    <td>{m.nombre}</td>
                    <td>{m.norma ? <span className="tag">{m.norma}</span> : "—"}</td>
                    <td className="num">{sel ? <span className="pill blue">elegido</span> : <span className="btn outline sm">Elegir</span>}</td>
                  </tr>
                );
              })}
              {cargandoMet && <tr><td colSpan={4} style={{ textAlign: "center", padding: 18, color: "var(--muted)" }}>Buscando…</td></tr>}
              {!cargandoMet && metodos.length === 0 && (
                <tr><td colSpan={4} style={{ textAlign: "center", padding: 18, color: "var(--muted)" }}>Sin métodos para la búsqueda.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 2 · Pasos del método elegido */}
      {metodo && (
        <div className="card" style={{ marginTop: 14 }}>
          <h2>
            Pasos de <span className="codigo">{metodo.codigo}</span> · {metodo.nombre}
            <span className="right">{pasos.length} paso(s)</span>
          </h2>

          <div className="toolbar">
            <span className="subtitle" style={{ flex: 1, margin: 0 }}>
              Ordena con ▲▼. La instrucción es texto de procedimiento libre (inicialmente vacío).
            </span>
            <button className="btn primary sm" onClick={() => (form && !editId ? cerrar() : abrirCrear())}>
              {form && !editId ? "Cerrar" : "＋ Nuevo paso"}
            </button>
          </div>

          {form && (
            <form onSubmit={guardar} className="card" style={{ marginBottom: 12 }}>
              <div className="form-grid cols-4">
                <div className="field">
                  <label>Orden</label>
                  <input type="number" value={form.orden ?? 0} onChange={(e) => cambiar("orden", Number(e.target.value) as any)} />
                </div>
                <div className="field span-3">
                  <label>Nombre del paso / campo <span className="req"> *</span></label>
                  <input required value={form.nombre ?? ""} onChange={(e) => cambiar("nombre", e.target.value as any)} placeholder="p.ej. Fuerza, Área, Masa Inicial" />
                </div>
                <div className="field">
                  <label>Tipo de dato</label>
                  <select value={form.tipoDato ?? "numero"} onChange={(e) => cambiar("tipoDato", e.target.value as any)}>
                    {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Unidad</label>
                  <input value={form.unidad ?? ""} onChange={(e) => cambiar("unidad", e.target.value as any)} placeholder="p.ej. N, mm, g" />
                </div>
                <div className="field">
                  <label>Formato (máscara)</label>
                  <input value={form.formato ?? ""} onChange={(e) => cambiar("formato", e.target.value as any)} placeholder="p.ej. ###.##" />
                </div>
                <div className="field">
                  <label style={{ flexDirection: "row", alignItems: "center", gap: 6, display: "flex", textTransform: "none" }}>
                    <input type="checkbox" checked={form.obligatorio !== false} style={{ width: "auto" }}
                      onChange={(e) => cambiar("obligatorio", e.target.checked as any)} />
                    Obligatorio
                  </label>
                </div>
                <div className="field span-4">
                  <label>Instrucción del procedimiento (editable)</label>
                  <textarea rows={3} value={form.instruccion ?? ""} onChange={(e) => cambiar("instruccion", e.target.value as any)}
                    placeholder="Texto narrativo del procedimiento para este paso (no viene en la data de StarLIMS; edítelo aquí)." />
                </div>
              </div>
              <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button type="button" className="btn outline sm" onClick={cerrar}>Cancelar</button>
                <button className="btn primary sm">{editId ? "Actualizar" : "Guardar"}</button>
              </div>
            </form>
          )}

          <div className="card card--table">
            <table className="data">
              <thead>
                <tr>
                  <th className="num" style={{ width: 60 }}>Orden</th>
                  <th>Nombre</th>
                  <th>Tipo</th>
                  <th>Unidad</th>
                  <th>Formato</th>
                  <th>Obl.</th>
                  <th>Instrucción</th>
                  <th className="num">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {pasos.map((p, idx) => (
                  <tr key={p.id}>
                    <td className="num">{p.orden}</td>
                    <td>{p.nombre}</td>
                    <td><span className="tag">{p.tipoDato}</span></td>
                    <td>{p.unidad || "—"}</td>
                    <td>{p.formato || "—"}</td>
                    <td>{p.obligatorio ? <span className="pill green">sí</span> : <span className="pill gray">no</span>}</td>
                    <td style={{ maxWidth: 260, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: p.instruccion ? undefined : "var(--muted)" }}>
                      {p.instruccion || "— sin texto —"}
                    </td>
                    <td className="num">
                      <div style={{ display: "inline-flex", gap: 6, justifyContent: "flex-end" }}>
                        <button type="button" className="btn outline sm" disabled={idx === 0} onClick={() => mover(idx, -1)} title="Subir">▲</button>
                        <button type="button" className="btn outline sm" disabled={idx === pasos.length - 1} onClick={() => mover(idx, 1)} title="Bajar">▼</button>
                        <button type="button" className="btn outline sm" onClick={() => abrirEditar(p)}>Editar</button>
                        <button type="button" className="btn sm" style={{ color: "var(--danger, #c0392b)" }} onClick={() => eliminar(p)}>Eliminar</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {cargandoPasos && <tr><td colSpan={8} style={{ textAlign: "center", padding: 20, color: "var(--muted)" }}>Cargando pasos…</td></tr>}
                {!cargandoPasos && pasos.length === 0 && (
                  <tr><td colSpan={8} style={{ textAlign: "center", padding: 20, color: "var(--muted)" }}>Este método no tiene pasos definidos. Añade el primero.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
