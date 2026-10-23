"use client";

/**
 * Parámetros de la operación (entrega R1): circuito y numeración de la
 * cotización, encuestas, cierre de Metrología, recepción (producto obligatorio,
 * Nº interno, retención y campos propios de cada laboratorio) y equipo en la
 * captura. Se ve el VALOR vigente de cada uno; quien administra los parámetros
 * con alcance global (Calidad, Administración) lo cambia con un formulario
 * según su tipo y un motivo, y cada cambio queda en el historial. El resto,
 * solo lectura. Mismo patrón que «Porcentajes de la tasa de internación».
 *
 * Frente r2a: formulario especializado por método o laboratorio («variante»),
 * tablas (amenazas del LRB, HCP por tipo de vehículo, planes RSA, rangos
 * sensoriales) y campos de la preparación de muestras («campo_prep»).
 *
 * API: GET /parametros/configurables · PUT /parametros/configurables/:categoria/:codigo
 *      POST /parametros/configurables/:categoria (alta por laboratorio, método o plantilla)
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { llamar } from "@/lib/laboratorio";
import { fechaHora } from "@/lib/format";
import { toast } from "@/components/ui/feedback";
import EditorTabla, { type ColumnaTabla } from "./EditorTabla";

type Tipo = "entero" | "porcentaje" | "sino" | "opcion" | "multiple" | "formato" | "obligatorio" | "campo" | "variante" | "tabla" | "campo_prep";
interface Opcion { valor: string; etiqueta: string }
interface Def { tipo: Tipo; ayuda: string | null; min: number | null; max: number | null; unidad: string | null; opciones: Opcion[] | null; porDefecto: string | null; columnas?: ColumnaTabla[] | null; maxFilas?: number | null }
interface DefCampo { tipo: string; obligatorio: boolean; opciones: Opcion[]; ayuda: string; activo: boolean; bloquea?: boolean; unidad?: string }
interface Variante { variante: string; activo: boolean }
type Alta = "laboratorio" | "campo" | "metodo" | "plantilla";
interface Parametro {
  id?: string; categoria?: string; codigo: string; nombre: string; def?: Def; valor?: any; texto?: string;
  activo?: boolean; laboratorio?: string | null; updatedAt?: string | null; falta?: boolean;
}
interface Grupo {
  categoria: string; titulo: string; donde: string; porConfirmar: string | null; alta: Alta | null; parametros: Parametro[];
  patron?: { tipo: Tipo; opciones: Opcion[] | null; columnas: ColumnaTabla[] | null; maxFilas: number | null; nombre: string } | null;
}
interface Cambio { id: string; grupo: string; parametro: string; antes: string; despues: string; motivo: string; createdAt: string; usuarioNombre: string | null }
interface Datos { puedeEditar: boolean; grupos: Grupo[]; laboratorios: { codigo: string; nombre: string }[]; historial: Cambio[] }

const TIPOS_CAMPO: Opcion[] = [
  { valor: "texto", etiqueta: "Texto" },
  { valor: "numero", etiqueta: "Número" },
  { valor: "entero", etiqueta: "Número entero" },
  { valor: "fecha", etiqueta: "Fecha" },
  { valor: "lista", etiqueta: "Lista de opciones" },
  { valor: "casilla", etiqueta: "Casilla (sí / no)" },
];
const CAMPO_VACIO: DefCampo = { tipo: "texto", obligatorio: false, opciones: [], ayuda: "", activo: true };
const TIPOS_CAMPO_PREP: Opcion[] = [...TIPOS_CAMPO, { valor: "fechahora", etiqueta: "Fecha y hora" }, { valor: "equipo", etiqueta: "Equipo del laboratorio" }];

/** Lo que se edita: un valor simple, la definición de un campo, una variante o las filas de una tabla. */
type Borrador = string | boolean | string[] | DefCampo | Variante | Record<string, unknown>[];

function borradorDe(p: Parametro): Borrador {
  const t = p.def!.tipo;
  if (t === "entero") return p.valor == null ? "" : String(p.valor);
  if (t === "porcentaje") return p.valor == null ? "" : Number(p.valor).toLocaleString("es-CL", { maximumFractionDigits: 4, useGrouping: false });
  if (t === "sino" || t === "obligatorio") return Boolean(p.valor);
  if (t === "multiple") return Array.isArray(p.valor) ? p.valor : [];
  if (t === "campo" || t === "campo_prep") return { ...CAMPO_VACIO, ...(p.valor ?? {}), opciones: [...(p.valor?.opciones ?? [])] };
  if (t === "variante") return { variante: p.valor?.variante ?? "estandar", activo: p.valor?.activo !== false };
  if (t === "tabla") return Array.isArray(p.valor) ? p.valor.map((x: any) => ({ ...x })) : [];
  return String(p.valor ?? "");
}

/** Ejemplo del formato de número de la cotización (el servidor valida). */
function ejemplo(formato: string, digitos: number) {
  if (!formato.includes("{N}")) return null;
  return formato.replace(/\{AAAA\}/g, String(new Date().getFullYear())).replace(/\{N\}/g, "1".padStart(Math.max(1, Math.min(10, digitos || 1)), "0"));
}

const TEXTO_ALTA: Record<Alta, string> = { laboratorio: "＋ Añadir laboratorio", campo: "＋ Añadir campo", metodo: "＋ Añadir método", plantilla: "＋ Añadir plantilla" };
const COLUMNA_ALTA: Record<Alta, string> = { laboratorio: "Laboratorio", campo: "Laboratorio", metodo: "Método", plantilla: "Código" };
/** Nombre de la regla en las filas por patrón (el de producto obligatorio es el de siempre). */
function nombreFila(g: Grupo, p: Parametro): string {
  if (p.def?.tipo === "obligatorio") return g.categoria === "preparacion_obligatoria" ? "Preparación obligatoria antes de capturar" : "Producto obligatorio al recepcionar";
  return p.nombre;
}

export default function ParametrosOperacion() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState("");
  const [editando, setEditando] = useState<Parametro | null>(null);
  const [alta, setAlta] = useState<Grupo | null>(null);
  const [verHistorial, setVerHistorial] = useState(false);
  const [labCampos, setLabCampos] = useState("");

  const cargar = useCallback(async () => {
    try {
      setDatos(await llamar<Datos>("GET", "/parametros/configurables"));
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }, []);
  useEffect(() => {
    cargar();
  }, [cargar]);

  const digitos = useMemo(() => {
    const p = datos?.grupos.find((g) => g.categoria === "numeracion_cotizacion")?.parametros.find((x) => x.codigo === "digitos");
    return Number(p?.valor ?? 5);
  }, [datos]);

  if (error) return <div className="alert warn" role="alert">Parámetros de la operación: {error}</div>;
  if (!datos) return <div className="card" style={{ padding: 14 }}><p className="subtitle" style={{ margin: 0 }}>Cargando los parámetros de la operación…</p></div>;

  const editable = datos.puedeEditar;
  const listo = async (msg: string) => {
    toast.ok(msg);
    setEditando(null);
    setAlta(null);
    await cargar();
  };

  return (
    <section className="card" style={{ padding: 14 }} aria-labelledby="pop-titulo" id="parametros-operacion">
      <h2 id="pop-titulo" style={{ fontSize: 15, margin: "0 0 4px" }}>Parámetros de la operación</h2>
      <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 12px", maxWidth: 820 }}>
        Reglas del circuito que el IDIC puede ajustar sin intervención técnica. Un cambio rige desde ese momento; lo ya registrado no cambia.
        {editable
          ? " Cada cambio pide motivo y queda en el historial (quién, cuándo, antes y después)."
          : " Solo lectura: los cambian Calidad o Administración."}
      </p>

      {datos.grupos.map((g) => {
        const filas = g.alta === "campo" && labCampos ? g.parametros.filter((p) => p.laboratorio === labCampos) : g.parametros;
        const labsCampos = g.alta === "campo" ? [...new Set(g.parametros.map((p) => p.laboratorio).filter(Boolean) as string[])] : [];
        return (
          <section key={g.categoria} aria-labelledby={`g-${g.categoria}`} style={{ borderTop: "1px solid var(--line)", padding: "12px 0 6px" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", justifyContent: "space-between" }}>
              <h3 id={`g-${g.categoria}`} style={{ fontSize: 13.5, margin: 0 }}>{g.titulo}</h3>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {g.alta === "campo" && (
                  <label style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}>
                    Laboratorio
                    <select value={labCampos} onChange={(e) => setLabCampos(e.target.value)} aria-label="Filtrar los campos por laboratorio">
                      <option value="">Todos</option>
                      {labsCampos.map((l) => <option key={l} value={l}>{l}</option>)}
                    </select>
                  </label>
                )}
                {editable && g.alta && (
                  <button type="button" className="btn outline sm" onClick={() => { setAlta(g); setEditando(null); }}>
                    {TEXTO_ALTA[g.alta]}
                  </button>
                )}
              </div>
            </div>
            <p style={{ fontSize: 12, color: "var(--muted)", margin: "2px 0 8px" }}>
              Dónde rige: {g.donde}
              {g.porConfirmar && <> <span className="pill amber" title="Valor por defecto a la espera de la confirmación del IDIC">Por confirmar</span> {g.porConfirmar}</>}
            </p>
            {alta?.categoria === g.categoria && (
              <FormAlta grupo={g} laboratorios={datos.laboratorios} onCancelar={() => setAlta(null)} onListo={listo} />
            )}
            {filas.length === 0 ? (
              <p className="subtitle" style={{ margin: "0 0 6px" }}>Sin parámetros en esta instalación.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
              <table className="data">
                <thead>
                  <tr>
                    {g.alta ? <th style={{ width: 90 }}>{COLUMNA_ALTA[g.alta]}</th> : null}
                    <th>{g.alta === "laboratorio" ? "Regla" : "Parámetro"}</th>
                    <th style={{ width: "30%" }}>Valor vigente</th>
                    {g.alta === "campo" && <th>Estado</th>}
                    <th style={{ width: 150 }}>Último cambio</th>
                    {editable && <th style={{ width: 90 }} />}
                  </tr>
                </thead>
                <tbody>
                  {filas.map((p) => (
                    <Fragment key={p.codigo}>
                      <tr>
                        {g.alta ? <td><b>{g.alta === "metodo" || g.alta === "plantilla" ? p.codigo : p.laboratorio}</b></td> : null}
                        <td>
                          {nombreFila(g, p)}
                          {p.def?.ayuda && g.alta !== "laboratorio" && <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{p.def.ayuda}</div>}
                          {g.alta === "campo" && <div style={{ fontSize: 11, color: "var(--muted)" }}><code>{p.codigo}</code></div>}
                        </td>
                        <td style={{ fontWeight: 600 }}>
                          {p.falta ? <span className="pill amber">Falta en esta instalación</span> : p.texto}
                          {g.categoria === "numeracion_cotizacion" && p.codigo === "formato" && typeof p.valor === "string" && ejemplo(p.valor, digitos) && (
                            <div style={{ fontSize: 11.5, fontWeight: 400, color: "var(--muted)" }}>Ejemplo: {ejemplo(p.valor, digitos)}</div>
                          )}
                        </td>
                        {g.alta === "campo" && <td>{p.activo ? <span className="pill green">Activo</span> : <span className="pill gray">Inactivo</span>}</td>}
                        <td style={{ fontSize: 12 }}>{p.updatedAt ? fechaHora(p.updatedAt) : "—"}</td>
                        {editable && (
                          <td style={{ textAlign: "right" }}>
                            {!p.falta && (
                              <button type="button" className="btn outline sm" aria-expanded={editando?.id === p.id}
                                aria-label={`Cambiar ${g.alta === "laboratorio" ? `${p.laboratorio}: ${nombreFila(g, p)}` : g.alta === "metodo" || g.alta === "plantilla" ? `${p.codigo}: ${p.nombre}` : p.nombre}`}
                                onClick={() => { setEditando(editando?.id === p.id ? null : p); setAlta(null); }}>
                                {editando?.id === p.id ? "Cerrar" : "Cambiar"}
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                      {editable && editando?.id === p.id && (
                        <tr>
                          <td colSpan={6} style={{ background: "var(--panel-2, #f8fbfc)" }}>
                            <FormCambio p={p} digitos={digitos} onCancelar={() => setEditando(null)} onListo={listo} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </section>
        );
      })}

      <div style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}>
        <button type="button" className="btn outline sm" aria-expanded={verHistorial} onClick={() => setVerHistorial((x) => !x)}>
          {verHistorial ? "Ocultar historial" : `Historial de cambios (${datos.historial.length})`}
        </button>
        {verHistorial && (
          datos.historial.length === 0 ? (
            <p className="subtitle" style={{ margin: "8px 0 0" }}>Sin cambios registrados: rigen los valores de la instalación.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
            <table className="data" style={{ marginTop: 8 }}>
              <thead><tr><th>Fecha</th><th>Quién</th><th>Parámetro</th><th>Antes</th><th>Después</th><th>Motivo</th></tr></thead>
              <tbody>
                {datos.historial.map((h) => (
                  <tr key={h.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{fechaHora(h.createdAt)}</td>
                    <td>{h.usuarioNombre ?? "—"}</td>
                    <td>{h.grupo} · {h.parametro}</td>
                    <td>{h.antes}</td>
                    <td>{h.despues}</td>
                    <td>{h.motivo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ formularios --- */

function valorParaEnviar(tipo: Tipo, b: Borrador): unknown {
  if (tipo === "entero") return String(b).trim();
  if (tipo === "porcentaje") return String(b).trim().replace(/\s*%$/, "");
  return b;
}

/** Cambiar el valor de un parámetro: un campo según su tipo + motivo. */
function FormCambio({ p, digitos, onCancelar, onListo }: { p: Parametro; digitos: number; onCancelar: () => void; onListo: (m: string) => Promise<void> }) {
  const def = p.def!;
  const [b, setB] = useState<Borrador>(() => borradorDe(p));
  const [motivo, setMotivo] = useState("");
  const [err, setErr] = useState("");
  const [guardando, setGuardando] = useState(false);
  const id = `pop-${p.categoria}-${p.codigo}`.replace(/[^a-zA-Z0-9_-]/g, "_");

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (motivo.trim().length < 5) { setErr("Indique el motivo del cambio (mínimo 5 caracteres)."); return; }
    setGuardando(true);
    setErr("");
    try {
      const r = await llamar<{ despues: string }>("PUT", `/parametros/configurables/${encodeURIComponent(p.categoria!)}/${encodeURIComponent(p.codigo)}`, {
        valor: valorParaEnviar(def.tipo, b),
        motivo: motivo.trim(),
      });
      await onListo(`${p.nombre}: ${r.despues}.`);
    } catch (x: any) {
      setErr(x.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} style={{ display: "grid", gap: 10, padding: "6px 2px" }} aria-label={`Cambiar ${p.nombre}`}>
      <EditorValor id={id} def={def} b={b} setB={setB} digitos={digitos} codigo={p.codigo} />
      <div className="field" style={{ maxWidth: 560 }}>
        <label htmlFor={`${id}-motivo`}>Motivo del cambio <span className="req">*</span></label>
        <input id={`${id}-motivo`} value={motivo} maxLength={500} onChange={(e) => setMotivo(e.target.value)} />
      </div>
      {err && <div className="alert warn" role="alert" style={{ margin: 0 }}>{err}</div>}
      <div className="toolbar" style={{ margin: 0 }}>
        <button type="button" className="btn outline sm" onClick={onCancelar}>Cancelar</button>
        <button type="submit" className="btn primary sm" disabled={guardando}>{guardando ? "Guardando…" : "Guardar cambio"}</button>
      </div>
    </form>
  );
}

/** Alta de un laboratorio (producto obligatorio) o de un campo propio de la recepción. */
function FormAlta({ grupo, laboratorios, onCancelar, onListo }: {
  grupo: Grupo; laboratorios: { codigo: string; nombre: string }[]; onCancelar: () => void; onListo: (m: string) => Promise<void>;
}) {
  const esCampo = grupo.alta === "campo";
  const porCodigo = grupo.alta === "metodo" || grupo.alta === "plantilla";
  const yaEstan = new Set(grupo.parametros.map((p) => p.laboratorio));
  const opcionesLab = esCampo ? laboratorios : laboratorios.filter((l) => !yaEstan.has(l.codigo));
  const tipo: Tipo = grupo.patron?.tipo ?? (esCampo ? "campo" : "obligatorio");
  const [lab, setLab] = useState("");
  const [codigo, setCodigo] = useState("");
  const [campo, setCampo] = useState("");
  const [etiqueta, setEtiqueta] = useState("");
  const [b, setB] = useState<Borrador>(
    tipo === "campo" || tipo === "campo_prep" ? { ...CAMPO_VACIO } : tipo === "variante" ? { variante: grupo.patron?.opciones?.[1]?.valor ?? "estandar", activo: true } : tipo === "tabla" ? [] : true,
  );
  const [motivo, setMotivo] = useState("");
  const [err, setErr] = useState("");
  const [guardando, setGuardando] = useState(false);
  const id = `alta-${grupo.categoria}`;
  const def: Def = { tipo, ayuda: null, min: null, max: null, unidad: null, opciones: grupo.patron?.opciones ?? null, porDefecto: null, columnas: grupo.patron?.columnas ?? null, maxFilas: grupo.patron?.maxFilas ?? null };

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!porCodigo && !lab) { setErr("Elija el laboratorio."); return; }
    if (porCodigo && !codigo.trim()) { setErr(grupo.alta === "metodo" ? "Indique el código del método del catálogo." : "Indique el código de la plantilla."); return; }
    if (grupo.alta === "plantilla" && !etiqueta.trim()) { setErr("Indique el nombre visible de la plantilla."); return; }
    if (esCampo && (!/^[a-z][a-z0-9_]{0,39}$/.test(campo) || !etiqueta.trim())) {
      setErr("Indique el código del campo (minúsculas, sin espacios ni tildes, p. ej. lote_proveedor) y su nombre visible.");
      return;
    }
    if (motivo.trim().length < 5) { setErr("Indique el motivo (mínimo 5 caracteres)."); return; }
    setGuardando(true);
    setErr("");
    try {
      await llamar("POST", `/parametros/configurables/${grupo.categoria}`, {
        ...(porCodigo ? { codigo: codigo.trim().toUpperCase() } : { laboratorio: lab }),
        ...(esCampo ? { campo, etiqueta: etiqueta.trim() } : grupo.alta === "plantilla" ? { etiqueta: etiqueta.trim() } : {}),
        valor: b, motivo: motivo.trim(),
      });
      await onListo(esCampo ? `Campo «${etiqueta.trim()}» añadido a ${lab}.` : porCodigo ? `${codigo.trim().toUpperCase()}: añadido.` : `${lab}: regla añadida.`);
    } catch (x: any) {
      setErr(x.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} style={{ display: "grid", gap: 10, border: "1px dashed var(--line)", borderRadius: 8, padding: 10, marginBottom: 10 }}
      aria-label={esCampo ? "Añadir un campo" : grupo.alta === "metodo" ? "Añadir un método" : grupo.alta === "plantilla" ? "Añadir una plantilla" : "Añadir un laboratorio"}>
      <div className="form-grid cols-3" style={{ margin: 0 }}>
        {porCodigo ? (
          <div className="field">
            <label htmlFor={`${id}-codigo`}>{grupo.alta === "metodo" ? "Código del método del catálogo" : "Código de la plantilla"} <span className="req">*</span></label>
            <input id={`${id}-codigo`} value={codigo} maxLength={30} onChange={(e) => setCodigo(e.target.value)} placeholder={grupo.alta === "metodo" ? "p. ej. 3376" : "p. ej. REMOLQUE"} />
          </div>
        ) : (
          <div className="field">
            <label htmlFor={`${id}-lab`}>Laboratorio <span className="req">*</span></label>
            <select id={`${id}-lab`} value={lab} onChange={(e) => setLab(e.target.value)}>
              <option value="">Elegir…</option>
              {opcionesLab.map((l) => <option key={l.codigo} value={l.codigo}>{l.codigo} · {l.nombre}</option>)}
            </select>
          </div>
        )}
        {grupo.alta === "plantilla" && (
          <div className="field span-2">
            <label htmlFor={`${id}-et`}>Nombre visible <span className="req">*</span></label>
            <input id={`${id}-et`} value={etiqueta} maxLength={160} onChange={(e) => setEtiqueta(e.target.value)} />
          </div>
        )}
        {esCampo && (
          <>
            <div className="field">
              <label htmlFor={`${id}-cod`}>Código del campo <span className="req">*</span></label>
              <input id={`${id}-cod`} value={campo} maxLength={40} onChange={(e) => setCampo(e.target.value)} aria-describedby={`${id}-cod-ayuda`} />
              <small id={`${id}-cod-ayuda`} style={{ color: "var(--muted)" }}>Minúsculas y guion bajo; no cambia después.</small>
            </div>
            <div className="field">
              <label htmlFor={`${id}-et`}>Nombre visible <span className="req">*</span></label>
              <input id={`${id}-et`} value={etiqueta} maxLength={160} onChange={(e) => setEtiqueta(e.target.value)} />
            </div>
          </>
        )}
      </div>
      <EditorValor id={id} def={def} b={b} setB={setB} digitos={0} codigo={`${lab}.${campo}`} />
      <div className="field" style={{ maxWidth: 560 }}>
        <label htmlFor={`${id}-motivo`}>Motivo <span className="req">*</span></label>
        <input id={`${id}-motivo`} value={motivo} maxLength={500} onChange={(e) => setMotivo(e.target.value)} />
      </div>
      {err && <div className="alert warn" role="alert" style={{ margin: 0 }}>{err}</div>}
      <div className="toolbar" style={{ margin: 0 }}>
        <button type="button" className="btn outline sm" onClick={onCancelar}>Cancelar</button>
        <button type="submit" className="btn primary sm" disabled={guardando}>{guardando ? "Guardando…" : TEXTO_ALTA[grupo.alta ?? "laboratorio"].replace("＋ ", "")}</button>
      </div>
    </form>
  );
}

/** Un campo por clave según el tipo del parámetro (nunca JSON en crudo). */
function EditorValor({ id, def, b, setB, digitos, codigo }: {
  id: string; def: Def; b: Borrador; setB: (b: Borrador) => void; digitos: number; codigo: string;
}) {
  const rango = def.min != null && def.max != null ? `Entre ${def.min.toLocaleString("es-CL")} y ${def.max.toLocaleString("es-CL")}${def.unidad ? ` ${def.unidad}` : ""}.` : "";
  switch (def.tipo) {
    case "entero":
    case "porcentaje":
      return (
        <div className="field" style={{ maxWidth: 260 }}>
          <label htmlFor={`${id}-v`}>Nuevo valor{def.tipo === "porcentaje" ? " (%)" : def.unidad ? ` (${def.unidad})` : ""} <span className="req">*</span></label>
          <input id={`${id}-v`} inputMode={def.tipo === "porcentaje" ? "decimal" : "numeric"} value={String(b)} onChange={(e) => setB(e.target.value)} aria-describedby={`${id}-v-ayuda`} autoFocus />
          <small id={`${id}-v-ayuda`} style={{ color: "var(--muted)" }}>{def.tipo === "porcentaje" ? "Entre 0 y 100, con coma decimal (p. ej. 12,5)." : rango}</small>
        </div>
      );
    case "sino":
    case "obligatorio":
      return (
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{def.tipo === "obligatorio" ? "¿Producto obligatorio al recepcionar?" : "Nuevo valor"}</legend>
          <div style={{ display: "flex", gap: 16 }}>
            {[true, false].map((v) => (
              <label key={String(v)} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
                <input type="radio" name={`${id}-sn`} checked={b === v} onChange={() => setB(v)} /> {v ? "Sí" : "No"}
              </label>
            ))}
          </div>
        </fieldset>
      );
    case "opcion":
      return (
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Nuevo valor</legend>
          <div style={{ display: "grid", gap: 4 }}>
            {(def.opciones ?? []).map((o) => (
              <label key={o.valor} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
                <input type="radio" name={`${id}-op`} checked={b === o.valor} onChange={() => setB(o.valor)} /> {o.etiqueta}
              </label>
            ))}
          </div>
        </fieldset>
      );
    case "multiple": {
      const marcados = (Array.isArray(b) ? b : []) as string[];
      return (
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Marque los que correspondan</legend>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 4 }}>
            {(def.opciones ?? []).map((o) => (
              <label key={o.valor} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
                <input type="checkbox" checked={marcados.includes(o.valor)}
                  onChange={(e) => setB(e.target.checked ? [...marcados, o.valor] : marcados.filter((x) => x !== o.valor))} /> {o.etiqueta}
              </label>
            ))}
          </div>
        </fieldset>
      );
    }
    case "formato": {
      const ej = ejemplo(String(b), digitos);
      return (
        <div className="field" style={{ maxWidth: 360 }}>
          <label htmlFor={`${id}-v`}>Nuevo formato <span className="req">*</span></label>
          <input id={`${id}-v`} value={String(b)} maxLength={40} onChange={(e) => setB(e.target.value)} aria-describedby={`${id}-v-ayuda`}
            style={{ fontFamily: "'JetBrains Mono', monospace" }} autoFocus />
          <small id={`${id}-v-ayuda`} style={{ color: ej ? "var(--muted)" : "var(--red)" }}>
            {ej ? `Primer número con este formato: ${ej}.` : "Debe contener {N} (el correlativo). {AAAA} = año."}
          </small>
        </div>
      );
    }
    case "campo":
      return <EditorCampo id={id} c={b as DefCampo} setC={setB} esDestino={codigo.endsWith(".clase_custodia")} />;
    case "campo_prep":
      return <EditorCampo id={id} c={b as DefCampo} setC={setB} esDestino={false} preparacion />;
    case "variante": {
      const v = b as Variante;
      return (
        <div style={{ display: "grid", gap: 8 }}>
          <div className="field" style={{ maxWidth: 520 }}>
            <label htmlFor={`${id}-var`}>Formulario de captura <span className="req">*</span></label>
            <select id={`${id}-var`} value={v.variante} onChange={(e) => setB({ ...v, variante: e.target.value })} autoFocus>
              {(def.opciones ?? []).map((o) => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}
            </select>
          </div>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
            <input type="checkbox" checked={v.activo} onChange={(e) => setB({ ...v, activo: e.target.checked })} /> Activa (si no, rige la captura estándar)
          </label>
        </div>
      );
    }
    case "tabla":
      return <EditorTabla id={id} columnas={def.columnas ?? []} maxFilas={def.maxFilas ?? 200} filas={b as Record<string, unknown>[]} onCambio={setB} />;
  }
}

/** Definición de un campo de recepción: tipo, obligatorio, activo, ayuda y opciones. */
function EditorCampo({ id, c, setC, esDestino, preparacion }: { id: string; c: DefCampo; setC: (c: DefCampo) => void; esDestino: boolean; preparacion?: boolean }) {
  const set = (cambios: Partial<DefCampo>) => setC({ ...c, ...cambios });
  const opcion = (i: number, cambios: Partial<Opcion>) => set({ opciones: c.opciones.map((o, j) => (j === i ? { ...o, ...cambios } : o)) });
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div className="form-grid cols-3" style={{ margin: 0 }}>
        <div className="field">
          <label htmlFor={`${id}-tipo`}>Tipo de dato <span className="req">*</span></label>
          <select id={`${id}-tipo`} value={c.tipo} onChange={(e) => set({ tipo: e.target.value })} disabled={esDestino}>
            {(preparacion ? TIPOS_CAMPO_PREP : TIPOS_CAMPO).map((t) => <option key={t.valor} value={t.valor}>{t.etiqueta}</option>)}
          </select>
        </div>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, alignSelf: "end", paddingBottom: 6 }}>
          <input type="checkbox" checked={c.obligatorio} onChange={(e) => set({ obligatorio: e.target.checked })} /> {preparacion ? "Obligatorio al preparar" : "Obligatorio al recibir"}
        </label>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, alignSelf: "end", paddingBottom: 6 }}>
          <input type="checkbox" checked={c.activo} onChange={(e) => set({ activo: e.target.checked })} /> {preparacion ? "Activo (se pide en la preparación)" : "Activo (se pide en la recepción)"}
        </label>
      </div>
      {preparacion && (
        <div className="form-grid cols-3" style={{ margin: 0 }}>
          <label className="span-2" style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
            <input type="checkbox" checked={!!c.bloquea} disabled={!["casilla", "fecha", "equipo"].includes(c.tipo)} onChange={(e) => set({ bloquea: e.target.checked })} /> Bloquea la captura (casilla sin marcar, fecha vencida o equipo no apto)
          </label>
          <div className="field">
            <label htmlFor={`${id}-unidad`}>Unidad</label>
            <input id={`${id}-unidad`} value={c.unidad ?? ""} maxLength={20} onChange={(e) => set({ unidad: e.target.value })} placeholder="g, mL, °C, %…" />
          </div>
        </div>
      )}
      <div className="field">
        <label htmlFor={`${id}-ayuda`}>{preparacion ? "Ayuda para quien prepara" : "Ayuda para quien recibe"}</label>
        <input id={`${id}-ayuda`} value={c.ayuda} maxLength={300} onChange={(e) => set({ ayuda: e.target.value })} />
      </div>
      {c.tipo === "lista" && (
        <fieldset style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "6px 10px", margin: 0 }}>
          <legend style={{ fontSize: 12, fontWeight: 600 }}>Opciones de la lista</legend>
          {esDestino && <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "0 0 6px" }}>Destino de la muestra: los valores solo pueden ser analisis, testigo, custodia o contramuestra; el texto visible es libre.</p>}
          {c.opciones.length === 0 && <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 6px" }}>Sin opciones: añada al menos una.</p>}
          {c.opciones.map((o, i) => (
            <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4, flexWrap: "wrap" }}>
              <input aria-label={`Valor de la opción ${i + 1}`} placeholder="valor" value={o.valor} maxLength={60} onChange={(e) => opcion(i, { valor: e.target.value })} style={{ width: 170 }} />
              <input aria-label={`Texto visible de la opción ${i + 1}`} placeholder="texto visible" value={o.etiqueta} maxLength={120} onChange={(e) => opcion(i, { etiqueta: e.target.value })} style={{ flex: "1 1 200px" }} />
              <button type="button" className="btn outline sm" aria-label={`Quitar la opción ${i + 1}`} onClick={() => set({ opciones: c.opciones.filter((_, j) => j !== i) })}>Quitar</button>
            </div>
          ))}
          <button type="button" className="btn outline sm" onClick={() => set({ opciones: [...c.opciones, { valor: "", etiqueta: "" }] })}>＋ Opción</button>
        </fieldset>
      )}
    </div>
  );
}
