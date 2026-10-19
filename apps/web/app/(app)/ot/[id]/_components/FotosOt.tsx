"use client";

/**
 * Pestaña «Fotos» de la OT: fotos para el anexo fotográfico del informe.
 * El analista las sube y ve desde aquí (permiso resultado.crear) sin entrar en
 * «Emitir informe», que es de quien emite. Las mismas fotos aparecen en la
 * pantalla de emisión. Reglas: docs/FLUJO_INFORME_ENSAYO.md.
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { usePermisos } from "@/lib/permisos";
import FotosInforme, { type EnsayoOt } from "@/components/informes/FotosInforme";

export default function FotosOt({ otId, otEstado }: { otId: string; otEstado?: string | null }) {
  const { puede } = usePermisos();
  const [ensayos, setEnsayos] = useState<EnsayoOt[]>([]);

  useEffect(() => {
    api.getRaw<{ filas: EnsayoOt[] }>(`informes/ot/${otId}/estructura`).then((r) => setEnsayos(r.filas)).catch(() => setEnsayos([]));
  }, [otId]);

  const cerrada = ["cerrada", "anulada"].includes(String(otEstado ?? ""));
  const editar = !cerrada && puede(["resultado.crear", "certificado.emitir"]);
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <p className="subtitle" style={{ margin: 0 }}>
        Fotos de las muestras y de los ensayos para el <b>anexo fotográfico</b> del informe. Ligue cada foto al ensayo al que
        corresponde y marque las que van al informe; quien emite el informe las ve en el mismo orden.
        {cerrada ? " La OT está cerrada: las fotos solo se consultan." : ""}
      </p>
      <FotosInforme otId={otId} ensayos={ensayos} puedeEditar={editar} />
    </div>
  );
}
