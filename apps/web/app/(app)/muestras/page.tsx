"use client";

import CrudTable from "@/components/CrudTable";

export default function MuestrasPage() {
  return (
    <CrudTable
      recurso="muestras"
      titulo="Muestras"
      subtitulo="Maestro de muestras. A cada muestra se le asignan 1..n ensayos."
      columnas={[
        { campo: "codigo", titulo: "Código", render: (v) => <span className="codigo">{v}</span> },
        { campo: "nombre", titulo: "Muestra" },
        { campo: "codigoBarras", titulo: "Cód. barras", render: (v) => (v ? <span className="codigo">{v}</span> : "—") },
        { campo: "ubicacion", titulo: "Ubicación" },
        { campo: "estado", titulo: "Estado", render: (v) => <span className={`pill ${v === "finalizada" ? "green" : v === "en_analisis" ? "amber" : "blue"}`}>{v ?? "—"}</span> },
      ]}
      campos={[
        { campo: "codigo", label: "Código", requerido: true },
        { campo: "nombre", label: "Nombre de la muestra" },
        { campo: "codigoBarras", label: "Código de barras" },
        { campo: "ubicacion", label: "Ubicación" },
        { campo: "estado", label: "Estado", tipo: "select", opciones: ["recibida", "en_analisis", "finalizada"] },
      ]}
    />
  );
}
