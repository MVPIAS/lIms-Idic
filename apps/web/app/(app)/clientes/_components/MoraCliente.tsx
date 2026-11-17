"use client";

/**
 * COM-05 · Mora y bloqueo del cliente. Facturas vencidas por tramo (30 días
 * aviso · 60 bloqueo · 90 derivar al CDE; tramos en Parámetros › mora_cliente),
 * bloqueo manual y excepción o desbloqueo, que autoriza el Jefe DCO o su
 * subrogante con motivo.
 */
import { useCallback, useEffect, useState } from "react";
import Modal from "@/components/documentos/Modal";
import { api } from "@/lib/api";
import { usePermisos } from "@/lib/permisos";
import { toast } from "@/components/ui/feedback";
import { fechaDia, fechaHora, monto } from "@/lib/format";

const TRAMO: Record<string, [string, string]> = {
  al_dia: ["Al día", "green"],
  aviso: ["Aviso (factura vencida)", "amber"],
  bloqueo: ["Bloqueo por mora", "red"],
  cde: ["Derivar al CDE", "red"],
};

export default function MoraCliente({ cliente, onCerrar, onCambio }: { cliente: { id: string; razonSocial: string }; onCerrar: () => void; onCambio: () => void }) {
  const { puede } = usePermisos();
  const [d, setD] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setD(await api.getRaw<any>(`clientes/${cliente.id}/mora`));
    } catch (e: any) {
      setError(e.message);
    }
  }, [cliente.id]);
  useEffect(() => void cargar(), [cargar]);

  const accion = async (ruta: "bloquear" | "desbloquear") => {
    if (motivo.trim().length < 10) return setError("Indique el motivo (mínimo 10 caracteres).");
    setOcupado(true);
    setError(null);
    try {
      await api.post(`/clientes/${cliente.id}/${ruta}`, { motivo: motivo.trim() });
      toast.ok(ruta === "bloquear" ? "Cliente bloqueado." : "Excepción registrada: el cliente queda desbloqueado.");
      setMotivo("");
      await cargar();
      onCambio();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setOcupado(false);
    }
  };

  const t = d ? TRAMO[d.tramo] ?? TRAMO.al_dia : null;
  return (
    <Modal titulo={`Mora y bloqueo · ${cliente.razonSocial}`} onCerrar={onCerrar} ancho={780}
      acciones={<button type="button" className="btn outline" onClick={onCerrar}>Cerrar</button>}>
      {error && <div className="alert warn" role="alert">{error}</div>}
      {!d ? (
        <p>Cargando…</p>
      ) : (
        <>
          <p style={{ marginTop: 0 }}>
            Estado: <span className={`pill ${d.bloqueado ? "red" : "green"}`}>{d.bloqueado ? (d.bloqueoOrigen === "mora" ? "Bloqueado por mora" : "Bloqueado") : "Habilitado"}</span>{" "}
            {t && <span className={`pill ${t[1]}`}>{t[0]}</span>}
            {d.motivoBloqueo && <span style={{ color: "var(--muted)" }}> · {d.motivoBloqueo}</span>}
          </p>
          <p className="subtitle" style={{ margin: "0 0 8px" }}>
            Un cliente bloqueado no recibe cotizaciones ni OT nuevas. El bloqueo por mora se aplica solo y se levanta al pagar; la excepción la autoriza el Jefe DCO.
          </p>
          {d.facturas.length > 0 ? (
            <table className="table" style={{ fontSize: 12.5 }}>
              <thead><tr><th>Factura</th><th>Vencimiento</th><th>Días de mora</th><th>Saldo</th><th>Tramo</th></tr></thead>
              <tbody>
                {d.facturas.map((f: any) => (
                  <tr key={f.id}>
                    <td className="codigo">{f.numero}</td>
                    <td>{f.vencimiento ? fechaDia(f.vencimiento) : "—"}</td>
                    <td>{f.dias}</td>
                    <td>{monto(f.saldo, "CLP")}</td>
                    <td>{TRAMO[f.tramo]?.[0] ?? f.tramo}{f.exceptuada ? " · con excepción" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p style={{ color: "var(--muted)" }}>Sin facturas vencidas en los tramos de aviso, bloqueo o CDE.</p>
          )}

          {(puede("cliente.editar") || puede("cliente.desbloquear")) && (
            <div className="field" style={{ marginTop: 12 }}>
              <label htmlFor="mora-motivo">Motivo <span className="req">*</span></label>
              <textarea id="mora-motivo" rows={2} maxLength={1000} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            </div>
          )}
          <div className="toolbar" style={{ gap: 8, marginTop: 8 }}>
            <div className="spacer" />
            {!d.bloqueado && puede("cliente.editar") && (
              <button className="btn outline sm" disabled={ocupado} onClick={() => accion("bloquear")}>Bloquear a mano</button>
            )}
            {(d.bloqueado || d.bloquear) && puede("cliente.desbloquear") && (
              <button className="btn primary sm" disabled={ocupado} onClick={() => accion("desbloquear")}>Autorizar excepción / desbloquear</button>
            )}
          </div>

          {d.desbloqueos.length > 0 && (
            <>
              <h3 style={{ fontSize: 13, margin: "14px 0 6px" }}>Excepciones y desbloqueos</h3>
              <table className="table" style={{ fontSize: 12.5 }}>
                <thead><tr><th>Fecha</th><th>Autorizó</th><th>Motivo</th><th>Facturas cubiertas</th></tr></thead>
                <tbody>
                  {d.desbloqueos.map((x: any) => (
                    <tr key={x.id}><td>{fechaHora(x.fecha)}</td><td>{x.autorizadoPor ?? "—"}</td><td>{x.motivo}</td><td>{x.facturas}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </Modal>
  );
}
