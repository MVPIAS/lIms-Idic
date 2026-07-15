"use client";

import CrudTable from "@/components/CrudTable";

export default function AnalitosPage() {
  return (
    <CrudTable
      recurso="analitos"
      titulo="Analitos"
      subtitulo="Parámetros medibles del eje Análisis. Cada analito pertenece a un método y puede tener límites."
      columnas={[
        { campo: "codigo", titulo: "Código", render: (v) => <span className="codigo">{v}</span> },
        { campo: "nombre", titulo: "Analito" },
        { campo: "unidad", titulo: "Unidad", render: (v) => (v ? <span className="tag">{v}</span> : "—") },
        { campo: "metodoId", titulo: "Método (id)", render: (v) => (v ? <span className="tag">{String(v).slice(0, 8)}…</span> : "—") },
      ]}
      campos={[
        // metodoId es FK (uuid): por ahora se ingresa el id del método a mano.
        { campo: "metodoId", label: "Método (id)", requerido: true },
        { campo: "codigo", label: "Código", requerido: true },
        { campo: "nombre", label: "Nombre", requerido: true },
        { campo: "unidad", label: "Unidad" },
        { campo: "formula", label: "Fórmula" },
      ]}
    />
  );
}
