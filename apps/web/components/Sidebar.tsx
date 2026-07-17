"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

// Cada ítem puede declarar el permiso que exige el módulo en la API (el mismo
// código que usa @RequierePermiso en el backend). Sin `perm` => visible siempre
// (Panel, Perfil, verificación pública). El menú se filtra por los permisos del
// usuario para no ofrecer secciones que responderían 403. SUPERADMIN ve todo.
type Item = { href: string; label: string; icon: string; perm?: string };

const NAV: { title: string; items: Item[] }[] = [
  {
    title: "Inicio",
    items: [{ href: "/dashboard", label: "Panel", icon: "⌂" }],
  },
  {
    title: "CRM",
    items: [{ href: "/crm", label: "Oportunidades", icon: "🎯", perm: "cotizacion.ver" }],
  },
  {
    title: "Comercial",
    items: [
      { href: "/clientes", label: "Clientes", icon: "🏢", perm: "cliente.ver" },
      { href: "/proveedores", label: "Proveedores", icon: "🚚", perm: "factura.ver" },
      { href: "/contactos", label: "Contactos", icon: "👤", perm: "cliente.ver" },
      { href: "/cotizaciones", label: "Cotizaciones", icon: "$", perm: "cotizacion.ver" },
      { href: "/cotizaciones/nueva", label: "Nueva · Costeo", icon: "＋", perm: "cotizacion.crear" },
      { href: "/listas-precio", label: "Listas de Precio", icon: "≣", perm: "cotizacion.ver" },
      { href: "/lista-precio-items", label: "Ítems de Lista", icon: "🏷", perm: "cotizacion.ver" },
      { href: "/centros-costo", label: "Centros de Costo", icon: "🏦", perm: "factura.ver" },
      { href: "/facturas", label: "Facturas", icon: "📄", perm: "factura.ver" },
      { href: "/pagos", label: "Pagos", icon: "💵", perm: "factura.ver" },
      { href: "/notas-credito", label: "Notas de Crédito", icon: "🧾", perm: "factura.ver" },
      { href: "/ordenes-compra", label: "Órdenes de Compra", icon: "🛒", perm: "factura.ver" },
      { href: "/viaticos", label: "Viáticos", icon: "✈", perm: "factura.ver" },
    ],
  },
  {
    title: "Laboratorio",
    items: [
      { href: "/ot", label: "Órdenes de Trabajo", icon: "🗂", perm: "ot.ver" },
      { href: "/muestras", label: "Muestras", icon: "🧪", perm: "muestra.ver" },
      { href: "/captura", label: "Captura de Resultados", icon: "📊", perm: "resultado.crear" },
      { href: "/metodos", label: "Métodos", icon: "🔬", perm: "metodo.ver" },
      { href: "/analitos", label: "Analitos", icon: "⚗", perm: "metodo.ver" },
      { href: "/limites", label: "Límites", icon: "📐", perm: "metodo.ver" },
      { href: "/tipos-muestra", label: "Tipos de Muestra", icon: "🌡", perm: "muestra.ver" },
      { href: "/plantillas", label: "Plantillas", icon: "📄", perm: "plantilla.ver" },
      { href: "/informes", label: "Emitir Informe", icon: "🖨", perm: "certificado.emitir" },
      { href: "/equipos", label: "Equipos y Calibración", icon: "⚙", perm: "equipo.ver" },
      { href: "/custodia", label: "Cadena de Custodia", icon: "🔗", perm: "muestra.ver" },
      { href: "/certificados", label: "Certificados", icon: "📜", perm: "ot.ver" },
      { href: "/flujos", label: "Diseñador de Flujos", icon: "⛓", perm: "flujo.ver" },
    ],
  },
  {
    title: "SAEC · Armas y Evidencias",
    items: [
      { href: "/saec", label: "Evidencias", icon: "🧷", perm: "evidencia.ver" },
      { href: "/saec/armas", label: "Armas", icon: "🔫", perm: "arma.ver" },
      { href: "/saec/ibis", label: "Importar IBIS", icon: "📥", perm: "ibis.ver" },
      { href: "/saec/verificar", label: "Verificar certificado", icon: "🔎" },
    ],
  },
  {
    title: "Catálogo base",
    items: [
      { href: "/gran-grupos", label: "Grandes Grupos", icon: "🗃", perm: "muestra.ver" },
      { href: "/grupos", label: "Grupos", icon: "📁", perm: "muestra.ver" },
    ],
  },
  {
    title: "Sistema",
    items: [
      { href: "/usuarios", label: "Usuarios y Roles", icon: "👥", perm: "admin.usuarios" },
      { href: "/perfil", label: "Mi Perfil · 2FA", icon: "🔐" },
      { href: "/permisos", label: "Permisos", icon: "🔑", perm: "admin.usuarios" },
    ],
  },
];

/**
 * Lee roles y permisos del JWT guardado en localStorage (payload firmado por la
 * API en el login). Se decodifica solo el payload (no se valida la firma: es UI,
 * la autoridad real es la API). Devuelve null hasta montar en cliente para no
 * romper la hidratación (el server no tiene localStorage).
 */
function leerAuth(): { roles: string[]; permisos: string[] } | null {
  if (typeof window === "undefined") return null;
  const token = localStorage.getItem("lims_token");
  if (!token) return { roles: [], permisos: [] };
  try {
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(b64)
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join(""),
    );
    const payload = JSON.parse(json);
    return { roles: payload.roles ?? [], permisos: payload.permisos ?? [] };
  } catch {
    return { roles: [], permisos: [] };
  }
}

export default function Sidebar() {
  const pathname = usePathname() ?? "";
  const [auth, setAuth] = useState<{ roles: string[]; permisos: string[] } | null>(null);

  // Se resuelve tras montar: primer render (server + cliente) muestra el menú
  // completo, luego se filtra. Así el HTML del server y el del cliente coinciden.
  useEffect(() => setAuth(leerAuth()), []);

  const esSuperadmin = auth?.roles?.includes("SUPERADMIN") ?? false;
  const puedeVer = (item: Item) => {
    if (!item.perm) return true; // sin restricción
    if (auth === null) return true; // aún sin resolver: no ocultar (evita parpadeo/hydration)
    if (esSuperadmin) return true;
    return auth.permisos.includes(item.perm);
  };

  const secciones = NAV.map((s) => ({ ...s, items: s.items.filter(puedeVer) })).filter(
    (s) => s.items.length > 0,
  );

  const hrefs = secciones.flatMap((s) => s.items.map((i) => i.href));
  const activeHref = hrefs
    .filter((h) => pathname === h || pathname.startsWith(h + "/"))
    .sort((a, b) => b.length - a.length)[0];

  return (
    <div>
      <div className="brand">
        <div className="crest">I</div>
        <div>
          <b>LIMS IDIC</b>
          <small>Comercial + LIMS · Aiuken</small>
        </div>
      </div>

      {secciones.map((sect) => (
        <div key={sect.title}>
          <div className="sect">{sect.title}</div>
          {sect.items.map((item) => {
            const active = item.href === activeHref;
            return (
              <Link
                key={item.href}
                href={item.href as any}
                className={`nav${active ? " active" : ""}`}
              >
                <span className="ico">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </div>
  );
}
