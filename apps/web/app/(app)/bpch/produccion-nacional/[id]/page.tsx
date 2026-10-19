"use client";

/**
 * Ficha de la O/C operativa anual (Producción Nacional, BPCH):
 *  · productos y consumo (autorizado, planificado, comprometido, ejecutado, saldo);
 *  · programa de inspecciones: una línea = una visita o lote = una OT que sigue
 *    el flujo general; estado de cada línea y avance (planificadas, en curso,
 *    ejecutadas, atrasadas);
 *  · correlación con la relación de ventas e informe técnico a DCO.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { toast, confirmar } from "@/components/ui/feedback";
import Modal from "@/components/documentos/Modal";
import { usePermisos } from "@/lib/permisos";
import { llamar } from "@/lib/laboratorio";
import { rut } from "@/lib/format";
import { ESTADO_CORRELACION, ESTADO_LINEA, ESTADO_OC, MESES, MESES_LARGOS, cant, dia, numeroCl } from "@/lib/bpchProcesos";
import ClasificacionProducto from "./ClasificacionProducto";

const vacioLinea = { ocProductoId: "", unidadId: "", mes: "", fechaProgramada: "", lugar: "", lote: "", cantidad: "", observaciones: "" };

export default function OcPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { puede } = usePermisos();
  const [oc, setOc] = useState<any>(null);
  const [unidades, setUnidades] = useState<{ id: string; codigo: string; nombre: string }[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [nueva, setNueva] = useState({ ...vacioLinea });
  const [editar, setEditar] = useState<any>(null);
  const [anularLinea, setAnularLinea] = useState<any>(null);
  const [motivo, setMotivo] = useState("");
  const [modalOc, setModalOc] = useState<"anular" | null>(null);
  const [corrModal, setCorrModal] = useState(false);
  const [producto, setProducto] = useState<{ producto: string; unidadMedida: string; cantidadAutorizada: string } | null>(null);
  const [clasProducto, setClasProducto] = useState<any>(null);

  const cargar = useCallback(async () => {
    try {
      setOc(await llamar("GET", `/bpch/pn/oc/${id}`));
    } catch (e: any) {
      setError(e.message);
    }
  }, [id]);

  useEffect(() => {
    cargar();
    llamar<{ unidades: any[] }>("GET", "/bpch/pn/config").then((c) => setUnidades(c.unidades)).catch(() => setUnidades([]));
  }, [cargar]);

  const gestionar = puede("bpch.pn.gestionar");
  const programar = puede("bpch.pn.programar");
  const vigente = oc?.estado === "vigente";
  const mesesVigencia = useMemo(() => {
    if (!oc) return [];
    return MESES.map((m, i) => ({ n: i + 1, m })).filter(({ n }) => {
      const desde = `${oc.anio}-${String(n).padStart(2, "0")}-01`;
      const hasta = `${oc.anio}-${String(n).padStart(2, "0")}-31`;
      return hasta >= oc.vigenciaDesde && desde <= oc.vigenciaHasta;
    });
  }, [oc]);

  async function ejecutar<T>(fn: () => Promise<T>, ok: string): Promise<T | null> {
    setError("");
    setBusy(true);
    try {
      const r = await fn();
      toast.ok(ok);
      return r;
    } catch (e: any) {
      setError(e.message);
      toast.error(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function programarLinea() {
    if (!nueva.ocProductoId || !nueva.unidadId || !nueva.mes) {
      setError("Indique producto, sucursal y mes de la inspección.");
      return;
    }
    const cantidad = nueva.cantidad.trim() ? numeroCl(nueva.cantidad) : null;
    const r = await ejecutar(
      () => llamar("POST", `/bpch/pn/oc/${id}/programa`, { lineas: [{ ...nueva, mes: Number(nueva.mes), cantidad }] }),
      "Inspección programada.",
    );
    if (r) {
      setOc(r);
      setNueva({ ...vacioLinea, ocProductoId: nueva.ocProductoId, unidadId: nueva.unidadId });
    }
  }

  async function generarOt(l: any) {
    const ok = await confirmar({
      titulo: `¿Generar la OT de la inspección de ${MESES_LARGOS[l.mes - 1]}?`,
      mensaje: `${l.producto} · ${l.unidad.codigo}${l.lote ? ` · lote ${l.lote}` : ""}. La OT sigue el flujo general: registro de muestras, captura, revisión, aprobación, informe de inspección, firma, entrega y cierre.`,
      confirmarTexto: "Generar OT",
    });
    if (!ok) return;
    const r = await ejecutar(() => llamar<any>("POST", `/bpch/pn/programa/${l.id}/generar-ot`), "OT generada.");
    if (r) {
      setOc(r.oc);
      for (const a of r.avisos ?? []) toast.info(a);
    }
  }

  if (!oc) return <div>{error ? <div className="alert warn">{error}</div> : <p style={{ color: "var(--muted)" }}>Cargando…</p>}</div>;
  const est = ESTADO_OC[oc.estado];
  const r = oc.resumen;

  return (
    <div>
      <PageHeader
        icono="🏭"
        titulo={<>O/C operativa {oc.numero} <span className={`pill ${est?.pill}`} style={{ verticalAlign: "middle" }}>{est?.texto}</span></>}
        subtitulo={<>
          {oc.cliente.razonSocial} ({rut(oc.cliente.rut)}) · RAF {oc.raf.numero} · línea {oc.raf.tipoLinea === "MOVIL" ? "móvil (camión fábrica)" : "fija"}{oc.raf.planta ? ` · ${oc.raf.planta}` : ""} · vigencia {dia(oc.vigenciaDesde)} a {dia(oc.vigenciaHasta)} · {oc.conCobro ? "con cobro" : "sin cobro"}
        </>}
        migas={[{ label: "BPCH" }, { label: "Producción Nacional", href: "/bpch/produccion-nacional" }, { label: oc.numero }]}
        acciones={
          gestionar && vigente ? (
            <>
              <button className="btn outline sm" disabled={busy} onClick={async () => {
                if (await confirmar({ titulo: "¿Cerrar la O/C?", mensaje: "No se podrán programar más inspecciones ni generar OT con ella.", confirmarTexto: "Cerrar O/C" })) {
                  const x = await ejecutar(() => llamar("POST", `/bpch/pn/oc/${id}/cerrar`), "O/C cerrada.");
                  if (x) setOc(x);
                }
              }}>Cerrar O/C</button>
              <button className="btn danger sm" onClick={() => { setMotivo(""); setModalOc("anular"); }}>Anular</button>
            </>
          ) : null
        }
      />
      {error && <div className="alert warn" role="alert">{error}</div>}
      {oc.raf.estado !== "vigente" && <div className="alert warn">La RAF {oc.raf.numero} está anulada.</div>}
      {oc.raf.vigenciaHasta && oc.raf.vigenciaHasta < new Date().toISOString().slice(0, 10) && (
        <div className="alert warn">La RAF venció el {dia(oc.raf.vigenciaHasta)}: según SAC-PG01-IT08 es un defecto crítico de la inspección.</div>
      )}
      {oc.raf.tipoLinea === "MOVIL" && <div className="alert info">Línea móvil (camión fábrica): SAC-PG01-IT10 excluye estos productos del muestreo por atributos NCh 44.</div>}

      <div className="kpis" aria-label="Avance del programa">
        <div className="kpi"><div className="lab">Inspecciones programadas</div><div className="val">{r.total}</div></div>
        <div className="kpi k-blue"><div className="lab">Planificadas sin OT</div><div className="val">{r.planificadas}</div></div>
        <div className="kpi k-violet"><div className="lab">OT en curso</div><div className="val">{r.enCurso}</div></div>
        <div className="kpi k-green"><div className="lab">Ejecutadas (OT cerrada)</div><div className="val">{r.ejecutadas}</div></div>
        <div className={`kpi ${r.atrasadas ? "k-red" : ""}`}><div className="lab">Atrasadas (mes vencido sin OT)</div><div className="val">{r.atrasadas}</div></div>
      </div>

      {/* Productos y consumo */}
      <div className="card" style={{ padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <h2 style={{ fontSize: 14, margin: 0 }}>Productos y consumo de la O/C</h2>
          {gestionar && vigente && <button className="btn outline sm" onClick={() => setProducto({ producto: "", unidadMedida: "", cantidadAutorizada: "" })}>＋ Producto</button>}
        </div>
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 8px" }}>
          Consume lo que tiene OT: en curso = comprometido; cerrada = ejecutado. Lo planificado sin OT no descuenta. Si se supera lo autorizado, se avisa.
        </p>
        <div style={{ overflowX: "auto" }}>
          <table className="data">
            <thead>
              <tr><th>Producto</th><th>Clasificación</th><th className="num">Autorizado</th><th className="num">Planificado</th><th className="num">Comprometido</th><th className="num">Ejecutado</th><th className="num">Saldo</th><th>Avance</th></tr>
            </thead>
            <tbody>
              {oc.consumo.map((c: any) => {
                const p = oc.productos.find((x: any) => x.id === c.ocProductoId);
                return (
                  <tr key={c.ocProductoId}>
                    <td>{c.producto} <small style={{ color: "var(--muted)" }}>({c.unidadMedida})</small></td>
                    <td>
                      {p?.clasificacion ? <Link href={`/bpch/clasificaciones/${p.clasificacion.id}` as any}>{p.clasificacion.codigo}</Link> : <span style={{ color: "var(--muted)" }}>Sin clasificación</span>}
                      {gestionar && vigente && p && (
                        <button type="button" className="btn outline sm" style={{ marginLeft: 6 }} onClick={() => setClasProducto(p)}
                          aria-label={`${p.clasificacion ? "Cambiar" : "Asociar"} la clasificación de ${p.producto}`}>
                          {p.clasificacion ? "Cambiar" : "Asociar"}
                        </button>
                      )}
                      {!!p?.historialClasificacion?.length && (
                        <small style={{ display: "block", color: "var(--muted)" }}>{p.historialClasificacion.length} cambio(s) · ver en «{p.clasificacion ? "Cambiar" : "Asociar"}»</small>
                      )}
                    </td>
                    <td className="num">{cant(c.autorizado)}</td>
                    <td className="num">{cant(c.planificado)}</td>
                    <td className="num">{cant(c.comprometido)}</td>
                    <td className="num">{cant(c.ejecutado)}</td>
                    <td className="num" style={{ color: c.excedido ? "var(--red)" : undefined, fontWeight: c.excedido ? 700 : undefined }}>{cant(c.saldo)}{c.excedido ? " · excedido" : ""}</td>
                    <td style={{ minWidth: 120 }}>
                      <div role="progressbar" aria-valuenow={c.porcentajeEjecutado} aria-valuemin={0} aria-valuemax={100} aria-label={`Ejecutado ${c.porcentajeEjecutado} %`}
                        style={{ height: 8, background: "#eef3f7", borderRadius: 4, overflow: "hidden" }}>
                        <div style={{ width: `${Math.min(100, c.porcentajeEjecutado)}%`, height: "100%", background: c.excedido ? "var(--red)" : "var(--green)" }} />
                      </div>
                      <small style={{ color: "var(--muted)" }}>{c.porcentajeEjecutado} % ejecutado{c.lineasSinCantidad ? ` · ${c.lineasSinCantidad} OT sin cantidad` : ""}</small>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Programa */}
      <div className="card" style={{ padding: 14 }}>
        <h2 style={{ fontSize: 14, margin: "0 0 4px" }}>Programa de inspecciones {oc.anio}</h2>
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 8px" }}>
          Cada inspección (visita o lote) genera su OT, asignada a la sucursal. La programación la hace la propia sucursal; la SCC puede programar y generar las OT de cualquiera.
        </p>
        <div style={{ overflowX: "auto" }}>
          <table className="data">
            <thead>
              <tr><th>Mes</th><th>Sucursal</th><th>Producto</th><th>Lugar</th><th>Lote</th><th className="num">Cantidad</th><th>Estado</th><th>OT</th><th>Acciones</th></tr>
            </thead>
            <tbody>
              {oc.programa.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--muted)", padding: 18 }}>Aún no hay inspecciones programadas.</td></tr>
              )}
              {oc.programa.map((l: any) => (
                <tr key={l.id} style={l.estado === "anulada" ? { opacity: 0.55 } : undefined}>
                  <td>{MESES[l.mes - 1]}{l.fechaProgramada ? <small style={{ display: "block", color: "var(--muted)" }}>{dia(l.fechaProgramada)}</small> : null}</td>
                  <td title={l.unidad.nombre}>{l.unidad.codigo}</td>
                  <td>{l.producto}</td>
                  <td>{l.lugar ?? "—"}</td>
                  <td>{l.lote ?? "—"}</td>
                  <td className="num">{l.cantidad !== null ? `${cant(l.cantidad)} ${l.unidadMedida}` : "—"}</td>
                  <td><span className={`pill ${ESTADO_LINEA[l.estado]?.pill}`} title={l.anulada?.motivo ?? undefined}>{ESTADO_LINEA[l.estado]?.texto}</span></td>
                  <td>{l.ot ? <Link href={`/ot/${l.ot.id}` as any} className="codigo" style={{ textDecoration: "underline" }}>{l.ot.codigo}</Link> : "—"}</td>
                  <td>
                    {programar && (
                      <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {l.puedeGenerarOt && vigente && <button className="btn primary sm" disabled={busy} onClick={() => generarOt(l)}>Generar OT</button>}
                        {["planificada", "en_curso", "ot_anulada"].includes(l.estado) && (
                          <button className="btn outline sm" onClick={() => setEditar({ ...l, fechaProgramada: l.fechaProgramada ?? "", lugar: l.lugar ?? "", lote: l.lote ?? "", cantidad: l.cantidad === null ? "" : String(l.cantidad).replace(".", ","), observaciones: l.observaciones ?? "" })}>
                            {l.estado === "en_curso" ? "Lote y cantidad" : "Editar"}
                          </button>
                        )}
                        {["planificada", "ot_anulada"].includes(l.estado) && <button className="btn outline sm" onClick={() => { setMotivo(""); setAnularLinea(l); }}>Anular</button>}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {programar && vigente && (
          <fieldset style={{ border: "1px dashed var(--line)", borderRadius: 8, padding: 10, marginTop: 12 }}>
            <legend style={{ fontSize: 12.5, fontWeight: 700 }}>Programar inspección</legend>
            <div className="form-grid cols-4">
              <div className="field">
                <label htmlFor="n-prod">Producto <span className="req">*</span></label>
                <select id="n-prod" value={nueva.ocProductoId} onChange={(e) => setNueva({ ...nueva, ocProductoId: e.target.value })}>
                  <option value="">— Seleccione —</option>
                  {oc.productos.map((p: any) => <option key={p.id} value={p.id}>{p.producto} ({p.unidadMedida})</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="n-uni">Sucursal / delegación <span className="req">*</span></label>
                <select id="n-uni" value={nueva.unidadId} onChange={(e) => setNueva({ ...nueva, unidadId: e.target.value })}>
                  <option value="">— Seleccione —</option>
                  {unidades.map((u) => <option key={u.id} value={u.id}>{u.codigo} · {u.nombre}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="n-mes">Mes <span className="req">*</span></label>
                <select id="n-mes" value={nueva.mes} onChange={(e) => setNueva({ ...nueva, mes: e.target.value })}>
                  <option value="">— Seleccione —</option>
                  {mesesVigencia.map(({ n, m }) => <option key={n} value={n}>{m} {oc.anio}</option>)}
                </select>
              </div>
              <div className="field"><label htmlFor="n-fecha">Fecha programada</label><input id="n-fecha" type="date" value={nueva.fechaProgramada} onChange={(e) => setNueva({ ...nueva, fechaProgramada: e.target.value })} /></div>
              <div className="field"><label htmlFor="n-lugar">Lugar de inspección</label><input id="n-lugar" value={nueva.lugar} onChange={(e) => setNueva({ ...nueva, lugar: e.target.value })} maxLength={200} placeholder={oc.raf.planta ?? "Planta / faena"} /></div>
              <div className="field"><label htmlFor="n-lote">Lote</label><input id="n-lote" value={nueva.lote} onChange={(e) => setNueva({ ...nueva, lote: e.target.value })} maxLength={120} /></div>
              <div className="field"><label htmlFor="n-cant">Cantidad</label><input id="n-cant" inputMode="decimal" value={nueva.cantidad} onChange={(e) => setNueva({ ...nueva, cantidad: e.target.value })} placeholder="Se puede completar después" /></div>
              <div className="field" style={{ justifyContent: "flex-end" }}>
                <button className="btn primary sm" disabled={busy} onClick={programarLinea}>Programar</button>
              </div>
            </div>
          </fieldset>
        )}
      </div>

      {/* Correlación */}
      <div className="card" style={{ padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <h2 style={{ fontSize: 14, margin: 0 }}>Correlación con la relación de ventas · informe técnico a DCO</h2>
          {gestionar && oc.estado !== "anulada" && <button className="btn outline sm" onClick={() => setCorrModal(true)}>＋ Registrar relación de ventas</button>}
        </div>
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 8px" }}>
          La SCC recibe la relación de ventas del fabricante y la correlaciona con las inspecciones ejecutadas del período. Si no es conforme, pide información a la Sucursal (y, si no responde, a la DGMN) y emite el informe con propuesta técnica.
        </p>
        {oc.correlaciones.length === 0 ? (
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 12.5 }}>Sin correlaciones registradas.</p>
        ) : (
          <table className="data">
            <thead><tr><th>Período</th><th>Conformidad</th><th>Estado</th><th>Informe técnico</th><th /></tr></thead>
            <tbody>
              {oc.correlaciones.map((c: any) => (
                <tr key={c.id}>
                  <td>{dia(c.periodoDesde)} a {dia(c.periodoHasta)}</td>
                  <td>{c.conforme === true ? <span className="pill green">Conforme</span> : c.conforme === false ? <span className="pill red">No conforme</span> : "—"}</td>
                  <td><span className={`pill ${ESTADO_CORRELACION[c.estado]?.pill}`}>{ESTADO_CORRELACION[c.estado]?.texto}</span></td>
                  <td>{c.informeNumero ?? "—"}</td>
                  <td><Link href={`/bpch/produccion-nacional/correlacion/${c.id}` as any} className="btn outline sm">Abrir</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editar && (
        <Modal
          titulo={`Inspección de ${MESES_LARGOS[editar.mes - 1]} · ${editar.producto}`}
          onCerrar={() => setEditar(null)}
          ancho={620}
          acciones={
            <>
              <button className="btn outline sm" onClick={() => setEditar(null)}>Cancelar</button>
              <button className="btn primary sm" disabled={busy} onClick={async () => {
                const cuerpo: any = { lote: editar.lote, cantidad: editar.cantidad.trim() ? numeroCl(editar.cantidad) : null, lugar: editar.lugar, observaciones: editar.observaciones };
                if (editar.estado !== "en_curso") cuerpo.fechaProgramada = editar.fechaProgramada;
                const x = await ejecutar(() => llamar("PATCH", `/bpch/pn/programa/${editar.id}`, cuerpo), "Inspección actualizada.");
                if (x) { setOc(x); setEditar(null); }
              }}>Guardar</button>
            </>
          }
        >
          {editar.estado === "en_curso" && <p style={{ marginTop: 0, color: "var(--muted)" }}>Con la OT {editar.ot?.codigo} en curso solo se completan el lugar, el lote y la cantidad inspeccionada.</p>}
          <div className="form-grid cols-2">
            {editar.estado !== "en_curso" && <div className="field"><label htmlFor="e-f">Fecha programada</label><input id="e-f" type="date" value={editar.fechaProgramada} onChange={(e) => setEditar({ ...editar, fechaProgramada: e.target.value })} /></div>}
            <div className="field"><label htmlFor="e-l">Lugar</label><input id="e-l" value={editar.lugar} onChange={(e) => setEditar({ ...editar, lugar: e.target.value })} maxLength={200} /></div>
            <div className="field"><label htmlFor="e-lote">Lote</label><input id="e-lote" value={editar.lote} onChange={(e) => setEditar({ ...editar, lote: e.target.value })} maxLength={120} /></div>
            <div className="field"><label htmlFor="e-c">Cantidad ({editar.unidadMedida})</label><input id="e-c" inputMode="decimal" value={editar.cantidad} onChange={(e) => setEditar({ ...editar, cantidad: e.target.value })} /></div>
            <div className="field span-2"><label htmlFor="e-o">Observaciones</label><input id="e-o" value={editar.observaciones} onChange={(e) => setEditar({ ...editar, observaciones: e.target.value })} /></div>
          </div>
        </Modal>
      )}

      {(anularLinea || modalOc === "anular") && (
        <Modal
          titulo={anularLinea ? "Anular la inspección programada" : `Anular la O/C ${oc.numero}`}
          onCerrar={() => { setAnularLinea(null); setModalOc(null); }}
          acciones={
            <>
              <button className="btn outline sm" onClick={() => { setAnularLinea(null); setModalOc(null); }}>Cancelar</button>
              <button className="btn danger sm" disabled={busy || motivo.trim().length < 5} onClick={async () => {
                const ruta = anularLinea ? `/bpch/pn/programa/${anularLinea.id}/anular` : `/bpch/pn/oc/${id}/anular`;
                const x = await ejecutar(() => llamar("POST", ruta, { motivo }), anularLinea ? "Inspección anulada." : "O/C anulada.");
                if (x) { setOc(x); setAnularLinea(null); setModalOc(null); }
              }}>Anular</button>
            </>
          }
        >
          {!anularLinea && <p style={{ marginTop: 0 }}>Solo se anula una O/C que no ha generado OT.</p>}
          <div className="field">
            <label htmlFor="mot">Motivo <span className="req">*</span></label>
            <textarea id="mot" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </div>
        </Modal>
      )}

      {producto && (
        <Modal
          titulo="Agregar producto a la O/C"
          onCerrar={() => setProducto(null)}
          acciones={
            <>
              <button className="btn outline sm" onClick={() => setProducto(null)}>Cancelar</button>
              <button className="btn primary sm" disabled={busy || !producto.producto.trim() || !producto.unidadMedida.trim() || !producto.cantidadAutorizada.trim()} onClick={async () => {
                const x = await ejecutar(() => llamar("POST", `/bpch/pn/oc/${id}/productos`, { ...producto, cantidadAutorizada: numeroCl(producto.cantidadAutorizada) }), "Producto agregado.");
                if (x) { setOc(x); setProducto(null); }
              }}>Agregar</button>
            </>
          }
        >
          <div className="form-grid">
            <div className="field span-3"><label htmlFor="p-n">Producto <span className="req">*</span></label><input id="p-n" value={producto.producto} onChange={(e) => setProducto({ ...producto, producto: e.target.value })} maxLength={240} /></div>
            <div className="field"><label htmlFor="p-u">Unidad <span className="req">*</span></label><input id="p-u" value={producto.unidadMedida} onChange={(e) => setProducto({ ...producto, unidadMedida: e.target.value })} maxLength={20} placeholder="t, kg, u, m" /></div>
            <div className="field"><label htmlFor="p-c">Cantidad autorizada <span className="req">*</span></label><input id="p-c" inputMode="decimal" value={producto.cantidadAutorizada} onChange={(e) => setProducto({ ...producto, cantidadAutorizada: e.target.value })} /></div>
          </div>
        </Modal>
      )}

      {clasProducto && (
        <ClasificacionProducto ocId={id} producto={clasProducto} onCerrar={() => setClasProducto(null)}
          onGuardada={(x) => { setOc(x); setClasProducto(null); }} />
      )}

      {corrModal && <NuevaCorrelacion oc={oc} onCerrar={() => setCorrModal(false)} onCreada={(c) => router.push(`/bpch/produccion-nacional/correlacion/${c.id}` as any)} />}
    </div>
  );
}

function NuevaCorrelacion({ oc, onCerrar, onCreada }: { oc: any; onCerrar: () => void; onCreada: (c: any) => void }) {
  const [desde, setDesde] = useState(oc.vigenciaDesde);
  const [hasta, setHasta] = useState(new Date().toISOString().slice(0, 10) < oc.vigenciaHasta ? new Date().toISOString().slice(0, 10) : oc.vigenciaHasta);
  const [ref, setRef] = useState("");
  const [fechaRef, setFechaRef] = useState("");
  const [ventas, setVentas] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function crear() {
    setError("");
    setBusy(true);
    try {
      const filas = Object.entries(ventas).filter(([, v]) => v.trim() !== "").map(([ocProductoId, v]) => ({ ocProductoId, cantidad: numeroCl(v) }));
      const c = await llamar("POST", `/bpch/pn/oc/${oc.id}/correlaciones`, { periodoDesde: desde, periodoHasta: hasta, relacionVentasRef: ref, relacionVentasAt: fechaRef, ventas: filas });
      toast.ok("Relación de ventas registrada.");
      onCreada(c);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      titulo="Registrar relación de ventas"
      onCerrar={onCerrar}
      ancho={640}
      acciones={
        <>
          <button className="btn outline sm" onClick={onCerrar}>Cancelar</button>
          <button className="btn primary sm" disabled={busy || !desde || !hasta} onClick={crear}>Registrar y correlacionar</button>
        </>
      }
    >
      {error && <div className="alert warn" role="alert">{error}</div>}
      <div className="form-grid cols-2">
        <div className="field"><label htmlFor="c-d">Período desde <span className="req">*</span></label><input id="c-d" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
        <div className="field"><label htmlFor="c-h">Período hasta <span className="req">*</span></label><input id="c-h" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
        <div className="field"><label htmlFor="c-r">Relación de ventas (referencia)</label><input id="c-r" value={ref} onChange={(e) => setRef(e.target.value)} maxLength={200} placeholder="Documento o correo del fabricante" /></div>
        <div className="field"><label htmlFor="c-f">Fecha de recepción</label><input id="c-f" type="date" value={fechaRef} onChange={(e) => setFechaRef(e.target.value)} /></div>
      </div>
      <table className="data" style={{ marginTop: 10 }}>
        <thead><tr><th>Producto</th><th className="num">Declarado en ventas</th></tr></thead>
        <tbody>
          {oc.productos.map((p: any) => (
            <tr key={p.id}>
              <td>{p.producto} <small style={{ color: "var(--muted)" }}>({p.unidadMedida})</small></td>
              <td className="num"><input aria-label={`Ventas de ${p.producto}`} inputMode="decimal" value={ventas[p.id] ?? ""} onChange={(e) => setVentas({ ...ventas, [p.id]: e.target.value })} style={{ width: 130, textAlign: "right" }} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
