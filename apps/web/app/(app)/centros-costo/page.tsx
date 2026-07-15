"use client";

import CrudTable from "@/components/CrudTable";

const activoBadge = (v: any) => (
  <span className={`pill ${v === false ? "gray" : "green"}`}>{v === false ? "inactivo" : "activo"}</span>
);

export default function CentrosCostoPage() {
  return (
    <CrudTable
      recurso="centros-costo"
      titulo="Centros de Costo"
      subtitulo="Unidades de imputación contable, típicamente por laboratorio."
      columnas={[
        { campo: "codigo", titulo: "Código", render: (v) => <span className="codigo">{v}</span> },
        { campo: "nombre", titulo: "Nombre" },
        { campo: "laboratorio", titulo: "Laboratorio", render: (v) => (v ? <span className="tag">{v}</span> : "—") },
        { campo: "activo", titulo: "Estado", render: activoBadge },
      ]}
      campos={[
        { campo: "codigo", label: "Código", requerido: true },
        { campo: "nombre", label: "Nombre", requerido: true },
        { campo: "laboratorio", label: "Laboratorio" },
      ]}
    />
  );
}
