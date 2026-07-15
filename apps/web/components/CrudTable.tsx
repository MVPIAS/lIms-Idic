"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
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
  tipo?: "text" | "number" | "select" | "email" | "ref";
  /** opciones fijas para tipo "select". */
  opciones?: string[];
  /** recurso de la API del que se cargan las opciones cuando tipo === "ref" (p. ej. "clientes", "metodos"). */
  refRecurso?: string;
  /** etiqueta legible de una opción; por defecto código/nombre/razón social. */
  refLabel?: (row: any) => string;
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

/**
 * Normaliza la respuesta de un listado. La mayoría de endpoints devuelven
 * `{data, meta}` (BaseCrudController), pero algunos con controlador propio
 * (p. ej. `/ot`) devuelven un ARRAY plano. Toleramos ambas formas.
 */
function filasDe(res: any): any[] {
  if (Array.isArray(res)) return res;
  if (Array.isArray(res?.data)) return res.data;
  return [];
}

/**
 * Etiqueta legible por defecto de una fila referenciada: código y nombre.
 * Cubre las variantes reales del modelo (cgrupo, repid, numero / razonSocial…).
 * Si no hay nada legible, cae al id para no dejar la opción en blanco.
 */
export function etiquetaRef(row: any): string {
  if (!row) return "";
  const codigo = row.codigo ?? row.cgrupo ?? row.repid ?? row.numero ?? null;
  const nombre = row.nombre ?? row.razonSocial ?? row.descripcion ?? null;
  const texto = [codigo, nombre].filter(Boolean).join(" · ");
  return texto || String(row.id ?? "");
}

/**
 * Render de columna para una FK: muestra la etiqueta del objeto relacionado si
 * el backend lo incluye en el listado y, si no viene, el id abreviado (con el
 * uuid completo en el tooltip). Uso: `render: renderRef("cliente")`.
 */
export function renderRef(relacion: string, etiqueta: (row: any) => string = etiquetaRef) {
  return (v: any, row: any) => {
    const obj = row?.[relacion];
    if (obj) return <span>{etiqueta(obj)}</span>;
    return v ? <span className="tag" title={String(v)}>{String(v).slice(0, 8)}…</span> : "—";
  };
}

interface RefFieldProps {
  campo: CampoForm;
  inputId: string;
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  /** id a excluir de las opciones (auto-referencia: un registro no puede ser su propio padre). */
  excluirId?: string | null;
}

/**
 * Combo con búsqueda para una clave foránea: el usuario ve y busca por la
 * etiqueta legible, pero el valor que viaja al formulario es el `id` (uuid).
 *
 * Implementado con el patrón ARIA 1.2 de combobox (input + listbox) en vez de
 * `<datalist>`: con datalist el valor enviado sería la etiqueta (no el id), no
 * hay forma fiable de detectar la selección ni de mostrar carga/errores, y su
 * comportamiento difiere mucho entre navegadores.
 *
 * Invariante: al perder el foco, el texto visible siempre vuelve a ser la
 * etiqueta de la selección actual (o queda vacío si no hay ninguna). Así el
 * `required` nativo del input equivale a "tiene que haber una selección".
 */
function RefField({ campo, inputId, value, onChange, disabled, excluirId }: RefFieldProps) {
  const recurso = campo.refRecurso ?? "";
  const etiqueta = campo.refLabel ?? etiquetaRef;

  const [query, setQuery] = useState("");
  const [texto, setTexto] = useState("");
  const [opciones, setOpciones] = useState<any[]>([]);
  const [sel, setSel] = useState<any | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [enfocado, setEnfocado] = useState(false);
  const [cargando, setCargando] = useState(false);
  /** el recurso falló (p. ej. 500): degradamos a input de texto en vez de romper. */
  const [caido, setCaido] = useState(false);
  const [activo, setActivo] = useState(-1);

  const listaId = useId();
  /** id cuyo detalle ya se pidió, para no repetir la petición en cada render. */
  const pedidoRef = useRef<string | null>(null);
  const listaRef = useRef<HTMLUListElement>(null);

  // Carga de opciones (al montar el formulario y en cada búsqueda, con debounce 250ms).
  useEffect(() => {
    if (!recurso) return;
    let vivo = true;
    const t = setTimeout(async () => {
      setCargando(true);
      try {
        const res: any = await api.list<any>(recurso, { limit: 200, search: query || undefined });
        if (!vivo) return;
        let filas = filasDe(res);
        // Los endpoints que devuelven array plano (p. ej. /ot) ignoran ?search:
        // filtramos en cliente por la etiqueta para que el combo siga buscando.
        if (Array.isArray(res) && query) {
          const q = query.toLowerCase();
          filas = filas.filter((f) => etiqueta(f).toLowerCase().includes(q));
        }
        setOpciones(filas);
        setCaido(false);
      } catch {
        if (vivo) {
          setOpciones([]);
          setCaido(true);
        }
      } finally {
        if (vivo) setCargando(false);
      }
    }, query ? 250 : 0);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
    // `etiqueta` se omite a propósito: las páginas la definen inline y cambiaría de identidad en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recurso, query]);

  // Resuelve la etiqueta del valor actual. En modo edición llega solo el uuid:
  // se busca en las opciones ya cargadas y, si no está, se pide el detalle.
  //
  // La petición NO se cancela en el cleanup: este efecto se re-ejecuta en cuanto
  // llegan las opciones, y cancelarla dejaba la etiqueta sin resolver para siempre.
  // La respuesta obsoleta se descarta comparando con el valor vigente.
  useEffect(() => {
    if (!recurso) return;
    if (!value) {
      pedidoRef.current = null;
      setSel(null);
      return;
    }
    if (sel && String(sel.id) === String(value)) return; // ya resuelto
    const enLista = opciones.find((o) => String(o.id) === String(value));
    if (enLista) {
      setSel(enLista);
      return;
    }
    if (pedidoRef.current === String(value)) return; // ya pedido: no repetir
    pedidoRef.current = String(value);
    (async () => {
      let row: any = null;
      try {
        row = await api.get<any>(recurso, String(value));
      } catch {
        // No se pudo resolver (borrado, sin permiso, 500…): se mostrará el id crudo, sin romper.
      }
      if (pedidoRef.current !== String(value)) return; // el valor cambió mientras tanto
      setSel(row?.id ? row : { id: value });
    })();
  }, [value, opciones, recurso, sel]);

  // Fuera del foco, el texto visible siempre refleja la selección.
  useEffect(() => {
    if (!enfocado) setTexto(sel ? etiqueta(sel) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, enfocado]);

  // Mantiene visible la opción activa al navegar con el teclado.
  useEffect(() => {
    if (!abierto || activo < 0) return;
    listaRef.current?.querySelector<HTMLElement>(`[data-i="${activo}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activo, abierto]);

  const visibles = excluirId ? opciones.filter((o) => String(o.id) !== String(excluirId)) : opciones;

  function elegir(row: any) {
    pedidoRef.current = String(row.id);
    setSel(row);
    onChange(String(row.id));
    setTexto(etiqueta(row));
    setQuery("");
    setAbierto(false);
    setActivo(-1);
  }

  function limpiar() {
    pedidoRef.current = null;
    setSel(null);
    onChange("");
    setTexto("");
    setQuery("");
    setActivo(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setAbierto(true);
      setActivo((i) => Math.min(i + 1, visibles.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActivo((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (abierto && activo >= 0 && visibles[activo]) {
        e.preventDefault(); // no enviar el formulario: Enter aquí selecciona
        elegir(visibles[activo]);
      }
    } else if (e.key === "Escape") {
      setAbierto(false);
      setActivo(-1);
    }
  }

  // Degradación: si el catálogo no carga, el campo sigue siendo utilizable como texto.
  if (caido) {
    return (
      <>
        <input
          id={inputId}
          type="text"
          required={campo.requerido}
          disabled={disabled}
          value={value ?? ""}
          placeholder="Catálogo no disponible — id (uuid)"
          onChange={(e) => onChange(e.target.value)}
        />
        <small style={{ color: "var(--muted)", fontSize: 10, marginTop: 2 }}>
          No se pudieron cargar las opciones de «{recurso}».
        </small>
      </>
    );
  }

  const sinSeleccion = !value;
  return (
    <div style={{ position: "relative" }}>
      <input
        id={inputId}
        type="text"
        role="combobox"
        aria-expanded={abierto}
        aria-controls={listaId}
        aria-autocomplete="list"
        aria-activedescendant={abierto && activo >= 0 ? `${listaId}-${activo}` : undefined}
        autoComplete="off"
        required={campo.requerido}
        disabled={disabled}
        placeholder={cargando && !opciones.length ? "Cargando…" : "Buscar…"}
        value={texto}
        style={{ width: "100%", paddingRight: 26 }}
        onFocus={(e) => {
          setEnfocado(true);
          setAbierto(true);
          // Con una selección ya hecha, el texto es su etiqueta: se selecciona entera
          // para que al teclear se reemplace en vez de concatenarse a la etiqueta.
          e.target.select();
        }}
        onBlur={() => {
          setEnfocado(false);
          setAbierto(false);
          setActivo(-1);
        }}
        onKeyDown={onKeyDown}
        onChange={(e) => {
          setTexto(e.target.value);
          setQuery(e.target.value);
          setAbierto(true);
          setActivo(-1);
        }}
      />
      {!disabled && !sinSeleccion && (
        <button
          type="button"
          aria-label={`Quitar ${campo.label}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={limpiar}
          style={{
            position: "absolute", right: 4, top: 4, border: "none", background: "none",
            cursor: "pointer", color: "var(--muted)", fontSize: 13, lineHeight: 1, padding: "2px 4px",
          }}
        >
          ✕
        </button>
      )}
      {abierto && (
        <ul
          id={listaId}
          ref={listaRef}
          role="listbox"
          style={{
            position: "absolute", zIndex: 20, top: "100%", left: 0, right: 0, marginTop: 2,
            maxHeight: 220, overflowY: "auto", listStyle: "none", padding: 4, background: "var(--panel, #fff)",
            border: "1px solid var(--line)", borderRadius: 5, boxShadow: "0 6px 18px rgba(24,33,47,.14)",
          }}
        >
          {cargando && (
            <li style={{ padding: "6px 8px", fontSize: 12, color: "var(--muted)" }}>Cargando…</li>
          )}
          {!cargando && visibles.length === 0 && (
            <li style={{ padding: "6px 8px", fontSize: 12, color: "var(--muted)" }}>Sin coincidencias</li>
          )}
          {visibles.map((o, i) => {
            const seleccionada = String(o.id) === String(value);
            return (
              <li
                key={String(o.id)}
                id={`${listaId}-${i}`}
                data-i={i}
                role="option"
                aria-selected={seleccionada}
                onMouseEnter={() => setActivo(i)}
                onMouseDown={(e) => e.preventDefault()} // conserva el foco del input
                onClick={() => elegir(o)}
                style={{
                  padding: "5px 8px", fontSize: 12.5, borderRadius: 4, cursor: "pointer",
                  background: i === activo ? "rgba(0,140,158,.12)" : "transparent",
                  fontWeight: seleccionada ? 600 : 400,
                }}
              >
                {etiqueta(o)}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
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
  const formId = useId();

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

  /**
   * Las FK vacías se omiten del payload: el backend las valida como
   * `z.string().uuid().optional()`, que rechaza "" y no admite null.
   */
  function normalizarRefs(data: Record<string, any>) {
    const out = { ...data };
    for (const c of campos ?? []) {
      if (c.tipo === "ref" && (out[c.campo] === "" || out[c.campo] == null)) delete out[c.campo];
    }
    return out;
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    try {
      const base = normalizarRefs(form);
      const payload = prepararCrear ? prepararCrear(base) : base;
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
              const inputId = `${formId}-${c.campo}`;
              return (
                <div key={c.campo} className="field">
                  <label htmlFor={inputId}>{c.label}{c.requerido && <span className="req"> *</span>}</label>
                  {c.tipo === "ref" && c.refRecurso ? (
                    <RefField
                      campo={c}
                      inputId={inputId}
                      value={form[c.campo] ?? ""}
                      disabled={deshabilitado}
                      // auto-referencia (p. ej. tipo de muestra padre): no puede apuntarse a sí mismo
                      excluirId={c.refRecurso === recurso ? editId : null}
                      onChange={(v) => setForm({ ...form, [c.campo]: v })}
                    />
                  ) : c.tipo === "select" ? (
                    <select id={inputId} required={c.requerido} disabled={deshabilitado} value={form[c.campo] ?? ""} onChange={(e) => setForm({ ...form, [c.campo]: e.target.value })}>
                      <option value="">—</option>
                      {c.opciones?.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input id={inputId} type={c.tipo ?? "text"} required={c.requerido} disabled={deshabilitado}
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
