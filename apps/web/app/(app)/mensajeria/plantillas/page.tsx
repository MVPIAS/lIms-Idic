"use client";

/**
 * Plantillas de correo (GET /mensajeria/plantillas). Catálogo CERRADO de
 * plantillas institucionales definidas en el servidor
 * (apps/api/src/mensajeria/correo-plantillas.ts): el usuario las elige al enviar
 * un correo desde Mensajería. Son de solo lectura en la UI; cambiarlas requiere
 * una versión del sistema (no hay API de edición).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import DataTable from "@/components/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { api } from "@/lib/api";

interface Plantilla { clave: string; tipo: string; nombre: string; asunto: string }

const TIPO: Record<string, { label: string; pill: string }> = {
  cotizacion: { label: "Cotización", pill: "blue" },
  resultado: { label: "Resultado", pill: "green" },
  otro: { label: "Otro", pill: "gray" },
};

export default function PlantillasCorreoPage() {
  const [filas, setFilas] = useState<Plantilla[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const r = await api.getRaw<Plantilla[]>("mensajeria/plantillas");
        setFilas(Array.isArray(r) ? r : []);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setCargando(false);
      }
    })();
  }, []);

  return (
    <div>
      <PageHeader
        titulo="Plantillas de correo"
        migas={[{ label: "Reportes y comunicación" }, { label: "Mensajería", href: "/mensajeria" }, { label: "Plantillas" }]}
        subtitulo="Textos institucionales que se eligen al enviar una cotización o un resultado por correo. Los marcadores {{cliente}}, {{codigo}}, {{total}}… se reemplazan automáticamente al enviar."
        acciones={<Link href="/mensajeria" className="btn primary sm">📧 Ir a Mensajería</Link>}
      />
      <div className="alert info">
        Estas plantillas son fijas (aprobadas por el instituto) y no se editan desde aquí. Si necesitas un texto nuevo,
        solicítalo a la administración del sistema.
      </div>
      {error && <div className="alert warn">No se pudieron cargar las plantillas: {error}</div>}
      <DataTable
        rows={filas}
        rowKey={(r) => r.clave}
        loading={cargando}
        searchKeys={["nombre", "asunto", "tipo"]}
        vacio="No hay plantillas disponibles"
        columns={[
          { key: "nombre", label: "Nombre", render: (r) => <b>{r.nombre}</b> },
          {
            key: "tipo",
            label: "Uso",
            render: (r) => <span className={`pill ${TIPO[r.tipo]?.pill ?? "gray"}`}>{TIPO[r.tipo]?.label ?? r.tipo}</span>,
          },
          { key: "asunto", label: "Asunto del correo", render: (r) => <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11.5 }}>{r.asunto}</span> },
          { key: "clave", label: "Clave", render: (r) => <span className="tag">{r.clave}</span> },
        ]}
      />
    </div>
  );
}
