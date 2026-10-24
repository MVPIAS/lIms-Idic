"use client";

/**
 * InstrumentosOt · pestaña «Instrumentos» de una OT de calibración (EP-04):
 * ítems de la OT, programación del metrólogo, recepción con custodia, calibrar
 * desde el ítem, entrega del certificado, devolución con acta y cierre técnico.
 * Con `modo="cierre"` muestra solo los certificados de calibración de la OT
 * (pestaña «Informe y cierre»). Todo lo decide el servidor (GET /ot/:id/metrologia):
 * aquí solo se pinta lo que devuelve y se ofrecen las acciones que permite.
 */
import { avisarCambioOt, useCambiosOt } from "@/lib/refresco";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { llamar } from "@/lib/laboratorio";
import { fechaHora, fechaDia } from "@/lib/format";
import { toast, confirmar } from "@/components/ui/feedback";
import { MEDIOS_ENTREGA, textoMedio } from "@/lib/documentos";
import Modal from "@/components/documentos/Modal";
import css from "./ficha.module.css";
import NoCalibrables from "./NoCalibrables";
import {
  ESTADO_CALIBRACION, ESTADO_INSTRUMENTO, ESTADOS_FISICOS, SENTIDOS, ahoraLocal, imprimirActaDevolucion, imprimirEtiqueta, imprimirRecepcion,
} from "@/lib/metrologiaOt";

type Dialogo =
  | { tipo: "item"; item?: any }
  | { tipo: "asignar"; item: any }
  | { tipo: "recibir"; item: any }
  | { tipo: "entregar"; item: any }
  | { tipo: "devolver"; item: any }
  | { tipo: "anular"; item: any };

const vacioItem = () => ({ descripcion: "", marca: "", modelo: "", serie: "", idEspecial: "", capacidad: "", resolucion: "", rango: "", procesoCodigo: "", sentido: "", puntos: "", intervaloMeses: "", equipoCodigo: "" });

export default function InstrumentosOt({ otId, onCambio, modo = "instrumentos" }: { otId: string; onCambio?: () => void; modo?: "instrumentos" | "cierre" }) {
  const router = useRouter();
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState("");
  const [dlg, setDlg] = useState<Dialogo | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    try { setD(await llamar("GET", `/ot/${otId}/metrologia`)); setError(""); }
    catch (e: any) { setError(e.message); }
  }, [otId]);
  useEffect(() => { cargar(); }, [cargar]);
  useCambiosOt(otId, cargar);

  async function hacer(metodo: "POST" | "PUT", ruta: string, cuerpo: unknown, okTexto: string) {
    setOcupado(true);
    try {
      await llamar(metodo, ruta, cuerpo);
      toast.ok(okTexto);
      setDlg(null);
      await cargar();
      onCambio?.();
      avisarCambioOt(otId);
      return true;
    } catch (e: any) { toast.error(e.message); return false; }
    finally { setOcupado(false); }
  }

  async function desdeCotizacion() {
    setOcupado(true);
    try {
      const r = await llamar("POST", `/ot/${otId}/instrumentos/desde-cotizacion`);
      toast.ok(r.data.creados ? `Se registraron ${r.data.creados} instrumento(s) desde la cotización.` : "Las líneas de la cotización ya estaban cargadas.");
      await cargar(); onCambio?.(); avisarCambioOt(otId);
    } catch (e: any) { toast.error(e.message); }
    finally { setOcupado(false); }
  }

  async function cierreTecnico() {
    const ok = await confirmar({
      titulo: `¿Cerrar técnicamente la OT ${d.ot.codigo}?`,
      mensaje: "Todos los instrumentos tienen su certificado emitido (o son no calibrables). La OT pasa a «finalizada» y queda para que Comercial o Planificación la cierren.",
      confirmarTexto: "Cerrar técnicamente",
    });
    if (ok) await hacer("POST", `/ot/${otId}/metrologia/cierre-tecnico`, undefined, "OT cerrada técnicamente: pasa a Comercial.");
  }

  if (error && !d) return <div className="alert warn" role="alert">{error}</div>;
  if (!d) return <p className="subtitle" style={{ margin: 0 }}>Cargando instrumentos…</p>;
  if (!d.ot.esMetrologia)
    return modo === "cierre" ? null : <div className="alert info">Esta OT no es de un laboratorio de Metrología: sus trabajos se registran como muestras.</div>;

  const items: any[] = d.instrumentos;
  const vivos = items.filter((i) => i.estado !== "anulado");

  if (modo === "cierre") {
    const cals = vivos.filter((i) => i.calibracion);
    const noCal = vivos.filter((i) => !i.calibracion && (i.documentosNoCalibrable ?? []).length);
    return (
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ fontSize: 13, margin: "0 0 6px", display: "flex", alignItems: "center", gap: 8 }}>
          Certificados de calibración
          <span style={{ fontWeight: 400, color: "var(--muted)", fontSize: 12 }}>· cuentan para el cierre como cualquier informe</span>
          <span style={{ flex: 1 }} />
          {d.cierreTecnico.posible && <button className="btn outline sm" disabled={ocupado} onClick={cierreTecnico}>Cerrar técnicamente → Comercial</button>}
        </h2>
        {cals.length ? (
          <table className="data">
            <thead><tr><th>Certificado</th><th>Instrumento</th><th>Estado</th><th>Entrega</th><th>Custodia</th><th /></tr></thead>
            <tbody>
              {cals.map((i) => {
                const c = i.calibracion, e = ESTADO_CALIBRACION[c.estado] ?? { texto: c.estado, pill: "gray" };
                return (
                  <tr key={i.id}>
                    <td><span className="codigo">{c.numeroCertificado ?? c.codigo}</span></td>
                    <td>Ítem {i.numero} · {i.descripcion}</td>
                    <td><span className={`pill ${e.pill}`}>{e.texto}</span></td>
                    <td style={{ fontSize: 11.5 }}>{c.entregadoAt ? <>{fechaDia(c.entregadoAt)} · {textoMedio(c.entregaMedio)}</> : c.estado === "emitida" ? <span className="pill amber">Sin entregar</span> : "—"}</td>
                    <td><span className={`pill ${ESTADO_INSTRUMENTO[i.estado]?.pill ?? "gray"}`}>{ESTADO_INSTRUMENTO[i.estado]?.texto ?? i.estado}</span></td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {i.acciones.includes("ENTREGAR") && <button className="btn primary sm" onClick={() => setDlg({ tipo: "entregar", item: i })}>Registrar entrega</button>}{" "}
                      <Link className="btn outline sm" href={`/metrologia/${c.id}` as any}>Ficha</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <p className="subtitle" style={{ margin: 0 }}>Aún no hay calibraciones en esta OT (pestaña «Instrumentos»).</p>}
        {noCal.length > 0 && (
          <>
            <h3 style={{ fontSize: 12.5, margin: "10px 0 4px" }}>Instrumentos no calibrables · informe técnico o certificado externo</h3>
            <table className="data">
              <thead><tr><th>Instrumento</th><th>Documento</th><th>Custodia</th></tr></thead>
              <tbody>
                {noCal.map((i) => (
                  <tr key={i.id}>
                    <td>Ítem {i.numero} · {i.descripcion}</td>
                    <td><DocsNoCalibrable docs={i.documentosNoCalibrable} /></td>
                    <td><span className={`pill ${ESTADO_INSTRUMENTO[i.estado]?.pill ?? "gray"}`}>{ESTADO_INSTRUMENTO[i.estado]?.texto ?? i.estado}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="subtitle" style={{ margin: "4px 0 0" }}>La entrega de estos documentos se registra en la pestaña «Instrumentos» (no calibrables).</p>
          </>
        )}
        {dlg?.tipo === "entregar" && <DialogoEntrega item={dlg.item} ocupado={ocupado} onCerrar={() => setDlg(null)}
          onGuardar={(b) => hacer("POST", `/ot/${otId}/calibraciones/${dlg.item.calibracion.id}/entregar`, b, `Entrega de ${dlg.item.calibracion.numeroCertificado} registrada.`)} />}
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <p className="subtitle" style={{ margin: 0, flex: 1, minWidth: 260 }}>
          Un ítem por instrumento. La calibración se abre desde el instrumento <b>recibido</b>: hereda la OT, el cliente, las fechas y la
          instrucción de trabajo (IT).
        </p>
        {d.puedo.registrar && d.ot.cotizacionId && <button className="btn outline sm" disabled={ocupado} onClick={desdeCotizacion}>Cargar desde la cotización</button>}
        {d.puedo.registrar && <button className="btn primary sm" disabled={ocupado} onClick={() => setDlg({ tipo: "item" })}>＋ Registrar instrumento</button>}
      </div>

      {vivos.length === 0 ? (
        <div className="alert info" style={{ margin: 0 }}>
          La OT aún no tiene instrumentos.{d.puedo.registrar ? " Regístrelos uno por uno o cárguelos desde la cotización." : " Los registra el laboratorio o Comercial."}
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="data">
            <thead><tr><th>Ítem</th><th>Instrumento</th><th>IT</th><th>Metrólogo</th><th>Custodia</th><th>Certificado</th><th style={{ textAlign: "right" }}>Acciones</th></tr></thead>
            <tbody>
              {items.map((i) => {
                const e = ESTADO_INSTRUMENTO[i.estado] ?? { texto: i.estado, pill: "gray" };
                const c = i.calibracion, ec = c ? ESTADO_CALIBRACION[c.estado] ?? { texto: c.estado, pill: "gray" } : null;
                const a: string[] = i.acciones;
                return (
                  <tr key={i.id} style={i.estado === "anulado" ? { opacity: 0.55 } : undefined}>
                    <td className="num"><b>{i.numero}</b></td>
                    <td>
                      <b>{i.descripcion}</b>
                      <small style={{ display: "block", color: "var(--muted)" }}>
                        {[i.marca, i.modelo].filter(Boolean).join(" · ") || "Sin marca ni modelo"} · Serie {i.serie || "s/s"}{i.sentido ? ` · Sentido ${i.sentido}` : ""}
                      </small>
                      {i.estado === "anulado" && <small style={{ display: "block", color: "var(--muted)" }}>Anulado: {i.anuladoMotivo}</small>}
                    </td>
                    <td><span className="codigo">{i.procesoCodigo ?? "—"}</span></td>
                    <td>{i.metrologoNombre ?? <span style={{ color: "var(--muted)" }}>Sin asignar</span>}
                      {i.fechaPrevista && <small style={{ display: "block", color: "var(--muted)" }}>Prevista {fechaDia(i.fechaPrevista)}</small>}</td>
                    <td>
                      <span className={`pill ${e.pill}`}>{e.texto}</span>
                      {i.etiqueta && <small style={{ display: "block" }} className="codigo">{i.etiqueta}</small>}
                      {i.recibidoAt && <small style={{ display: "block", color: "var(--muted)" }}>{fechaHora(i.recibidoAt)} · {i.ubicacion}</small>}
                      {i.estado === "no_apto" && <small style={{ display: "block", color: "var(--muted)" }}>{i.motivoNoCalibrable}</small>}
                      {i.devueltoAt && <small style={{ display: "block", color: "var(--muted)" }}>Devuelto {fechaHora(i.devueltoAt)} a {i.devueltoRecibe}</small>}
                    </td>
                    <td>
                      {c ? (
                        <>
                          <Link href={`/metrologia/${c.id}` as any} className="codigo" style={{ color: "var(--accent)" }}>{c.numeroCertificado ?? c.codigo}</Link>
                          <span className={`pill ${ec!.pill}`} style={{ marginLeft: 6 }}>{ec!.texto}</span>
                          {c.estado === "emitida" && (c.entregadoAt
                            ? <small style={{ display: "block", color: "var(--muted)" }}>Entregado {fechaDia(c.entregadoAt)} · {textoMedio(c.entregaMedio)}</small>
                            : <small style={{ display: "block" }}><span className="pill amber">Sin entregar</span></small>)}
                        </>
                      ) : (i.documentosNoCalibrable ?? []).length ? (
                        <DocsNoCalibrable docs={i.documentosNoCalibrable} />
                      ) : <span style={{ color: "var(--muted)" }}>—</span>}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
                        {a.includes("ASIGNAR") && <button className="btn outline sm" onClick={() => setDlg({ tipo: "asignar", item: i })}>{i.metrologoId ? "Reasignar" : "Asignar → metrólogo"}</button>}
                        {a.includes("RECIBIR") && <button className="btn primary sm" onClick={() => setDlg({ tipo: "recibir", item: i })}>Recibir →</button>}
                        {a.includes("CALIBRAR") && <Link className="btn primary sm" href={`/metrologia/nueva?instrumento=${i.id}&ot=${otId}` as any}>Calibrar →</Link>}
                        {a.includes("ENTREGAR") && <button className="btn primary sm" onClick={() => setDlg({ tipo: "entregar", item: i })}>Registrar entrega →</button>}
                        {a.includes("DEVOLVER") && <button className="btn outline sm" onClick={() => setDlg({ tipo: "devolver", item: i })}>Devolver instrumento →</button>}
                        {i.etiqueta && <button className="btn outline sm" title="Etiqueta de custodia" onClick={() => imprimirEtiqueta({ codigo: d.ot.codigo, laboratorio: d.ot.laboratorio }, i)}>Etiqueta</button>}
                        {i.recibidoAt && <button className="btn outline sm" onClick={() => imprimirRecepcion({ codigo: d.ot.codigo, cliente: d.ot.cliente, laboratorio: d.ot.laboratorio }, i)}>Recepción</button>}
                        {i.estado === "devuelto" && <button className="btn outline sm" onClick={() => imprimirActaDevolucion({ codigo: d.ot.codigo, cliente: d.ot.cliente, laboratorio: d.ot.laboratorio }, i)}>Acta</button>}
                        {a.includes("EDITAR") && <button className="btn outline sm" onClick={() => setDlg({ tipo: "item", item: i })}>Editar</button>}
                        {a.includes("ANULAR") && <button className="btn outline sm" onClick={() => setDlg({ tipo: "anular", item: i })}>Anular</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {vivos.some((i) => i.estado === "no_apto" || (i.estado === "devuelto" && i.calibrable === false)) && (
        <NoCalibrables otId={otId} onCambio={() => { cargar(); onCambio?.(); avisarCambioOt(otId); }} />
      )}

      {vivos.length > 0 && d.ot.estado !== "cerrada" && (
        <div className={`alert ${d.faltantes.length ? "warn" : "success"}`} style={{ margin: 0 }}>
          {d.faltantes.length ? (
            <><b>Para cerrar la OT falta:</b><ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{d.faltantes.map((f: string) => <li key={f}>{f}</li>)}</ul></>
          ) : <>Instrumentos al día: certificados emitidos y entregados{d.exigeDevolucion ? " e instrumentos devueltos" : ""}.</>}
          {d.cierreTecnico.posible && (
            <div style={{ marginTop: 8 }}><button className="btn primary sm" disabled={ocupado} onClick={cierreTecnico}>Cerrar técnicamente → Comercial</button></div>
          )}
        </div>
      )}

      {dlg?.tipo === "item" && <DialogoItem otId={otId} item={dlg.item} laboratorio={d.ot.laboratorio} ocupado={ocupado} onCerrar={() => setDlg(null)}
        onGuardar={(b) => dlg.item
          ? hacer("PUT", `/ot/${otId}/instrumentos/${dlg.item.id}`, b, `Ítem ${dlg.item.numero} actualizado.`)
          : hacer("POST", `/ot/${otId}/instrumentos`, b, "Instrumento registrado: queda «por recibir».")} />}
      {dlg?.tipo === "asignar" && <DialogoAsignar otId={otId} item={dlg.item} ocupado={ocupado} onCerrar={() => setDlg(null)}
        onGuardar={(b) => hacer("POST", `/ot/${otId}/instrumentos/${dlg.item.id}/asignar`, b, `Metrólogo asignado al ítem ${dlg.item.numero}.`)} />}
      {dlg?.tipo === "recibir" && <DialogoRecepcion item={dlg.item} laboratorio={d.ot.laboratorio} ocupado={ocupado} onCerrar={() => setDlg(null)}
        onGuardar={async (b) => {
          const item = dlg.item;
          const ok = await hacer("POST", `/ot/${otId}/instrumentos/${item.id}/recepcion`, b, b.calibrable ? `Ítem ${item.numero} recibido y en custodia: ya se puede calibrar.` : `Ítem ${item.numero} recibido como no calibrable.`);
          // B-080: «Registrar recepción → Hoja de control» abre la hoja de control de la calibración del ítem.
          if (ok && b.calibrable && d.puedo?.calibrar) router.push(`/metrologia/nueva?instrumento=${item.id}&ot=${otId}` as any);
        }} />}
      {dlg?.tipo === "entregar" && <DialogoEntrega item={dlg.item} ocupado={ocupado} onCerrar={() => setDlg(null)}
        onGuardar={(b) => hacer("POST", `/ot/${otId}/calibraciones/${dlg.item.calibracion.id}/entregar`, b, `Entrega de ${dlg.item.calibracion.numeroCertificado} registrada.`)} />}
      {dlg?.tipo === "devolver" && <DialogoDevolucion item={dlg.item} ocupado={ocupado} onCerrar={() => setDlg(null)}
        onGuardar={(b) => hacer("POST", `/ot/${otId}/instrumentos/${dlg.item.id}/devolucion`, b, `Devolución del ítem ${dlg.item.numero} registrada: imprima el acta.`)} />}
      {dlg?.tipo === "anular" && <DialogoMotivo titulo={`Anular el ítem ${dlg.item.numero}`} texto="El ítem queda anulado con su motivo (solo antes de recibirlo)." boton="Anular ítem"
        ocupado={ocupado} onCerrar={() => setDlg(null)} onGuardar={(motivo) => hacer("POST", `/ot/${otId}/instrumentos/${dlg.item.id}/anular`, { motivo }, `Ítem ${dlg.item.numero} anulado.`)} />}
    </div>
  );
}

/* ----------------------------------------------------------- diálogos --- */
const Req = () => <span className="req">*</span>;
const botones = (ocupado: boolean, onCerrar: () => void, texto: string, ok: boolean, onClick: () => void) => (
  <>
    <button className="btn outline" onClick={onCerrar}>Cancelar</button>
    <button className="btn primary" disabled={ocupado || !ok} onClick={onClick}>{ocupado ? "Guardando…" : texto}</button>
  </>
);

function DialogoItem({ otId, item, laboratorio, ocupado, onCerrar, onGuardar }: { otId: string; item?: any; laboratorio: string | null; ocupado: boolean; onCerrar: () => void; onGuardar: (b: any) => void }) {
  const [f, setF] = useState<any>(() => (item ? { ...vacioItem(), ...Object.fromEntries(Object.entries(item).map(([k, v]) => [k, v ?? ""])), intervaloMeses: item.intervaloMeses ?? "" } : vacioItem()));
  const [procs, setProcs] = useState<any[] | null>(null);
  useEffect(() => {
    llamar("GET", "/metrologia/procesos").then((p) => setProcs((p.data ?? []).filter((x: any) => !x.laboratorio || x.laboratorio === laboratorio))).catch(() => setProcs(null));
  }, [laboratorio, otId]);
  const campo = (k: string, label: string, req = false, ancho = false) => (
    <div className="field" style={ancho ? { gridColumn: "1 / -1" } : undefined}>
      <label htmlFor={`it-${k}`}>{label}{req && <> <Req /></>}</label>
      <input id={`it-${k}`} value={f[k] ?? ""} maxLength={k === "descripcion" ? 300 : 160} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </div>
  );
  const enviar = () => onGuardar({
    ...Object.fromEntries(["descripcion", "marca", "modelo", "serie", "idEspecial", "capacidad", "resolucion", "rango", "procesoCodigo", "puntos", "equipoCodigo"].map((k) => [k, String(f[k] ?? "").trim() || null])),
    sentido: f.sentido || null,
    intervaloMeses: f.intervaloMeses === "" ? null : Number(f.intervaloMeses),
  });
  return (
    <Modal titulo={item ? `Editar el ítem ${item.numero}` : "Registrar instrumento"} ancho={640} onCerrar={onCerrar}
      acciones={botones(ocupado, onCerrar, item ? "Guardar" : "Registrar → por recibir", f.descripcion.trim().length >= 2, enviar)}>
      <div className="form-grid cols-2">
        {campo("descripcion", "Descripción del instrumento", true, true)}
        {campo("marca", "Marca")}{campo("modelo", "Modelo")}
        {campo("serie", "N° de serie (s/s si no tiene)")}{campo("idEspecial", "Identificación especial")}
        {campo("capacidad", "Capacidad nominal")}{campo("resolucion", "Resolución")}
        {campo("rango", "Rango a calibrar")}
        <div className="field">
          <label htmlFor="it-proc">Proceso de calibración (IT)</label>
          {procs ? (
            <select id="it-proc" value={f.procesoCodigo ?? ""} onChange={(e) => setF({ ...f, procesoCodigo: e.target.value })}>
              <option value="">Lo fija el laboratorio…</option>
              {procs.map((p) => <option key={p.codigo} value={p.codigo}>{p.codigo} · {p.nombre}</option>)}
            </select>
          ) : <input id="it-proc" value={f.procesoCodigo ?? ""} placeholder="Lo fija el laboratorio" onChange={(e) => setF({ ...f, procesoCodigo: e.target.value.toUpperCase() })} />}
        </div>
        {laboratorio === "LNF" && (
          <div className="field"><label htmlFor="it-sent">Sentido solicitado</label>
            <select id="it-sent" value={f.sentido ?? ""} onChange={(e) => setF({ ...f, sentido: e.target.value })}>
              <option value="">Seleccione…</option>{SENTIDOS.map((s) => <option key={s.valor} value={s.valor}>{s.texto}</option>)}
            </select></div>
        )}
        {campo("puntos", "Puntos o escalas (según certificado anterior)", false, true)}
        <div className="field"><label htmlFor="it-int">Intervalo de calibración</label>
          <select id="it-int" value={String(f.intervaloMeses ?? "")} onChange={(e) => setF({ ...f, intervaloMeses: e.target.value })}>
            <option value="">Según el laboratorio</option>
            {[12, 15, 18, 24, 36, 48, 60].map((m) => <option key={m} value={m}>{m} meses</option>)}
            <option value="0">Según requerimiento del cliente</option>
          </select></div>
        {campo("equipoCodigo", "Código del equipo (OT interna, maestro de Equipos)")}
      </div>
    </Modal>
  );
}

function DialogoAsignar({ otId, item, ocupado, onCerrar, onGuardar }: { otId: string; item: any; ocupado: boolean; onCerrar: () => void; onGuardar: (b: any) => void }) {
  const [c, setC] = useState<{ data: any[]; magnitud: string | null } | null>(null);
  const [err, setErr] = useState("");
  const [id, setId] = useState(item.metrologoId ?? "");
  const [prevista, setPrevista] = useState(item.fechaPrevista ?? "");
  useEffect(() => { llamar("GET", `/ot/${otId}/instrumentos/${item.id}/metrologos`).then(setC).catch((e) => setErr(e.message)); }, [otId, item.id]);
  const elegido = c?.data.find((x) => x.id === id);
  return (
    <Modal titulo={`Asignar el metrólogo del ítem ${item.numero}`} onCerrar={onCerrar}
      acciones={botones(ocupado, onCerrar, "Asignar → metrólogo", !!elegido?.habilitado, () => onGuardar({ metrologoId: id, fechaPrevista: prevista || null }))}>
      <p style={{ marginTop: 0, color: "var(--muted)" }}>
        {c?.magnitud ? <>Solo puede calibrarlo un metrólogo habilitado para la magnitud <b>{c.magnitud}</b> en el registro de firmas autorizadas.</>
          : <>El ítem aún no tiene IT: se listan los metrólogos del laboratorio.</>}
      </p>
      {err && <div className="alert warn">{err}</div>}
      <div className="form-grid cols-2">
        <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="as-m">Metrólogo <Req /></label>
          <select id="as-m" value={id} onChange={(e) => setId(e.target.value)}>
            <option value="">Seleccione…</option>
            {(c?.data ?? []).map((x) => <option key={x.id} value={x.id} disabled={!x.habilitado}>{x.nombre}{x.habilitado ? "" : " · no habilitado para la magnitud"}</option>)}
          </select></div>
        <div className="field"><label htmlFor="as-f">Fecha prevista de calibración</label><input id="as-f" type="date" value={prevista} onChange={(e) => setPrevista(e.target.value)} /></div>
      </div>
    </Modal>
  );
}

function DialogoRecepcion({ item, laboratorio, ocupado, onCerrar, onGuardar }: { item: any; laboratorio: string | null; ocupado: boolean; onCerrar: () => void; onGuardar: (b: any) => void }) {
  const [f, setF] = useState<any>({
    fechaHora: ahoraLocal(), entregadoPor: "", estadoFisico: "", estadoFisicoObs: "", ubicacion: "", calibrable: "", motivoNoCalibrable: "", requiereExterno: false,
    sentido: item.sentido ?? "", acondicionamientoH: "", tempAmbiente: "",
    descripcion: item.descripcion ?? "", marca: item.marca ?? "", modelo: item.modelo ?? "", serie: item.serie ?? "", idEspecial: item.idEspecial ?? "",
    capacidad: item.capacidad ?? "", resolucion: item.resolucion ?? "",
  });
  const [acc, setAcc] = useState<any[]>([]);
  const lnf = laboratorio === "LNF";
  const no = f.calibrable === "no";
  const completo = f.fechaHora && f.entregadoPor.trim() && f.estadoFisico && f.ubicacion.trim() && f.calibrable
    && (f.estadoFisico === "bueno" || f.estadoFisicoObs.trim()) && (!no || f.motivoNoCalibrable.trim().length >= 5)
    && (!lnf || no || (f.sentido && f.acondicionamientoH !== "" && f.tempAmbiente !== ""));
  const t = (k: string, label: string, req = false, props: any = {}) => (
    <div className="field" style={props.ancho ? { gridColumn: "1 / -1" } : undefined}>
      <label htmlFor={`rc-${k}`}>{label}{req && <> <Req /></>}</label>
      <input id={`rc-${k}`} value={f[k]} type={props.type ?? "text"} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </div>
  );
  const enviar = () => onGuardar({
    fechaHora: f.fechaHora, entregadoPor: f.entregadoPor.trim(), estadoFisico: f.estadoFisico, estadoFisicoObs: f.estadoFisicoObs.trim() || null,
    ubicacion: f.ubicacion.trim(), calibrable: !no, motivoNoCalibrable: no ? f.motivoNoCalibrable.trim() : null, requiereExterno: no ? !!f.requiereExterno : null,
    accesorios: acc.filter((a) => a.tipo.trim()).map((a) => ({ tipo: a.tipo.trim(), marca: a.marca || null, modelo: a.modelo || null, serie: a.serie || null, detalle: a.detalle || null })),
    sentido: f.sentido || null, acondicionamientoH: f.acondicionamientoH === "" ? null : Number(String(f.acondicionamientoH).replace(",", ".")),
    tempAmbiente: f.tempAmbiente === "" ? null : Number(String(f.tempAmbiente).replace(",", ".")),
    descripcion: f.descripcion.trim() || undefined, marca: f.marca.trim() || null, modelo: f.modelo.trim() || null, serie: f.serie.trim() || null,
    idEspecial: f.idEspecial.trim() || null, capacidad: f.capacidad.trim() || null, resolucion: f.resolucion.trim() || null,
  });
  return (
    <Modal titulo={`Recepción del instrumento · ítem ${item.numero}`} ancho={760} onCerrar={onCerrar}
      acciones={botones(ocupado, onCerrar, no ? "Registrar recepción → no calibrable" : "Registrar recepción → Hoja de control", !!completo, enviar)}>
      <p style={{ marginTop: 0, color: "var(--muted)" }}>Registro de custodia (ISO/IEC 17025 §7.4). Los datos del instrumento vienen de la OT: corríjalos si lo recibido no coincide.</p>
      <div className="form-grid cols-2">
        {t("fechaHora", "Fecha y hora de recepción", true, { type: "datetime-local" })}
        {t("entregadoPor", "Entregado por (persona del cliente o laboratorio)", true)}
        {t("descripcion", "Descripción", true)}{t("marca", "Marca")}{t("modelo", "Modelo")}{t("serie", "N° de serie («s/s» si no tiene)")}
        {t("idEspecial", "Identificación especial")}{t("capacidad", "Capacidad nominal")}{t("resolucion", "Resolución")}
        <div className="field"><label htmlFor="rc-ef">Estado físico <Req /></label>
          <select id="rc-ef" value={f.estadoFisico} onChange={(e) => setF({ ...f, estadoFisico: e.target.value })}>
            <option value="">Seleccione…</option>{ESTADOS_FISICOS.map((x) => <option key={x.valor} value={x.valor}>{x.texto}</option>)}
          </select></div>
        {f.estadoFisico && f.estadoFisico !== "bueno" && t("estadoFisicoObs", "Observación del estado", true, { ancho: true })}
        {t("ubicacion", "Ubicación de almacenamiento", true)}
        <div className="field"><label htmlFor="rc-cal">¿Se puede calibrar? <Req /></label>
          <select id="rc-cal" value={f.calibrable} onChange={(e) => setF({ ...f, calibrable: e.target.value })}>
            <option value="">Seleccione…</option><option value="si">Sí</option><option value="no">No</option>
          </select></div>
        {no && t("motivoNoCalibrable", "Motivo por el que no se calibra", true, { ancho: true })}
        {no && (
          <label style={{ gridColumn: "1 / -1", display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
            <input type="checkbox" checked={!!f.requiereExterno} onChange={(e) => setF({ ...f, requiereExterno: e.target.checked })} />
            Requiere un laboratorio externo (lo decide el Jefe de Laboratorio)
          </label>
        )}
        {lnf && !no && (
          <>
            <div className="field"><label htmlFor="rc-sen">Sentido solicitado <Req /></label>
              <select id="rc-sen" value={f.sentido} onChange={(e) => setF({ ...f, sentido: e.target.value })}>
                <option value="">Seleccione…</option>{SENTIDOS.map((s) => <option key={s.valor} value={s.valor}>{s.texto}</option>)}
              </select></div>
            {t("acondicionamientoH", "Acondicionamiento (horas)", true)}{t("tempAmbiente", "Temperatura ambiente (°C)", true)}
          </>
        )}
      </div>
      <div style={{ marginTop: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <b style={{ fontSize: 12 }}>Accesorios</b>
          <button type="button" className="btn outline sm" onClick={() => setAcc([...acc, { tipo: "", marca: "", modelo: "", serie: "", detalle: "" }])}>＋ Accesorio</button>
        </div>
        {acc.map((a, k) => (
          <div key={k} className={css.accesorio}>
            {(["tipo", "marca", "modelo", "serie", "detalle"] as const).map((c) => (
              <input key={c} aria-label={`Accesorio ${k + 1} · ${c}`} placeholder={c === "tipo" ? "Tipo (cable, amplificador…)" : c === "detalle" ? "Detalle (largo, estado)" : c[0].toUpperCase() + c.slice(1)}
                value={a[c]} onChange={(e) => setAcc(acc.map((x, j) => (j === k ? { ...x, [c]: e.target.value } : x)))} />
            ))}
            <button type="button" className="btn outline sm" aria-label={`Quitar accesorio ${k + 1}`} onClick={() => setAcc(acc.filter((_, j) => j !== k))}>✕</button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function DialogoEntrega({ item, ocupado, onCerrar, onGuardar }: { item: any; ocupado: boolean; onCerrar: () => void; onGuardar: (b: any) => void }) {
  const [f, setF] = useState({ fecha: new Date().toLocaleDateString("sv-SE", { timeZone: "America/Santiago" }), medio: "", destinatario: "", observacion: "" });
  return (
    <Modal titulo={`Registrar la entrega del certificado ${item.calibracion?.numeroCertificado ?? ""}`} onCerrar={onCerrar}
      acciones={botones(ocupado, onCerrar, "Registrar entrega → Cierre de OT", !!(f.fecha && f.medio && f.destinatario.trim().length >= 2),
        () => onGuardar({ fecha: f.fecha, medio: f.medio, destinatario: f.destinatario.trim(), observacion: f.observacion.trim() || null }))}>
      <p style={{ marginTop: 0, color: "var(--muted)" }}>Se registra una sola vez. La fecha no puede ser anterior a la emisión del certificado.</p>
      <div className="form-grid cols-2">
        <div className="field"><label htmlFor="en-f">Fecha de entrega <Req /></label><input id="en-f" type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></div>
        <div className="field"><label htmlFor="en-m">Medio <Req /></label>
          <select id="en-m" value={f.medio} onChange={(e) => setF({ ...f, medio: e.target.value })}>
            <option value="">Seleccione…</option>{MEDIOS_ENTREGA.map((m) => <option key={m.valor} value={m.valor}>{m.texto}</option>)}
          </select></div>
        <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="en-d">Destinatario <Req /></label><input id="en-d" maxLength={160} value={f.destinatario} onChange={(e) => setF({ ...f, destinatario: e.target.value })} /></div>
        <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="en-o">Observación</label><input id="en-o" maxLength={1000} value={f.observacion} onChange={(e) => setF({ ...f, observacion: e.target.value })} /></div>
      </div>
    </Modal>
  );
}

function DialogoDevolucion({ item, ocupado, onCerrar, onGuardar }: { item: any; ocupado: boolean; onCerrar: () => void; onGuardar: (b: any) => void }) {
  const [f, setF] = useState({ fechaHora: ahoraLocal(), recibidoPor: "", estadoFisico: "", observacion: "", guia: "" });
  return (
    <Modal titulo={`Acta de devolución · ítem ${item.numero}`} onCerrar={onCerrar}
      acciones={botones(ocupado, onCerrar, "Registrar devolución → cerrar custodia", !!(f.fechaHora && f.recibidoPor.trim() && f.estadoFisico),
        () => onGuardar({ fechaHora: f.fechaHora, recibidoPor: f.recibidoPor.trim(), estadoFisico: f.estadoFisico, observacion: f.observacion.trim() || null, guia: f.guia.trim() || null }))}>
      <p style={{ marginTop: 0, color: "var(--muted)" }}>
        {item.estado === "no_apto" ? "El instrumento no calibrable se devuelve sin certificado." : "El instrumento se devuelve con su certificado emitido."} La custodia termina con la devolución.
      </p>
      <div className="form-grid cols-2">
        <div className="field"><label htmlFor="dv-f">Fecha y hora <Req /></label><input id="dv-f" type="datetime-local" value={f.fechaHora} onChange={(e) => setF({ ...f, fechaHora: e.target.value })} /></div>
        <div className="field"><label htmlFor="dv-r">Recibe <Req /></label><input id="dv-r" maxLength={160} value={f.recibidoPor} onChange={(e) => setF({ ...f, recibidoPor: e.target.value })} /></div>
        <div className="field"><label htmlFor="dv-e">Estado al devolver <Req /></label>
          <select id="dv-e" value={f.estadoFisico} onChange={(e) => setF({ ...f, estadoFisico: e.target.value })}>
            <option value="">Seleccione…</option>{ESTADOS_FISICOS.map((x) => <option key={x.valor} value={x.valor}>{x.texto}</option>)}
          </select></div>
        <div className="field"><label htmlFor="dv-g">Guía (si es courier)</label><input id="dv-g" maxLength={80} value={f.guia} onChange={(e) => setF({ ...f, guia: e.target.value })} /></div>
        <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="dv-o">Observación</label><input id="dv-o" maxLength={1000} value={f.observacion} onChange={(e) => setF({ ...f, observacion: e.target.value })} /></div>
      </div>
    </Modal>
  );
}

function DialogoMotivo({ titulo, texto, boton, ocupado, onCerrar, onGuardar }: { titulo: string; texto: string; boton: string; ocupado: boolean; onCerrar: () => void; onGuardar: (m: string) => void }) {
  const [m, setM] = useState("");
  return (
    <Modal titulo={titulo} onCerrar={onCerrar} acciones={botones(ocupado, onCerrar, boton, m.trim().length >= 5, () => onGuardar(m.trim()))}>
      <p style={{ marginTop: 0, color: "var(--muted)" }}>{texto}</p>
      <div className="field"><label htmlFor="mo-m">Motivo <Req /></label><textarea id="mo-m" rows={3} value={m} onChange={(e) => setM(e.target.value)} /></div>
    </Modal>
  );
}

const ESTADO_DOC_NOCAL: Record<string, string> = {
  borrador: "Borrador", en_firma: "En firma", emitido: "Emitido", solicitado: "Solicitado", aprobado: "Aprobado", enviado: "En el laboratorio externo", validado: "Validado",
};

/** B-029: informe técnico o certificado externo del ítem no calibrable, con su estado de entrega. */
function DocsNoCalibrable({ docs }: { docs: { tipo: string; numero: string | null; estado: string; entregadoAt: string | null; entregaMedio: string | null }[] }) {
  return (
    <>
      {docs.map((x) => {
        const listo = x.tipo === "informe_tecnico" ? x.estado === "emitido" : x.estado === "validado";
        return (
          <div key={`${x.tipo}-${x.numero}`} style={{ fontSize: 12 }}>
            {x.tipo === "informe_tecnico" ? "Informe técnico" : "Certificado externo"} <span className="codigo">{x.numero ?? "(sin número)"}</span>{" "}
            <span className={`pill ${listo ? "green" : "gray"}`}>{ESTADO_DOC_NOCAL[x.estado] ?? x.estado}</span>
            {listo && (x.entregadoAt
              ? <small style={{ display: "block", color: "var(--muted)" }}>Entregado {fechaDia(x.entregadoAt)} · {textoMedio(x.entregaMedio)}</small>
              : <small style={{ display: "block" }}><span className="pill amber">Sin entregar</span></small>)}
          </div>
        );
      })}
    </>
  );
}
