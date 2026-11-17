"use client";

/**
 * Bloqueo de clientes con facturas impagas (Comercial, reunión 2 · 28-10-2026).
 * Es atribución del Jefe del Departamento Comercial (permiso cliente.bloquear y
 * jefatura del DCO). Un cliente bloqueado no recibe cotizaciones ni se le
 * registra la aceptación. «Morosos» lista los clientes con facturas impagas
 * vencidas (propuesta de bloqueo) y los ya bloqueados.
 */
import { useCallback, useEffect, useState } from "react";
import Modal from "@/components/documentos/Modal";
import { usePermisos } from "@/lib/permisos";
import { llamar } from "@/lib/laboratorio";
import { clp, fecha, rut as fmtRut } from "@/lib/format";
import { toast } from "@/components/ui/feedback";

type ClienteRef = { id: string; razonSocial: string; bloqueado?: boolean | null; motivoBloqueo?: string | null };

export function BloqueoCliente({ cliente, onCerrar, onHecho }: { cliente: ClienteRef; onCerrar: () => void; onHecho: () => void }) {
  const { puede } = usePermisos();
  const [historial, setHistorial] = useState<any[]>([]);
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const bloqueado = !!cliente.bloqueado;

  useEffect(() => {
    llamar<any[]>("GET", `/clientes/${cliente.id}/bloqueos`).then(setHistorial).catch(() => setHistorial([]));
  }, [cliente.id]);

  async function confirmar() {
    setEnviando(true);
    try {
      await llamar("POST", `/clientes/${cliente.id}/${bloqueado ? "desbloquear" : "bloquear"}`, { motivo: motivo.trim() });
      toast.ok(bloqueado ? `Cliente ${cliente.razonSocial} desbloqueado.` : `Cliente ${cliente.razonSocial} bloqueado.`);
      onHecho();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal titulo={<>{bloqueado ? "Desbloquear" : "Bloquear"} cliente · {cliente.razonSocial}</>} onCerrar={onCerrar}>
      {bloqueado ? (
        <div className="alert warn">Bloqueado{cliente.motivoBloqueo ? `: ${cliente.motivoBloqueo.trim().replace(/[\s.]+$/, "")}` : ""}. No recibe cotizaciones ni se le registran aceptaciones.</div>
      ) : (
        <p className="hint" style={{ marginTop: 0 }}>Al bloquearlo no se le podrán emitir cotizaciones ni registrar la aceptación de las abiertas, hasta que el Jefe DCO lo desbloquee.</p>
      )}
      {puede("cliente.bloquear") ? (
        <>
          <div className="field">
            <label htmlFor="bloq-motivo">Motivo <span className="req">*</span></label>
            <textarea id="bloq-motivo" rows={2} maxLength={1000} value={motivo} onChange={(e) => setMotivo(e.target.value)}
              placeholder={bloqueado ? "p. ej. pagó las facturas pendientes" : "p. ej. facturas 123 y 130 impagas desde agosto"} />
          </div>
          <div className="toolbar" style={{ marginTop: 8 }}>
            <button className="btn outline sm" onClick={onCerrar}>Cancelar</button>
            <div className="spacer" />
            <button className={`btn sm ${bloqueado ? "success" : "danger"}`} disabled={enviando || motivo.trim().length < 5} onClick={confirmar}>
              {bloqueado ? "Desbloquear" : "Bloquear cliente"}
            </button>
          </div>
        </>
      ) : (
        <div className="alert info">Bloquear o desbloquear clientes es atribución del Jefe del Departamento Comercial.</div>
      )}
      {historial.length > 0 && (
        <>
          <h3 style={{ marginTop: 14 }}>Historial</h3>
          <table className="data">
            <thead><tr><th>Fecha</th><th>Acción</th><th>Motivo</th><th>Por</th></tr></thead>
            <tbody>
              {historial.map((h, i) => (
                <tr key={i}><td>{fecha(h.fecha)}</td><td>{h.accion === "bloqueo" ? "Bloqueo" : "Desbloqueo"}</td><td>{h.motivo}</td><td>{h.usuario ?? "—"}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Modal>
  );
}

/** Sin `onElegir` (quien no tiene cliente.bloquear) la lista es de solo consulta. */
export function ClientesMorosos({ onCerrar, onElegir }: { onCerrar: () => void; onElegir?: (c: ClienteRef) => void }) {
  const [filas, setFilas] = useState<any[] | null>(null);
  const [error, setError] = useState("");
  const cargar = useCallback(() => llamar<any[]>("GET", "/clientes/morosos").then(setFilas).catch((e) => setError(e.message)), []);
  useEffect(() => { cargar(); }, [cargar]);
  return (
    <Modal titulo="Clientes morosos y bloqueados" onCerrar={onCerrar}>
      <p className="hint" style={{ marginTop: 0 }}>Clientes con facturas impagas vencidas (el sistema propone el bloqueo; lo decide el Jefe del Departamento Comercial) y los que ya están bloqueados.</p>
      {error && <div className="alert warn">{error}</div>}
      <table className="data">
        <thead><tr><th>Cliente</th><th className="num">Facturas vencidas</th><th className="num">Monto vencido</th><th className="num">Días de mora</th><th>Estado</th><th /></tr></thead>
        <tbody>
          {(filas ?? []).map((c) => (
            <tr key={c.id}>
              <td>{c.razonSocial}<small style={{ display: "block", color: "var(--muted)" }}>{fmtRut(c.rut)}</small></td>
              <td className="num">{c.morosidad.facturasVencidas}</td>
              <td className="num">{clp(c.morosidad.montoVencido)}</td>
              <td className="num">{c.morosidad.diasMoraMax || "—"}</td>
              <td>{c.bloqueado ? <span className="pill red">bloqueado</span> : <span className="pill amber">propuesto</span>}</td>
              <td>{onElegir && <button className="btn outline sm" onClick={() => onElegir(c)}>{c.bloqueado ? "Desbloquear…" : "Bloquear…"}</button>}</td>
            </tr>
          ))}
          {filas && !filas.length && <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--muted)", padding: 18 }}>No hay clientes con facturas impagas vencidas ni bloqueados.</td></tr>}
          {!filas && !error && <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--muted)", padding: 18 }}>Cargando…</td></tr>}
        </tbody>
      </table>
    </Modal>
  );
}
