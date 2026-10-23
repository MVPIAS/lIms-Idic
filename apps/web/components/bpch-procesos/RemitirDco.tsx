"use client";

/**
 * «Remitir a DCO» del expediente BPCH (EP-06 6.14 y EP-07 7.18, BL-171): el
 * documento final oficial (Certificado de Conformidad o Informe de
 * Incumplimiento, con o sin tasa) se despacha al DCO, que recibe aviso y tarjeta
 * en su bandeja con el enlace al informe. Es independiente de «Remitir a
 * facturación» (la tasa). Usa el despacho general: POST /informes/:id/despachar.
 */
import { useCallback, useEffect, useState } from "react";
import { llamar } from "@/lib/laboratorio";
import { fechaDia } from "@/lib/format";
import { toast } from "@/components/ui/feedback";
import { usePermisos } from "@/lib/permisos";

const FINALES = ["CERTIFICADO_CONFORMIDAD", "INFORME_INCUMPLIMIENTO", "INFORME_TECNICO"];

export default function RemitirDco({ otId, onCambio }: { otId: string; onCambio?: () => void }) {
  const { puede } = usePermisos();
  const [docs, setDocs] = useState<any[] | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const r = await llamar("GET", `/ot/${otId}/seguimiento`);
      setDocs((r.documentos ?? []).filter((d: any) => FINALES.includes(d.tipoDocumento) && ["oficial", "emitido"].includes(d.estado)));
    } catch {
      setDocs([]);
    }
  }, [otId]);
  useEffect(() => {
    cargar();
  }, [cargar]);

  if (!docs || !docs.length) return null;
  async function remitir(d: any) {
    setOcupado(true);
    try {
      await llamar("POST", `/informes/${d.id}/despachar`, { destino: "DCO", ejemplares: 1 });
      toast.ok(`${d.numero} remitido a DCO: el Departamento Comercial recibe el aviso.`);
      await cargar();
      onCambio?.();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  }
  return (
    <div className="card">
      <h2>Remitir a DCO</h2>
      <p className="subtitle" style={{ marginTop: 0 }}>
        El documento final va siempre al Departamento Comercial, con o sin tasa y cumpla o no. La tasa se remite aparte a facturación.
      </p>
      <table className="data">
        <thead><tr><th>Documento</th><th>Remisión a DCO</th><th /></tr></thead>
        <tbody>
          {docs.map((d) => (
            <tr key={d.id}>
              <td><span className="codigo">{d.numero}</span> <small style={{ color: "var(--muted)" }}>{d.plantilla ?? d.tipoDocumento}</small></td>
              <td>
                {d.despachoDestino
                  ? <><span className={`pill ${d.despachoRecibidoAt ? "green" : "amber"}`}>{d.despachoRecibidoAt ? "Recibido en DCO" : "Remitido"}</span> el {fechaDia(d.despachoFecha)}</>
                  : <span className="pill gray">Sin remitir</span>}
              </td>
              <td style={{ textAlign: "right" }}>
                {!d.despachoDestino && puede("certificado.despachar") && (
                  <button type="button" className="btn primary sm" disabled={ocupado} onClick={() => remitir(d)}>Remitir a DCO →</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
