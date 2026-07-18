"use client";

import CrudTable, { activoBadge, codigoCell } from "../_components/CrudTable";

export default function GranGruposPage() {
  return (
    <CrudTable
      titulo="Gran Grupos"
      subtitulo="Eje Producto · nivel 1. Máxima agrupación del catálogo de productos/matrices."
      endpoint="cat/gran-grupos"
      columnas={[
        { key: "codigo", label: "Código", render: codigoCell },
        { key: "nombre", label: "Nombre" },
        { key: "activo", label: "Estado", render: activoBadge },
      ]}
      campos={[
        { name: "codigo", label: "Código", requerido: true },
        { name: "nombre", label: "Nombre", requerido: true, span: 2 },
        { name: "activo", label: "Activo", tipo: "checkbox" },
      ]}
    />
  );
}
