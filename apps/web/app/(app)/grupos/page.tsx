"use client";

import CrudTable from "@/components/CrudTable";

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
        { campo: "granGrupoId", titulo: "Gran Grupo (id)", render: (v) => (v ? <span className="tag">{String(v).slice(0, 8)}…</span> : "—") },
        { campo: "activo", titulo: "Estado", render: activoBadge },
      ]}
      campos={[
        // granGrupoId es FK (uuid): por ahora se ingresa el id a mano.
        { campo: "granGrupoId", label: "Gran Grupo (id)", requerido: true },
        { campo: "cgrupo", label: "Código" },
        { campo: "nombre", label: "Nombre", requerido: true },
      ]}
    />
  );
}
