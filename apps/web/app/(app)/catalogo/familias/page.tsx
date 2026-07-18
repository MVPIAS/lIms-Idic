"use client";

import CrudTable, { activoBadge, codigoCell } from "../_components/CrudTable";

export default function FamiliasPage() {
  return (
    <CrudTable
      titulo="Familias"
      subtitulo="Eje Producto · dimensión organizativa (laboratorio / departamento / subdirección) asociable a Elementos."
      endpoint="cat/familias"
      columnas={[
        { key: "codsucdel", label: "Código", render: codigoCell },
        { key: "nombre", label: "Nombre" },
        { key: "laboratorio", label: "Laboratorio" },
        { key: "departamento", label: "Departamento" },
        { key: "activo", label: "Estado", render: activoBadge },
      ]}
      campos={[
        { name: "codsucdel", label: "Código", requerido: true },
        { name: "nombre", label: "Nombre", requerido: true, span: 2 },
        { name: "laboratorio", label: "Laboratorio" },
        { name: "departamento", label: "Departamento" },
        { name: "subdireccion", label: "Subdirección" },
        { name: "activo", label: "Activo", tipo: "checkbox" },
      ]}
    />
  );
}
