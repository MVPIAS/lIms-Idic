"use client";

import { fechaDia } from "@/lib/format";
import { SEMAFORO, semaforoDe, textoDias } from "@/lib/documentos";

/** Semáforo de la fecha de compromiso de una OT (en plazo / por vencer / vencida). */
export default function SemaforoPlazo({ fechaCompromiso, estado, conFecha = true }: { fechaCompromiso: unknown; estado?: string | null; conFecha?: boolean }) {
  const { semaforo, dias } = semaforoDe(fechaCompromiso, estado);
  if (semaforo === "terminada") return <span style={{ color: "var(--muted)" }}>{fechaCompromiso ? fechaDia(fechaCompromiso) : "—"}</span>;
  const s = SEMAFORO[semaforo];
  return (
    <span title={textoDias(dias)} style={{ whiteSpace: "nowrap" }}>
      <span className={`pill ${s.pill}`}>{s.texto}</span>
      {conFecha && fechaCompromiso ? <small style={{ marginLeft: 6, color: "var(--muted)" }}>{fechaDia(fechaCompromiso)}</small> : null}
    </span>
  );
}
