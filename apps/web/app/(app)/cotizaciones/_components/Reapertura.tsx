"use client";

/**
 * COM-02 · Reabrir cotización (valor cotizado → valor finalmente trabajado).
 * El Ejecutivo la pide con motivo obligatorio; el Jefe DCO o su subrogante la
 * autoriza; con la cotización reabierta se corrigen las líneas en «Datos» y se
 * registra el valor final, que pasa a la OT y a la factura pendiente.
 */
import { useState } from "react";
import { fechaHora, monto } from "@/lib/format";
import Panel from "./Panel";
import { pedir } from "./comercial";

const ESTADO_REAPERTURA: Record<string, [string, string]> = {
  solicitada: ["Esperando autorización", "amber"],
  autorizada: ["Reabierta", "amber"],
  rechazada: ["Rechazada", "red"],
  cerrada: ["Valor final registrado", "green"],
};

export default function Reapertura({
  cot,
  puede,
  onHecho,
  onError,
  onEditar,
}: {
  cot: any;
  puede: (p: string) => boolean;
  onHecho: (m: string) => Promise<void>;
  onError: (m: string) => void;
  onEditar: () => void;
}) {
  const [dialogo, setDialogo] = useState<null | "pedir" | "rechazar">(null);
  const [texto, setTexto] = useState("");
  const [busy, setBusy] = useState(false);
  const lista: any[] = cot.reaperturas ?? [];
  const viva = lista.find((r) => r.estado === "solicitada" || r.estado === "autorizada") ?? null;
  if (cot.estado !== "aceptada" && cot.estado !== "reabierta" && !lista.length) return null;

  const accion = async (ruta: string, cuerpo?: unknown) => {
    setBusy(true);
    try {
      const r = await pedir<any>("POST", `/cotizaciones/${cot.id}${ruta}`, cuerpo ?? {});
      setDialogo(null);
      setTexto("");
      await onHecho(r?.mensaje ?? "Listo.");
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const puedePedir = cot.estado === "aceptada" && !viva && puede("cotizacion.crear");
  const puedeAutorizar = viva?.estado === "solicitada" && puede("cotizacion.reabrir");

  return (
    <section className="card" style={{ marginBottom: 12, padding: 12 }} aria-label="Reapertura de la cotización">
      <div className="toolbar" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <b style={{ fontSize: 13 }}>Ajuste del valor (reapertura)</b>
        {viva && <span className={`pill ${ESTADO_REAPERTURA[viva.estado]?.[1] ?? "gray"}`}>{ESTADO_REAPERTURA[viva.estado]?.[0] ?? viva.estado}</span>}
        <div className="spacer" />
        {puedePedir && <button className="btn outline sm" onClick={() => setDialogo("pedir")}>Reabrir cotización</button>}
        {puedeAutorizar && (
          <>
            <button className="btn outline sm" disabled={busy} onClick={() => setDialogo("rechazar")}>Rechazar reapertura</button>
            <button className="btn success sm" disabled={busy} onClick={() => accion("/reapertura/resolver", { autorizar: true })}>Autorizar reapertura</button>
          </>
        )}
        {cot.estado === "reabierta" && puede("cotizacion.crear") && (
          <>
            <button className="btn outline sm" onClick={onEditar}>Corregir líneas</button>
            <button className="btn primary sm" disabled={busy} onClick={() => accion("/reapertura/cerrar")}>Registrar valor final →</button>
          </>
        )}
      </div>
      {viva?.estado === "solicitada" && (
        <p className="subtitle" style={{ margin: "6px 0 0" }}>
          Motivo: {viva.motivo} · pedida por {viva.solicitadaPor ?? "—"} el {fechaHora(viva.solicitadaAt)}.
          {!puedeAutorizar && " Espera la autorización del Jefe DCO (o su subrogante)."}
        </p>
      )}
      {cot.estado === "reabierta" && (
        <p className="subtitle" style={{ margin: "6px 0 0" }}>
          Cotización reabierta (versión {viva?.version ?? "—"}): corrija las líneas y registre el valor final. La OT conserva su número y toma el valor final; la factura pendiente se actualiza con él.
        </p>
      )}
      {lista.length > 0 && (
        <table className="table" style={{ marginTop: 8, fontSize: 12 }}>
          <thead>
            <tr><th>Versión</th><th>Estado</th><th>Motivo</th><th>Autorización</th><th>Cotizado</th><th>Valor final</th></tr>
          </thead>
          <tbody>
            {lista.map((r) => (
              <tr key={r.id}>
                <td>{r.version}</td>
                <td>{ESTADO_REAPERTURA[r.estado]?.[0] ?? r.estado}</td>
                <td>{r.motivo}</td>
                <td>{r.resueltaPor ? `${r.resueltaPor} · ${fechaHora(r.resueltaAt)}${r.comentarioResolucion ? ` · ${r.comentarioResolucion}` : ""}` : "—"}</td>
                <td>{r.totalAnterior != null ? monto(r.totalAnterior, r.moneda ?? cot.moneda) : "—"}</td>
                <td>{r.totalFinal != null ? monto(r.totalFinal, r.moneda ?? cot.moneda) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {dialogo && (
        <Panel titulo={dialogo === "pedir" ? `Reabrir la cotización ${cot.codigo}` : `Rechazar la reapertura de ${cot.codigo}`} onCerrar={() => setDialogo(null)} ancho={480}>
          <div className="field">
            <label htmlFor="reap-texto">{dialogo === "pedir" ? "Motivo de la reapertura (por qué se modifica el valor)" : "Motivo del rechazo"} <span className="req">*</span></label>
            <textarea id="reap-texto" rows={3} maxLength={2000} value={texto} onChange={(e) => setTexto(e.target.value)} />
          </div>
          {dialogo === "pedir" && <p className="subtitle" style={{ margin: "8px 0 0" }}>La reapertura la autoriza el Jefe DCO o su subrogante. Mínimo 10 caracteres.</p>}
          <div className="toolbar" style={{ marginTop: 12 }}>
            <button className="btn outline sm" onClick={() => setDialogo(null)}>Cancelar</button>
            <div className="spacer" />
            {dialogo === "pedir" ? (
              <button className="btn primary sm" disabled={busy || texto.trim().length < 10} onClick={() => accion("/reapertura", { motivo: texto.trim() })}>Pedir reapertura → Jefe DCO</button>
            ) : (
              <button className="btn sm" style={{ background: "var(--red)", color: "#fff" }} disabled={busy || texto.trim().length < 5} onClick={() => accion("/reapertura/resolver", { autorizar: false, comentario: texto.trim() })}>Rechazar</button>
            )}
          </div>
        </Panel>
      )}
    </section>
  );
}
