"use client";

/**
 * Muestras de la OT (pestaña del expediente) y «Recepción e identificación de
 * la muestra» (EP-01 §1.3, EP-02 §2.1, EP-03 §1.2, EP-05 §3.1; LME 20-10-2026).
 *
 * · Todos los que ven la OT ven sus muestras, su Nº interno, producto (matriz),
 *   recepción (toma, condición, sellos, destino y datos propios del
 *   laboratorio) y cuántos ensayos tiene cada una.
 * · Quien registra muestras (permiso «muestra.crear»: Recepción, jefaturas,
 *   analistas del laboratorio…) puede «Recepcionar»: indica cuántas llegaron,
 *   su descripción, el producto de cada una (carga el panel de ensayos del
 *   producto), identificación del cliente y sello, los datos de recepción y
 *   marca los métodos que se aplican. Si la OT nació de una cotización, los
 *   ensayos cotizados aparecen ya listados (y marcados cuando el ensayo tiene un
 *   solo método); si no, se proponen los del panel del producto.
 * · «Asignar número» da a cada muestra su Nº de muestra interno (correlativo,
 *   no cambia).
 * · «Recepción…» en cada muestra corrige o completa su recepción y su registro
 *   fotográfico (queda en el historial de la OT con lo anterior y lo nuevo).
 *
 * API: GET /flujo/ot/:id/registro-muestras · POST /flujo/ot/:id/muestras ·
 *      PATCH /flujo/muestras/:id/recepcion · /recepcion/… (productos, panel,
 *      Nº interno)
 */
import MarcarTodos from "@/components/ui/MarcarTodos";
import DistribucionMuestra from "./DistribucionMuestra";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "@/components/ui/feedback";
import { llamar, veredictoInfo } from "@/lib/laboratorio";
import { usePermisos } from "@/lib/permisos";
import { fechaHora } from "@/lib/format";
import { etiquetaClase, fechaDma, textoValor, type ConfigRecepcion, type ProductoLab, type ValorCampo } from "@/lib/recepcion";
import FormRecepcion, { RECEPCION_VACIA, cuerpoRecepcion, faltantesRecepcion, type DatosRecepcion } from "./FormRecepcion";
import FotosRecepcion from "./FotosRecepcion";

interface Metodo { id: string; codigo: string; nombre: string; norma?: string | null; ensayoId?: string | null; analitos: number }
interface Linea {
  lineaId: string; descripcion: string; cantidad: number; ensayoId: string | null; ensayoCodigo: string | null;
  metodos: Metodo[]; sugeridos: string[]; aviso: string | null;
}
interface EnlaceLab { unidadId: string; unidad: { id: string; codigo: string; nombre: string } | null; ordenes: { id: string; numero: string; estado: string }[] }
interface MuestraOt {
  id: string; codigo: string; nombre: string | null; estado: string; veredicto: string | null; ensayos: number; metodos: string[];
  tomaMuestra: string | null; condicionRecepcion: "cumple" | "no_cumple" | null; condicionObservacion: string | null;
  selloNumero: string | null; identificacionCliente: string | null; requiereOtrosLabs: boolean; otrosLabs: string[];
  otrosLabsDetalle: string | null; recepcionadaAt: string | null; recepcionadaPorNombre: string | null;
  recepcionCorregidaAt?: string | null; recepcionCorregidaPorNombre?: string | null;
  recepcionIncompleta: boolean; faltantesRecepcion?: string[]; otrosLabsEnlace: EnlaceLab[];
  numeroInterno: string | null; catElementoId: string | null; productoNombre: string | null; productoCodigo: string | null;
  clienteId: string | null; clienteNombre: string | null; sellosVerificados: boolean | null; claseCustodia: string | null;
  retenerHasta: string | null; ubicacion: string | null; datos: Record<string, ValorCampo> | null; fotosRecepcion: number;
}
interface Propuesta {
  ot: { id: string; codigo: string; estado: string; unidadPrincipal: string | null; clienteId: string | null; clienteNombre: string | null; catElementoId: string | null };
  configRecepcion: ConfigRecepcion;
  cotizacion: { id: string; codigo: string; referencia: string | null } | null;
  muestras: MuestraOt[];
  lineas: Linea[];
  opcionesToma: { codigo: string; etiqueta: string }[];
}
interface FilaRegistro { nombre: string; ident: string; sello: string; productoId: string }

const etiquetaMetodo = (m: Metodo) => `${m.codigo} · ${m.nombre}${m.norma ? ` (${m.norma})` : ""}`;
const filaVacia = (productoId = ""): FilaRegistro => ({ nombre: "", ident: "", sello: "", productoId });

const datosDe = (m: MuestraOt): DatosRecepcion => ({
  tomaMuestra: m.tomaMuestra ?? "",
  condicionRecepcion: m.condicionRecepcion ?? "",
  condicionObservacion: m.condicionObservacion ?? "",
  selloNumero: m.selloNumero ?? "",
  identificacionCliente: m.identificacionCliente ?? "",
  requiereOtrosLabs: m.requiereOtrosLabs,
  otrosLabs: m.otrosLabs ?? [],
  otrosLabsDetalle: m.otrosLabsDetalle ?? "",
  clienteId: m.clienteId ?? "",
  sellosVerificados: !!m.sellosVerificados,
  claseCustodia: m.claseCustodia ?? "",
  ubicacion: m.ubicacion ?? "",
  datos: { ...(m.datos ?? {}) },
});

/** Selector del producto (matriz): lista del laboratorio + búsqueda en el catálogo. */
function SelectorProducto({ id, valor, onCambio, productos, otId, obligatorio, nombreActual }: {
  id: string;
  valor: string;
  onCambio: (id: string, p: ProductoLab | null) => void;
  productos: ProductoLab[];
  otId: string;
  obligatorio: boolean;
  nombreActual?: string | null;
}) {
  const [busca, setBusca] = useState("");
  const [encontrados, setEncontrados] = useState<ProductoLab[]>([]);
  useEffect(() => {
    const q = busca.trim();
    if (q.length < 2) { setEncontrados([]); return; }
    const t = setTimeout(() => {
      llamar<{ encontrados: ProductoLab[] }>("GET", `/recepcion/ot/${otId}/productos?search=${encodeURIComponent(q)}`)
        .then((r) => setEncontrados(r.encontrados))
        .catch(() => setEncontrados([]));
    }, 300);
    return () => clearTimeout(t);
  }, [busca, otId]);
  const todos = [...productos, ...encontrados];
  const conocido = todos.some((p) => p.id === valor);
  return (
    <div className="field">
      <label htmlFor={id}>Producto (matriz) {obligatorio && <span className="req">*</span>}</label>
      <select id={id} value={valor} onChange={(e) => onCambio(e.target.value, todos.find((p) => p.id === e.target.value) ?? null)}>
        <option value="">{obligatorio ? "Elija el producto…" : "Sin producto"}</option>
        {valor && !conocido && <option value={valor}>{nombreActual ?? "Producto elegido"}</option>}
        {productos.length > 0 && (
          <optgroup label="Productos del laboratorio">
            {productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </optgroup>
        )}
        {encontrados.length > 0 && (
          <optgroup label="Del catálogo">
            {encontrados.map((p) => <option key={p.id} value={p.id}>{p.nombre} · {p.codigo}</option>)}
          </optgroup>
        )}
      </select>
      <input aria-label="Buscar otro producto en el catálogo" value={busca} onChange={(e) => setBusca(e.target.value)}
        placeholder="Otro producto: buscar en el catálogo" style={{ marginTop: 4, fontSize: 12 }} />
    </div>
  );
}

export default function RegistroMuestras({ otId, onCambio, onOrdenInterna, onRecepcionado }: {
  otId: string;
  onCambio?: () => void;
  /** Abre la pestaña «Órdenes internas» de la OT; con unidad, propone ese laboratorio de destino. */
  onOrdenInterna?: (unidadId?: string) => void;
  /** Tras recepcionar: siguiente paso «asignar y ejecutar» (pestaña Asignación). */
  onRecepcionado?: () => void;
}) {
  const { puede } = usePermisos();
  const [d, setD] = useState<Propuesta | null>(null);
  const [error, setError] = useState("");
  const [abierto, setAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [productos, setProductos] = useState<ProductoLab[]>([]);

  // Formulario de registro
  const [filas, setFilas] = useState<FilaRegistro[]>([filaVacia()]);
  const [comun, setComun] = useState<DatosRecepcion>(RECEPCION_VACIA);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [extra, setExtra] = useState<Metodo[]>([]);
  const [panel, setPanel] = useState<{ producto: string; metodos: Metodo[] }[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [encontrados, setEncontrados] = useState<Metodo[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [conNumero, setConNumero] = useState(true);

  // Corrección de la recepción de una muestra
  const [editando, setEditando] = useState<string | null>(null);
  const [distribuyendo, setDistribuyendo] = useState<string | null>(null);
  const [edicion, setEdicion] = useState<DatosRecepcion>(RECEPCION_VACIA);
  const [productoEdicion, setProductoEdicion] = useState("");

  const cargar = useCallback(async () => {
    try {
      setD(await llamar<Propuesta>("GET", `/flujo/ot/${otId}/registro-muestras`));
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }, [otId]);
  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => {
    llamar<{ productos: ProductoLab[] }>("GET", `/recepcion/ot/${otId}/productos`).then((r) => setProductos(r.productos)).catch(() => setProductos([]));
  }, [otId]);

  const cfg = d?.configRecepcion ?? null;
  const unaPorEnvase = cfg?.laboratorio?.codigo === "LPN";

  const redimensionar = (n: number) => setFilas((xs) => Array.from({ length: n }, (_, i) => xs[i] ?? filaVacia(xs[0]?.productoId ?? "")));

  const abrir = () => {
    if (!d) return;
    setMarcados(new Set(d.lineas.flatMap((l) => l.sugeridos)));
    // Tantas muestras como la mayor cantidad cotizada (mínimo 1); la descripción la escribe quien recibe.
    const n = d.lineas.length ? Math.max(1, Math.min(20, Math.max(...d.lineas.map((l) => l.cantidad || 1)))) : 1;
    setFilas(Array.from({ length: n }, () => filaVacia(d.ot.catElementoId ?? "")));
    setComun(RECEPCION_VACIA);
    setExtra([]);
    setPanel([]);
    setBusqueda("");
    setEncontrados([]);
    setEditando(null);
    setAbierto(true);
  };

  /** «Carga el panel»: los métodos del producto; sin cotización, se proponen marcados. */
  async function cargarPanel(elementoId: string, nombre: string) {
    if (!elementoId || panel.some((p) => p.producto === nombre)) return;
    try {
      const r = await llamar<{ metodos: Metodo[] }>("GET", `/recepcion/ot/${otId}/productos/${elementoId}/panel`);
      setPanel((ps) => [...ps.filter((p) => p.producto !== nombre), { producto: nombre, metodos: r.metodos }]);
      if (!d?.cotizacion) setMarcados((s) => { const n = new Set(s); for (const m of r.metodos) if (m.analitos) n.add(m.id); return n; });
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  // Búsqueda de métodos en el catálogo (con un pequeño retardo).
  useEffect(() => {
    if (!abierto || busqueda.trim().length < 2) { setEncontrados([]); return; }
    const t = setTimeout(async () => {
      setBuscando(true);
      try {
        const r: any = await llamar("GET", `/cat/metodos?search=${encodeURIComponent(busqueda.trim())}&limit=20`);
        const xs: any[] = Array.isArray(r) ? r : r?.data ?? [];
        setEncontrados(xs.map((m) => ({ id: m.id, codigo: m.codigo, nombre: m.nombre, norma: m.norma, ensayoId: m.ensayoId, analitos: m.analitos?.length ?? m._count?.analitos ?? 1 })));
      } catch {
        setEncontrados([]);
      } finally {
        setBuscando(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [busqueda, abierto]);

  const metodosListados = useMemo(
    () => new Set([...(d?.lineas ?? []).flatMap((l) => l.metodos.map((m) => m.id)), ...panel.flatMap((p) => p.metodos.map((m) => m.id))]),
    [d, panel],
  );
  const alternar = (id: string) => setMarcados((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const agregarExtra = (m: Metodo) => {
    if (!metodosListados.has(m.id) && !extra.some((x) => x.id === m.id)) setExtra((x) => [...x, m]);
    setMarcados((s) => new Set(s).add(m.id));
    setBusqueda("");
    setEncontrados([]);
  };

  const etiquetaToma = (c: string | null) => d?.opcionesToma.find((o) => o.codigo === c)?.etiqueta ?? c ?? "";

  async function guardar() {
    const metodoIds = [...marcados];
    if (filas.some((f) => !f.nombre.trim())) return toast.error("Escriba la descripción de cada muestra recibida.");
    if (cfg?.productoObligatorio && filas.some((f) => !f.productoId))
      return toast.error(`Elija el producto (matriz) de cada muestra: es obligatorio en el ${cfg.laboratorio?.codigo ?? "laboratorio"}.`);
    // Los sellos van por muestra: «sellos verificados» exige el número en cada una.
    const falta = faltantesRecepcion({ ...comun, selloNumero: comun.sellosVerificados ? "por muestra" : "" }, cfg);
    if (comun.sellosVerificados && filas.some((f) => !f.sello.trim())) falta.push("indique el Nº de sello de cada muestra (marcó «sellos verificados»)");
    if (falta.length) return toast.error(`Recepción: ${falta.join("; ")}.`);
    if (!metodoIds.length) return toast.error("Marque al menos un método.");
    setGuardando(true);
    try {
      const r: any = await llamar("POST", `/flujo/ot/${otId}/muestras`, {
        muestras: filas.map((f) => ({
          nombre: f.nombre.trim(),
          metodoIds,
          ...(f.productoId ? { catElementoId: f.productoId } : {}),
          recepcion: cuerpoRecepcion({ ...comun, identificacionCliente: f.ident, selloNumero: f.sello }),
        })),
      });
      let numeros = "";
      if (conNumero) {
        try {
          const n = await llamar<{ asignados: { numeroInterno: string }[] }>("POST", `/recepcion/ot/${otId}/numeros`);
          numeros = n.asignados.length ? ` Nº interno: ${n.asignados.map((x) => x.numeroInterno).join(", ")}.` : "";
        } catch (e: any) {
          toast.error(`Las muestras quedaron recepcionadas, pero no se pudo asignar el Nº interno: ${e.message}`);
        }
      }
      toast.ok(`Se recepcionaron ${r.muestras.length} muestra(s) con ${r.ensayos} ensayo(s) por analizar.${numeros} Siguiente: asignar y ejecutar.`);
      setAbierto(false);
      await cargar();
      onCambio?.();
      onRecepcionado?.();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setGuardando(false);
    }
  }

  async function guardarRecepcion(m: MuestraOt) {
    const falta = faltantesRecepcion(edicion, cfg);
    if (cfg?.productoObligatorio && !productoEdicion) falta.push("elija el producto (matriz)");
    if (falta.length) return toast.error(`Recepción: ${falta.join("; ")}.`);
    setGuardando(true);
    try {
      await llamar("PATCH", `/flujo/muestras/${m.id}/recepcion`, {
        ...cuerpoRecepcion(edicion),
        ...(productoEdicion && productoEdicion !== m.catElementoId ? { catElementoId: productoEdicion } : {}),
      });
      toast.ok(`Recepción de ${m.codigo} guardada. Queda en el historial de la OT.`);
      setEditando(null);
      await cargar();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setGuardando(false);
    }
  }

  async function asignarNumero(m?: MuestraOt) {
    setGuardando(true);
    try {
      if (m) {
        const r = await llamar<{ numeroInterno: string }>("POST", `/recepcion/muestras/${m.id}/numero`);
        toast.ok(`Muestra ${m.codigo}: Nº interno ${r.numeroInterno}.`);
      } else {
        const r = await llamar<{ asignados: { codigo: string; numeroInterno: string }[] }>("POST", `/recepcion/ot/${otId}/numeros`);
        toast.ok(`Se asignó el Nº interno a ${r.asignados.length} muestra(s).`);
      }
      await cargar();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setGuardando(false);
    }
  }

  if (error) return <div className="alert warn">{error}</div>;
  if (!d) return <p className="subtitle" style={{ margin: 0 }}>Cargando muestras…</p>;

  const cerrada = ["cerrada", "anulada"].includes(d.ot.estado);
  const puedeRegistrar = puede("muestra.crear") && !cerrada;
  const incompletas = d.muestras.filter((m) => m.recepcionIncompleta).length;
  const sinNumero = d.muestras.filter((m) => !m.numeroInterno).length;
  const camposLab = cfg?.campos.filter((c) => !["clase_custodia", "ubicacion"].includes(c.codigo)) ?? [];

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {d.muestras.length ? (
        <>
          {incompletas > 0 && (
            <div className="alert warn" style={{ margin: 0 }}>
              {incompletas} muestra(s) sin la recepción completa.
              {puedeRegistrar ? " Complétela con «Recepción…»." : " La completa Recepción o la jefatura del laboratorio."}
            </div>
          )}
          {puedeRegistrar && sinNumero > 0 && (
            <div className="toolbar" style={{ margin: 0 }}>
              <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{sinNumero} muestra(s) sin Nº de muestra interno.</span>
              <button className="btn outline sm" disabled={guardando} onClick={() => asignarNumero()}>Asignar número a todas</button>
            </div>
          )}
          {distribuyendo && <DistribucionMuestra muestraId={distribuyendo} onCerrar={() => setDistribuyendo(null)} />}
          <div style={{ overflowX: "auto" }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Código · Nº interno</th><th>Muestra · producto</th><th>Recepción</th><th>Sellos</th><th>Otros laboratorios</th>
                  <th>Métodos</th><th className="num">Ensayos</th><th>Veredicto</th><th>Estado</th>{puedeRegistrar && <th aria-label="Acciones"></th>}
                </tr>
              </thead>
              <tbody>
                {d.muestras.map((m) => {
                  const v = veredictoInfo(m.veredicto);
                  return (
                    <Fragment key={m.id}>
                      <tr>
                        <td>
                          <span className="codigo" style={{ whiteSpace: "nowrap" }}>{m.codigo}</span>
                          <div style={{ marginTop: 3 }}>
                            {m.numeroInterno ? (
                              <span className="pill blue" title="Nº de muestra interno">Nº {m.numeroInterno}</span>
                            ) : puedeRegistrar ? (
                              <button className="btn outline sm" disabled={guardando} onClick={() => asignarNumero(m)}>Asignar número</button>
                            ) : (
                              <span style={{ fontSize: 11, color: "var(--muted)" }}>sin Nº interno</span>
                            )}
                          </div>
                        </td>
                        <td>
                          {m.nombre ?? "—"}
                          {m.productoNombre && <div style={{ fontSize: 11.5 }}><b>Producto:</b> {m.productoNombre}</div>}
                          {m.clienteNombre && m.clienteId !== d.ot.clienteId && <div style={{ fontSize: 11.5, color: "var(--muted)" }}>Cliente: {m.clienteNombre}</div>}
                          {m.identificacionCliente && <div style={{ fontSize: 11.5, color: "var(--muted)" }}>Rótulo: «{m.identificacionCliente}»</div>}
                        </td>
                        <td style={{ fontSize: 12, minWidth: 200 }}>
                          {m.recepcionIncompleta && !m.condicionRecepcion ? (
                            <span className="pill amber">incompleta</span>
                          ) : (
                            <>
                              <span className={`pill ${m.condicionRecepcion === "cumple" ? "green" : "red"}`}>{m.condicionRecepcion === "cumple" ? "Cumple" : "No cumple"}</span>
                              <div style={{ color: "var(--muted)", marginTop: 2 }}>{etiquetaToma(m.tomaMuestra)}</div>
                            </>
                          )}
                          {m.faltantesRecepcion && m.faltantesRecepcion.length > 0 && (
                            <div style={{ color: "#7a4b00", marginTop: 2 }}>Falta: {m.faltantesRecepcion.join(", ")}</div>
                          )}
                          {m.condicionObservacion && <div style={{ color: "var(--red)", marginTop: 2 }}>{m.condicionObservacion}</div>}
                          {m.claseCustodia && (
                            <div style={{ marginTop: 2 }}>
                              {etiquetaClase(cfg, m.claseCustodia)}{m.retenerHasta ? ` · retener hasta ${fechaDma(m.retenerHasta)}` : ""}
                            </div>
                          )}
                          {m.ubicacion && <div style={{ color: "var(--muted)" }}>Ubicación: {m.ubicacion}</div>}
                          {(() => {
                            // Datos propios del laboratorio en una línea; las casillas, resumidas.
                            const datos = camposLab.filter((c) => c.tipo !== "casilla" && m.datos && m.datos[c.codigo] !== undefined && m.datos[c.codigo] !== "");
                            const casillas = camposLab.filter((c) => c.tipo === "casilla");
                            const marcadas = casillas.filter((c) => m.datos?.[c.codigo] === true).length;
                            return (
                              <>
                                {datos.length > 0 && (
                                  <div style={{ color: "var(--muted)" }}>{datos.map((c) => `${c.etiqueta}: ${textoValor(c, m.datos?.[c.codigo])}`).join(" · ")}</div>
                                )}
                                {casillas.length > 0 && (
                                  <div style={{ color: marcadas === casillas.length ? "var(--muted)" : "#7a4b00" }}
                                    title={casillas.map((c) => `${c.etiqueta}: ${m.datos?.[c.codigo] === true ? "Sí" : "No"}`).join(" · ")}>
                                    Verificaciones: {marcadas} de {casillas.length}
                                  </div>
                                )}
                              </>
                            );
                          })()}
                          {m.fotosRecepcion > 0 && <div style={{ color: "var(--muted)" }}>{m.fotosRecepcion} foto(s) de recepción</div>}
                          {m.recepcionadaAt && (
                            <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 2 }}>
                              Recibida {fechaHora(m.recepcionadaAt)}{m.recepcionadaPorNombre ? ` · ${m.recepcionadaPorNombre}` : ""}
                            </div>
                          )}
                          {m.recepcionCorregidaAt && (
                            <div style={{ color: "var(--muted)", fontSize: 11 }}>
                              Corregida {fechaHora(m.recepcionCorregidaAt)}{m.recepcionCorregidaPorNombre ? ` · ${m.recepcionCorregidaPorNombre}` : ""}
                            </div>
                          )}
                        </td>
                        <td>
                          {m.selloNumero ? <span className="codigo">{m.selloNumero}</span> : "—"}
                          {m.selloNumero && m.sellosVerificados != null && (
                            <div style={{ fontSize: 11, color: m.sellosVerificados ? "var(--muted)" : "var(--red)" }}>{m.sellosVerificados ? "Verificados" : "Sin verificar"}</div>
                          )}
                        </td>
                        <td style={{ fontSize: 12 }}>
                          {!m.requiereOtrosLabs ? "No" : m.otrosLabsEnlace.map((e) => (
                            <div key={e.unidadId}>
                              <b title={e.unidad?.nombre}>{e.unidad?.codigo ?? "—"}</b>{" · "}
                              {e.ordenes.length
                                ? e.ordenes.map((o) => onOrdenInterna
                                    ? <button key={o.id} type="button" onClick={() => onOrdenInterna()} style={{ color: "var(--accent)", background: "none", border: 0, padding: 0, cursor: "pointer", textDecoration: "underline" }}>{o.numero} ({o.estado})</button>
                                    : <Link key={o.id} href={"/ordenes-internas" as any} style={{ color: "var(--accent)" }}>{o.numero} ({o.estado})</Link>)
                                : <>
                                    <span className="pill amber">sin orden interna</span>
                                    {onOrdenInterna && puede("orden_interna.emitir") && (
                                      <button type="button" className="btn outline sm" style={{ marginLeft: 6 }} onClick={() => onOrdenInterna(e.unidadId)}>
                                        Emitir orden interna
                                      </button>
                                    )}
                                  </>}
                            </div>
                          ))}
                          {m.otrosLabsDetalle && <div style={{ color: "var(--muted)" }}>{m.otrosLabsDetalle}</div>}
                        </td>
                        <td style={{ fontSize: 12 }}>{m.metodos.length ? m.metodos.join(", ") : <span className="pill amber">sin ensayos</span>}</td>
                        <td className="num">{m.ensayos}</td>
                        <td><span className={`pill ${v.pill}`}>{v.texto}</span></td>
                        <td><span className="pill gray">{m.estado}</span></td>
                        {puedeRegistrar && (
                          <td style={{ whiteSpace: "nowrap" }}>
                            {/* EP-02 1.3 (frente r4d): porción por laboratorio de destino. */}
                            {m.ensayos > 0 && (
                              <button className="btn outline sm" style={{ marginRight: 4 }} onClick={() => setDistribuyendo(m.id)}>Distribuir…</button>
                            )}
                            <button className="btn outline sm" aria-expanded={editando === m.id}
                              onClick={() => { setEditando(editando === m.id ? null : m.id); setEdicion(datosDe(m)); setProductoEdicion(m.catElementoId ?? ""); setAbierto(false); }}>
                              {editando === m.id ? "Cerrar" : "Recepción…"}
                            </button>
                          </td>
                        )}
                      </tr>
                      {editando === m.id && (
                        <tr>
                          <td colSpan={10} style={{ background: "#f8fbfc" }}>
                            <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 6 }}>Recepción e identificación de {m.codigo}</div>
                            <div className="form-grid cols-2" style={{ marginBottom: 6 }}>
                              <SelectorProducto id={`prod-${m.id}`} valor={productoEdicion} onCambio={(id) => setProductoEdicion(id)} productos={productos}
                                otId={otId} obligatorio={!!cfg?.productoObligatorio} nombreActual={m.productoNombre} />
                            </div>
                            <FormRecepcion valor={edicion} onCambio={setEdicion} opcionesToma={d.opcionesToma} labPrincipalId={d.ot.unidadPrincipal}
                              config={cfg} clienteOt={{ id: d.ot.clienteId, nombre: d.ot.clienteNombre }} />
                            <FotosRecepcion otId={otId} muestraId={m.id} codigo={m.codigo} puedeEditar={puedeRegistrar} onCambio={cargar} />
                            <div className="toolbar" style={{ margin: "8px 0 0" }}>
                              <span style={{ fontSize: 11.5, color: "var(--muted)" }}>El cambio queda en el historial de la OT con lo anterior y lo nuevo.</span>
                              <div className="spacer" />
                              <button className="btn outline sm" disabled={guardando} onClick={() => setEditando(null)}>Cancelar</button>
                              <button className="btn primary sm" disabled={guardando} onClick={() => guardarRecepcion(m)}>{guardando ? "Guardando…" : "Guardar recepción"}</button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="alert warn" style={{ margin: 0 }}>
          Esta OT aún no tiene muestras recepcionadas: sin muestras no hay ensayos que asignar ni capturar.
          {puedeRegistrar ? " Regístrelas con «Recepcionar muestras»." : " Las recepciona Recepción o el laboratorio."}
        </div>
      )}

      {puedeRegistrar && !abierto && (
        <div><button className="btn primary sm" onClick={abrir}>Recepcionar muestras</button></div>
      )}

      {abierto && (
        <div className="card" style={{ margin: 0, padding: 12 }}>
          <h2 style={{ fontSize: 14, marginTop: 0 }}>
            Recepción e identificación de la muestra{cfg?.laboratorio ? ` · ${cfg.laboratorio.codigo}` : ""}
          </h2>
          {unaPorEnvase && (
            <p className="subtitle" style={{ margin: "0 0 8px" }}>
              En el LPN se registra <b>una muestra por envase o producto físico</b>: cada una lleva su producto y su informe (IE).
            </p>
          )}

          <div className="field" style={{ maxWidth: 220 }}>
            <label htmlFor="n-muestras">{unaPorEnvase ? "Nº de envases recibidos" : "Nº de muestras recibidas"}</label>
            <input id="n-muestras" type="number" min={1} max={50} value={filas.length}
              onChange={(e) => redimensionar(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} />
          </div>
          <div style={{ display: "grid", gap: 8, marginBottom: 10 }}>
            {filas.map((f, i) => (
              <div className="form-grid cols-4" key={i} style={{ borderTop: i ? "1px solid var(--line)" : 0, paddingTop: i ? 6 : 0 }}>
                <div className="field">
                  <label htmlFor={`m-${i}-nombre`}>{unaPorEnvase ? `Envase ${i + 1}` : `Muestra ${i + 1}`} · descripción <span className="req">*</span></label>
                  <input id={`m-${i}-nombre`} value={f.nombre} maxLength={200} onChange={(e) => setFilas((xs) => xs.map((x, j) => (j === i ? { ...x, nombre: e.target.value } : x)))} />
                </div>
                <SelectorProducto id={`m-${i}-producto`} valor={f.productoId} productos={productos} otId={otId} obligatorio={!!cfg?.productoObligatorio}
                  onCambio={(id, p) => {
                    setFilas((xs) => xs.map((x, j) => (j === i || (i === 0 && !x.productoId && !unaPorEnvase) ? { ...x, productoId: id } : x)));
                    if (id && p) cargarPanel(id, p.nombre);
                  }} />
                <div className="field">
                  <label htmlFor={`m-${i}-ident`}>Identificación dada por el cliente</label>
                  <input id={`m-${i}-ident`} value={f.ident} maxLength={300} onChange={(e) => setFilas((xs) => xs.map((x, j) => (j === i ? { ...x, ident: e.target.value } : x)))} />
                </div>
                <div className="field">
                  <label htmlFor={`m-${i}-sello`}>Nº de sello(s)</label>
                  <input id={`m-${i}-sello`} value={f.sello} maxLength={200} onChange={(e) => setFilas((xs) => xs.map((x, j) => (j === i ? { ...x, sello: e.target.value } : x)))} />
                </div>
              </div>
            ))}
          </div>

          <h3 style={{ fontSize: 13, margin: "6px 0" }}>
            Recepción{filas.length > 1 && <span style={{ fontWeight: 400, color: "var(--muted)" }}> · se aplica a las {filas.length} muestras; después puede corregir cada una con «Recepción…»</span>}
          </h3>
          <FormRecepcion valor={comun} onCambio={setComun} opcionesToma={d.opcionesToma} labPrincipalId={d.ot.unidadPrincipal} porMuestra={false}
            config={cfg} clienteOt={{ id: d.ot.clienteId, nombre: d.ot.clienteNombre }} />

          <h3 style={{ fontSize: 13, margin: "12px 0 6px" }}>
            Ensayos que se aplican a cada muestra
            {d.cotizacion && <span style={{ fontWeight: 400, color: "var(--muted)" }}> · ensayos de la cotización {d.cotizacion.codigo}</span>}
          </h3>
          {d.lineas.length === 0 && panel.length === 0 && (
            <p className="subtitle" style={{ margin: "0 0 8px" }}>
              {d.cotizacion ? "La cotización no tiene líneas." : "Esta OT no viene de una cotización."} Elija el producto para cargar su panel de ensayos, o busque los métodos en el catálogo.
            </p>
          )}
          {d.lineas.map((l) => (
            <div key={l.lineaId} style={{ borderTop: "1px solid var(--line)", padding: "6px 0" }}>
              <div style={{ fontWeight: 600, fontSize: 12.5 }}>
                {l.ensayoCodigo ? <span className="codigo">{l.ensayoCodigo}</span> : null} {l.descripcion}
                <span style={{ fontWeight: 400, color: "var(--muted)" }}> · cantidad cotizada {l.cantidad}</span>
              </div>
              {l.aviso && <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{l.aviso}</div>}
              {l.metodos.map((m) => (
                <label key={m.id} style={{ display: "flex", gap: 6, alignItems: "center", fontWeight: 400, fontSize: 12.5, opacity: m.analitos ? 1 : 0.55 }}>
                  <input type="checkbox" style={{ width: "auto" }} disabled={!m.analitos} checked={marcados.has(m.id)} onChange={() => alternar(m.id)} />
                  {etiquetaMetodo(m)}{!m.analitos && " · sin analitos en el catálogo"}
                </label>
              ))}
            </div>
          ))}
          {panel.map((p) => {
            const delPanel = p.metodos.filter((m) => m.analitos && !d.lineas.some((l) => l.metodos.some((x) => x.id === m.id))).map((m) => m.id);
            return (
            <div key={p.producto} style={{ borderTop: "1px solid var(--line)", padding: "6px 0" }}>
              <div style={{ fontWeight: 600, fontSize: 12.5, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <MarcarTodos marcados={delPanel.filter((id) => marcados.has(id)).length} total={delPanel.length}
                  onMarcar={() => setMarcados((s) => new Set([...s, ...delPanel]))}
                  onDesmarcar={() => setMarcados((s) => new Set([...s].filter((id) => !delPanel.includes(id))))} />
                Panel de ensayos del producto {p.producto}
                <span style={{ fontWeight: 400, color: "var(--muted)" }}>
                  {d.cotizacion ? " · marque solo lo pedido en la cotización" : " · propuestos; desmarque lo que no se pidió"}
                </span>
              </div>
              {p.metodos.length === 0 && <div style={{ fontSize: 11.5, color: "var(--muted)" }}>El producto no tiene panel en el catálogo: busque los métodos abajo.</div>}
              {p.metodos.filter((m) => !d.lineas.some((l) => l.metodos.some((x) => x.id === m.id))).map((m) => (
                <label key={m.id} style={{ display: "flex", gap: 6, alignItems: "center", fontWeight: 400, fontSize: 12.5, opacity: m.analitos ? 1 : 0.55 }}>
                  <input type="checkbox" style={{ width: "auto" }} disabled={!m.analitos} checked={marcados.has(m.id)} onChange={() => alternar(m.id)} />
                  {etiquetaMetodo(m)}{!m.analitos && " · sin analitos en el catálogo"}
                </label>
              ))}
            </div>
            );
          })}
          {extra.length > 0 && (
            <div style={{ borderTop: "1px solid var(--line)", padding: "6px 0" }}>
              <div style={{ fontWeight: 600, fontSize: 12.5 }}>Otros métodos del catálogo</div>
              {extra.map((m) => (
                <label key={m.id} style={{ display: "flex", gap: 6, alignItems: "center", fontWeight: 400, fontSize: 12.5 }}>
                  <input type="checkbox" style={{ width: "auto" }} checked={marcados.has(m.id)} onChange={() => alternar(m.id)} />
                  {etiquetaMetodo(m)}
                </label>
              ))}
            </div>
          )}
          <div className="field" style={{ marginTop: 8, maxWidth: 520, position: "relative" }}>
            <label htmlFor="buscar-metodo">Agregar un método del catálogo</label>
            <input id="buscar-metodo" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Código o nombre del método" />
            {(buscando || encontrados.length > 0) && (
              <div className="card" style={{ position: "absolute", zIndex: 5, top: "100%", left: 0, right: 0, margin: 0, padding: 4, maxHeight: 240, overflowY: "auto" }}>
                {buscando && <div style={{ fontSize: 12, color: "var(--muted)", padding: 4 }}>Buscando…</div>}
                {encontrados.map((m) => (
                  <button key={m.id} type="button" className="btn outline sm" style={{ display: "block", width: "100%", textAlign: "left", marginBottom: 2 }} onClick={() => agregarExtra(m)}>
                    {etiquetaMetodo(m)}
                  </button>
                ))}
              </div>
            )}
          </div>

          <p className="hint" style={{ fontSize: 11.5, color: "var(--muted)" }}>
            Se recepcionarán {filas.length} muestra(s) con {marcados.size} método(s) cada una. Cada método genera un ensayo por
            analito, con su especificación, fórmula y factor del catálogo. Queda registrado en el historial de la OT.
          </p>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, marginBottom: 8 }}>
            <input type="checkbox" style={{ width: "auto" }} checked={conNumero} onChange={(e) => setConNumero(e.target.checked)} />
            Asignar el Nº de muestra interno al recepcionar (si no, con «Asignar número» en cada muestra)
          </label>
          <div className="toolbar" style={{ margin: 0 }}>
            <button className="btn outline sm" disabled={guardando} onClick={() => setAbierto(false)}>Cancelar</button>
            <button className="btn primary sm" disabled={guardando || !marcados.size} onClick={guardar}>
              {guardando ? "Recepcionando…" : "Recepcionar → asignar y ejecutar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
