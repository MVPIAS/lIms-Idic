"use client";

/**
 * Diálogos de la cotización: registrar la aceptación (SVT6/SVT7, genera la OT)
 * y anular con motivo. Los usan la lista y la ficha de la cotización.
 */
import { useState } from "react";
import Panel from "./Panel";
import SelectorLaboratorio from "@/components/SelectorLaboratorio";
import { pedir, hoyISO, ACEPTACION_LABEL } from "./comercial";
import { subirFormulario } from "@/lib/d11";
import { money } from "@/lib/format";

/* --------------------------------------------------------------------------
 * Registrar aceptación (SVT6 / SVT7)
 * ------------------------------------------------------------------------ */
export function DialogoAceptacion({ cot, onCerrar, onHecho }: { cot: any; onCerrar: () => void; onHecho: (r: any) => void }) {
  const [tipo, setTipo] = useState<string>(cot.tipoClienteCodigo === "ejercito" ? "OPI_RESOLUCION" : "OC");
  const [numero, setNumero] = useState("");
  const [fechaDoc, setFechaDoc] = useState(hoyISO());
  const [archivo, setArchivo] = useState<File | null>(null);
  const [montoOc, setMontoOc] = useState("");
  const [discrepancia, setDiscrepancia] = useState("");
  const [anulandoOrden, setAnulandoOrden] = useState(false);
  const [motivoOrden, setMotivoOrden] = useState("");
  const total = Number(cot.total ?? 0);
  const monto = montoOc.trim() === "" ? null : Number(montoOc.replace(/\./g, "").replace(",", "."));
  const diferencia = tipo === "OC" && monto != null && Number.isFinite(monto) ? Math.round((monto - total) * 100) / 100 : null;
  const difiere = diferencia != null && diferencia !== 0;
  const [conCobro, setConCobro] = useState(true);
  const [labId, setLabId] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const requiereNumero = tipo === "OPI_RESOLUCION" || tipo === "OC";

  async function confirmar() {
    setError("");
    if (requiereNumero && !numero.trim()) return setError("Indique el número del documento.");
    if (!labId) return setError("Elija el laboratorio responsable de la OT que se generará.");
    if (difiere && discrepancia.trim().length < 5) return setError("La O/C difiere del total cotizado: registre la discrepancia (o anule la orden del cliente).");
    setEnviando(true);
    try {
      // EP-00 4.1: el documento de aceptación se adjunta como archivo antes de crear la OT.
      let adjuntoId: string | undefined;
      if (archivo) {
        const f = new FormData();
        f.append("clase", "aceptacion");
        f.append("archivo", archivo, archivo.name);
        adjuntoId = (await subirFormulario<{ id: string }>(`/cotizaciones/${cot.id}/adjuntos`, f)).id;
      }
      const r = await pedir("POST", `/cotizaciones/${cot.id}/aceptar`, {
        tipo,
        numero: numero.trim() || undefined,
        fecha: fechaDoc,
        adjuntoId,
        conCobro,
        unidadPrincipalId: labId,
        ...(tipo === "OC" && monto != null && Number.isFinite(monto) ? { montoOc: monto } : {}),
        ...(difiere ? { discrepancia: discrepancia.trim() } : {}),
      });
      onHecho(r);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setEnviando(false);
    }
  }

  /** «Anular orden del cliente» (EP-00 4.2): la O/C no corresponde; la cotización sigue Abierta. */
  async function anularOrden() {
    setError("");
    if (!numero.trim()) return setError("Indique el Nº de la orden de compra que se anula.");
    if (motivoOrden.trim().length < 5) return setError("Indique el motivo (mínimo 5 caracteres).");
    setEnviando(true);
    try {
      const r = await pedir("POST", `/cotizaciones/${cot.id}/anular-orden-cliente`, {
        numero: numero.trim(),
        ...(monto != null && Number.isFinite(monto) ? { montoOc: monto } : {}),
        motivo: motivoOrden.trim(),
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
        {tipo === "OC" && (
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label htmlFor="acep-monto">Monto de la O/C ({cot.moneda === "USD" ? "US$" : "CLP"})</label>
            <input id="acep-monto" inputMode="decimal" value={montoOc} onChange={(e) => setMontoOc(e.target.value)} placeholder={`Total cotizado: ${money(total, cot.moneda === "USD" ? "USD" : "CLP")}`} />
            {diferencia != null && (
              <small style={{ color: difiere ? "var(--red)" : "var(--muted)" }}>
                {difiere
                  ? `O/C vs cotización: diferencia de ${money(diferencia, cot.moneda === "USD" ? "USD" : "CLP")}. Registre la discrepancia o anule la orden del cliente.`
                  : "La O/C coincide con el total cotizado."}
              </small>
            )}
          </div>
        )}
        {difiere && (
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label htmlFor="acep-disc">Discrepancia <span className="req">*</span></label>
            <textarea id="acep-disc" rows={2} maxLength={2000} value={discrepancia} onChange={(e) => setDiscrepancia(e.target.value)}
              placeholder="p. ej. la O/C excluye un ensayo; se acuerda con el cliente…" />
          </div>
        )}
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label htmlFor="acep-arch">Documento de aceptación (PDF o imagen, máx. 5 MB)</label>
          <input id="acep-arch" type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
          <small style={{ color: "var(--muted)" }}>OPI, O/C, correo o comprobante de pago. Queda en la cotización y en la OT.</small>
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
        {tipo === "OC" && difiere && (
          <button className="btn outline sm" disabled={enviando} onClick={() => setAnulandoOrden((v) => !v)}>Anular orden del cliente</button>
        )}
        <button className="btn success sm" disabled={enviando} onClick={confirmar}>{enviando ? "Registrando…" : difiere ? "Resolver → crear OT" : "Confirmar aceptación → crear OT"}</button>
      </div>
      {anulandoOrden && (
        <div className="card" style={{ marginTop: 10, padding: 10 }}>
          <div className="field">
            <label htmlFor="acep-mot">Motivo de la anulación de la orden <span className="req">*</span></label>
            <textarea id="acep-mot" rows={2} maxLength={2000} value={motivoOrden} onChange={(e) => setMotivoOrden(e.target.value)} />
          </div>
          <p className="subtitle" style={{ margin: "6px 0" }}>La cotización sigue <b>Abierta</b>; queda el hito con la orden y el motivo.</p>
          <div className="toolbar"><div className="spacer" /><button className="btn sm" style={{ background: "var(--red)", color: "#fff" }} disabled={enviando} onClick={anularOrden}>Anular orden del cliente</button></div>
        </div>
      )}
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

