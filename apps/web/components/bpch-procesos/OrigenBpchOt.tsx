"use client";

/**
 * Aviso del expediente de la OT: de qué proceso de BPCH nace (Producción
 * Nacional o Prototipo) y enlace a él. Solo consulta si el origen de la OT es
 * uno de esos dos (GET /bpch/origen-ot/:otId); si no, no pinta nada.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { llamar } from "@/lib/laboratorio";

interface Origen {
  proceso: "PRODUCCION_NACIONAL" | "PROTOTIPO";
  titulo: string;
  enlace: string;
  detalle: string[];
}

export default function OrigenBpchOt({ otId, origenTrabajo }: { otId: string; origenTrabajo?: string | null }) {
  const [o, setO] = useState<Origen | null>(null);
  const aplica = origenTrabajo === "PRODUCCION_NACIONAL" || origenTrabajo === "PROTOTIPO";

  useEffect(() => {
    if (!aplica || !otId) return;
    llamar<Origen | null>("GET", `/bpch/origen-ot/${otId}`).then(setO).catch(() => setO(null));
  }, [otId, aplica]);

  if (!o) return null;
  return (
    <div className="alert info" style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ flex: 1, minWidth: 240 }}>
        <b>{o.titulo}</b>
        <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
          {o.detalle.map((d) => <li key={d}>{d}</li>)}
        </ul>
      </div>
      <Link href={o.enlace as any} className="btn outline sm">
        {o.proceso === "PROTOTIPO" ? "Ir al prototipo" : "Ir a la O/C y su programa"}
      </Link>
    </div>
  );
}
