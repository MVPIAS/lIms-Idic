"use client";

import CrudTable, { activoBadge, codigoCell } from "../_components/CrudTable";

export default function SubgruposPage() {
  return (
    <CrudTable
      titulo="SubGrupos"
      subtitulo="Eje Producto · nivel 3. Cada SubGrupo cuelga de un Grupo."
      endpoint="cat/subgrupos"
      columnas={[
        { key: "cntlroom", label: "Código", render: codigoCell },
        { key: "nombre", label: "Nombre" },
        { key: "grupo", label: "Grupo", render: (_v, row) => row.grupo?.nombre ?? "—" },
        { key: "activo", label: "Estado", render: activoBadge },
      ]}
      campos={[
        { name: "grupoId", label: "Grupo", tipo: "select", requerido: true, opcionesEndpoint: "cat/grupos?limit=500" },
        { name: "cntlroom", label: "Código", requerido: true },
        { name: "nombre", label: "Nombre", requerido: true },
        { name: "activo", label: "Activo", tipo: "checkbox" },
      ]}
    />
  );
}
