"use client";

/**
 * Comercial en la ficha de la OT (reuniones 1 y 2 · 27 y 28-10-2026):
 *  · plazo para regularizar la OPI de una OT por disposición (2 meses por
 *    defecto, parámetro ot_disposicion.meses_opi);
 *  · «Anular OT» cuando el cliente desiste (u otra causa), con motivo
 *    (permiso ot.anular). No se anula una OT cerrada, facturada o con
 *    documentos oficiales.
 */
import { useEffect, useState } from "react";
import { llamar } from "@/lib/laboratorio";
import { fechaDia } from "@/lib/format";
import { usePermisos } from "@/lib/permisos";
import { toast } from "@/components/ui/feedback";

const CAUSAS: [string, string][] = [
  ["cliente_desiste", "El cliente desiste del servicio"],
  ["error_registro", "Error de registro"],
  ["otra", "Otra causa"],
];

export default function ComercialOt({ ot, onCambio }: { ot: any; onCambio: () => void }) {
  const { puede, listo } = usePermisos();
  const veAvisos = listo && puede("cotizacion.ver");
  const [plazo, setPlazo] = useState<{ estado: string; limite: string; diasRestantes: number } | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [causa, setCausa] = useState("cliente_desiste");
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);

  // Los permisos se leen después del primer render: el efecto se repite cuando
  // están listos (antes nunca pedía el plazo, F024). Una OT anulada no lo muestra (F031).
  useEffect(() => {
    if (!ot?.opiPendiente || ot?.estado === "anulada" || !veAvisos) {
      setPlazo(null);
      return;
    }
    llamar<any>("GET", "/comercial/avisos")
      .then((r) => setPlazo((r?.otOpiPendiente ?? []).find((x: any) => x.id === ot.id)?.plazo ?? null))
      .catch(() => setPlazo(null));
  }, [ot?.id, ot?.opiPendiente, ot?.estado, veAvisos]);

  async function anular() {
    setBusy(true);
    try {
      const r = await llamar<any>("POST", `/ot/${ot.id}/anular`, { causa, motivo: motivo.trim() });
      toast.ok(r?.mensaje ?? "OT anulada.");
      setAbierto(false);
      onCambio();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!ot) return null;
  const anulable = !["cerrada", "anulada"].includes(ot.estado) && puede("ot.anular");
  return (
    <>
      {plazo && (
        <div className={`alert ${plazo.estado === "vencida" ? "warn" : "info"}`}>
          Plazo para regularizar la OPI: <b>{fechaDia(plazo.limite)}</b>
          {plazo.estado === "vencida" ? ` · vencido hace ${-plazo.diasRestantes} días.` : ` · faltan ${plazo.diasRestantes} días.`}
          {" "}Si el cliente desiste, anule la OT.
        </div>
      )}
      {anulable && !abierto && (
        <div className="toolbar" style={{ justifyContent: "flex-end", marginBottom: 6 }}>
          <button className="btn outline sm" onClick={() => setAbierto(true)} title="Por ejemplo, cuando el cliente desiste del servicio">Anular OT…</button>
        </div>
      )}
      {anulable && abierto && (
        <div className="card">
          <h2>Anular la OT {ot.codigo}</h2>
          <div className="form-grid cols-3">
            <div className="field">
              <label htmlFor="anul-causa">Causa</label>
              <select id="anul-causa" value={causa} onChange={(e) => setCausa(e.target.value)}>
                {CAUSAS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="field" style={{ gridColumn: "span 2" }}>
              <label htmlFor="anul-motivo">Motivo <span className="req">*</span></label>
              <input id="anul-motivo" maxLength={2000} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="p. ej. el cliente informó por correo que no enviará las muestras" />
            </div>
          </div>
          <p className="hint">La OT queda anulada y lo anotado en su Historial. Un borrador de factura sin emitir también se anula.</p>
          <div className="toolbar">
            <button className="btn outline sm" onClick={() => setAbierto(false)}>Cancelar</button>
            <div className="spacer" />
            <button className="btn danger sm" disabled={busy || motivo.trim().length < 5} onClick={anular}>Anular OT</button>
          </div>
        </div>
      )}
    </>
  );
}
