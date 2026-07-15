"use client";

import CrudTable from "@/components/CrudTable";

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
        { campo: "parentId", titulo: "Padre (id)", render: (v) => (v ? <span className="tag">{String(v).slice(0, 8)}…</span> : "—") },
        { campo: "activo", titulo: "Estado", render: activoBadge },
      ]}
      campos={[
        // parentId es FK (uuid) opcional: id del tipo de muestra padre.
        { campo: "parentId", label: "Tipo padre (id)" },
        { campo: "codigo", label: "Código", requerido: true },
        { campo: "nombre", label: "Nombre", requerido: true },
      ]}
    />
  );
}
