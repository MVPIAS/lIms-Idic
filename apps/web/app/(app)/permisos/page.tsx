"use client";

import CrudTable from "@/components/CrudTable";

export default function PermisosPage() {
  return (
    <CrudTable
      recurso="permisos"
      titulo="Permisos"
      subtitulo="Catálogo de permisos RBAC (módulo.acción) que se asignan a los roles del sistema."
      columnas={[
        { campo: "codigo", titulo: "Código", render: (v) => <span className="codigo">{v}</span> },
        { campo: "modulo", titulo: "Módulo", render: (v) => (v ? <span className="tag">{v}</span> : "—") },
        { campo: "accion", titulo: "Acción" },
        { campo: "descripcion", titulo: "Descripción" },
      ]}
      campos={[
        { campo: "codigo", label: "Código (p.ej. admin.usuarios)", requerido: true },
        { campo: "modulo", label: "Módulo", requerido: true },
        { campo: "accion", label: "Acción", requerido: true },
        { campo: "descripcion", label: "Descripción" },
      ]}
    />
  );
}
