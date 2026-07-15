"use client";

import CrudTable, { renderRef } from "@/components/CrudTable";

const activoBadge = (v: any) => (
  <span className={`pill ${v === false ? "gray" : "green"}`}>{v === false ? "inactivo" : "activo"}</span>
);

export default function TiposMuestraPage() {
  return (
    <CrudTable
      recurso="tipos-muestra"
      titulo="Tipos de Muestra"
      subtitulo="Árbol de matrices/tipos de muestra. Puede anidarse indicando un tipo padre."
      columnas={[
        { campo: "codigo", titulo: "Código", render: (v) => <span className="codigo">{v}</span> },
        { campo: "nombre", titulo: "Nombre" },
        { campo: "parentId", titulo: "Padre", render: renderRef("parent") },
        { campo: "activo", titulo: "Estado", render: activoBadge },
      ]}
      campos={[
        // Auto-referencia: CrudTable excluye del combo el propio registro en edición.
        { campo: "parentId", label: "Tipo padre", tipo: "ref", refRecurso: "tipos-muestra" },
        { campo: "codigo", label: "Código", requerido: true },
        { campo: "nombre", label: "Nombre", requerido: true },
      ]}
    />
  );
}
