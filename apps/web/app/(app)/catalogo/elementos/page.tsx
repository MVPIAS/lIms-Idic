"use client";

import CrudTable, { activoBadge, codigoCell } from "../_components/CrudTable";

export default function ElementosPage() {
  return (
    <CrudTable
      titulo="Elementos"
      subtitulo="Eje Producto · nivel 4 (hoja). Cuelga de un SubGrupo y opcionalmente se asocia a una Familia."
      endpoint="cat/elementos"
      columnas={[
        { key: "codigo", label: "Código", render: codigoCell },
        { key: "nombre", label: "Nombre" },
        { key: "subgrupo", label: "SubGrupo", render: (_v, row) => row.subgrupo?.nombre ?? "—" },
        { key: "familia", label: "Familia", render: (_v, row) => row.familia?.nombre ?? "—" },
        { key: "activo", label: "Estado", render: activoBadge },
      ]}
      campos={[
        { name: "subgrupoId", label: "SubGrupo", tipo: "select", requerido: true, opcionesEndpoint: "cat/subgrupos?limit=500" },
        { name: "familiaId", label: "Familia (opcional)", tipo: "select", opcionesEndpoint: "cat/familias?limit=500" },
        { name: "codigo", label: "Código", requerido: true },
        { name: "nombre", label: "Nombre", requerido: true },
        { name: "servgrp", label: "Serv. grupo" },
        { name: "activo", label: "Activo", tipo: "checkbox" },
      ]}
    />
  );
}
