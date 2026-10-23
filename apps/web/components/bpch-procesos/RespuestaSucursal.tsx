"use client";

/**
 * Respuesta del Jefe de Sucursal al requerimiento técnico de Producción
 * Nacional (EP-07 7.14, BL-157): el requerimiento que registró la SCC, y la
 * respuesta con su fecha. Botón «Responder → SCC». Le llega como tarea en
 * Mi bandeja («Requerimientos técnicos por responder»).
 */
import { useCallback, useEffect, useState } from "react";
import { llamar } from "@/lib/laboratorio";
import { fechaDia, hoyISO } from "@/lib/format";
import { toast } from "@/components/ui/feedback";

export default function RespuestaSucursal({ correlacionId, onCambio }: { correlacionId: string; onCambio?: () => void }) {
  const [v, setV] = useState<any>(null);
  const [texto, setTexto] = useState("");
  const [fecha, setFecha] = useState(hoyISO());
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setV(await llamar("GET", `/bpch/pn/correlaciones/${correlacionId}/requerimiento`));
    } catch {
      setV(null);
    }
  }, [correlacionId]);
  useEffect(() => {
    cargar();
  }, [cargar]);

  if (!v || !v.requerimiento) return null;
  return (
    <div className="card" aria-labelledby="tit-req">
      <h2 id="tit-req">Requerimiento técnico a la sucursal</h2>
      <p style={{ fontSize: 12.5, margin: "0 0 6px" }}>
        <b>Requerimiento</b>{v.requerimientoAt ? ` (${fechaDia(v.requerimientoAt)})` : ""}: {v.requerimiento}
      </p>
      {v.respuesta ? (
        <p style={{ fontSize: 12.5, margin: 0 }}>
          <span className="pill green">Respondido</span> {v.respuestaAt ? `el ${fechaDia(v.respuestaAt)}` : ""}: {v.respuesta}
        </p>
      ) : v.puedoResponder ? (
        <div className="form-grid">
          <div className="field span-2">
            <label htmlFor="resp-suc">Respuesta de la sucursal (informe) <span className="req">*</span></label>
            <textarea id="resp-suc" rows={4} maxLength={4000} value={texto} onChange={(e) => setTexto(e.target.value)} />
          </div>
          <div className="field"><label htmlFor="resp-fecha">Fecha</label><input id="resp-fecha" type="date" max={hoyISO()} value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
          <div className="toolbar" style={{ gridColumn: "1 / -1", margin: 0 }}>
            <button
              type="button"
              className="btn primary sm"
              disabled={ocupado || texto.trim().length < 5}
              onClick={async () => {
                setOcupado(true);
                try {
                  setV(await llamar("POST", `/bpch/pn/correlaciones/${correlacionId}/responder-requerimiento`, { respuesta: texto.trim(), fecha }));
                  toast.ok("Respuesta registrada: la SCC recibe el aviso.");
                  onCambio?.();
                } catch (e: any) {
                  toast.error(e.message);
                } finally {
                  setOcupado(false);
                }
              }}
            >
              Responder → SCC
            </button>
          </div>
        </div>
      ) : (
        <p className="subtitle" style={{ margin: 0 }}>Pendiente de la respuesta del Jefe de la Sucursal que inspeccionó la O/C.</p>
      )}
    </div>
  );
}
