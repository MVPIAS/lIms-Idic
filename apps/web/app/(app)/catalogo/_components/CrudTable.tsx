"use client";

/**
 * CrudTable · tabla maestra genérica del catálogo v2 (listar + crear + editar + eliminar).
 *
 * Autocontenida: usa `fetch` directo contra el API con el Bearer de localStorage,
 * sin depender de librerías del repo, para que las 9 maestras del catálogo se
 * gestionen con una sola config declarativa. Selects dependientes (cascada):
 * cuando cambia el campo `dependeDe`, se recargan las opciones y se limpia el valor.
 */

import { useCallback, useEffect, useId, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";

function authHeaders(): Record<string, string> {
  const t = typeof window !== "undefined" ? localStorage.getItem("lims_token") : null;
  return {
    "Content-Type": "application/json",
    ...(t ? { Authorization: `Bearer ${t}` } : {}),
  };
}

async function apiFetch(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${API}/${path}`, { ...init, headers: { ...authHeaders(), ...(init.headers ?? {}) } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message ?? `Error ${res.status}`);
  }
  return res.status === 204 ? undefined : res.json();
}

export interface Columna {
  key: string;
  label: string;
  render?: (v: any, row: any) => React.ReactNode;
  num?: boolean;
}

export type TipoCampo = "text" | "number" | "checkbox" | "select" | "textarea";

export interface Campo {
  name: string;
  label: string;
  tipo?: TipoCampo;
  requerido?: boolean;
  /** opciones fijas para un select simple. */
  opciones?: string[];
  /**
   * endpoint (relativo, sin barra inicial) del que cargar opciones de un select.
   * Puede ser una función del formulario actual para cascada (devuelve null si aún no aplica).
   */
  opcionesEndpoint?: string | ((form: Record<string, any>) => string | null);
  /** mapea una fila de opciones a {value,label}. Por defecto id → código · nombre. */
  opcionesMap?: (row: any) => { value: string; label: string };
  /** nombre de otro campo del que depende: al cambiar, recarga opciones y limpia este valor. */
  dependeDe?: string;
  /** ancho: ocupa 2 o 3 columnas del grid. */
  span?: 2 | 3;
}

export interface CrudTableProps {
  titulo: string;
  subtitulo?: string;
  /** recurso CRUD, p. ej. "cat/gran-grupos". */
  endpoint: string;
  columnas: Columna[];
  campos: Campo[];
}

const mapPorDefecto = (row: any) => {
  const codigo = row.codigo ?? row.cgrupo ?? row.cntlroom ?? row.codsucdel ?? null;
  const nombre = row.nombre ?? row.razonSocial ?? row.descripcion ?? null;
  const label = [codigo, nombre].filter(Boolean).join(" · ") || String(row.id ?? "");
  return { value: String(row.id ?? ""), label };
};

/** Extrae un array plano tanto si el endpoint pagina ({data}) como si no. */
function filasDe(res: any): any[] {
  if (Array.isArray(res)) return res;
  if (Array.isArray(res?.data)) return res.data;
  return [];
}

interface SelectFieldProps {
  campo: Campo;
  inputId: string;
  value: string;
  endpoint: string | null;
  onChange: (v: string) => void;
}

/** Select cuyas opciones se cargan de un endpoint (recarga cuando cambia el endpoint = cascada). */
function SelectField({ campo, inputId, value, endpoint, onChange }: SelectFieldProps) {
  const [opciones, setOpciones] = useState<{ value: string; label: string }[]>([]);
  const [error, setError] = useState(false);
  const map = campo.opcionesMap ?? mapPorDefecto;

  useEffect(() => {
    if (!endpoint) {
      setOpciones([]);
      return;
    }
    let vivo = true;
    (async () => {
      try {
        const res = await apiFetch(endpoint);
        if (vivo) {
          setOpciones(filasDe(res).map(map));
          setError(false);
        }
      } catch {
        if (vivo) {
          setOpciones([]);
          setError(true);
        }
      }
    })();
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint]);

  if (error) {
    return (
      <>
        <input id={inputId} type="text" required={campo.requerido} value={value} placeholder="Catálogo no disponible — id"
          onChange={(e) => onChange(e.target.value)} />
        <small style={{ color: "var(--muted)", fontSize: 10, marginTop: 2 }}>No se pudieron cargar las opciones.</small>
      </>
    );
  }

  const disabled = !endpoint;
  return (
    <select id={inputId} required={campo.requerido} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{disabled ? "Selecciona antes el nivel superior…" : "—"}</option>
      {opciones.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export default function CrudTable({ titulo, subtitulo, endpoint, columnas, campos }: CrudTableProps) {
  const [rows, setRows] = useState<any[]>([]);
  const [meta, setMeta] = useState<{ page: number; totalPages: number; total: number } | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [borrandoId, setBorrandoId] = useState<string | null>(null);
  const formId = useId();

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      p.set("page", String(page));
      p.set("limit", "20");
      if (search) p.set("search", search);
      const res = await apiFetch(`${endpoint}?${p.toString()}`);
      setRows(filasDe(res));
      setMeta(res?.meta ?? null);
      setError("");
    } catch (e: any) {
      setError(e.message);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [endpoint, page, search]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  /** Valores iniciales al crear: checkbox `activo` marcado por defecto. */
  function inicialCrear(): Record<string, any> {
    const init: Record<string, any> = {};
    for (const c of campos) {
      if (c.tipo === "checkbox") init[c.name] = c.name === "activo";
    }
    return init;
  }

  function abrirCrear() {
    setEditId(null);
    setForm(inicialCrear());
    setShowForm(true);
    setError("");
  }

  function abrirEditar(row: any) {
    const init: Record<string, any> = {};
    for (const c of campos) {
      const v = row[c.name];
      if (c.tipo === "checkbox") init[c.name] = v !== false;
      else init[c.name] = v ?? "";
    }
    setEditId(String(row.id));
    setForm(init);
    setShowForm(true);
    setError("");
  }

  function cerrarForm() {
    setShowForm(false);
    setEditId(null);
    setForm({});
  }

  /** Al cambiar un campo, limpia los que dependen de él (cascada). */
  function cambiar(name: string, value: any) {
    setForm((prev) => {
      const next = { ...prev, [name]: value };
      for (const c of campos) {
        if (c.dependeDe === name) next[c.name] = "";
      }
      return next;
    });
  }

  /** Construye el payload: castea números/booleanos y omite vacíos opcionales. */
  function construirPayload(): Record<string, any> {
    const out: Record<string, any> = {};
    for (const c of campos) {
      const raw = form[c.name];
      if (c.tipo === "checkbox") {
        out[c.name] = !!raw;
      } else if (c.tipo === "number") {
        if (raw === "" || raw == null) continue;
        const n = Number(raw);
        if (!Number.isNaN(n)) out[c.name] = n;
      } else {
        if (raw === "" || raw == null) continue;
        out[c.name] = raw;
      }
    }
    return out;
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    try {
      const payload = construirPayload();
      if (editId != null) {
        await apiFetch(`${endpoint}/${editId}`, { method: "PATCH", body: JSON.stringify(payload) });
      } else {
        await apiFetch(endpoint, { method: "POST", body: JSON.stringify(payload) });
      }
      cerrarForm();
      cargar();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function eliminar(row: any) {
    if (!confirm("¿Eliminar este registro? Esta acción no se puede deshacer.")) return;
    setBorrandoId(String(row.id));
    try {
      await apiFetch(`${endpoint}/${row.id}`, { method: "DELETE" });
      if (editId != null && editId === String(row.id)) cerrarForm();
      setError("");
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
        <button className="btn primary sm" onClick={() => (showForm ? cerrarForm() : abrirCrear())}>
          {showForm ? "Cerrar" : "＋ Nuevo"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={guardar} className="card">
          <div className="form-grid">
            {campos.map((c) => {
              const inputId = `${formId}-${c.name}`;
              const tipo = c.tipo ?? "text";
              const spanCls = c.span === 3 ? "span-3" : c.span === 2 ? "span-2" : "";
              // resuelve el endpoint de opciones (soporta cascada por función).
              const ep =
                typeof c.opcionesEndpoint === "function"
                  ? c.opcionesEndpoint(form)
                  : c.opcionesEndpoint ?? null;
              return (
                <div key={c.name} className={`field ${spanCls}`}>
                  {tipo === "checkbox" ? (
                    <label htmlFor={inputId} style={{ flexDirection: "row", alignItems: "center", gap: 6, display: "flex", textTransform: "none" }}>
                      <input id={inputId} type="checkbox" checked={!!form[c.name]} style={{ width: "auto" }}
                        onChange={(e) => cambiar(c.name, e.target.checked)} />
                      {c.label}
                    </label>
                  ) : (
                    <>
                      <label htmlFor={inputId}>{c.label}{c.requerido && <span className="req"> *</span>}</label>
                      {tipo === "select" && (c.opcionesEndpoint || c.opciones) ? (
                        c.opciones ? (
                          <select id={inputId} required={c.requerido} value={form[c.name] ?? ""}
                            onChange={(e) => cambiar(c.name, e.target.value)}>
                            <option value="">—</option>
                            {c.opciones.map((o) => <option key={o} value={o}>{o}</option>)}
                          </select>
                        ) : (
                          <SelectField campo={c} inputId={inputId} value={form[c.name] ?? ""} endpoint={ep}
                            onChange={(v) => cambiar(c.name, v)} />
                        )
                      ) : tipo === "textarea" ? (
                        <textarea id={inputId} required={c.requerido} rows={3} value={form[c.name] ?? ""}
                          onChange={(e) => cambiar(c.name, e.target.value)} />
                      ) : (
                        <input id={inputId} type={tipo === "number" ? "number" : "text"} step={tipo === "number" ? "any" : undefined}
                          required={c.requerido} value={form[c.name] ?? ""}
                          onChange={(e) => cambiar(c.name, e.target.value)} />
                      )}
                    </>
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
              {columnas.map((c) => <th key={c.key} className={c.num ? "num" : ""}>{c.label}</th>)}
              <th className="num">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                {columnas.map((c) => (
                  <td key={c.key} className={c.num ? "num" : ""}>
                    {c.render ? c.render(row[c.key], row) : (row[c.key] ?? "—")}
                  </td>
                ))}
                <td className="num">
                  <div style={{ display: "inline-flex", gap: 6, justifyContent: "flex-end" }}>
                    <button type="button" className="btn outline sm" onClick={() => abrirEditar(row)}>Editar</button>
                    <button type="button" className="btn sm" style={{ color: "var(--danger, #c0392b)" }}
                      disabled={borrandoId === String(row.id)} onClick={() => eliminar(row)}>
                      {borrandoId === String(row.id) ? "Eliminando…" : "Eliminar"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={columnas.length + 1} style={{ textAlign: "center", padding: 24, color: "var(--muted)" }}>Sin resultados</td></tr>
            )}
            {loading && (
              <tr><td colSpan={columnas.length + 1} style={{ textAlign: "center", padding: 24, color: "var(--muted)" }}>Cargando…</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {meta && meta.totalPages > 1 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 12.5 }}>
          <button disabled={page <= 1} className="btn outline sm" onClick={() => setPage((p) => p - 1)}>←</button>
          <span className="subtitle" style={{ margin: 0 }}>Página {meta.page} de {meta.totalPages} · {meta.total} registros</span>
          <button disabled={page >= meta.totalPages} className="btn outline sm" onClick={() => setPage((p) => p + 1)}>→</button>
        </div>
      )}
    </div>
  );
}

/** Badge activo/inactivo reutilizable por las páginas del catálogo. */
export const activoBadge = (v: any) => (
  <span className={`pill ${v === false ? "gray" : "green"}`}>{v === false ? "inactivo" : "activo"}</span>
);

/** Render de código monoespaciado. */
export const codigoCell = (v: any) => (v ? <span className="codigo">{v}</span> : "—");
