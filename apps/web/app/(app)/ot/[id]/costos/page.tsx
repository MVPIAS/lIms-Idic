"use client";

/**
 * Planilla de costos reales de la OT · DCO-PG01-P05-IT03-FORM01 («Control de
 * gastos por OT»). La completa el Jefe de Laboratorio (costo_real.gestionar) al
 * cerrar la parte de su laboratorio: horas hombre por cargo, reactivos y
 * consumibles, equipos (horas máquina) y otros. Se compara con la estimación de
 * la cotización. Ven la planilla las jefaturas, Dirección, Planificación y
 * Finanzas (costo_real.ver), siempre dentro de su alcance.
 *
 * Las tarifas ($/h por cargo y por equipo) no constan en las fuentes recibidas:
 * se escriben en cada línea.
 *
 * API: GET|PUT /laboratorio/ot/:id/costos-reales · POST …/cerrar · POST …/reabrir
 */
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader, SkeletonCards } from "@/components/ui/PageHeader";
import { toast } from "@/components/ui/feedback";
import { clp, fechaHora, num, pct } from "@/lib/format";
import { llamar, qs } from "@/lib/laboratorio";

type Categoria = "horas_hombre" | "reactivos" | "equipos" | "otros";
interface Linea {
  categoria: Categoria; cargo?: string | null; consumibleId?: string | null; equipoId?: string | null;
  descripcion?: string | null; cantidad: number; unidad?: string | null; costoUnitario: number;
}
/** Línea en edición: los números como texto (coma decimal). */
interface Fila extends Omit<Linea, "cantidad" | "costoUnitario"> { clave: string; cantidad: string; costoUnitario: string }
interface Vista {
  ot: { id: string; codigo: string; estado: string };
  unidad: { id: string; codigo: string; nombre: string } | null;
  unidadesPosibles: { id: string; codigo: string; nombre: string; principal: boolean }[];
  cotizacion: { id: string; codigo: string } | null;
  planilla: null | {
    estado: "borrador" | "cerrada"; observaciones: string | null; actualizadaPor: string | null; actualizadaAt: string | null;
    cerradaPor: string | null; cerradaAt: string | null; reabiertaPor: string | null; reabiertaAt: string | null; reabiertaMotivo: string | null;
  };
  lineas: (Linea & { total: number; consumibleNombre?: string | null; equipoNombre?: string | null; equipoCodigo?: string | null })[];
  resumen: { porCategoria: Record<Categoria, { cantidad: number; total: number; lineas: number }>; horasHombre: number; horasMaquina: number; total: number };
  estimacion: { costoDirecto: number | null; fuenteCosto: string | null; horasHombre: number | null; fuenteHoras: string | null; cotizadoPorCategoria: Record<Categoria, number>; neto: number | null };
  comparacion: { costoReal: number; costoEstimado: number | null; diferencia: number | null; desviacionPct: number | null; horasReales: number; horasEstimadas: number | null; diferenciaHoras: number | null; margen: number | null };
  cargos: { codigo: string; etiqueta: string }[];
  sugerencias: { equipos: { id: string; codigo: string; nombre: string }[]; consumos: { id: string; codigo: string; nombre: string; unidad: string | null; cantidad: number }[] };
  resultadosSinAprobar: number;
  puedeGestionar: boolean;
  erroresCierre: string[];
}

const BLOQUES: { k: Categoria; titulo: string; cantidad: string; unitario: string; ayuda: string }[] = [
  { k: "horas_hombre", titulo: "Horas hombre", cantidad: "Horas", unitario: "$ / hora", ayuda: "Por cargo. La tarifa por hora la indica la jefatura (no consta en las fuentes recibidas)." },
  { k: "reactivos", titulo: "Reactivos y consumibles", cantidad: "Cantidad", unitario: "$ / unidad", ayuda: "Insumos usados en los ensayos de la OT (p. ej. acetileno, HCl, lámparas, Titrisol)." },
  { k: "equipos", titulo: "Equipos (horas máquina)", cantidad: "Horas", unitario: "$ / hora", ayuda: "Horas de uso de cada equipo con su tarifa estándar." },
  { k: "otros", titulo: "Otros", cantidad: "Cantidad", unitario: "$ unitario", ayuda: "Traslados, servicios externos u otros gastos directos." },
];
const FUENTE_COSTO: Record<string, string> = {
  costeo_consolidado: "costeo consolidado de la cotización",
  estimacion_laboratorio: "estimación del laboratorio en la cotización",
  costo_estimado_ot: "costo estimado de la OT",
};
const FUENTE_HORAS: Record<string, string> = {
  estimacion_laboratorio: "estimación del laboratorio",
  horas_ot: "horas hombre de la OT",
  lineas_cotizacion: "líneas de horas de la cotización",
};

let correlativo = 0;
const clave = () => `l${++correlativo}`;
const aTexto = (v: number | null | undefined) => (v == null ? "" : String(v).replace(".", ","));
const aNum = (s: string) => {
  const t = s.trim().replace(/\s/g, "");
  if (!t) return 0;
  return /^\d+([.,]\d+)?$/.test(t) ? Number(t.replace(",", ".")) : NaN;
};
const filaVacia = (k: Categoria): Fila => ({ clave: clave(), categoria: k, cargo: null, descripcion: "", cantidad: "", unidad: "", costoUnitario: "" });

export default function CostosRealesPage() {
  const { id } = useParams<{ id: string }>();
  const [v, setV] = useState<Vista | null>(null);
  const [error, setError] = useState("");
  const [unidadId, setUnidadId] = useState("");
  const [filas, setFilas] = useState<Fila[]>([]);
  const [obs, setObs] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [sucio, setSucio] = useState(false);
  const [reabriendo, setReabriendo] = useState(false);
  const [motivo, setMotivo] = useState("");

  const aplicar = (x: Vista) => {
    setV(x);
    setFilas(x.lineas.map((l) => ({ ...l, clave: clave(), cantidad: aTexto(l.cantidad), costoUnitario: aTexto(l.costoUnitario), descripcion: l.descripcion ?? l.consumibleNombre ?? (l.equipoNombre ? `${l.equipoCodigo ?? ""} ${l.equipoNombre}`.trim() : "") })));
    setObs(x.planilla?.observaciones ?? "");
    setSucio(false);
  };

  const cargar = useCallback(async () => {
    try {
      aplicar(await llamar<Vista>("GET", `/laboratorio/ot/${id}/costos-reales${qs({ unidadId })}`));
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }, [id, unidadId]);
  useEffect(() => { cargar(); }, [cargar]);
  // Avisa antes de salir con cambios sin guardar.
  useEffect(() => {
    if (!sucio) return;
    const aviso = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [sucio]);

  const editable = !!v?.puedeGestionar && v.planilla?.estado !== "cerrada" && v.ot.estado !== "anulada";
  const cambiar = (k: string, p: Partial<Fila>) => { setFilas((fs) => fs.map((f) => (f.clave === k ? { ...f, ...p } : f))); setSucio(true); };
  const quitar = (k: string) => { setFilas((fs) => fs.filter((f) => f.clave !== k)); setSucio(true); };
  const agregar = (f: Fila) => { setFilas((fs) => [...fs, f]); setSucio(true); };

  const totales = useMemo(() => {
    const t: Record<Categoria, number> = { horas_hombre: 0, reactivos: 0, equipos: 0, otros: 0 };
    for (const f of filas) {
      const c = aNum(f.cantidad), u = aNum(f.costoUnitario);
      if (Number.isFinite(c) && Number.isFinite(u)) t[f.categoria] += Math.round(c * u * 100) / 100;
    }
    return { ...t, total: t.horas_hombre + t.reactivos + t.equipos + t.otros };
  }, [filas]);

  async function guardar() {
    const malas = filas.filter((f) => !Number.isFinite(aNum(f.cantidad)) || !Number.isFinite(aNum(f.costoUnitario)));
    if (malas.length) return toast.error("Hay cantidades o costos que no son números (use coma decimal, sin separador de miles).");
    setOcupado(true);
    try {
      aplicar(await llamar<Vista>("PUT", `/laboratorio/ot/${id}/costos-reales`, {
        unidadId: v?.unidad?.id,
        observaciones: obs.trim() || null,
        lineas: filas.map((f) => ({
          categoria: f.categoria,
          cargo: f.categoria === "horas_hombre" ? f.cargo || null : null,
          consumibleId: f.categoria === "reactivos" ? f.consumibleId ?? null : null,
          equipoId: f.categoria === "equipos" ? f.equipoId ?? null : null,
          descripcion: f.descripcion?.trim() || null,
          cantidad: aNum(f.cantidad),
          unidad: f.unidad?.trim() || null,
          costoUnitario: aNum(f.costoUnitario),
        })),
      }));
      toast.ok("Planilla guardada como borrador.");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  }

  async function cerrar() {
    if (sucio) return toast.error("Guarde primero los cambios de la planilla.");
    setOcupado(true);
    try {
      aplicar(await llamar<Vista>("POST", `/laboratorio/ot/${id}/costos-reales/cerrar`, { unidadId: v?.unidad?.id }));
      toast.ok("Planilla de costos cerrada.");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  }

  async function reabrir() {
    if (motivo.trim().length < 5) return toast.error("Indique el motivo de la reapertura (mínimo 5 caracteres).");
    setOcupado(true);
    try {
      aplicar(await llamar<Vista>("POST", `/laboratorio/ot/${id}/costos-reales/reabrir`, { unidadId: v?.unidad?.id, motivo: motivo.trim() }));
      setReabriendo(false);
      setMotivo("");
      toast.ok("Planilla reabierta: corrija y vuelva a cerrarla.");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  }

  const codigo = v?.ot.codigo ?? "";
  const c = v?.comparacion;
  const est = v?.estimacion;
  return (
    <div>
      <PageHeader
        icono="💲"
        titulo="Planilla de costos reales"
        subtitulo={<>Control de gastos por OT (DCO-PG01-P05-IT03-FORM01) de la OT <b>{codigo}</b>, comparado con la estimación de la cotización{v?.cotizacion ? ` ${v.cotizacion.codigo}` : ""}.</>}
        migas={[{ label: "Expedientes / OT", href: "/ot" }, { label: codigo || "OT", href: `/ot/${id}` }, { label: "Costos reales" }]}
      />
      {error && <div className="alert warn" role="alert">{error}</div>}
      {!v && !error && <SkeletonCards n={4} />}

      {v && (
        <>
          <div className="card">
            <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
              {v.unidadesPosibles.length > 1 ? (
                <div className="field" style={{ minWidth: 260 }}>
                  <label htmlFor="lab">Laboratorio</label>
                  <select id="lab" value={v.unidad?.id ?? ""} onChange={(e) => setUnidadId(e.target.value)} disabled={sucio} title={sucio ? "Guarde los cambios antes de cambiar de laboratorio" : undefined}>
                    {v.unidadesPosibles.map((u) => <option key={u.id} value={u.id}>{u.codigo} · {u.nombre}{u.principal ? " (responsable)" : " (orden interna)"}</option>)}
                  </select>
                </div>
              ) : (
                <div><div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" }}>Laboratorio</div><b>{v.unidad ? `${v.unidad.codigo} · ${v.unidad.nombre}` : "—"}</b></div>
              )}
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" }}>Estado</div>
                <span className={`pill ${v.planilla?.estado === "cerrada" ? "green" : v.planilla ? "amber" : "gray"}`}>
                  {v.planilla?.estado === "cerrada" ? "Cerrada" : v.planilla ? "Borrador" : "Sin completar"}
                </span>
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", flex: 1, minWidth: 220 }}>
                {v.planilla?.cerradaAt && <div>Cerrada por {v.planilla.cerradaPor ?? "—"} · {fechaHora(v.planilla.cerradaAt)}</div>}
                {v.planilla?.actualizadaAt && <div>Última edición: {v.planilla.actualizadaPor ?? "—"} · {fechaHora(v.planilla.actualizadaAt)}</div>}
                {v.planilla?.reabiertaAt && <div>Reabierta por {v.planilla.reabiertaPor ?? "—"} · {fechaHora(v.planilla.reabiertaAt)} · motivo: {v.planilla.reabiertaMotivo}</div>}
              </div>
            </div>
            {!v.puedeGestionar && <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--muted)" }}>Solo lectura: la completa y cierra el Jefe de Laboratorio.</p>}
          </div>

          <div className="kpis">
            <div className="kpi k-blue"><div className="lab">Costo real</div><div className="val">{clp(sucio ? totales.total : c!.costoReal)}</div></div>
            <div className="kpi"><div className="lab">Costo directo estimado</div><div className="val">{c!.costoEstimado != null ? clp(c!.costoEstimado) : "—"}</div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>{est!.fuenteCosto ? FUENTE_COSTO[est!.fuenteCosto] : "La cotización no trae estimación de costo"}</div></div>
            <div className={`kpi ${c!.diferencia == null ? "" : c!.diferencia > 0 ? "k-red" : "k-green"}`}><div className="lab">Diferencia real − estimado</div>
              <div className="val">{c!.diferencia != null ? `${clp(c!.diferencia)}` : "—"}</div>
              {c!.desviacionPct != null && <div style={{ fontSize: 11, color: "var(--muted)" }}>{pct(c!.desviacionPct, 1)} sobre lo estimado</div>}</div>
            <div className="kpi k-violet"><div className="lab">Horas hombre (real / estimado)</div>
              <div className="val">{num(c!.horasReales, 2)} / {c!.horasEstimadas != null ? num(c!.horasEstimadas, 2) : "—"}</div>
              {est!.fuenteHoras && <div style={{ fontSize: 11, color: "var(--muted)" }}>{FUENTE_HORAS[est!.fuenteHoras]}</div>}</div>
            <div className="kpi k-amber"><div className="lab">Neto cotizado − costo real</div><div className="val">{c!.margen != null ? clp(c!.margen) : "—"}</div></div>
          </div>
          {sucio && <div className="alert info">Hay cambios sin guardar: los indicadores del servidor se actualizan al guardar.</div>}

          {BLOQUES.map((b) => {
            const propias = filas.filter((f) => f.categoria === b.k);
            const cotizado = v.estimacion.cotizadoPorCategoria[b.k];
            return (
              <div className="card" key={b.k}>
                <h2>
                  {b.titulo}
                  <span className="right" style={{ fontSize: 13 }}>
                    Subtotal <b>{clp(totales[b.k])}</b>{cotizado > 0 && <span style={{ color: "var(--muted)", fontWeight: 400 }}> · cotizado (precio) {clp(cotizado)}</span>}
                  </span>
                </h2>
                <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--muted)" }}>{b.ayuda}</p>
                {propias.length > 0 ? (
                  <div style={{ overflowX: "auto" }}>
                    <table className="data">
                      <thead>
                        <tr>
                          {b.k === "horas_hombre" && <th>Cargo</th>}
                          <th>{b.k === "horas_hombre" ? "Detalle (opcional)" : b.k === "reactivos" ? "Reactivo o consumible" : b.k === "equipos" ? "Equipo" : "Descripción"}</th>
                          <th className="num">{b.cantidad}</th>
                          {b.k !== "horas_hombre" && b.k !== "equipos" && <th>Unidad</th>}
                          <th className="num">{b.unitario}</th>
                          <th className="num">Total</th>
                          {editable && <th aria-label="Quitar"></th>}
                        </tr>
                      </thead>
                      <tbody>
                        {propias.map((f) => {
                          const tot = aNum(f.cantidad) * aNum(f.costoUnitario);
                          return (
                            <tr key={f.clave}>
                              {b.k === "horas_hombre" && (
                                <td>
                                  {editable ? (
                                    <select aria-label="Cargo" value={f.cargo ?? ""} onChange={(e) => cambiar(f.clave, { cargo: e.target.value || null })}>
                                      <option value="">Elija el cargo…</option>
                                      {v.cargos.map((x) => <option key={x.codigo} value={x.codigo}>{x.etiqueta}</option>)}
                                    </select>
                                  ) : v.cargos.find((x) => x.codigo === f.cargo)?.etiqueta ?? f.cargo ?? "—"}
                                </td>
                              )}
                              <td>{editable ? <input aria-label="Descripción" value={f.descripcion ?? ""} maxLength={300} onChange={(e) => cambiar(f.clave, { descripcion: e.target.value })} /> : f.descripcion || "—"}</td>
                              <td className="num">{editable ? <input aria-label={b.cantidad} inputMode="decimal" value={f.cantidad} style={{ width: 90, textAlign: "right" }} onChange={(e) => cambiar(f.clave, { cantidad: e.target.value })} /> : f.cantidad}</td>
                              {b.k !== "horas_hombre" && b.k !== "equipos" && (
                                <td>{editable ? <input aria-label="Unidad" value={f.unidad ?? ""} maxLength={20} style={{ width: 70 }} onChange={(e) => cambiar(f.clave, { unidad: e.target.value })} /> : f.unidad || "—"}</td>
                              )}
                              <td className="num">{editable ? <input aria-label={b.unitario} inputMode="decimal" value={f.costoUnitario} style={{ width: 110, textAlign: "right" }} onChange={(e) => cambiar(f.clave, { costoUnitario: e.target.value })} /> : clp(aNum(f.costoUnitario))}</td>
                              <td className="num">{Number.isFinite(tot) ? clp(Math.round(tot * 100) / 100) : <span className="pill red">revise</span>}</td>
                              {editable && <td><button className="btn outline sm" onClick={() => quitar(f.clave)} title="Quitar la línea" aria-label="Quitar la línea">✕</button></td>}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p style={{ margin: 0, fontSize: 12.5, color: "var(--muted)" }}>Sin líneas.</p>
                )}
                {editable && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
                    <button className="btn outline sm" onClick={() => agregar(filaVacia(b.k))}>＋ Agregar línea</button>
                    {b.k === "equipos" && v.sugerencias.equipos.filter((e) => !filas.some((f) => f.equipoId === e.id)).map((e) => (
                      <button key={e.id} className="btn outline sm" title="Equipo usado en los ensayos de la OT"
                        onClick={() => agregar({ ...filaVacia("equipos"), equipoId: e.id, descripcion: `${e.codigo} ${e.nombre}`.trim(), unidad: "h" })}>
                        ＋ {e.codigo}
                      </button>
                    ))}
                    {b.k === "reactivos" && v.sugerencias.consumos.filter((x) => !filas.some((f) => f.consumibleId === x.id)).map((x) => (
                      <button key={x.id} className="btn outline sm" title="Consumo registrado en el kardex sobre las muestras de la OT"
                        onClick={() => agregar({ ...filaVacia("reactivos"), consumibleId: x.id, descripcion: x.nombre, cantidad: aTexto(x.cantidad), unidad: x.unidad ?? "" })}>
                        ＋ {x.nombre} ({num(x.cantidad, 2)} {x.unidad ?? ""})
                      </button>
                    ))}
                    {(b.k === "equipos" && v.sugerencias.equipos.length > 0) || (b.k === "reactivos" && v.sugerencias.consumos.length > 0)
                      ? <span style={{ fontSize: 11.5, color: "var(--muted)" }}>Sugeridos desde los ensayos y el kardex de la OT.</span> : null}
                  </div>
                )}
              </div>
            );
          })}

          <div className="card">
            <div className="field">
              <label htmlFor="obs">Observaciones</label>
              <textarea id="obs" rows={3} value={obs} readOnly={!editable} maxLength={4000} onChange={(e) => { setObs(e.target.value); setSucio(true); }} />
            </div>
            {v.planilla?.estado !== "cerrada" && v.erroresCierre.length > 0 && (
              <div className="alert info" style={{ marginTop: 8 }}>
                Para cerrar la planilla: <ul style={{ margin: "4px 0 0 18px" }}>{v.erroresCierre.map((x) => <li key={x}>{x}</li>)}</ul>
              </div>
            )}
            {v.puedeGestionar && (
              <div className="toolbar" style={{ marginTop: 8 }}>
                <div className="spacer" />
                {editable && <button className="btn outline sm" disabled={ocupado || !sucio} onClick={guardar}>{ocupado ? "Guardando…" : "Guardar borrador"}</button>}
                {editable && <button className="btn primary sm" disabled={ocupado || sucio || v.erroresCierre.length > 0} onClick={cerrar}
                  title={sucio ? "Guarde primero" : v.erroresCierre.join(" ")}>Cerrar planilla</button>}
                {v.planilla?.estado === "cerrada" && !reabriendo && <button className="btn outline sm" onClick={() => setReabriendo(true)}>Reabrir para corregir</button>}
              </div>
            )}
            {reabriendo && (
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginTop: 8 }}>
                <div className="field" style={{ flex: 1, minWidth: 260 }}>
                  <label htmlFor="motivo">Motivo de la reapertura <span className="req">*</span></label>
                  <input id="motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={1000} autoFocus placeholder="Qué hay que corregir y por qué" />
                </div>
                <button className="btn outline sm" onClick={() => setReabriendo(false)}>Cancelar</button>
                <button className="btn primary sm" disabled={ocupado} onClick={reabrir}>Reabrir</button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
