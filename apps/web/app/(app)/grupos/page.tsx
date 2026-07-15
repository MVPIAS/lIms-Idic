"use client";

import CrudTable, { renderRef } from "@/components/CrudTable";

const activoBadge = (v: any) => (
  <span className={`pill ${v === false ? "gray" : "green"}`}>{v === false ? "inactivo" : "activo"}</span>
);

export default function GruposPage() {
  return (
    <CrudTable
      recurso="grupos"
      titulo="Grupos"
      subtitulo="Segundo nivel del eje Producto. Cada Grupo cuelga de un Gran Grupo."
      columnas={[
        { campo: "cgrupo", titulo: "Código", render: (v) => (v ? <span className="codigo">{v}</span> : "—") },
        { campo: "nombre", titulo: "Nombre" },
        { campo: "granGrupoId", titulo: "Gran Grupo", render: renderRef("granGrupo") },
        { campo: "activo", titulo: "Estado", render: activoBadge },
      ]}
      campos={[
        { campo: "granGrupoId", label: "Gran Grupo", tipo: "ref", refRecurso: "gran-grupos", requerido: true },
        { campo: "cgrupo", label: "Código" },
        { campo: "nombre", label: "Nombre", requerido: true },
      ]}
    />
  );
}
