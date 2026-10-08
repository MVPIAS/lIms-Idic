"use client";

import CrudTable from "@/components/CrudTable";
import RequierePermiso from "@/components/RequierePermiso";

function PermisosContenido() {
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

/** Solo para quien tiene admin.usuarios: sin permiso se muestra «Sin acceso» (y no se piden datos). */
export default function PermisosPage() {
  return (
    <RequierePermiso perm="admin.usuarios" titulo="el catálogo de permisos">
      <PermisosContenido />
    </RequierePermiso>
  );
}
