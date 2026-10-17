"use client";

/**
 * Muestras de la OT (pestaña del expediente) y registro de las muestras
 * recibidas con sus ensayos.
 *
 * · Todos los que ven la OT ven sus muestras, su recepción (toma de muestra,
 *   condición, sello, identificación del cliente, otros laboratorios) y cuántos
 *   ensayos tiene cada una.
 * · Quien registra muestras (permiso «muestra.crear»: Recepción, Planificación,
 *   jefaturas…) puede «Registrar muestras recibidas»: indica cuántas llegaron,
 *   su descripción, identificación del cliente y sello, los datos de recepción y
 *   marca los métodos del catálogo que se aplican. Si la OT nació de una
 *   cotización, los ensayos cotizados aparecen ya listados (y marcados cuando el
 *   ensayo tiene un solo método). También puede buscar otros métodos.
 * · Al guardar se crean las muestras (<OT>-M1, M2…) y sus ensayos por analizar,
 *   con la especificación, la fórmula y el factor copiados del catálogo.
 * · «Recepción…» en cada muestra corrige o completa su recepción (queda en el
 *   historial de la OT con lo anterior y lo nuevo).
 *
 * API: GET /flujo/ot/:id/registro-muestras · POST /flujo/ot/:id/muestras ·
 *      PATCH /flujo/muestras/:id/recepcion
 */
import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "@/components/ui/feedback";
import { llamar, veredictoInfo } from "@/lib/laboratorio";
import { usePermisos } from "@/lib/permisos";
import { fechaHora } from "@/lib/format";
import FormRecepcion, { RECEPCION_VACIA, cuerpoRecepcion, faltantesRecepcion, type DatosRecepcion } from "./FormRecepcion";

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
  recepcionIncompleta: boolean; otrosLabsEnlace: EnlaceLab[];
}
interface Propuesta {
  ot: { id: string; codigo: string; estado: string; unidadPrincipal: string | null };
  cotizacion: { id: string; codigo: string; referencia: string | null } | null;
  muestras: MuestraOt[];
  lineas: Linea[];
  opcionesToma: { codigo: string; etiqueta: string }[];
}

const etiquetaMetodo = (m: Metodo) => `${m.codigo} · ${m.nombre}${m.norma ? ` (${m.norma})` : ""}`;

const datosDe = (m: MuestraOt): DatosRecepcion => ({
  tomaMuestra: m.tomaMuestra ?? "",
  condicionRecepcion: m.condicionRecepcion ?? "",
  condicionObservacion: m.condicionObservacion ?? "",
  selloNumero: m.selloNumero ?? "",
  identificacionCliente: m.identificacionCliente ?? "",
  requiereOtrosLabs: m.requiereOtrosLabs,
  otrosLabs: m.otrosLabs ?? [],
  otrosLabsDetalle: m.otrosLabsDetalle ?? "",
});

export default function RegistroMuestras({ otId, onCambio }: { otId: string; onCambio?: () => void }) {
  const { puede } = usePermisos();
  const [d, setD] = useState<Propuesta | null>(null);
  const [error, setError] = useState("");
  const [abierto, setAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);

  // Formulario de registro
  const [nombres, setNombres] = useState<string[]>([""]);
  const [idents, setIdents] = useState<string[]>([""]);
  const [sellos, setSellos] = useState<string[]>([""]);
  const [comun, setComun] = useState<DatosRecepcion>(RECEPCION_VACIA);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [extra, setExtra] = useState<Metodo[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [encontrados, setEncontrados] = useState<Metodo[]>([]);
  const [buscando, setBuscando] = useState(false);

  // Corrección de la recepción de una muestra
  const [editando, setEditando] = useState<string | null>(null);
  const [edicion, setEdicion] = useState<DatosRecepcion>(RECEPCION_VACIA);

  const cargar = useCallback(async () => {
    try {
      setD(await llamar<Propuesta>("GET", `/flujo/ot/${otId}/registro-muestras`));
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }, [otId]);
  useEffect(() => { cargar(); }, [cargar]);

  const redimensionar = (n: number) => {
    const ajustar = (xs: string[]) => Array.from({ length: n }, (_, i) => xs[i] ?? "");
    setNombres(ajustar);
    setIdents(ajustar);
    setSellos(ajustar);
  };

  const abrir = () => {
    if (!d) return;
    setMarcados(new Set(d.lineas.flatMap((l) => l.sugeridos)));
    // Tantas muestras como la mayor cantidad cotizada (mínimo 1); la descripción la escribe quien recibe.
    const n = d.lineas.length ? Math.max(1, Math.min(20, Math.max(...d.lineas.map((l) => l.cantidad || 1)))) : 1;
    setNombres(Array.from({ length: n }, () => ""));
    setIdents(Array.from({ length: n }, () => ""));
    setSellos(Array.from({ length: n }, () => ""));
    setComun(RECEPCION_VACIA);
    setExtra([]);
    setBusqueda("");
    setEncontrados([]);
    setEditando(null);
    setAbierto(true);
  };

  // Búsqueda de métodos en el catálogo (con un pequeño retardo).
  useEffect(() => {
    if (!abierto || busqueda.trim().length < 2) { setEncontrados([]); return; }
    const t = setTimeout(async () => {
      setBuscando(true);
      try {
        const r: any = await llamar("GET", `/cat/metodos?search=${encodeURIComponent(busqueda.trim())}&limit=20`);
        const filas: any[] = Array.isArray(r) ? r : r?.data ?? [];
        setEncontrados(filas.map((m) => ({ id: m.id, codigo: m.codigo, nombre: m.nombre, norma: m.norma, ensayoId: m.ensayoId, analitos: m.analitos?.length ?? m._count?.analitos ?? 1 })));
      } catch {
        setEncontrados([]);
      } finally {
        setBuscando(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [busqueda, abierto]);

  const metodosDeLineas = useMemo(() => new Set((d?.lineas ?? []).flatMap((l) => l.metodos.map((m) => m.id))), [d]);
  const alternar = (id: string) => setMarcados((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const agregarExtra = (m: Metodo) => {
    if (!metodosDeLineas.has(m.id) && !extra.some((x) => x.id === m.id)) setExtra((x) => [...x, m]);
    setMarcados((s) => new Set(s).add(m.id));
    setBusqueda("");
    setEncontrados([]);
  };

  const etiquetaToma = (c: string | null) => d?.opcionesToma.find((o) => o.codigo === c)?.etiqueta ?? c ?? "";

  async function guardar() {
    const metodoIds = [...marcados];
    if (nombres.some((n) => !n.trim())) return toast.error("Escriba la descripción de cada muestra recibida.");
    const falta = faltantesRecepcion(comun);
    if (falta.length) return toast.error(`Recepción: ${falta.join("; ")}.`);
    if (!metodoIds.length) return toast.error("Marque al menos un método.");
    setGuardando(true);
    try {
      const r: any = await llamar("POST", `/flujo/ot/${otId}/muestras`, {
        muestras: nombres.map((nombre, i) => ({
          nombre: nombre.trim(),
          metodoIds,
          recepcion: cuerpoRecepcion({ ...comun, identificacionCliente: idents[i] ?? "", selloNumero: sellos[i] ?? "" }),
        })),
      });
      toast.ok(`Se registraron ${r.muestras.length} muestra(s) con ${r.ensayos} ensayo(s) por analizar.`);
      setAbierto(false);
      await cargar();
      onCambio?.();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setGuardando(false);
    }
  }

  async function guardarRecepcion(m: MuestraOt) {
    const falta = faltantesRecepcion(edicion);
    if (falta.length) return toast.error(`Recepción: ${falta.join("; ")}.`);
    setGuardando(true);
    try {
      await llamar("PATCH", `/flujo/muestras/${m.id}/recepcion`, cuerpoRecepcion(edicion));
      toast.ok(`Recepción de ${m.codigo} guardada. Queda en el historial de la OT.`);
      setEditando(null);
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

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {d.muestras.length ? (
        <>
          {incompletas > 0 && (
            <div className="alert warn" style={{ margin: 0 }}>
              {incompletas} muestra(s) sin la recepción completa (toma de muestra o condición de recepción).
              {puedeRegistrar ? " Complétela con «Recepción…»." : " La completa Recepción o la jefatura del laboratorio."}
            </div>
          )}
          <div style={{ overflowX: "auto" }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Código</th><th>Muestra</th><th>Recepción</th><th>Sello</th><th>Otros laboratorios</th>
                  <th>Métodos</th><th className="num">Ensayos</th><th>Veredicto</th><th>Estado</th>{puedeRegistrar && <th aria-label="Acciones"></th>}
                </tr>
              </thead>
              <tbody>
                {d.muestras.map((m) => {
                  const v = veredictoInfo(m.veredicto);
                  return (
                    <Fragment key={m.id}>
                      <tr>
                        <td><span className="codigo">{m.codigo}</span></td>
                        <td>
                          {m.nombre ?? "—"}
                          {m.identificacionCliente && <div style={{ fontSize: 11.5, color: "var(--muted)" }}>Cliente: «{m.identificacionCliente}»</div>}
                        </td>
                        <td style={{ fontSize: 12 }}>
                          {m.recepcionIncompleta ? (
                            <span className="pill amber">incompleta</span>
                          ) : (
                            <>
                              <span className={`pill ${m.condicionRecepcion === "cumple" ? "green" : "red"}`}>{m.condicionRecepcion === "cumple" ? "Cumple" : "No cumple"}</span>
                              <div style={{ color: "var(--muted)", marginTop: 2 }}>{etiquetaToma(m.tomaMuestra)}</div>
                            </>
                          )}
                          {m.condicionObservacion && <div style={{ color: "#8a1f1f", marginTop: 2 }}>{m.condicionObservacion}</div>}
                          {m.recepcionadaAt && (
                            <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 2 }}>
                              {fechaHora(m.recepcionadaAt)}{m.recepcionadaPorNombre ? ` · ${m.recepcionadaPorNombre}` : ""}
                            </div>
                          )}
                        </td>
                        <td>{m.selloNumero ? <span className="codigo">{m.selloNumero}</span> : "—"}</td>
                        <td style={{ fontSize: 12 }}>
                          {!m.requiereOtrosLabs ? "No" : m.otrosLabsEnlace.map((e) => (
                            <div key={e.unidadId}>
                              <b title={e.unidad?.nombre}>{e.unidad?.codigo ?? "—"}</b>{" · "}
                              {e.ordenes.length
                                ? e.ordenes.map((o) => <Link key={o.id} href={"/ordenes-internas" as any} style={{ color: "var(--accent)" }}>{o.numero} ({o.estado})</Link>)
                                : <span className="pill amber" title="Emita la orden interna a ese laboratorio en «Órdenes internas»">sin orden interna</span>}
                            </div>
                          ))}
                          {m.otrosLabsDetalle && <div style={{ color: "var(--muted)" }}>{m.otrosLabsDetalle}</div>}
                        </td>
                        <td style={{ fontSize: 12 }}>{m.metodos.length ? m.metodos.join(", ") : <span className="pill amber">sin ensayos</span>}</td>
                        <td className="num">{m.ensayos}</td>
                        <td><span className={`pill ${v.pill}`}>{v.texto}</span></td>
                        <td><span className="pill gray">{m.estado}</span></td>
                        {puedeRegistrar && (
                          <td>
                            <button className="btn outline sm" aria-expanded={editando === m.id}
                              onClick={() => { setEditando(editando === m.id ? null : m.id); setEdicion(datosDe(m)); setAbierto(false); }}>
                              {editando === m.id ? "Cerrar" : "Recepción…"}
                            </button>
                          </td>
                        )}
                      </tr>
                      {editando === m.id && (
                        <tr>
                          <td colSpan={10} style={{ background: "#f8fbfc" }}>
                            <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 6 }}>Recepción e identificación de {m.codigo}</div>
                            <FormRecepcion valor={edicion} onCambio={setEdicion} opcionesToma={d.opcionesToma} labPrincipalId={d.ot.unidadPrincipal} />
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
          Esta OT aún no tiene muestras registradas: sin muestras no hay ensayos que asignar ni capturar.
          {puedeRegistrar ? " Regístrelas con «Registrar muestras recibidas»." : " Las registra Recepción, Planificación o la jefatura del laboratorio."}
        </div>
      )}

      {puedeRegistrar && !abierto && (
        <div><button className="btn primary sm" onClick={abrir}>Registrar muestras recibidas</button></div>
      )}

      {abierto && (
        <div className="card" style={{ margin: 0, padding: 12 }}>
          <h2 style={{ fontSize: 14, marginTop: 0 }}>Registrar muestras recibidas</h2>

          <div className="field" style={{ maxWidth: 180 }}>
            <label htmlFor="n-muestras">Nº de muestras recibidas</label>
            <input id="n-muestras" type="number" min={1} max={50} value={nombres.length}
              onChange={(e) => redimensionar(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} />
          </div>
          <div style={{ display: "grid", gap: 8, marginBottom: 10 }}>
            {nombres.map((n, i) => (
              <div className="form-grid cols-3" key={i} style={{ borderTop: i ? "1px solid var(--line)" : 0, paddingTop: i ? 6 : 0 }}>
                <div className="field">
                  <label htmlFor={`m-${i}-nombre`}>Muestra {i + 1} · descripción <span className="req">*</span></label>
                  <input id={`m-${i}-nombre`} value={n} maxLength={200} onChange={(e) => setNombres((xs) => xs.map((x, j) => (j === i ? e.target.value : x)))} />
                </div>
                <div className="field">
                  <label htmlFor={`m-${i}-ident`}>Identificación dada por el cliente</label>
                  <input id={`m-${i}-ident`} value={idents[i] ?? ""} maxLength={300} onChange={(e) => setIdents((xs) => xs.map((x, j) => (j === i ? e.target.value : x)))} />
                </div>
                <div className="field">
                  <label htmlFor={`m-${i}-sello`}>Nº de sello</label>
                  <input id={`m-${i}-sello`} value={sellos[i] ?? ""} maxLength={40} onChange={(e) => setSellos((xs) => xs.map((x, j) => (j === i ? e.target.value : x)))} />
                </div>
              </div>
            ))}
          </div>

          <h3 style={{ fontSize: 13, margin: "6px 0" }}>
            Recepción{nombres.length > 1 && <span style={{ fontWeight: 400, color: "var(--muted)" }}> · se aplica a las {nombres.length} muestras; después puede corregir cada una con «Recepción…»</span>}
          </h3>
          <FormRecepcion valor={comun} onCambio={setComun} opcionesToma={d.opcionesToma} labPrincipalId={d.ot.unidadPrincipal} porMuestra={false} />

          <h3 style={{ fontSize: 13, margin: "12px 0 6px" }}>
            Métodos que se aplican a cada muestra
            {d.cotizacion && <span style={{ fontWeight: 400, color: "var(--muted)" }}> · ensayos de la cotización {d.cotizacion.codigo}</span>}
          </h3>
          {d.lineas.length === 0 && (
            <p className="subtitle" style={{ margin: "0 0 8px" }}>
              {d.cotizacion ? "La cotización no tiene líneas." : "Esta OT no viene de una cotización."} Busque los métodos en el catálogo.
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
            Se crearán {nombres.length} muestra(s) con {marcados.size} método(s) cada una. Cada método genera un ensayo por
            analito, con su especificación, fórmula y factor del catálogo. Queda registrado en el historial de la OT.
          </p>
          <div className="toolbar" style={{ margin: 0 }}>
            <button className="btn outline sm" disabled={guardando} onClick={() => setAbierto(false)}>Cancelar</button>
            <button className="btn primary sm" disabled={guardando || !marcados.size} onClick={guardar}>
              {guardando ? "Registrando…" : "Registrar muestras y ensayos"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
