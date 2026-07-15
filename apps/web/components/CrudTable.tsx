"use client";

import { useCallback, useEffect, useState } from "react";
import { api, Paginado } from "@/lib/api";

export interface Columna {
  campo: string;
  titulo: string;
  render?: (v: any, row: any) => React.ReactNode;
  right?: boolean;
}
export interface CampoForm {
  campo: string;
  label: string;
  tipo?: "text" | "number" | "select" | "email";
  opciones?: string[];
  requerido?: boolean;
  /** si es true, el input se deshabilita en modo edición (p. ej. un código/clave). */
  soloLecturaEnEdicion?: boolean;
}
export interface CrudTableProps {
  recurso: string;
  titulo: string;
  subtitulo?: string;
  columnas: Columna[];
  campos?: CampoForm[];
  /** transforma el form antes de enviar (p. ej. castear números). */
  prepararCrear?: (data: any) => any;
  /** mapea una fila al formulario de edición. Por defecto toma de la fila los valores de `campos` por su `campo`. */
  prepararEditar?: (row: any) => Record<string, any>;
}

/** Tabla CRUD genérica: lista paginada + buscador + alta + edición + borrado. Reutilizable por recurso. */
export default function CrudTable({ recurso, titulo, subtitulo, columnas, campos, prepararCrear, prepararEditar }: CrudTableProps) {
  const [res, setRes] = useState<Paginado<any> | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<Record<string, any>>({});
  const [editId, setEditId] = useState<string | null>(null);
  const [borrandoId, setBorrandoId] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      setRes(await api.list(recurso, { page, limit: 20, search }));
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }, [recurso, page, search]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  function abrirCrear() {
    setEditId(null);
    setForm({});
    setShowForm(true);
  }

  function abrirEditar(row: any) {
    const inicial = prepararEditar
      ? prepararEditar(row)
      : (campos ?? []).reduce((acc, c) => {
          acc[c.campo] = row[c.campo] ?? "";
          return acc;
        }, {} as Record<string, any>);
    setEditId(String(row.id));
    setForm(inicial);
    setShowForm(true);
    setError("");
  }

  function cerrarForm() {
    setShowForm(false);
    setEditId(null);
    setForm({});
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    try {
      const payload = prepararCrear ? prepararCrear(form) : form;
      if (editId != null) {
        await api.update(recurso, editId, payload);
      } else {
        await api.create(recurso, payload);
      }
      cerrarForm();
      cargar();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function eliminar(row: any) {
    if (!confirm(`¿Eliminar este registro? Esta acción no se puede deshacer.`)) return;
    setBorrandoId(String(row.id));
    try {
      await api.remove(recurso, String(row.id));
      setError("");
      // si borramos la fila que se estaba editando, cerramos el form
      if (editId != null && editId === String(row.id)) cerrarForm();
      cargar();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBorrandoId(null);
    }
  }

  const editando = editId != null;

  return (
    <div>
      <h1 className="page">{titulo}</h1>
      {subtitulo && <p className="subtitle">{subtitulo}</p>}
      {error && <div className="alert warn">{error}</div>}

      <div className="toolbar">
        <input
          placeholder="Buscar…"
          style={{ flex: 1 }}
          value={search}
          onChange={(e) => { setPage(1); setSearch(e.target.value); }}
        />
        {campos && (
          <button className="btn primary sm" onClick={() => (showForm ? cerrarForm() : abrirCrear())}>
            {showForm ? "Cerrar" : "＋ Nuevo"}
          </button>
        )}
      </div>

      {showForm && campos && (
        <form onSubmit={guardar} className="card">
          <div className="form-grid">
            {campos.map((c) => {
              const deshabilitado = editando && !!c.soloLecturaEnEdicion;
              return (
                <div key={c.campo} className="field">
                  <label>{c.label}{c.requerido && <span className="req"> *</span>}</label>
                  {c.tipo === "select" ? (
                    <select required={c.requerido} disabled={deshabilitado} value={form[c.campo] ?? ""} onChange={(e) => setForm({ ...form, [c.campo]: e.target.value })}>
                      <option value="">—</option>
                      {c.opciones?.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input type={c.tipo ?? "text"} required={c.requerido} disabled={deshabilitado}
                      value={form[c.campo] ?? ""} onChange={(e) => setForm({ ...form, [c.campo]: e.target.value })} />
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" className="btn outline sm" onClick={cerrarForm}>Cancelar</button>
            <button className="btn primary sm">{editando ? "Actualizar" : "Guardar"}</button>
          </div>
        </form>
      )}

      <div className="card card--table">
        <table className="data">
          <thead>
            <tr>
              {columnas.map((c) => <th key={c.campo} className={c.right ? "num" : ""}>{c.titulo}</th>)}
              {campos && <th className="num">Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {res?.data.map((row) => (
              <tr key={row.id}>
                {columnas.map((c) => (
                  <td key={c.campo} className={c.right ? "num" : ""}>
                    {c.render ? c.render(row[c.campo], row) : (row[c.campo] ?? "—")}
                  </td>
                ))}
                {campos && (
                  <td className="num">
                    <div style={{ display: "inline-flex", gap: 6, justifyContent: "flex-end" }}>
                      <button type="button" className="btn outline sm" onClick={() => abrirEditar(row)}>Editar</button>
                      <button type="button" className="btn sm" style={{ color: "var(--danger, #c0392b)" }} disabled={borrandoId === String(row.id)} onClick={() => eliminar(row)}>
                        {borrandoId === String(row.id) ? "Eliminando…" : "Eliminar"}
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {res && res.data.length === 0 && (
              <tr><td colSpan={columnas.length + (campos ? 1 : 0)} style={{ textAlign: "center", padding: "24px", color: "var(--muted)" }}>Sin resultados</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {res && res.meta.totalPages > 1 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 12.5 }}>
          <button disabled={page <= 1} className="btn outline sm" onClick={() => setPage((p) => p - 1)}>←</button>
          <span className="subtitle" style={{ margin: 0 }}>Página {res.meta.page} de {res.meta.totalPages} · {res.meta.total} registros</span>
          <button disabled={page >= res.meta.totalPages} className="btn outline sm" onClick={() => setPage((p) => p + 1)}>→</button>
        </div>
      )}
    </div>
  );
}
