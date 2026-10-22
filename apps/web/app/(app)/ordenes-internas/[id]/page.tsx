"use client";

/**
 * Laboratorio › Órdenes internas › {Nº interno}: ficha de una orden interna con
 * los pasos del procedimiento (EP-01 2.2 → 0.6 → 5.5 → 3.7; EP-03 5.5):
 *   1 Emitida (solicitante) · 2 Recibida (destino) · 3 Respondida (destino) ·
 *   4 Cerrada, informe devuelto (destino) · 5 Dada por recibida (solicitante).
 * Cada paso tiene su formulario y su botón «Verbo → siguiente»; el recuadro
 * «Siguiente paso · Le toca a» dice quién debe actuar. El informe de respuesta
 * se ve renderizado; abajo, la bitácora.
 * La ficha solo ofrece los botones que la API aceptará (`puedo` del servidor).
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { toast } from "@/components/ui/feedback";
import PasosProceso from "@/components/ui/PasosProceso";
import { llamar } from "@/lib/laboratorio";
import { fechaHora } from "@/lib/format";
import FormOrdenInterna from "@/components/ordenes-internas/FormOrdenInterna";
import {
  ACCION_HISTORIAL_OI, PASOS_OI, destinoTexto, estadoOi, fechaDia, pesos, type OrdenInterna,
} from "@/components/ordenes-internas/ordenesInternas";

type Puedo = { editar: boolean; anular: boolean; recibir: boolean; responder: boolean; cerrar: boolean; darPorRecibido: boolean; capturar?: boolean };
type Ficha = OrdenInterna & { puedo: Puedo };

const ESTADO_RESULTADO: Record<string, string> = {
  pendiente: "Por capturar",
  capturado: "Capturado",
  revisado_n1: "Revisado",
  revisado: "Revisado",
  aprobado: "Aprobado",
  devuelto: "Devuelto",
  rechazado: "Devuelto",
};

const valorResultado = (r: NonNullable<OrdenInterna["resultados"]>[number]) =>
  r.texto?.trim() ? r.texto : r.valor === null || r.valor === undefined ? "—" : `${r.valor.toLocaleString("es-CL", { maximumFractionDigits: 6 })}${r.unidad ? ` ${r.unidad}` : ""}`;

export default function FichaOrdenInterna() {
  const { id } = useParams<{ id: string }>();
  const [f, setF] = useState<Ficha | null>(null);
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [editar, setEditar] = useState(false);

  const cargar = useCallback(async () => {
    setError("");
    try {
      setF(await llamar<Ficha>("GET", `/ordenes-internas/${id}`));
    } catch (e: any) {
      setError(e.message);
    }
  }, [id]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function accion(ruta: string, cuerpo: unknown, ok: string) {
    setOcupado(true);
    try {
      await llamar("POST", `/ordenes-internas/${id}/${ruta}`, cuerpo);
      toast.ok(ok);
      await cargar();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  }

  if (error && !f) {
    return (
      <div>
        <PageHeader titulo="Orden interna" migas={[{ label: "Laboratorio" }, { label: "Órdenes internas", href: "/ordenes-internas" }]} />
        <div className="alert warn" role="alert">{error}</div>
      </div>
    );
  }
  if (!f) return <p className="subtitle">Cargando la orden interna…</p>;

  const est = estadoOi(f);
  const anulada = f.estado === "anulada";
  const paso = f.paso ?? 1;
  const siguiente = siguientePaso(f);

  return (
    <div>
      <PageHeader
        icono="🔀"
        titulo={`Orden interna ${f.numero}`}
        subtitulo={<>OT <Link href={`/ot/${f.otId}` as any} className="codigo" style={{ textDecoration: "underline" }}>{f.otCodigo}</Link>
          {" · "}{f.otUnidadCodigo ?? "—"} → {destinoTexto(f)} · <span className={`pill ${est.pill}`}>{est.texto}</span></>}
        migas={[{ label: "Laboratorio" }, { label: "Órdenes internas", href: "/ordenes-internas" }, { label: f.numero }]}
        acciones={<>
          {f.puedo.editar && <button type="button" className="btn outline" onClick={() => setEditar(true)}>Editar</button>}
          <Link href={"/ordenes-internas" as any} className="btn outline">Volver a la bandeja</Link>
        </>}
      />

      <PasosProceso
        etiqueta="Pasos de la orden interna"
        pasos={PASOS_OI.map((p) => ({ titulo: `${p.n} · ${p.titulo}`, detalle: p.n === 1 ? f.otUnidadCodigo : p.n === 5 ? f.otUnidadCodigo : f.destinoUnidadCodigo }))}
        actual={anulada ? 0 : Math.min(paso + 1, 5)}
        completo={paso >= 5}
        anulado={anulada}
      />

      {anulada ? (
        <div className="alert warn" role="status">Anulada el {fechaHora(f.anuladaAt)}{f.motivoAnulacion ? ` · motivo: ${f.motivoAnulacion}` : ""}.</div>
      ) : siguiente && (
        <section className="siguiente-paso" aria-label="Siguiente paso de la orden interna">
          <div className="sp-fila">
            <div className="sp-texto">
              <div><span className="sp-etq">Siguiente paso</span> {siguiente.texto}</div>
              <div className="sp-quien"><span className="sp-etq">Le toca a</span> {siguiente.quien}
                {!siguiente.puedo && <span className="sp-espera"> · Esperando a que lo haga ese laboratorio</span>}</div>
            </div>
          </div>
        </section>
      )}

      {/* 1 · Emitida */}
      <div className="card">
        <h2>1 · Orden emitida <span className="right">{fechaHora(f.createdAt)}{f.creadaPor ? ` · ${f.creadaPor}` : ""}</span></h2>
        <dl className="ficha-dl" style={{ display: "grid", gridTemplateColumns: "minmax(150px, 220px) 1fr", gap: "4px 12px", margin: 0 }}>
          <dt>OT y muestra de origen</dt>
          <dd style={{ margin: 0 }}><span className="codigo">{f.otCodigo}</span>{f.muestraCodigo ? <> · <span className="codigo">{f.muestraCodigo}</span>{f.muestraNombre ? ` (${f.muestraNombre})` : ""}</> : " · sin muestra indicada"}</dd>
          <dt>Laboratorio solicitante</dt><dd style={{ margin: 0 }}>{f.otUnidadCodigo ?? "—"}{f.otUnidadNombre ? ` · ${f.otUnidadNombre}` : ""}</dd>
          <dt>Laboratorio de destino</dt><dd style={{ margin: 0 }}>{destinoTexto(f)}</dd>
          {f.origenBpch && <><dt>Origen BPCH</dt><dd style={{ margin: 0 }}>{f.origenBpch}</dd></>}
          <dt>Requisito y punto de la especificación</dt><dd style={{ margin: 0 }}>{f.requisito || <span style={{ color: "var(--muted)" }}>No indicado (orden anterior a esta versión)</span>}</dd>
          <dt>Fecha de envío de la muestra</dt><dd style={{ margin: 0 }}>{fechaDia(f.fechaEnvio)}</dd>
          {f.ieReferencia && <><dt>IE de referencia</dt><dd style={{ margin: 0 }}>{f.ieReferencia}</dd></>}
          {f.detalle && <><dt>Detalle</dt><dd style={{ margin: 0 }}>{f.detalle}</dd></>}
          <dt>Ensayos pedidos ({f.ensayosDetalle.length})</dt>
          <dd style={{ margin: 0 }}>{f.ensayosDetalle.map((e) => <span key={e.id} style={{ display: "block" }}><span className="codigo">{e.codigo}</span> {e.nombre}</span>)}</dd>
        </dl>
      </div>

      {/* 2 · Recibir */}
      <div className="card">
        <h2>2 · Recepción en el laboratorio de destino
          <span className="right">{f.recibidaAt ? `${fechaHora(f.recibidaAt)}${f.recibidaPorNombre ? ` · ${f.recibidaPorNombre}` : ""}` : "Pendiente"}</span></h2>
        {f.recibidaAt ? (
          <p style={{ margin: 0 }}>Recibida. Los ensayos pedidos quedaron en la muestra {f.muestraCodigo ?? ""} para que {f.destinoUnidadCodigo ?? "el destino"} registre sus resultados.</p>
        ) : f.puedo.recibir ? (
          <div className="toolbar" style={{ margin: 0 }}>
            <p style={{ margin: 0, flex: 1 }}>Confirme que recibió la muestra. Al recibirla, los ensayos pedidos se crean en la muestra para capturar sus resultados.</p>
            <button type="button" className="btn primary" disabled={ocupado} onClick={() => accion("recibir", {}, `Orden interna ${f.numero} recibida.`)}>
              Recibir OT interna → recepción
            </button>
          </div>
        ) : (
          <p style={{ margin: 0, color: "var(--muted)" }}>La recibe la jefatura de {f.destinoUnidadCodigo ?? "el laboratorio de destino"}.</p>
        )}
      </div>

      {/* 3 · Resultados y respuesta */}
      {f.recibidaAt && (
        <div className="card">
          <h2>3 · Resultados y respuesta del destino
            <span className="right">{f.respondidaAt ? `${fechaHora(f.respondidaAt)}${f.respondidaPorNombre ? ` · ${f.respondidaPorNombre}` : ""}` : "Pendiente"}</span></h2>
          <TablaResultados f={f} />
          {f.estado === "recibida" && f.puedo.responder ? (
            <FormRespuesta f={f} ocupado={ocupado} onGuardar={(c) => accion("responder", c, "Respuesta guardada.")} />
          ) : f.respondidaAt ? null : (
            <p style={{ margin: "8px 0 0", color: "var(--muted)" }}>Responde la jefatura de {f.destinoUnidadCodigo ?? "el laboratorio de destino"}.</p>
          )}
        </div>
      )}

      {/* 4 · Cerrar y devolver */}
      {f.recibidaAt && (
        <div className="card">
          <h2>4 · Cierre y devolución del informe <span className="right">{f.cerradaAt ? `${fechaHora(f.cerradaAt)}${f.cerradaPorNombre ? ` · ${f.cerradaPorNombre}` : ""}` : "Pendiente"}</span></h2>
          {f.estado === "recibida" && (
            <>
              {(f.faltantesCierre ?? []).length > 0 ? (
                <>
                  <p style={{ margin: "0 0 4px", fontWeight: 600 }}>Para cerrar falta:</p>
                  <ul style={{ margin: "0 0 8px", paddingLeft: 18, fontSize: 12.5, lineHeight: 1.6 }}>
                    {(f.faltantesCierre ?? []).map((x) => <li key={x}>{x}</li>)}
                  </ul>
                </>
              ) : <p style={{ margin: "0 0 8px" }}>Todo listo: resultados capturados y respuesta guardada.</p>}
              {f.puedo.cerrar && (
                <button type="button" className="btn primary" disabled={ocupado || (f.faltantesCierre ?? []).length > 0}
                  onClick={() => accion("cerrar", {}, `Orden interna ${f.numero} cerrada: el informe vuelve a ${f.otUnidadCodigo ?? "el solicitante"}.`)}>
                  Cerrar OT interna → devolver al solicitante
                </button>
              )}
            </>
          )}
          {f.respondidaAt && <InformeRespuesta f={f} />}
        </div>
      )}

      {/* 5 · Dar por recibido */}
      {f.estado === "cerrada" && (
        <div className="card">
          <h2>5 · Integración en la OT de origen <span className="right">{f.aceptadaAt ? `${fechaHora(f.aceptadaAt)}${f.aceptadaPorNombre ? ` · ${f.aceptadaPorNombre}` : ""}` : "Pendiente"}</span></h2>
          {f.aceptadaAt ? (
            <p style={{ margin: 0 }}>Dada por recibida. Los resultados están en la muestra {f.muestraCodigo ?? ""} y se evalúan como los propios.{f.aceptadaObservacion ? ` Observación: ${f.aceptadaObservacion}` : ""}</p>
          ) : f.puedo.darPorRecibido ? (
            <FormAceptar ocupado={ocupado} onAceptar={(obs) => accion("dar-por-recibido", { observacion: obs || null }, "Informe interno dado por recibido.")} />
          ) : (
            <p style={{ margin: 0, color: "var(--muted)" }}>La da por recibida {f.otUnidadCodigo ?? "el laboratorio solicitante"}.</p>
          )}
        </div>
      )}

      {/* Bitácora */}
      {!!f.historial?.length && (
        <div className="card">
          <h2>Bitácora</h2>
          <table className="data">
            <thead><tr><th scope="col">Fecha</th><th scope="col">Quién</th><th scope="col">Qué</th></tr></thead>
            <tbody>
              {f.historial.map((h) => (
                <tr key={h.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{fechaHora(h.createdAt)}</td>
                  <td>{h.usuarioNombre ?? "—"}</td>
                  <td>{ACCION_HISTORIAL_OI[h.accion] ?? h.accion}{h.detalle?.numero ? ` · ${h.detalle.numero}` : ""}{h.detalle?.motivo ? ` · ${h.detalle.motivo}` : ""}{h.detalle?.observacion ? ` · ${h.detalle.observacion}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editar && (
        <FormOrdenInterna otId={f.otId} otCodigo={f.otCodigo} orden={f} onCerrar={() => setEditar(false)}
          onGuardada={() => { setEditar(false); cargar(); }} />
      )}
    </div>
  );
}

/** «Siguiente paso · Le toca a» de la orden (mismo lenguaje que la Ruta de la OT). */
function siguientePaso(f: Ficha): { texto: string; quien: string; puedo: boolean } | null {
  const destino = `Jefatura de ${f.destinoUnidadCodigo ?? "el laboratorio de destino"}`;
  const origen = `Jefatura o analista de ${f.otUnidadCodigo ?? "el laboratorio solicitante"}`;
  if (f.estado === "abierta") return { texto: "Recibir la muestra y la orden interna", quien: destino, puedo: f.puedo.recibir };
  if (f.estado === "recibida" && !f.respondidaAt)
    return {
      texto: "Registrar los resultados en la muestra (analista) y guardar la respuesta con horas y costo directo (jefatura)",
      quien: `Analista y jefatura de ${f.destinoUnidadCodigo ?? "el laboratorio de destino"}`,
      puedo: f.puedo.responder || !!f.puedo.capturar,
    };
  if (f.estado === "recibida") return { texto: "Cerrar la orden interna y devolver el informe al solicitante", quien: destino, puedo: f.puedo.cerrar };
  if (f.estado === "cerrada" && !f.aceptadaAt) return { texto: "Dar por recibido el informe e integrar los resultados", quien: origen, puedo: f.puedo.darPorRecibido };
  return null;
}

function TablaResultados({ f }: { f: Ficha }) {
  const rs = f.resultados ?? [];
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--muted)" }}>
          Resultados de los ensayos pedidos en la muestra {f.muestraCodigo ?? ""}. Se capturan en la planilla de la OT, como los propios.
        </p>
        {/* Jefatura o analista del destino (resultado.crear en su laboratorio): abre la captura de la OT de origen,
            donde solo ve los ensayos que se le derivaron (D02-25). */}
        {f.estado === "recibida" && (f.puedo.responder || f.puedo.capturar) && (
          <Link href={`/captura-ot?otId=${f.otId}` as any} className="btn outline sm">Registrar resultados</Link>
        )}
      </div>
      {rs.length === 0 ? (
        <p style={{ margin: 0, color: "var(--muted)" }}>Aún no hay resultados de los ensayos pedidos en la muestra.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="data">
            <thead><tr><th scope="col">Muestra</th><th scope="col">Ensayo</th><th scope="col">Analito</th><th scope="col" className="num">Resultado</th><th scope="col">Estado</th><th scope="col">Observación</th></tr></thead>
            <tbody>
              {rs.map((r) => (
                <tr key={r.id}>
                  <td className="codigo">{r.muestra}</td>
                  <td>{r.ensayo}</td>
                  <td>{r.analito ?? "—"}</td>
                  <td className="num">{valorResultado(r)}</td>
                  <td>{ESTADO_RESULTADO[r.estado ?? ""] ?? r.estado ?? "—"}</td>
                  <td>{r.observacion ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function FormRespuesta({ f, ocupado, onGuardar }: { f: Ficha; ocupado: boolean; onGuardar: (c: any) => void }) {
  const [numero, setNumero] = useState(f.respuestaNumero ?? "");
  const [informe, setInforme] = useState(f.respuestaInforme ?? "");
  const [horas, setHoras] = useState(f.respuestaHoras === null || f.respuestaHoras === undefined ? "" : String(f.respuestaHoras).replace(".", ","));
  const [insumos, setInsumos] = useState(f.respuestaInsumos ?? "");
  const [costo, setCosto] = useState(f.costoDirecto === null || f.costoDirecto === undefined ? "" : String(Math.round(f.costoDirecto)));
  const [error, setError] = useState("");
  const num = (s: string) => (s.trim() === "" ? NaN : Number(s.replace(/\./g, "").replace(",", ".")));
  const numHoras = (s: string) => (s.trim() === "" ? NaN : Number(s.replace(",", ".")));

  function guardar(e: React.FormEvent) {
    e.preventDefault();
    const h = numHoras(horas);
    const c = num(costo);
    if (!Number.isFinite(h) || h < 0) return setError("Indique las horas dedicadas (número mayor o igual a 0).");
    if (!Number.isFinite(c) || c < 0) return setError("Indique el costo directo en pesos (número mayor o igual a 0).");
    setError("");
    onGuardar({ horas: h, costoDirecto: c, informe: informe.trim() || null, insumos: insumos.trim() || null, ...(numero.trim() ? { respuestaNumero: numero.trim() } : {}) });
  }

  return (
    <form onSubmit={guardar} style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 10 }} aria-label="Respuesta del laboratorio de destino">
      {error && <div className="alert warn" role="alert">{error}</div>}
      <div className="form-grid cols-2">
        <div className="field">
          <label htmlFor="oi-r-numero">Nº del informe de respuesta</label>
          <input id="oi-r-numero" maxLength={80} value={numero} onChange={(e) => setNumero(e.target.value)} aria-describedby="oi-r-numero-ayuda" />
          <small id="oi-r-numero-ayuda" style={{ color: "var(--muted)" }}>
            {f.respuestaNumero ? "Ya asignado." : f.respuestaNumeroPropuesto ? `Si lo deja vacío se asigna ${f.respuestaNumeroPropuesto}. Para un «Boletín N° …», escríbalo.` : "Si lo deja vacío lo asigna la numeración del laboratorio."}
          </small>
        </div>
        <div className="field">
          <label htmlFor="oi-r-horas">Horas dedicadas <span className="req">*</span></label>
          <input id="oi-r-horas" inputMode="decimal" value={horas} onChange={(e) => setHoras(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="oi-r-costo">Costo directo ($) <span className="req">*</span></label>
          <input id="oi-r-costo" inputMode="numeric" value={costo} onChange={(e) => setCosto(e.target.value)} aria-describedby="oi-r-costo-ayuda" />
          <small id="oi-r-costo-ayuda" style={{ color: "var(--muted)" }}>Se imputa a la OT {f.otCodigo}.</small>
        </div>
        <div className="field">
          <label htmlFor="oi-r-insumos">Insumos</label>
          <input id="oi-r-insumos" maxLength={2000} value={insumos} onChange={(e) => setInsumos(e.target.value)} />
        </div>
        <div className="field span-2">
          <label htmlFor="oi-r-informe">Informe de análisis interno (conclusión u observaciones)</label>
          <textarea id="oi-r-informe" rows={3} maxLength={8000} value={informe} onChange={(e) => setInforme(e.target.value)} />
        </div>
      </div>
      <div className="toolbar" style={{ margin: "8px 0 0" }}>
        <button type="submit" className="btn primary" disabled={ocupado}>{f.respondidaAt ? "Guardar cambios de la respuesta" : "Guardar respuesta → cerrar"}</button>
      </div>
    </form>
  );
}

/** Informe de respuesta renderizado (lo que recibe el laboratorio solicitante). */
function InformeRespuesta({ f }: { f: Ficha }) {
  const rs = f.resultados ?? [];
  return (
    <article aria-label="Informe de análisis interno" style={{ marginTop: 12, border: "1px solid var(--line)", borderRadius: 8, padding: "14px 16px", background: "var(--panel)" }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", borderBottom: "1px solid var(--line)", paddingBottom: 6, marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--muted)" }}>Informe de análisis interno</div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{f.respuestaNumero ?? "Sin número"}</div>
        </div>
        <div style={{ fontSize: 12, textAlign: "right" }}>
          {f.destinoUnidadCodigo} → {f.otUnidadCodigo}<br />Orden {f.numero} · OT {f.otCodigo}
        </div>
      </header>
      <p style={{ margin: "0 0 6px", fontSize: 12.5 }}><b>Muestra:</b> {f.muestraCodigo ?? "—"} · <b>Requisito:</b> {f.requisito ?? "—"}</p>
      {rs.length > 0 && (
        <table className="data" style={{ marginBottom: 8 }}>
          <thead><tr><th scope="col">Ensayo</th><th scope="col">Analito</th><th scope="col" className="num">Resultado</th></tr></thead>
          <tbody>{rs.map((r) => <tr key={r.id}><td>{r.ensayo}</td><td>{r.analito ?? "—"}</td><td className="num">{valorResultado(r)}</td></tr>)}</tbody>
        </table>
      )}
      {f.respuestaInforme && <p style={{ margin: "0 0 6px", whiteSpace: "pre-wrap" }}>{f.respuestaInforme}</p>}
      <p style={{ margin: 0, fontSize: 12.5 }}>
        <b>Horas:</b> {f.respuestaHoras?.toLocaleString("es-CL") ?? "—"} · <b>Insumos:</b> {f.respuestaInsumos || "—"} · <b>Costo directo:</b> {pesos(f.costoDirecto)}
      </p>
      <footer style={{ marginTop: 8, fontSize: 11.5, color: "var(--muted)" }}>
        Responde: {f.respondidaPorNombre ?? "—"}{f.cerradaAt ? ` · Cerrada el ${fechaHora(f.cerradaAt)}${f.cerradaPorNombre ? ` por ${f.cerradaPorNombre}` : ""}` : " · aún sin cerrar"}
      </footer>
    </article>
  );
}

function FormAceptar({ ocupado, onAceptar }: { ocupado: boolean; onAceptar: (obs: string) => void }) {
  const [obs, setObs] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); onAceptar(obs.trim()); }} aria-label="Dar por recibido el informe interno">
      <p style={{ margin: "0 0 8px" }}>El laboratorio de destino devolvió su informe. Revíselo arriba: sus resultados ya están en la muestra y se evalúan contra el requisito como los propios.</p>
      <div className="field">
        <label htmlFor="oi-a-obs">Observación (opcional)</label>
        <input id="oi-a-obs" maxLength={2000} value={obs} onChange={(e) => setObs(e.target.value)} />
      </div>
      <button type="submit" className="btn primary" disabled={ocupado} style={{ marginTop: 8 }}>Dar por recibido → evaluación</button>
    </form>
  );
}
