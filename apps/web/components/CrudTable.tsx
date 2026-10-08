"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { api, Paginado } from "@/lib/api";
import { validarFormulario, propsInput, type TipoCampo } from "@/lib/validate";
import { usePermisos } from "@/lib/permisos";
import { permisosDe, type PermisosCrud } from "@/lib/permisosRecurso";
import { toast, confirmar } from "@/components/ui/feedback";
import { PageHeader, EmptyState, SkeletonRows, type Miga } from "@/components/ui/PageHeader";

/** Edición rápida en celda (doble clic → Enter guarda con PATCH {campo: valor}). */
export interface EditableCfg {
  tipo?: "text" | "number" | "select" | "date";
  /** opciones para tipo "select". */
  opciones?: string[];
  requerido?: boolean;
  /** construye el body del PATCH (por defecto `{ [campo]: valor }`). */
  preparar?: (valor: any, row: any) => Record<string, any>;
}

export interface Columna {
  campo: string;
  titulo: string;
  render?: (v: any, row: any) => React.ReactNode;
  /** alinea a la derecha (números). Si se omite, se deduce de los datos. */
  right?: boolean;
  /** habilita la edición rápida en la celda (requiere permiso de editar). */
  editable?: boolean | EditableCfg;
}
export interface CampoForm {
  campo: string;
  label: string;
  // Tipos de validación/formato: text, email, telefono, rut, url, number,
  // entero, moneda, date, password, select, ref. Ver lib/validate.ts.
  tipo?: TipoCampo;
  /** opciones fijas para tipo "select". */
  opciones?: string[];
  /**
   * endpoint (path relativo con query, sin barra inicial) del que cargar las
   * opciones de un "select". El valor guardado es el `codigo` de cada fila (no el
   * id). Uso: parámetros de negocio editables → `parametros?categoria=tipo_cliente&activo=true`.
   */
  opcionesEndpoint?: string;
  /** mapea una fila del endpoint a {value,label}. Por defecto codigo → etiqueta. */
  opcionesMap?: (row: any) => { value: string; label: string };
  /** recurso de la API del que se cargan las opciones cuando tipo === "ref" (p. ej. "clientes", "metodos"). */
  refRecurso?: string;
  /** etiqueta legible de una opción; por defecto código/nombre/razón social. */
  refLabel?: (row: any) => string;
  requerido?: boolean;
  /** si es true, el input se deshabilita en modo edición (p. ej. un código/clave). */
  soloLecturaEnEdicion?: boolean;
  /** texto de ayuda bajo el campo. */
  ayuda?: string;
  /** ancho del campo en la rejilla del formulario. */
  span?: 2 | 3;
}
export interface CrudTableProps {
  recurso: string;
  titulo: string;
  subtitulo?: ReactNode;
  /** migas de pan de la cabecera. */
  migas?: Miga[];
  /** botones extra en la cabecera (junto a «＋ Nuevo»). */
  accionesCabecera?: ReactNode;
  columnas: Columna[];
  /** campos del formulario de ALTA (y de edición si no se pasa `camposEditar`). */
  campos?: CampoForm[];
  /** campos del formulario de EDICIÓN, cuando difieren del alta (p. ej. solo estado/fechas). */
  camposEditar?: CampoForm[];
  /** transforma el form antes de enviar (p. ej. castear números). */
  prepararCrear?: (data: any) => any;
  /** transforma el form de edición antes del PATCH (por defecto `prepararCrear`). */
  prepararActualizar?: (data: any) => any;
  /** mapea una fila al formulario de edición. Por defecto toma de la fila los valores de `camposEditar ?? campos`. */
  prepararEditar?: (row: any) => Record<string, any>;
  /** permisos por verbo; por defecto los del recurso (lib/permisosRecurso.ts). */
  permisos?: PermisosCrud;
  /** fuerza mostrar/ocultar cada acción (se combina con el permiso). */
  permitirCrear?: boolean;
  permitirEditar?: boolean;
  permitirEliminar?: boolean;
  /** botones extra por fila (p. ej. «Anular»). Recibe la fila y una función para recargar. */
  accionesFila?: (row: any, recargar: () => void) => ReactNode;
  /** contenido cuando la lista está vacía (sin búsqueda). */
  vacio?: ReactNode;
  /** filas por página (máx. 100 en el backend). */
  limite?: number;
  /** textos del borrado (p. ej. «Desactivar» cuando el backend solo desactiva). */
  textoEliminar?: { accion?: string; titulo?: string; mensaje?: ReactNode; boton?: string };
  /** nombre legible de la fila para el diálogo de confirmación. */
  etiquetaFila?: (row: any) => string;
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

interface SelectRemotoProps {
  campo: CampoForm;
  inputId: string;
  value: string;
  disabled?: boolean;
  onChange: (v: string) => void;
}

/**
 * Select cuyas opciones se cargan de un endpoint de la API (parámetros de
 * negocio editables). A diferencia de RefField, el valor que viaja al formulario
 * es el `codigo` de la fila (un string estable como "institucional"), no un uuid,
 * porque la columna de negocio guarda ese código. Si el endpoint falla, degrada a
 * input de texto para no bloquear el formulario.
 */
function SelectRemoto({ campo, inputId, value, disabled, onChange }: SelectRemotoProps) {
  const [opciones, setOpciones] = useState<{ value: string; label: string }[]>([]);
  const [caido, setCaido] = useState(false);
  const map = campo.opcionesMap ?? ((r: any) => ({ value: String(r.codigo ?? r.id ?? ""), label: r.etiqueta ?? etiquetaRef(r) }));

  useEffect(() => {
    if (!campo.opcionesEndpoint) return;
    let vivo = true;
    (async () => {
      try {
        const res: any = await api.getRaw(campo.opcionesEndpoint!);
        if (vivo) {
          setOpciones(filasDe(res).map(map));
          setCaido(false);
        }
      } catch {
        if (vivo) {
          setOpciones([]);
          setCaido(true);
        }
      }
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campo.opcionesEndpoint]);

  if (caido) {
    return (
      <>
        <input id={inputId} type="text" required={campo.requerido} disabled={disabled} value={value ?? ""}
          placeholder="Catálogo no disponible — valor" onChange={(e) => onChange(e.target.value)} />
        <small style={{ color: "var(--muted)", fontSize: 10, marginTop: 2 }}>No se pudieron cargar las opciones.</small>
      </>
    );
  }

  return (
    <select id={inputId} required={campo.requerido} disabled={disabled} value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      {opciones.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/** ¿La columna es numérica? Explícito (`right`) o deducido: todos los valores presentes son number. */
function esColumnaNumerica(c: Columna, filas: any[]): boolean {
  if (c.right !== undefined) return c.right;
  let alguno = false;
  for (const f of filas) {
    const v = f?.[c.campo];
    if (v == null || v === "") continue;
    if (typeof v !== "number") return false;
    alguno = true;
  }
  return alguno;
}

/** Configuración normalizada de la edición rápida de una columna. */
function cfgEditable(c: Columna): EditableCfg | null {
  if (!c.editable) return null;
  if (c.editable === true) return { tipo: "text" };
  return c.editable;
}

/**
 * Tabla CRUD genérica: lista paginada + buscador + alta + edición + borrado.
 * Reutilizable por recurso.
 *
 *  · Consciente de permisos: oculta Nuevo / Editar / Eliminar si el usuario no
 *    tiene el permiso que el backend exige para ese verbo (lib/permisosRecurso.ts).
 *    Las props `permitirCrear/Editar/Eliminar` y `permisos` lo sobrescriben.
 *  · Edición rápida: doble clic en una celda `editable` → Enter guarda (PATCH),
 *    Escape cancela.
 *  · Avisos (toast) y confirmación en diálogo propio (no window.confirm).
 */
export default function CrudTable({
  recurso, titulo, subtitulo, migas, accionesCabecera, columnas, campos, camposEditar,
  prepararCrear, prepararEditar, prepararActualizar, permisos, permitirCrear, permitirEditar,
  permitirEliminar, accionesFila, vacio, limite = 20, textoEliminar, etiquetaFila,
}: CrudTableProps) {
  const { puede, listo } = usePermisos();
  const [res, setRes] = useState<Paginado<any> | null>(null);
  const [cargando, setCargando] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [errorForm, setErrorForm] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<Record<string, any>>({});
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [editId, setEditId] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [borrandoId, setBorrandoId] = useState<string | null>(null);
  // edición rápida en celda
  const [celda, setCelda] = useState<{ id: string; campo: string } | null>(null);
  const [valorCelda, setValorCelda] = useState<string>("");
  const [guardandoCelda, setGuardandoCelda] = useState(false);
  const formId = useId();

  // --- permisos efectivos (prop explícita > mapa del recurso > visible) ---
  const perms = permisos ?? permisosDe(recurso) ?? {};
  const permiteVerbo = (explicito: boolean | undefined, perm?: string) =>
    explicito !== undefined ? explicito : listo && (!perm || puede(perm));
  const camposAlta = campos;
  const camposEdicion = camposEditar ?? campos;
  const puedeCrear = !!camposAlta?.length && permiteVerbo(permitirCrear, perms.crear);
  const puedeEditar = !!camposEdicion?.length && permiteVerbo(permitirEditar, perms.editar);
  const puedeEditarCelda = permiteVerbo(permitirEditar, perms.editar);
  // Eliminar se ofrece si hay formulario (comportamiento histórico) o si se pide explícitamente.
  const puedeEliminar = permitirEliminar !== undefined
    ? permitirEliminar && permiteVerbo(undefined, perms.eliminar)
    : !!campos?.length && permiteVerbo(undefined, perms.eliminar);
  const hayAcciones = puedeEditar || puedeEliminar || !!accionesFila;

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r: any = await api.list(recurso, { page, limit: limite, search });
      // Tolera endpoints que devuelven array plano (sin {data, meta}).
      setRes(Array.isArray(r) ? { data: r, meta: { page: 1, limit: r.length, total: r.length, totalPages: 1 } } : r);
      setError("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }, [recurso, page, search, limite]);

  useEffect(() => {
    // Búsqueda con pequeño retardo para no pedir en cada tecla.
    const t = setTimeout(cargar, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [cargar, search]);

  const listaCampos = editId != null ? camposEdicion ?? [] : camposAlta ?? [];

  function abrirCrear() {
    setEditId(null);
    setForm({});
    setErrores({});
    setErrorForm("");
    setShowForm(true);
  }

  function abrirEditar(row: any) {
    const inicial = prepararEditar
      ? prepararEditar(row)
      : (camposEdicion ?? []).reduce((acc, c) => {
          const v = row[c.campo];
          // Las fechas ISO se recortan a AAAA-MM-DD para el <input type="date">.
          acc[c.campo] = c.tipo === "date" && typeof v === "string" ? v.slice(0, 10) : v ?? "";
          return acc;
        }, {} as Record<string, any>);
    setEditId(String(row.id));
    setForm(inicial);
    setErrores({});
    setErrorForm("");
    setShowForm(true);
  }

  function cerrarForm() {
    setShowForm(false);
    setEditId(null);
    setForm({});
    setErrores({});
    setErrorForm("");
  }

  /**
   * Las FK vacías se omiten del payload: el backend las valida como
   * `z.string().uuid().optional()`, que rechaza "" y no admite null.
   */
  function normalizarRefs(data: Record<string, any>) {
    const out = { ...data };
    for (const c of listaCampos) {
      if (c.tipo === "ref" && (out[c.campo] === "" || out[c.campo] == null)) delete out[c.campo];
    }
    return out;
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    // Validación de formato/obligatorios ANTES de llamar al backend.
    const errs = validarFormulario(listaCampos, form);
    setErrores(errs);
    if (Object.keys(errs).length > 0) {
      setErrorForm("Revise los campos marcados en rojo.");
      return;
    }
    setGuardando(true);
    try {
      const base = normalizarRefs(form);
      if (editId != null) {
        const payload = prepararActualizar ? prepararActualizar(base) : prepararCrear ? prepararCrear(base) : base;
        await api.update(recurso, editId, payload);
        toast.ok("Cambios guardados.");
      } else {
        const payload = prepararCrear ? prepararCrear(base) : base;
        await api.create(recurso, payload);
        toast.ok("Registro creado.");
      }
      cerrarForm();
      cargar();
    } catch (e: any) {
      setErrorForm(e.message);
      toast.error(`No se pudo guardar: ${e.message}`);
    } finally {
      setGuardando(false);
    }
  }

  async function eliminar(row: any) {
    const crudo = etiquetaFila ? etiquetaFila(row) : etiquetaRef(row);
    const nombre = crudo && crudo !== String(row.id) ? crudo : "";
    const ok = await confirmar({
      titulo: textoEliminar?.titulo ?? "¿Eliminar este registro?",
      mensaje: (
        <>
          {nombre && <><b>{nombre}</b><br /></>}
          {textoEliminar?.mensaje ?? "El registro dejará de aparecer en las listas. Esta acción no se puede deshacer desde esta pantalla."}
        </>
      ),
      confirmarTexto: textoEliminar?.boton ?? "Eliminar",
      peligro: true,
    });
    if (!ok) return;
    setBorrandoId(String(row.id));
    try {
      await api.remove(recurso, String(row.id));
      // si borramos la fila que se estaba editando, cerramos el form
      if (editId != null && editId === String(row.id)) cerrarForm();
      toast.ok("Registro eliminado.");
      cargar();
    } catch (e: any) {
      toast.error(`No se pudo eliminar: ${e.message}`);
    } finally {
      setBorrandoId(null);
    }
  }

  // --- edición rápida en celda ---------------------------------------------
  function empezarCelda(row: any, c: Columna) {
    if (!puedeEditarCelda || !cfgEditable(c) || guardandoCelda) return;
    setCelda({ id: String(row.id), campo: c.campo });
    const v = row[c.campo];
    setValorCelda(v == null ? "" : String(v));
  }

  async function guardarCelda(row: any, c: Columna) {
    const cfg = cfgEditable(c);
    if (!cfg || !celda) return;
    const original = row[c.campo] == null ? "" : String(row[c.campo]);
    if (valorCelda === original) { setCelda(null); return; }
    let valor: any = valorCelda;
    if (cfg.tipo === "number") {
      const n = Number(String(valorCelda).replace(",", "."));
      if (valorCelda.trim() === "" || Number.isNaN(n)) {
        toast.error(`«${c.titulo}» debe ser un número.`);
        return;
      }
      valor = n;
    }
    if (cfg.requerido && String(valorCelda).trim() === "") {
      toast.error(`«${c.titulo}» es obligatorio.`);
      return;
    }
    setGuardandoCelda(true);
    try {
      const payload = cfg.preparar ? cfg.preparar(valor, row) : { [c.campo]: valor };
      const actualizado: any = await api.update(recurso, String(row.id), payload);
      // Refleja el cambio en la fila sin recargar la página entera.
      setRes((r) => r && {
        ...r,
        data: r.data.map((x) => (String(x.id) === String(row.id)
          ? { ...x, ...(actualizado && typeof actualizado === "object" ? actualizado : {}), [c.campo]: actualizado?.[c.campo] ?? valor }
          : x)),
      });
      setCelda(null);
      toast.ok(`«${c.titulo}» actualizado.`);
    } catch (e: any) {
      toast.error(`No se pudo guardar «${c.titulo}»: ${e.message}`);
    } finally {
      setGuardandoCelda(false);
    }
  }

  function editorCelda(row: any, c: Columna) {
    const cfg = cfgEditable(c)!;
    const comunes = {
      autoFocus: true,
      "aria-label": `Editar ${c.titulo}`,
      disabled: guardandoCelda,
      onBlur: () => !guardandoCelda && setCelda(null),
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === "Enter") { e.preventDefault(); guardarCelda(row, c); }
        if (e.key === "Escape") { e.preventDefault(); setCelda(null); }
      },
    };
    if (cfg.tipo === "select") {
      return (
        <select {...comunes} value={valorCelda} onChange={(e) => setValorCelda(e.target.value)}>
          {!cfg.requerido && <option value="">—</option>}
          {(cfg.opciones ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    }
    return (
      <input
        {...comunes}
        type={cfg.tipo === "number" ? "number" : cfg.tipo === "date" ? "date" : "text"}
        step={cfg.tipo === "number" ? "any" : undefined}
        value={cfg.tipo === "date" ? valorCelda.slice(0, 10) : valorCelda}
        onChange={(e) => setValorCelda(e.target.value)}
      />
    );
  }

  const editando = editId != null;
  const filas = res?.data ?? [];
  const numericas = new Set(columnas.filter((c) => esColumnaNumerica(c, filas)).map((c) => c.campo));
  const nCols = columnas.length + (hayAcciones ? 1 : 0);
  const hayEditables = puedeEditarCelda && columnas.some((c) => cfgEditable(c));

  return (
    <div>
      <PageHeader
        titulo={titulo}
        subtitulo={subtitulo}
        migas={migas}
        acciones={
          <>
            {accionesCabecera}
            {puedeCrear && !showForm && (
              <button type="button" className="btn primary sm" onClick={abrirCrear}>＋ Nuevo</button>
            )}
          </>
        }
      />
      {error && <div className="alert warn">No se pudo cargar la lista: {error}</div>}

      <div className="toolbar">
        <input
          type="search"
          placeholder="Buscar…"
          aria-label={`Buscar en ${typeof titulo === "string" ? titulo : "la lista"}`}
          style={{ flex: 1 }}
          value={search}
          onChange={(e) => { setPage(1); setSearch(e.target.value); }}
        />
        {hayEditables && (
          <span className="subtitle" style={{ margin: 0, fontSize: 11 }} title="Las celdas editables se resaltan al pasar el ratón">
            ✎ Doble clic en una celda resaltada para editarla
          </span>
        )}
      </div>

      {showForm && (
        <form onSubmit={guardar} className="card" aria-label={editando ? "Editar registro" : "Nuevo registro"}>
          <h2>{editando ? "Editar registro" : "Nuevo registro"}</h2>
          {errorForm && <div className="alert warn">{errorForm}</div>}
          <div className="form-grid">
            {listaCampos.map((c) => {
              const deshabilitado = editando && !!c.soloLecturaEnEdicion;
              const inputId = `${formId}-${c.campo}`;
              return (
                <div key={c.campo} className={`field${c.span === 3 ? " span-3" : c.span === 2 ? " span-2" : ""}`}>
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
                  ) : c.tipo === "select" && c.opcionesEndpoint ? (
                    <SelectRemoto
                      campo={c}
                      inputId={inputId}
                      value={form[c.campo] ?? ""}
                      disabled={deshabilitado}
                      onChange={(v) => setForm({ ...form, [c.campo]: v })}
                    />
                  ) : c.tipo === "select" ? (
                    <select id={inputId} required={c.requerido} disabled={deshabilitado} value={form[c.campo] ?? ""} onChange={(e) => setForm({ ...form, [c.campo]: e.target.value })}>
                      <option value="">—</option>
                      {c.opciones?.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : c.tipo === "textarea" ? (
                    <textarea id={inputId} rows={3} required={c.requerido} disabled={deshabilitado}
                      value={form[c.campo] ?? ""} onChange={(e) => setForm({ ...form, [c.campo]: e.target.value })} />
                  ) : (
                    <input
                      id={inputId}
                      {...propsInput(c.tipo)}
                      required={c.requerido}
                      disabled={deshabilitado}
                      aria-invalid={!!errores[c.campo]}
                      value={form[c.campo] ?? ""}
                      onChange={(e) => setForm({ ...form, [c.campo]: e.target.value })}
                    />
                  )}
                  {c.ayuda && <small style={{ color: "var(--muted)", fontSize: 10.5, marginTop: 2 }}>{c.ayuda}</small>}
                  {errores[c.campo] && (
                    <span style={{ color: "var(--danger, #c0392b)", fontSize: 11 }}>{errores[c.campo]}</span>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" className="btn outline sm" onClick={cerrarForm}>Cancelar</button>
            <button className="btn primary sm" disabled={guardando}>
              {guardando ? "Guardando…" : editando ? "Guardar cambios" : "Guardar"}
            </button>
          </div>
        </form>
      )}

      <div className="card card--table">
        <table className="data">
          <thead>
            <tr>
              {columnas.map((c) => (
                <th key={c.campo} className={numericas.has(c.campo) ? "num" : ""}>
                  {c.titulo}
                  {puedeEditarCelda && cfgEditable(c) && <span aria-hidden style={{ marginLeft: 4, opacity: 0.6 }}>✎</span>}
                </th>
              ))}
              {hayAcciones && <th className="num">Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {cargando && !res && <SkeletonRows cols={nCols} />}
            {filas.map((row) => (
              <tr key={row.id}>
                {columnas.map((c) => {
                  const enEdicion = celda?.id === String(row.id) && celda.campo === c.campo;
                  const editable = puedeEditarCelda && !!cfgEditable(c);
                  const cls = [
                    numericas.has(c.campo) ? "num" : "",
                    editable ? "editable" : "",
                    enEdicion ? "editando" : "",
                    enEdicion && guardandoCelda ? "guardando" : "",
                  ].filter(Boolean).join(" ");
                  return (
                    <td
                      key={c.campo}
                      className={cls || undefined}
                      title={editable && !enEdicion ? "Doble clic para editar" : undefined}
                      onDoubleClick={editable && !enEdicion ? () => empezarCelda(row, c) : undefined}
                    >
                      {enEdicion
                        ? editorCelda(row, c)
                        : c.render ? c.render(row[c.campo], row) : (row[c.campo] ?? "—")}
                    </td>
                  );
                })}
                {hayAcciones && (
                  <td className="num">
                    <div style={{ display: "inline-flex", gap: 6, justifyContent: "flex-end" }}>
                      {accionesFila?.(row, cargar)}
                      {puedeEditar && (
                        <button type="button" className="btn outline sm" onClick={() => abrirEditar(row)}>Editar</button>
                      )}
                      {puedeEliminar && (
                        <button type="button" className="btn ghost-danger sm" disabled={borrandoId === String(row.id)} onClick={() => eliminar(row)}>
                          {borrandoId === String(row.id) ? "Eliminando…" : textoEliminar?.accion ?? "Eliminar"}
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {res && filas.length === 0 && (
              <tr>
                <td colSpan={nCols}>
                  {search
                    ? <EmptyState compacto icono="🔍" titulo="Sin resultados" texto={`No hay registros que coincidan con «${search}».`} />
                    : vacio ?? <EmptyState compacto titulo="Aún no hay registros" texto={puedeCrear ? "Usa «＋ Nuevo» para crear el primero." : undefined} />}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {res && res.meta.totalPages > 1 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 12.5 }}>
          <button disabled={page <= 1} className="btn outline sm" onClick={() => setPage((p) => p - 1)}>← Anterior</button>
          <span className="subtitle" style={{ margin: 0 }}>Página {res.meta.page} de {res.meta.totalPages} · {res.meta.total} registros</span>
          <button disabled={page >= res.meta.totalPages} className="btn outline sm" onClick={() => setPage((p) => p + 1)}>Siguiente →</button>
        </div>
      )}
      {res && res.meta.totalPages <= 1 && filas.length > 0 && (
        <div className="subtitle" style={{ marginTop: 8 }}>{res.meta.total} registro(s)</div>
      )}
    </div>
  );
}
