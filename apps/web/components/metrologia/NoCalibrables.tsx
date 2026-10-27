"use client";

/**
 * Instrumentos no calibrables de la OT (EP-04 P2.3 y P2.4): informe técnico
 * (Elaborar → Enviar a firma → Firmar y emitir → Registrar entrega) y servicio
 * externo (Solicitar → Jefe de Departamento → Registrar envío con O/C → Adjuntar el
 * certificado externo → Validar). Lo que se puede hacer lo decide el servidor
 * (GET /ot/:id/metrologia/documentos); aquí solo se ofrecen esas acciones.
 */
import { avisarCambioOt, useCambiosOt } from "@/lib/refresco";
import { useCallback, useEffect, useId, useState } from "react";
import { llamar } from "@/lib/laboratorio";
import { enviarInforme } from "@/lib/informes";
import { fechaDia, fechaHora } from "@/lib/format";
import { textoMedio } from "@/lib/documentos";
import { useMediosEnvio } from "@/lib/lista-parametro";
import { confirmar, toast } from "@/components/ui/feedback";
import Modal from "@/components/documentos/Modal";
import css from "./ficha.module.css";
import { hoyChile } from "@/lib/fecha-chile";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
const ESTADO_INFORME: Record<string, { texto: string; pill: string }> = {
  borrador: { texto: "Borrador", pill: "gray" }, en_firma: { texto: "En firma", pill: "blue" }, emitido: { texto: "Emitido", pill: "green" },
};
const ESTADO_EXTERNO: Record<string, { texto: string; pill: string }> = {
  solicitado: { texto: "Solicitado · espera al Jefe de Departamento", pill: "amber" }, aprobado: { texto: "Aprobado · por enviar", pill: "blue" },
  enviado: { texto: "En el laboratorio externo", pill: "blue" }, validado: { texto: "Validado", pill: "green" }, rechazado: { texto: "Rechazado", pill: "red" },
};
const hoy = () => hoyChile();

type Dlg =
  | { tipo: "informe"; fila: any } | { tipo: "devolverInforme"; fila: any } | { tipo: "entregarInforme"; fila: any }
  | { tipo: "solicitar"; fila: any } | { tipo: "rechazar"; fila: any } | { tipo: "envio"; fila: any } | { tipo: "certificado"; fila: any } | { tipo: "validar"; fila: any }
  | { tipo: "entregarExterno"; fila: any };

async function abrirPdf(ruta: string) {
  try {
    const r = await fetch(`${API}${ruta}`, { headers: { Authorization: `Bearer ${localStorage.getItem("lims_token")}` } });
    if (!r.ok) throw new Error(`No se pudo abrir el documento (${r.status})`);
    window.open(URL.createObjectURL(await r.blob()), "_blank");
  } catch (e: any) { toast.error(e.message); }
}

export default function NoCalibrables({ otId, onCambio }: { otId: string; onCambio?: () => void }) {
  useMediosEnvio(); // frente f5: textos de los medios de envío (Parámetros del sistema)
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState("");
  const [dlg, setDlg] = useState<Dlg | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    try { setD(await llamar("GET", `/ot/${otId}/metrologia/documentos`)); setError(""); }
    catch (e: any) { setError(e.message); }
  }, [otId]);
  useEffect(() => { cargar(); }, [cargar]);
  useCambiosOt(otId, cargar);

  async function hacer(metodo: "POST" | "PUT", ruta: string, cuerpo: unknown, ok: string) {
    setOcupado(true);
    try {
      if (cuerpo instanceof FormData) await enviarInforme(ruta, "PUT", cuerpo);
      else await llamar(metodo, ruta, cuerpo);
      toast.ok(ok); setDlg(null); await cargar(); onCambio?.(); avisarCambioOt(otId);
    } catch (e: any) { toast.error(e.message); }
    finally { setOcupado(false); }
  }

  if (error) return <div className="alert warn" role="alert">{error}</div>;
  if (!d || !d.data.length) return null;
  const base = (f: any) => `/ot/${otId}/instrumentos/${f.instrumento.id}`;

  return (
    <section className={css.bloque} aria-labelledby="nocal-tit">
      <h2 id="nocal-tit">Instrumentos no calibrables · informe técnico o servicio externo</h2>
      <p style={{ margin: "0 0 10px", fontSize: 12.5, color: "var(--muted)" }}>
        Cuando el laboratorio no puede calibrar un instrumento, se emite un informe técnico o se contrata un laboratorio externo
        (aprueba el Jefe {d.jefeDepartamento ? `del ${d.jefeDepartamento}` : "de Departamento"}). Formatos y firmantes por confirmar con el IDIC.
      </p>
      <div style={{ display: "grid", gap: 10 }}>
        {d.data.map((f: any) => {
          const inf = f.informe, ext = f.externo;
          const ai: string[] = f.accionesInforme, ae: string[] = f.accionesExterno;
          const ei = inf ? ESTADO_INFORME[inf.estado] ?? { texto: inf.estado, pill: "gray" } : null;
          const ee = ext ? ESTADO_EXTERNO[ext.estado] ?? { texto: ext.estado, pill: "gray" } : null;
          return (
            <div key={f.instrumento.id} className={css.nocal}>
              <div className={css.nocalItem}>
                <b>Ítem {f.instrumento.numero} · {f.instrumento.descripcion}</b>
                <small>Serie {f.instrumento.serie || "s/s"} · No se puede calibrar: {f.instrumento.motivoNoCalibrable ?? "—"}
                  {f.instrumento.requiereExterno ? " · se indicó laboratorio externo" : ""}</small>
              </div>
              <div className={css.nocalCol}>
                <h3>Informe técnico {ei && <span className={`pill ${ei.pill}`}>{ei.texto}</span>}</h3>
                {inf ? (
                  <p>{inf.numero ? <span className="codigo">{inf.numero}</span> : "Sin número (se asigna al emitir)"}
                    {inf.emitido_at ? ` · emitido el ${fechaHora(inf.emitido_at)}${inf.emitido_nombre ? ` por ${inf.emitido_nombre}` : ""}` : ""}
                    {inf.entregado_at ? ` · entregado el ${fechaDia(inf.entregado_at)} (${textoMedio(inf.entrega_medio)}) a ${inf.entrega_destinatario}` : ""}
                    {inf.devuelto_motivo && inf.estado === "borrador" ? <span style={{ display: "block", color: "var(--warn-ink, #8a4b00)" }}>Devuelto: {inf.devuelto_motivo}</span> : null}</p>
                ) : <p>Aún no se elabora.</p>}
                <div className={css.acciones}>
                  {ai.includes("GUARDAR") && <button className="btn outline sm" onClick={() => setDlg({ tipo: "informe", fila: f })}>{inf ? "Editar informe" : "Elaborar informe técnico"}</button>}
                  {ai.includes("ENVIAR") && <button className="btn primary sm" disabled={ocupado} onClick={async () => {
                    // B-074: enviar a firma un documento que se sellará pide confirmación.
                    if (await confirmar({ titulo: "¿Enviar el informe técnico a firma?", mensaje: "Queda en firma de la jefatura del laboratorio: ya no se puede editar salvo que lo devuelvan.", confirmarTexto: "Enviar a firma" }))
                      hacer("POST", `${base(f)}/informe-tecnico/enviar`, undefined, "Informe técnico enviado a firma.");
                  }}>Enviar a firma → emitir</button>}
                  {ai.includes("EMITIR") && <button className="btn primary sm" disabled={ocupado} onClick={async () => {
                    if (await confirmar({ titulo: "¿Firmar y emitir el informe técnico?", mensaje: "Recibe su número, queda sellado y su fecha de emisión se congela.", confirmarTexto: "Firmar y emitir" }))
                      hacer("POST", `${base(f)}/informe-tecnico/emitir`, undefined, "Informe técnico emitido con su número.");
                  }}>Firmar y emitir → Entrega</button>}
                  {ai.includes("DEVOLVER") && <button className="btn outline sm" onClick={() => setDlg({ tipo: "devolverInforme", fila: f })}>Devolver…</button>}
                  {ai.includes("ENTREGAR") && <button className="btn primary sm" onClick={() => setDlg({ tipo: "entregarInforme", fila: f })}>Registrar entrega → Cierre</button>}
                  {inf && <button className="btn outline sm" onClick={() => abrirPdf(`${base(f)}/informe-tecnico/pdf`)}>{inf.estado === "emitido" ? "Informe (PDF)" : "Borrador (PDF)"}</button>}
                </div>
              </div>
              <div className={css.nocalCol}>
                <h3>Servicio externo {ee && <span className={`pill ${ee.pill}`}>{ee.texto}</span>}</h3>
                {ext ? (
                  <p>{ext.proveedor ?? "—"}{ext.costo != null ? ` · $ ${Math.round(ext.costo).toLocaleString("es-CL")}` : ""}{ext.oc_numero ? ` · O/C ${ext.oc_numero}` : ""}
                    {ext.fecha_envio ? ` · enviado el ${fechaDia(ext.fecha_envio)}` : ""}{ext.fecha_retorno ? ` · volvió el ${fechaDia(ext.fecha_retorno)}` : ""}
                    {ext.certificado_numero ? <> · certificado externo <span className="codigo">{ext.certificado_numero}</span></> : null}
                    {ext.estado === "validado" ? ` · ${ext.aptitud === "apto" ? "apto" : "no apto"}${ext.aptitud_comentario ? `: ${ext.aptitud_comentario}` : ""}` : ""}
                    {ext.estado === "rechazado" && ext.rechazo_motivo ? <span style={{ display: "block" }}>Rechazado: {ext.rechazo_motivo}</span> : null}
                    {ext.estado === "validado" && (ext.entregado_at
                      ? <span style={{ display: "block" }}>Entregado al cliente el {fechaDia(ext.entregado_at)} · {ext.entrega_destinatario}</span>
                      : <span style={{ display: "block" }}><span className="pill amber">Sin entregar al cliente</span></span>)}</p>
                ) : <p>No se ha solicitado.</p>}
                <div className={css.acciones}>
                  {ae.includes("SOLICITAR") && <button className="btn outline sm" onClick={() => setDlg({ tipo: "solicitar", fila: f })}>Solicitar servicio externo → Jefe de Departamento</button>}
                  {ae.includes("APROBAR") && <button className="btn primary sm" disabled={ocupado} onClick={() => hacer("POST", `${base(f)}/servicio-externo/aprobar`, undefined, "Contratación aprobada: pasa a Abastecimiento y envío.")}>Aprobar contratación → envío</button>}
                  {ae.includes("RECHAZAR") && <button className="btn outline sm" onClick={() => setDlg({ tipo: "rechazar", fila: f })}>Rechazar…</button>}
                  {ae.includes("ENVIO") && <button className="btn primary sm" onClick={() => setDlg({ tipo: "envio", fila: f })}>Registrar envío al proveedor →</button>}
                  {ae.includes("CERTIFICADO") && <button className="btn outline sm" onClick={() => setDlg({ tipo: "certificado", fila: f })}>{ext?.tiene_certificado ? "Reemplazar el certificado externo" : "Adjuntar el certificado externo"}</button>}
                  {ae.includes("VALIDAR") && <button className="btn primary sm" onClick={() => setDlg({ tipo: "validar", fila: f })}>Validar el certificado externo → Entrega</button>}
                  {ae.includes("ENTREGAR") && <button className="btn primary sm" onClick={() => setDlg({ tipo: "entregarExterno", fila: f })}>Registrar entrega → Cierre</button>}
                  {ext?.tiene_certificado && <button className="btn outline sm" onClick={() => abrirPdf(`${base(f)}/servicio-externo/certificado`)}>Certificado externo (PDF)</button>}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {dlg?.tipo === "informe" && <DialogoInforme fila={dlg.fila} ocupado={ocupado} onCerrar={() => setDlg(null)}
        onGuardar={(b) => hacer("POST", `${base(dlg.fila)}/informe-tecnico`, b, "Informe técnico guardado en borrador.")} />}
      {dlg?.tipo === "devolverInforme" && <DialogoTexto titulo="Devolver el informe técnico" etiqueta="Motivo" boton="Devolver al metrólogo" min={5} ocupado={ocupado} onCerrar={() => setDlg(null)}
        onGuardar={(motivo) => hacer("POST", `${base(dlg.fila)}/informe-tecnico/devolver`, { motivo }, "Informe técnico devuelto al metrólogo.")} />}
      {dlg?.tipo === "rechazar" && <DialogoTexto titulo="Rechazar la contratación del servicio externo" etiqueta="Motivo" boton="Rechazar" min={5} ocupado={ocupado} onCerrar={() => setDlg(null)}
        onGuardar={(motivo) => hacer("POST", `${base(dlg.fila)}/servicio-externo/rechazar`, { motivo }, "Solicitud rechazada.")} />}
      {dlg?.tipo === "entregarInforme" && <DialogoEntrega ocupado={ocupado} onCerrar={() => setDlg(null)}
        onGuardar={(b) => hacer("POST", `${base(dlg.fila)}/informe-tecnico/entregar`, b, "Entrega del informe técnico registrada.")} />}
      {dlg?.tipo === "entregarExterno" && <DialogoEntrega ocupado={ocupado} onCerrar={() => setDlg(null)}
        onGuardar={(b) => hacer("POST", `${base(dlg.fila)}/servicio-externo/entregar`, b, "Entrega del certificado externo registrada.")} />}
      {dlg?.tipo === "solicitar" && <DialogoSolicitud otId={otId} ocupado={ocupado} onCerrar={() => setDlg(null)}
        onGuardar={(b) => hacer("POST", `${base(dlg.fila)}/servicio-externo`, b, "Servicio externo solicitado: espera la aprobación del Jefe de Departamento.")} />}
      {dlg?.tipo === "envio" && <DialogoEnvio costo={dlg.fila.externo?.costo} ocupado={ocupado} onCerrar={() => setDlg(null)}
        onGuardar={(b) => hacer("POST", `${base(dlg.fila)}/servicio-externo/envio`, b, "Envío al laboratorio externo registrado.")} />}
      {dlg?.tipo === "certificado" && <DialogoCertificado fechaEnvio={dlg.fila.externo?.fecha_envio} ocupado={ocupado} onCerrar={() => setDlg(null)}
        onGuardar={(fd) => hacer("PUT", `${base(dlg.fila)}/servicio-externo/certificado`, fd, "Certificado externo adjunto.")} />}
      {dlg?.tipo === "validar" && <DialogoValidar ocupado={ocupado} onCerrar={() => setDlg(null)}
        onGuardar={(b) => hacer("POST", `${base(dlg.fila)}/servicio-externo/validar`, b, "Certificado externo validado.")} />}
    </section>
  );
}

const Req = () => <span className="req">*</span>;
const acciones = (ocupado: boolean, onCerrar: () => void, texto: string, ok: boolean, onClick: () => void) => (
  <><button className="btn outline" onClick={onCerrar}>Cancelar</button>
    <button className="btn primary" disabled={ocupado || !ok} onClick={onClick}>{ocupado ? "Guardando…" : texto}</button></>
);

function DialogoInforme({ fila, ocupado, onCerrar, onGuardar }: { fila: any; ocupado: boolean; onCerrar: () => void; onGuardar: (b: any) => void }) {
  const id = useId();
  const [f, setF] = useState({ motivo: fila.informe?.motivo ?? fila.instrumento.motivoNoCalibrable ?? "", hallazgos: fila.informe?.hallazgos ?? "", recomendacion: fila.informe?.recomendacion ?? "" });
  const ok = f.motivo.trim().length >= 5 && f.hallazgos.trim().length >= 5;
  return (
    <Modal titulo={`Informe técnico · ítem ${fila.instrumento.numero}`} onCerrar={onCerrar}
      acciones={acciones(ocupado, onCerrar, "Guardar borrador", ok, () => onGuardar({ motivo: f.motivo.trim(), hallazgos: f.hallazgos.trim(), recomendacion: f.recomendacion.trim() || null }))}>
      <div className="field"><label htmlFor={`${id}-m`}>Motivo por el que no se calibra <Req /></label><textarea id={`${id}-m`} rows={2} maxLength={4000} value={f.motivo} onChange={(e) => setF({ ...f, motivo: e.target.value })} /></div>
      <div className="field"><label htmlFor={`${id}-h`}>Hallazgos <Req /></label><textarea id={`${id}-h`} rows={4} maxLength={4000} value={f.hallazgos} onChange={(e) => setF({ ...f, hallazgos: e.target.value })} /></div>
      <div className="field"><label htmlFor={`${id}-r`}>Recomendación</label><textarea id={`${id}-r`} rows={2} maxLength={4000} value={f.recomendacion} onChange={(e) => setF({ ...f, recomendacion: e.target.value })} /></div>
    </Modal>
  );
}

function DialogoTexto({ titulo, etiqueta, boton, min, ocupado, onCerrar, onGuardar }: { titulo: string; etiqueta: string; boton: string; min: number; ocupado: boolean; onCerrar: () => void; onGuardar: (t: string) => void }) {
  const id = useId();
  const [t, setT] = useState("");
  return (
    <Modal titulo={titulo} onCerrar={onCerrar} acciones={acciones(ocupado, onCerrar, boton, t.trim().length >= min, () => onGuardar(t.trim()))}>
      <div className="field"><label htmlFor={id}>{etiqueta} <Req /></label><textarea id={id} rows={3} maxLength={1000} value={t} onChange={(e) => setT(e.target.value)} /></div>
      <small style={{ color: "var(--muted)" }}>Mínimo {min} caracteres.</small>
    </Modal>
  );
}

function DialogoEntrega({ ocupado, onCerrar, onGuardar }: { ocupado: boolean; onCerrar: () => void; onGuardar: (b: any) => void }) {
  const medios = useMediosEnvio(); // frente f5: «Parámetros del sistema › medio_envio»
  const id = useId();
  const [f, setF] = useState({ fecha: hoy(), medio: "", destinatario: "", observacion: "" });
  return (
    <Modal titulo="Registrar la entrega del informe técnico" onCerrar={onCerrar}
      acciones={acciones(ocupado, onCerrar, "Registrar entrega", !!f.fecha && !!f.medio && f.destinatario.trim().length >= 2,
        () => onGuardar({ fecha: f.fecha, medio: f.medio, destinatario: f.destinatario.trim(), observacion: f.observacion.trim() || null }))}>
      <div className="form-grid cols-2">
        <div className="field"><label htmlFor={`${id}-f`}>Fecha <Req /></label><input id={`${id}-f`} type="date" max={hoy()} value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></div>
        <div className="field"><label htmlFor={`${id}-m`}>Medio <Req /></label>
          <select id={`${id}-m`} value={f.medio} onChange={(e) => setF({ ...f, medio: e.target.value })}><option value="">Seleccione…</option>{medios.opciones.map((m) => <option key={m.codigo} value={m.codigo}>{m.etiqueta}</option>)}</select></div>
        <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor={`${id}-d`}>Destinatario <Req /></label><input id={`${id}-d`} maxLength={160} value={f.destinatario} onChange={(e) => setF({ ...f, destinatario: e.target.value })} /></div>
        <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor={`${id}-o`}>Observación</label><input id={`${id}-o`} maxLength={1000} value={f.observacion} onChange={(e) => setF({ ...f, observacion: e.target.value })} /></div>
      </div>
    </Modal>
  );
}

function DialogoSolicitud({ otId, ocupado, onCerrar, onGuardar }: { otId: string; ocupado: boolean; onCerrar: () => void; onGuardar: (b: any) => void }) {
  const id = useId();
  const [provs, setProvs] = useState<any[] | null>(null);
  const [f, setF] = useState({ proveedorId: "", justificacion: "", costo: "" });
  useEffect(() => { llamar("GET", `/ot/${otId}/metrologia/proveedores`).then((r) => setProvs(r.data ?? [])).catch(() => setProvs([])); }, [otId]);
  const costo = f.costo.trim() === "" ? null : Number(f.costo.replace(/\./g, "").replace(",", "."));
  const ok = !!f.proveedorId && f.justificacion.trim().length >= 5 && (costo == null || (Number.isFinite(costo) && costo >= 0));
  return (
    <Modal titulo="Solicitar la calibración en un laboratorio externo" onCerrar={onCerrar}
      acciones={acciones(ocupado, onCerrar, "Solicitar → Jefe de Departamento", ok, () => onGuardar({ proveedorId: f.proveedorId, justificacion: f.justificacion.trim(), costo }))}>
      <div className="field"><label htmlFor={`${id}-p`}>Proveedor (laboratorio externo) <Req /></label>
        <select id={`${id}-p`} value={f.proveedorId} onChange={(e) => setF({ ...f, proveedorId: e.target.value })} disabled={!provs}>
          <option value="">{provs ? (provs.length ? "Seleccione del maestro de proveedores…" : "No hay proveedores en el maestro") : "Cargando…"}</option>
          {(provs ?? []).map((p) => <option key={p.id} value={p.id}>{p.razon_social} · {p.codigo}</option>)}
        </select></div>
      <div className="field"><label htmlFor={`${id}-j`}>Justificación <Req /></label><textarea id={`${id}-j`} rows={3} maxLength={2000} value={f.justificacion} onChange={(e) => setF({ ...f, justificacion: e.target.value })} /></div>
      <div className="field"><label htmlFor={`${id}-c`}>Costo estimado ($)</label><input id={`${id}-c`} inputMode="numeric" value={f.costo} onChange={(e) => setF({ ...f, costo: e.target.value })} /></div>
    </Modal>
  );
}

function DialogoEnvio({ costo, ocupado, onCerrar, onGuardar }: { costo?: number | null; ocupado: boolean; onCerrar: () => void; onGuardar: (b: any) => void }) {
  const id = useId();
  const [f, setF] = useState({ ocNumero: "", fechaEnvio: hoy(), costo: costo != null ? String(Math.round(costo)) : "" });
  const c = f.costo.trim() === "" ? null : Number(f.costo.replace(/\./g, "").replace(",", "."));
  return (
    <Modal titulo="Registrar el envío al laboratorio externo" onCerrar={onCerrar}
      acciones={acciones(ocupado, onCerrar, "Registrar envío", !!f.fechaEnvio && (c == null || Number.isFinite(c)), () => onGuardar({ ocNumero: f.ocNumero.trim() || null, fechaEnvio: f.fechaEnvio, costo: c }))}>
      <div className="form-grid cols-2">
        <div className="field"><label htmlFor={`${id}-o`}>N° de orden de compra</label><input id={`${id}-o`} maxLength={40} value={f.ocNumero} onChange={(e) => setF({ ...f, ocNumero: e.target.value })} /></div>
        <div className="field"><label htmlFor={`${id}-f`}>Fecha de envío <Req /></label><input id={`${id}-f`} type="date" max={hoy()} value={f.fechaEnvio} onChange={(e) => setF({ ...f, fechaEnvio: e.target.value })} /></div>
        <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor={`${id}-c`}>Costo ($)</label><input id={`${id}-c`} inputMode="numeric" value={f.costo} onChange={(e) => setF({ ...f, costo: e.target.value })} /></div>
      </div>
    </Modal>
  );
}

function DialogoCertificado({ fechaEnvio, ocupado, onCerrar, onGuardar }: { fechaEnvio?: string | null; ocupado: boolean; onCerrar: () => void; onGuardar: (fd: FormData) => void }) {
  const id = useId();
  const [archivo, setArchivo] = useState<File | null>(null);
  const [numero, setNumero] = useState("");
  const [retorno, setRetorno] = useState(hoy());
  const ok = !!archivo && numero.trim().length > 0 && archivo.size <= 10 * 1024 * 1024;
  return (
    <Modal titulo="Adjuntar el certificado del laboratorio externo" onCerrar={onCerrar}
      acciones={acciones(ocupado, onCerrar, "Adjuntar certificado", ok, () => {
        const fd = new FormData(); fd.append("archivo", archivo!); fd.append("numero", numero.trim()); if (retorno) fd.append("fechaRetorno", retorno); onGuardar(fd);
      })}>
      <div className="form-grid cols-2">
        <div className="field"><label htmlFor={`${id}-n`}>N° del certificado externo <Req /></label><input id={`${id}-n`} maxLength={60} value={numero} onChange={(e) => setNumero(e.target.value)} /></div>
        <div className="field"><label htmlFor={`${id}-r`}>Fecha de retorno</label><input id={`${id}-r`} type="date" min={fechaEnvio ?? undefined} max={hoy()} value={retorno} onChange={(e) => setRetorno(e.target.value)} /></div>
        <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor={`${id}-a`}>Certificado en PDF (máx. 10 MB) <Req /></label>
          <input id={`${id}-a`} type="file" accept="application/pdf" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} /></div>
      </div>
      {archivo && archivo.size > 10 * 1024 * 1024 && <div className="alert warn" style={{ margin: "8px 0 0" }}>El PDF supera 10 MB.</div>}
    </Modal>
  );
}

function DialogoValidar({ ocupado, onCerrar, onGuardar }: { ocupado: boolean; onCerrar: () => void; onGuardar: (b: any) => void }) {
  const id = useId();
  const [aptitud, setAptitud] = useState("");
  const [comentario, setComentario] = useState("");
  return (
    <Modal titulo="Validar el certificado externo" onCerrar={onCerrar}
      acciones={acciones(ocupado, onCerrar, "Validar → Entrega", !!aptitud, () => onGuardar({ aptitud, comentario: comentario.trim() || null }))}>
      <fieldset style={{ border: 0, padding: 0, margin: "0 0 8px" }} className={css.opciones}>
        <legend style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 4 }}>Revisión de aptitud del certificado <Req /></legend>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="radio" name={`${id}-a`} checked={aptitud === "apto"} onChange={() => setAptitud("apto")} /> Apto: cumple lo solicitado</label>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="radio" name={`${id}-a`} checked={aptitud === "no_apto"} onChange={() => setAptitud("no_apto")} /> No apto</label>
      </fieldset>
      <div className="field"><label htmlFor={`${id}-c`}>Comentario</label><textarea id={`${id}-c`} rows={3} maxLength={2000} value={comentario} onChange={(e) => setComentario(e.target.value)} /></div>
    </Modal>
  );
}
