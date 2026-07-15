"use client";

import CrudTable from "@/components/CrudTable";

const activoBadge = (v: any) => (
  <span className={`pill ${v === false ? "gray" : "green"}`}>{v === false ? "inactivo" : "activo"}</span>
);

export default function GranGruposPage() {
  return (
    <CrudTable
      recurso="gran-grupos"
      titulo="Grandes Grupos"
      subtitulo="Eje Producto del catálogo LIMS. Nivel superior de la jerarquía (Gran Grupo → Grupo)."
      columnas={[
        { campo: "codigo", titulo: "Código", render: (v) => <span className="codigo">{v}</span> },
        { campo: "nombre", titulo: "Nombre" },
        { campo: "activo", titulo: "Estado", render: activoBadge },
      ]}
      campos={[
        { campo: "codigo", label: "Código", requerido: true },
        { campo: "nombre", label: "Nombre", requerido: true },
      ]}
    />
  );
}
