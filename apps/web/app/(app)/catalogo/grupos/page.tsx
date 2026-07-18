"use client";

import CrudTable, { activoBadge, codigoCell } from "../_components/CrudTable";

const refNombre = (row: any) => row?.nombre ?? "—";

export default function GruposPage() {
  return (
    <CrudTable
      titulo="Grupos"
      subtitulo="Eje Producto · nivel 2. Cada Grupo cuelga de un Gran Grupo."
      endpoint="cat/grupos"
      columnas={[
        { key: "cgrupo", label: "Código", render: codigoCell },
        { key: "nombre", label: "Nombre" },
        { key: "granGrupo", label: "Gran Grupo", render: (_v, row) => refNombre(row.granGrupo) },
        { key: "activo", label: "Estado", render: activoBadge },
      ]}
      campos={[
        { name: "granGrupoId", label: "Gran Grupo", tipo: "select", requerido: true, opcionesEndpoint: "cat/gran-grupos?limit=500" },
        { name: "cgrupo", label: "Código" },
        { name: "nombre", label: "Nombre", requerido: true },
        { name: "activo", label: "Activo", tipo: "checkbox" },
      ]}
    />
  );
}
