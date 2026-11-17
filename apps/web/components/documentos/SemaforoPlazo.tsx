"use client";

import { fechaDia } from "@/lib/format";
import { SEMAFORO, semaforoDe, textoDias } from "@/lib/documentos";

/** Semáforo de la fecha de compromiso de una OT (en plazo / por vencer / vencida). */
export default function SemaforoPlazo({
  fechaCompromiso,
  estado,
  conFecha = true,
  plazo,
}: {
  fechaCompromiso: unknown;
  estado?: string | null;
  conFecha?: boolean;
  /** Semáforo calculado por el servidor (umbral del parámetro y recepción en el DCO, COM-23). */
  plazo?: { semaforo: string; diasRestantes: number | null; medidoEn?: string } | null;
}) {
  const calculado = semaforoDe(fechaCompromiso, estado);
  const semaforo = plazo?.semaforo ?? calculado.semaforo;
  const dias = plazo ? plazo.diasRestantes : calculado.dias;
  if (plazo?.medidoEn)
    return (
      <span title={`Recepción en el DCO el ${fechaDia(plazo.medidoEn)}`} style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>
        {fechaCompromiso ? fechaDia(fechaCompromiso) : "—"} · recibida en DCO
      </span>
    );
  if (semaforo === "terminada") return <span style={{ color: "var(--muted)" }}>{fechaCompromiso ? fechaDia(fechaCompromiso) : "—"}</span>;
  const s = SEMAFORO[semaforo];
  return (
    <span title={textoDias(dias)} style={{ whiteSpace: "nowrap" }}>
      <span className={`pill ${s.pill}`}>{s.texto}</span>
      {conFecha && fechaCompromiso ? <small style={{ marginLeft: 6, color: "var(--muted)" }}>{fechaDia(fechaCompromiso)}</small> : null}
    </span>
  );
}
