"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AdminProviders } from "@/components/admin/ui";

const SECCIONES = [
  { href: "/admin", label: "Inicio", icono: "⌂" },
  { href: "/admin/estructura", label: "Estructura", icono: "🏛" },
  { href: "/admin/usuarios", label: "Usuarios", icono: "👥" },
  { href: "/admin/roles", label: "Roles y permisos", icono: "🔑" },
  { href: "/admin/firmas", label: "Matriz de firmas", icono: "✍" },
  { href: "/admin/numeracion", label: "Numeración", icono: "№" },
];

/** Área de Administración: proveedores (toasts/confirmación) + sub-navegación. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  return (
    <AdminProviders>
      <nav className="flex gap-1 flex-wrap mb-4 border-b border-[var(--line)] pb-2" aria-label="Secciones de administración">
        {SECCIONES.map((s) => {
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
      {children}
    </AdminProviders>
  );
}
