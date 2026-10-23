"use client";

/**
 * Pestaña «Laboratorio» de la ficha de la cotización (EP-00 2.3–2.6):
 *   · el ejecutivo pide fechas (servicio estándar) o abre el Formulario de
 *     costeo FORM05 (no estándar) a un laboratorio → «Solicitar → laboratorio»;
 *   · cada solicitud muestra la respuesta del laboratorio (programa FORM06 y
 *     costeo FORM05) y su V°B° (laboratorio y departamento) con quién y cuándo;
 *   · los botones aparecen solo a quien le toca (el servidor lo decide).
 */
import { useState } from "react";
import SelectorLaboratorio from "@/components/SelectorLaboratorio";
import { fechaDia, fechaHora, money } from "@/lib/format";
import { confirmar } from "@/components/ui/feedback";
import Panel from "./Panel";
import RespuestaLaboratorio from "./RespuestaLaboratorio";
import { pedir } from "./comercial";
import { PILL_SOLICITUD, type Circuito, type Solicitud } from "./circuito";

const TEXTO_RESPUESTA: Record<string, string> = {
  aceptar: "Realiza el servicio",
  aceptar_con_comentario: "Realiza el servicio, con comentario",
  rechazar: "No realiza el servicio",
};
const SECCION: Record<string, string> = {
  viaticos: "1 · Viáticos",
  horasHombre: "2 · Horas hombre",
  servicios: "3 · Servicios estándar",
  horasMaquina: "4 · Horas máquina",
  pasajes: "5 · Pasajes",
  otros: "6 · Otros gastos",
};

function FormSolicitud({ cotId, onHecho }: { cotId: string; onHecho: (m: string) => void }) {
  const [unidadId, setUnidadId] = useState("");
  const [tipo, setTipo] = useState<"estandar" | "no_estandar" | "comision">("estandar");
  const [comentario, setComentario] = useState("");
  const [conCopia, setConCopia] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  async function enviar() {
    setError("");
    if (!unidadId) return setError("Elija el laboratorio al que se pide fecha y costo.");
    setEnviando(true);
    try {
      const r = await pedir<any>("POST", `/cotizaciones/${cotId}/solicitudes-laboratorio`, {
        unidadId,
        tipoServicio: tipo,
        comentario: comentario.trim() || null,
        conCopia: conCopia.trim() || null,
      });
      setUnidadId("");
      setComentario("");
      setConCopia("");
      onHecho(r?.mensaje ?? "Solicitud enviada al laboratorio.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setEnviando(false);
    }
  }
  return (
    <section className="card" style={{ margin: "0 0 14px", padding: 12 }} aria-labelledby="sol-tit">
      <h3 id="sol-tit" style={{ margin: "0 0 8px", fontSize: 14 }}>Solicitar fechas y costo al laboratorio</h3>
      {error && <div className="alert warn" role="alert">{error}</div>}
      <div className="form-grid cols-2">
        <div><SelectorLaboratorio valor={unidadId} onCambio={setUnidadId} pistas={{ cotizacionId: cotId }} etiqueta="Laboratorio" /></div>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Tipo de servicio <span className="req">*</span></legend>
          <label style={{ display: "flex", gap: 6, fontWeight: 400 }}>
            <input type="radio" name="tipo-servicio" style={{ width: "auto" }} checked={tipo === "estandar"} onChange={() => setTipo("estandar")} />
            Estandarizado · el laboratorio da fechas y plazo (programa de trabajo)
          </label>
          <label style={{ display: "flex", gap: 6, fontWeight: 400 }}>
            <input type="radio" name="tipo-servicio" style={{ width: "auto" }} checked={tipo === "no_estandar"} onChange={() => setTipo("no_estandar")} />
            No estandarizado · abre el Formulario de costeo (FORM05) con número
          </label>
          <label style={{ display: "flex", gap: 6, fontWeight: 400 }}>
            <input type="radio" name="tipo-servicio" style={{ width: "auto" }} checked={tipo === "comision"} onChange={() => setTipo("comision")} />
            Comisión en terreno o en el extranjero · el laboratorio costea horas por rol, viáticos, pasajes, traslados y arriendo (FORM05)
          </label>
        </fieldset>
        <div className="field">
          <label htmlFor="sol-com">Comentario para el laboratorio</label>
          <textarea id="sol-com" rows={2} maxLength={2000} value={comentario} onChange={(e) => setComentario(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="sol-cc">Con copia (cargo o unidad)</label>
          <input id="sol-cc" maxLength={500} value={conCopia} onChange={(e) => setConCopia(e.target.value)} />
        </div>
      </div>
      <p className="subtitle" style={{ margin: "6px 0 0", fontSize: 11.5 }}>
        La solicitud llega a «Cotizaciones por responder» y a Mi bandeja del Jefe de Laboratorio.
      </p>
      <div className="toolbar" style={{ marginTop: 8 }}>
        <div className="spacer" />
        <button className="btn primary sm" disabled={enviando} onClick={enviar}>{enviando ? "Enviando…" : "Solicitar → laboratorio"}</button>
      </div>
    </section>
  );
}

function DialogoVb({ sol, accion, onCerrar, onHecho }: { sol: Solicitud; accion: "dar" | "devolver"; onCerrar: () => void; onHecho: (m: string) => void }) {
  const [comentario, setComentario] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const nivel = sol.vb?.nivel === "depto" ? "del departamento" : "del laboratorio";
  async function enviar() {
    setError("");
    if (accion === "devolver" && !comentario.trim()) return setError("Indique el motivo de la devolución.");
    setEnviando(true);
    try {
      const r = await pedir<any>("POST", `/cotizaciones/solicitudes-laboratorio/${sol.id}/vb`, { accion, comentario: comentario.trim() || null });
      onHecho(r?.mensaje ?? "Listo.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setEnviando(false);
    }
  }
  return (
    <Panel titulo={accion === "dar" ? `V°B° ${nivel} · ${sol.numero ?? sol.unidadCodigo}` : `Devolver al laboratorio · ${sol.numero ?? sol.unidadCodigo}`} onCerrar={onCerrar} ancho={500}>
      {error && <div className="alert warn" role="alert">{error}</div>}
      <div className="field">
        <label htmlFor="vb-com">Comentario {accion === "devolver" && <span className="req">*</span>}</label>
        <textarea id="vb-com" rows={3} maxLength={2000} value={comentario} onChange={(e) => setComentario(e.target.value)} />
      </div>
      <p className="subtitle" style={{ margin: "8px 0 0" }}>
        {accion === "dar" ? "Queda registrado quién da el V°B° y cuándo." : "El laboratorio tendrá que volver a responder; los V°B° anteriores se borran."}
      </p>
      <div className="toolbar" style={{ marginTop: 12 }}>
        <button className="btn outline sm" onClick={onCerrar}>Cancelar</button>
        <div className="spacer" />
        <button className={`btn sm ${accion === "dar" ? "success" : ""}`} style={accion === "devolver" ? { background: "var(--red)", color: "#fff" } : undefined} disabled={enviando} onClick={enviar}>
          {enviando ? "Guardando…" : accion === "dar" ? "Dar V°B° → Comercial" : "Devolver con comentario"}
        </button>
      </div>
    </Panel>
  );
}

function TarjetaSolicitud({ sol, c, puedeRetirar, onResponder, onVb, onRetirar }: {
  sol: Solicitud;
  c: Circuito;
  puedeRetirar: boolean;
  onResponder: () => void;
  onVb: (a: "dar" | "devolver") => void;
  onRetirar: () => void;
}) {
  const r = sol.costeo?.resultado;
  const vbExige = c.config.niveles;
  return (
    <article className="card" style={{ margin: "0 0 12px", padding: 12 }} aria-label={`Solicitud a ${sol.unidadCodigo}`}>
      <header style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
        <b style={{ fontSize: 14 }}>{sol.unidadCodigo}</b>
        <span style={{ color: "var(--muted)", fontSize: 12 }}>{sol.unidadNombre}</span>
        {sol.numero ? <span className="codigo">{sol.numero}</span> : <span className="pill gray">Solicitud de fechas</span>}
        <span className={`pill ${PILL_SOLICITUD[sol.estado] ?? "gray"}`}>{sol.etiquetaEstado}</span>
        <div className="spacer" style={{ flex: 1 }} />
        {sol.puedoResponder && <button className="btn primary sm" onClick={onResponder}>{sol.estado === "devuelto" ? "Corregir y responder" : "Responder"}</button>}
        {sol.puedoVb && <button className="btn success sm" onClick={() => onVb("dar")}>Dar V°B° → Comercial</button>}
        {sol.puedoVb && <button className="btn outline sm" onClick={() => onVb("devolver")}>Devolver con comentario</button>}
        {puedeRetirar && <button className="btn outline sm" onClick={onRetirar}>Retirar solicitud</button>}
      </header>
      <p style={{ margin: "0 0 6px", fontSize: 12.5 }}>
        Solicitada por {sol.solicitadaPorNombre ?? "—"} el {fechaHora(sol.solicitadaAt)}
        {sol.comentarioEjecutivo ? <> · «{sol.comentarioEjecutivo}»</> : null}
        {sol.conCopia ? <> · c.c.: {sol.conCopia}</> : null}
      </p>
      {sol.devueltaMotivo && sol.estado === "devuelto" && <div className="alert warn" style={{ margin: "4px 0" }}>Devuelta: {sol.devueltaMotivo}</div>}

      {sol.respondidaAt && (
        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 8, marginTop: 6 }}>
          <p style={{ margin: "0 0 6px", fontSize: 12.5 }}>
            <b>{TEXTO_RESPUESTA[sol.respuesta ?? ""] ?? "Respondida"}</b> · {sol.respondidaPorNombre ?? "—"} · {fechaHora(sol.respondidaAt)}
            {sol.comentarioLab ? <> · «{sol.comentarioLab}»</> : null}
          </p>
          {sol.programa && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 2 }}>Programa de trabajo (FORM06)</div>
              <div style={{ fontSize: 12.5 }}>
                Plazo de entrega propuesto: <b>{sol.programa.plazoEntregaDias} días corridos</b>
                {sol.programa.fechaInicio ? <> · inicio {fechaDia(sol.programa.fechaInicio)}</> : null}
                {sol.programa.fechaTermino ? <> · término {fechaDia(sol.programa.fechaTermino)}</> : null}
                {sol.programa.puntosEt ? <> · puntos de la E.T.: <b>{sol.programa.puntosEt}</b></> : null}
                {sol.programa.numItems ? <> · {sol.programa.numItems} ítems</> : null}
              </div>
              {sol.programa.etapas?.length > 0 && (
                <table className="data" style={{ marginTop: 4 }}>
                  <thead><tr><th>Etapa</th><th>Inicio</th><th>Término</th><th>Recursos</th></tr></thead>
                  <tbody>
                    {sol.programa.etapas.map((e, i) => (
                      <tr key={i}><td>{e.actividad}</td><td>{fechaDia(e.inicio)}</td><td>{fechaDia(e.termino)}</td><td>{e.recursos ?? "—"}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
          {r && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 2 }}>Formulario de costeo (FORM05) · interno, no se imprime</div>
              <table className="data">
                <tbody>
                  {Object.entries(SECCION).map(([k, l]) => (r.secciones?.[k] ? <tr key={k}><td>{l}</td><td className="num">{money(r.secciones[k])}</td></tr> : null))}
                  <tr><td><b>Costo directo total (CDT)</b></td><td className="num"><b>{money(r.cdt)}</b></td></tr>
                  <tr><td>CFA ({r.cfaPct} %)</td><td className="num">{money(r.cfa)}</td></tr>
                  <tr><td>Costo total · precio Ejército</td><td className="num">{money(r.ct)}</td></tr>
                  <tr><td>Precio particular (+{r.margenParticularPct} %)</td><td className="num">{money(r.precioParticular)}</td></tr>
                </tbody>
              </table>
              {sol.costeo?.condiciones && <p style={{ fontSize: 12.5, margin: "6px 0 0" }}>7 · Condiciones técnicas y restricciones: {sol.costeo.condiciones}</p>}
            </div>
          )}
        </div>
      )}

      {vbExige !== "ninguno" && sol.respondidaAt && sol.estado !== "rechazado" && (
        <ol aria-label="V°B° de la respuesta" style={{ listStyle: "none", padding: 0, margin: "8px 0 0", display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12.5 }}>
          <li>
            <b>V°B° laboratorio:</b>{" "}
            {sol.vbLabAt ? <>✓ {sol.vbLabPorNombre} · {fechaHora(sol.vbLabAt)}{sol.vbLabComentario ? ` · «${sol.vbLabComentario}»` : ""}</> : sol.vb?.nivel === "lab" ? <>pendiente · {sol.vb.personas.map((p) => p.nombre).join(", ") || "sin Jefe de Laboratorio asignado"}</> : "—"}
          </li>
          {vbExige === "lab_depto" && (
            <li>
              <b>V°B° departamento:</b>{" "}
              {sol.vbDeptoAt ? <>✓ {sol.vbDeptoPorNombre} · {fechaHora(sol.vbDeptoAt)}{sol.vbDeptoComentario ? ` · «${sol.vbDeptoComentario}»` : ""}</> : sol.vb?.nivel === "depto" ? <>pendiente · {sol.vb.personas.map((p) => p.nombre).join(", ") || "sin Jefe de Departamento asignado"}</> : "—"}
            </li>
          )}
        </ol>
      )}
    </article>
  );
}

export default function LaboratorioCotizacion({ c, onCambio, onMensaje }: { c: Circuito; onCambio: () => void; onMensaje: (m: string) => void }) {
  const [respondiendo, setRespondiendo] = useState<Solicitud | null>(null);
  const [vb, setVb] = useState<{ sol: Solicitud; accion: "dar" | "devolver" } | null>(null);
  const hecho = (m: string) => { onMensaje(m); onCambio(); };

  async function retirar(s: Solicitud) {
    const ok = await confirmar({ titulo: `Retirar la solicitud a ${s.unidadCodigo}`, mensaje: "La solicitud deja de contar para la cotización. Queda en la bitácora.", confirmarTexto: "Retirar", peligro: true });
    if (!ok) return;
    try {
      const r = await pedir<any>("POST", `/cotizaciones/solicitudes-laboratorio/${s.id}/retirar`, { motivo: s.estado === "rechazado" ? "El laboratorio no realiza el servicio" : "Retirada por el ejecutivo" });
      hecho(r?.mensaje ?? "Solicitud retirada.");
    } catch (e: any) {
      onMensaje(e.message);
    }
  }

  return (
    <div>
      <p className="subtitle" style={{ marginTop: 0 }}>
        V°B° exigido: {c.config.niveles === "lab_depto" ? "Jefe de Laboratorio y Jefe de Departamento" : c.config.niveles === "lab" ? "Jefe de Laboratorio" : "ninguno"}.
        {" "}{c.config.exigirConsulta ? "La consulta al laboratorio es obligatoria antes de la firma." : "La consulta es opcional; si se hace, su V°B° es necesario para la firma."}
      </p>
      {c.puedo.solicitar && <FormSolicitud cotId={c.cotizacion.id} onHecho={hecho} />}
      {c.solicitudes.length === 0 ? (
        <p className="subtitle">Aún no se ha consultado a ningún laboratorio.</p>
      ) : (
        c.solicitudes.map((s) => (
          <TarjetaSolicitud
            key={s.id}
            sol={s}
            c={c}
            puedeRetirar={c.puedo.solicitar && ["solicitado", "devuelto", "rechazado"].includes(s.estado)}
            onResponder={() => setRespondiendo(s)}
            onVb={(accion) => setVb({ sol: s, accion })}
            onRetirar={() => retirar(s)}
          />
        ))
      )}
      {respondiendo && (
        <RespuestaLaboratorio
          sol={respondiendo}
          cotCodigo={c.cotizacion.codigo}
          cfg={c.config}
          onCerrar={() => setRespondiendo(null)}
          onHecho={(m) => { setRespondiendo(null); hecho(m); }}
        />
      )}
      {vb && <DialogoVb sol={vb.sol} accion={vb.accion} onCerrar={() => setVb(null)} onHecho={(m) => { setVb(null); hecho(m); }} />}
    </div>
  );
}
