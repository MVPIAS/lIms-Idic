"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AdminProviders } from "@/components/admin/ui";
import { usePermisos } from "@/lib/permisos";

// Cada pestaña con el permiso de su pantalla (AdminGuard): sin él no se ofrece.
const SECCIONES = [
  { href: "/admin/estructura", label: "Estructura", icono: "🏛", perm: "admin.estructura" },
  { href: "/admin/usuarios", label: "Usuarios", icono: "👥", perm: "admin.usuarios" },
  { href: "/admin/roles", label: "Roles y permisos", icono: "🔑", perm: "admin.roles" },
  { href: "/admin/firmas", label: "Matriz de firmas", icono: "✍", perm: "admin.firmas" },
  { href: "/admin/numeracion", label: "Numeración", icono: "№", perm: "documento.numeracion" },
];

/** Área de Administración: proveedores (toasts/confirmación) + sub-navegación. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const { listo, puede } = usePermisos();
  const visibles = listo ? SECCIONES.filter((s) => puede(s.perm)) : [];
  // Sin ninguna pestaña permitida (p. ej. un Analista que entra por URL) no hay barra: solo la tarjeta «Sin acceso».
  const secciones = visibles.length ? [{ href: "/admin", label: "Inicio", icono: "⌂", perm: "" }, ...visibles] : [];
  return (
    <AdminProviders>
      {secciones.length > 0 && (
      <nav className="flex gap-1 flex-wrap mb-4 border-b border-[var(--line)] pb-2" aria-label="Secciones de administración">
        {secciones.map((s) => {
          const activo = s.href === "/admin" ? pathname === "/admin" : pathname.startsWith(s.href);
          return (
            <Link key={s.href} href={s.href as any} aria-current={activo ? "page" : undefined}
              className={`px-3 py-[5px] rounded-full text-[12px] font-semibold no-underline transition-colors ${
                activo ? "bg-[var(--primary)] text-white" : "text-[var(--muted)] hover:bg-white hover:text-[var(--ink)]"}`}>
              <span className="mr-1" aria-hidden>{s.icono}</span>{s.label}
            </Link>
          );
        })}
      </nav>
      )}
      {children}
    </AdminProviders>
  );
}
