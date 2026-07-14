"use client";

import CrudTable from "@/components/CrudTable";

const rolesBadges = (_: any, row: any) => (
  <div className="flex flex-wrap gap-1">
    {(row.usuarioRoles ?? []).map((ur: any) => (
      <span key={ur.rolId} className="text-[11px] px-2 py-0.5 rounded-full bg-accent/10 text-accent font-medium">
        {ur.rol?.codigo ?? "?"}
      </span>
    ))}
    {(!row.usuarioRoles || row.usuarioRoles.length === 0) && <span className="text-slate-400 text-xs">sin rol</span>}
  </div>
);

const estadoBadge = (v: string) => (
  <span className={`text-[11px] px-2 py-0.5 rounded-full ${v === "activo" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
    {v ?? "—"}
  </span>
);

export default function UsuariosPage() {
  return (
    <CrudTable
      recurso="usuarios"
      titulo="Usuarios y Roles"
      subtitulo="Control de acceso (RBAC). Cada usuario recibe uno o más roles; el rol define los permisos efectivos. 13 roles institucionales, 32 permisos."
      columnas={[
        { campo: "username", titulo: "Usuario" },
        { campo: "nombreCompleto", titulo: "Nombre completo" },
        { campo: "grado", titulo: "Grado / Cargo", render: (v, row) => v ?? row.cargo ?? "—" },
        { campo: "usuarioRoles", titulo: "Roles", render: rolesBadges },
        { campo: "estado", titulo: "Estado", render: estadoBadge },
      ]}
    />
  );
}
