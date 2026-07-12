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
}
export interface CrudTableProps {
  recurso: string;
  titulo: string;
  subtitulo?: string;
  columnas: Columna[];
  campos?: CampoForm[];
  /** transforma el form antes de enviar (p. ej. castear números). */
  prepararCrear?: (data: any) => any;
}

/** Tabla CRUD genérica: lista paginada + buscador + alta. Reutilizable por recurso. */
export default function CrudTable({ recurso, titulo, subtitulo, columnas, campos, prepararCrear }: CrudTableProps) {
  const [res, setRes] = useState<Paginado<any> | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<Record<string, any>>({});

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

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    try {
      const payload = prepararCrear ? prepararCrear(form) : form;
      await api.create(recurso, payload);
      setShowForm(false);
      setForm({});
      cargar();
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold">{titulo}</h1>
        {campos && (
          <button className="bg-primary text-white text-sm font-semibold rounded-md px-3.5 py-2" onClick={() => setShowForm((s) => !s)}>
            {showForm ? "Cerrar" : "＋ Nuevo"}
          </button>
        )}
      </div>
      {subtitulo && <p className="text-sm text-slate-500 mb-3">{subtitulo}</p>}
      {error && <div className="mb-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{error}</div>}

      {showForm && campos && (
        <form onSubmit={crear} className="bg-white border rounded-lg p-4 mb-3 shadow-sm grid grid-cols-2 md:grid-cols-3 gap-3">
          {campos.map((c) => (
            <label key={c.campo} className="block">
              <span className="block text-[11px] uppercase text-slate-500 font-semibold mb-1">{c.label}{c.requerido && " *"}</span>
              {c.tipo === "select" ? (
                <select className="w-full border rounded px-2 py-1.5 text-sm" required={c.requerido} value={form[c.campo] ?? ""} onChange={(e) => setForm({ ...form, [c.campo]: e.target.value })}>
                  <option value="">—</option>
                  {c.opciones?.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input type={c.tipo ?? "text"} className="w-full border rounded px-2 py-1.5 text-sm" required={c.requerido}
                  value={form[c.campo] ?? ""} onChange={(e) => setForm({ ...form, [c.campo]: e.target.value })} />
              )}
            </label>
          ))}
          <div className="col-span-full flex justify-end">
            <button className="bg-primary text-white text-sm font-semibold rounded-md px-3.5 py-2">Guardar</button>
          </div>
        </form>
      )}

      <div className="mb-2">
        <input className="w-72 border rounded-md px-3 py-1.5 text-sm" placeholder="Buscar…" value={search}
          onChange={(e) => { setPage(1); setSearch(e.target.value); }} />
      </div>

      <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase text-slate-500 bg-slate-50 border-b">
              {columnas.map((c) => <th key={c.campo} className={`px-3 py-2 ${c.right ? "text-right" : ""}`}>{c.titulo}</th>)}
            </tr>
          </thead>
          <tbody>
            {res?.data.map((row) => (
              <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50">
                {columnas.map((c) => (
                  <td key={c.campo} className={`px-3 py-2 ${c.right ? "text-right tabular-nums" : ""}`}>
                    {c.render ? c.render(row[c.campo], row) : (row[c.campo] ?? "—")}
                  </td>
                ))}
              </tr>
            ))}
            {res && res.data.length === 0 && (
              <tr><td colSpan={columnas.length} className="px-3 py-6 text-center text-slate-400">Sin resultados</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {res && res.meta.totalPages > 1 && (
        <div className="flex items-center gap-2 mt-3 text-sm">
          <button disabled={page <= 1} className="border rounded px-2 py-1 disabled:opacity-40" onClick={() => setPage((p) => p - 1)}>←</button>
          <span>Página {res.meta.page} de {res.meta.totalPages} · {res.meta.total} registros</span>
          <button disabled={page >= res.meta.totalPages} className="border rounded px-2 py-1 disabled:opacity-40" onClick={() => setPage((p) => p + 1)}>→</button>
        </div>
      )}
    </div>
  );
}
