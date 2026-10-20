"use client";

/**
 * Diálogos de la cotización: registrar la aceptación (SVT6/SVT7, genera la OT)
 * y anular con motivo. Los usan la lista y la ficha de la cotización.
 */
import { useState } from "react";
import Panel from "./Panel";
import SelectorLaboratorio from "@/components/SelectorLaboratorio";
import { pedir, hoyISO, ACEPTACION_LABEL } from "./comercial";

/* --------------------------------------------------------------------------
 * Registrar aceptación (SVT6 / SVT7)
 * ------------------------------------------------------------------------ */
export function DialogoAceptacion({ cot, onCerrar, onHecho }: { cot: any; onCerrar: () => void; onHecho: (r: any) => void }) {
  const [tipo, setTipo] = useState<string>(cot.tipoClienteCodigo === "ejercito" ? "OPI_RESOLUCION" : "OC");
  const [numero, setNumero] = useState("");
  const [fechaDoc, setFechaDoc] = useState(hoyISO());
  const [adjunto, setAdjunto] = useState("");
  const [conCobro, setConCobro] = useState(true);
  const [labId, setLabId] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const requiereNumero = tipo === "OPI_RESOLUCION" || tipo === "OC";

  async function confirmar() {
    setError("");
    if (requiereNumero && !numero.trim()) return setError("Indique el número del documento.");
    if (!labId) return setError("Elija el laboratorio responsable de la OT que se generará.");
    setEnviando(true);
    try {
      const r = await pedir("POST", `/cotizaciones/${cot.id}/aceptar`, {
        tipo,
        numero: numero.trim() || undefined,
        fecha: fechaDoc,
        adjunto: adjunto.trim() || undefined,
        conCobro,
        unidadPrincipalId: labId,
      });
      onHecho(r);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Panel titulo={<>Registrar aceptación · <span className="codigo">{cot.codigo}</span></>} onCerrar={onCerrar}>
      {error && <div className="alert warn">{error}</div>}
      <div className="form-grid cols-2">
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label>Documento de aceptación <span className="req">*</span></label>
          <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
            {Object.entries(ACEPTACION_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Número {requiereNumero && <span className="req">*</span>}</label>
          <input value={numero} onChange={(e) => setNumero(e.target.value)} maxLength={60}
            placeholder={tipo === "DISPOSICION_DIRECTOR" ? "Ref. de la disposición" : tipo === "CORREO" ? "Opcional" : ""} />
        </div>
        <div className="field">
          <label>Fecha <span className="req">*</span></label>
          <input type="date" value={fechaDoc} onChange={(e) => setFechaDoc(e.target.value)} />
        </div>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label>Adjunto (referencia del archivo o ubicación)</label>
          <input value={adjunto} onChange={(e) => setAdjunto(e.target.value)} maxLength={300} placeholder="p. ej. ruta del PDF en el repositorio documental" />
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 400, gridColumn: "1 / -1" }}>
          <input type="checkbox" style={{ width: "auto" }} checked={conCobro} onChange={(e) => setConCobro(e.target.checked)} />
          Con cobro
        </label>
        <div style={{ gridColumn: "1 / -1" }}>
          <SelectorLaboratorio valor={labId} onCambio={setLabId} pistas={{ cotizacionId: cot.id }} etiqueta="Laboratorio responsable de la OT" />
        </div>
      </div>
      {tipo === "DISPOSICION_DIRECTOR" && (
        <div className="alert warn" style={{ marginTop: 10 }}>
          OT por disposición del Director (IDIC-PG03 6.4 g): {conCobro
            ? <>la OT quedará con <b>OPI pendiente</b> hasta que se registre la OPI en la OT.</>
            : <>sin cobro: no espera OPI, pero igual registra horas y costo.</>}
        </div>
      )}
      <p className="subtitle" style={{ margin: "10px 0 0" }}>Al confirmar, la cotización pasa a <b>Aceptada</b> y se genera la Orden de Trabajo.</p>
      <div className="toolbar" style={{ marginTop: 12 }}>
        <button className="btn outline sm" onClick={onCerrar}>Cancelar</button>
        <div className="spacer" />
        <button className="btn success sm" disabled={enviando} onClick={confirmar}>{enviando ? "Registrando…" : "Confirmar aceptación"}</button>
      </div>
    </Panel>
  );
}

/* --------------------------------------------------------------------------
 * Anular (motivo obligatorio)
 * ------------------------------------------------------------------------ */
export function DialogoAnulacion({ cot, onCerrar, onHecho }: { cot: any; onCerrar: () => void; onHecho: () => void }) {
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  async function confirmar() {
    setError("");
    if (motivo.trim().length < 3) return setError("Indique el motivo de la anulación.");
    setEnviando(true);
    try {
      await pedir("POST", `/cotizaciones/${cot.id}/anular`, { motivo: motivo.trim() });
      onHecho();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setEnviando(false);
    }
  }
  return (
    <Panel titulo={<>Anular cotización · <span className="codigo">{cot.codigo}</span></>} onCerrar={onCerrar} ancho={480}>
      {error && <div className="alert warn">{error}</div>}
      <div className="field">
        <label>Motivo <span className="req">*</span></label>
        <textarea rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={1000} />
      </div>
      <p className="subtitle" style={{ margin: "8px 0 0" }}>La anulación no se puede deshacer. La cotización queda de solo lectura.</p>
      <div className="toolbar" style={{ marginTop: 12 }}>
        <button className="btn outline sm" onClick={onCerrar}>Cancelar</button>
        <div className="spacer" />
        <button className="btn sm" style={{ background: "var(--red)", color: "#fff" }} disabled={enviando} onClick={confirmar}>
          {enviando ? "Anulando…" : "Anular cotización"}
        </button>
      </div>
    </Panel>
  );
}

