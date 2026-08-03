"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

// Cada ítem puede declarar el permiso que lo habilita. Si el usuario no lo tiene
// (y no es SUPERADMIN/ADMIN) el ítem se oculta del menú. La seguridad real la
// impone el backend (PermisoGuard → 403); esto es sólo para no mostrar accesos
// que el rol no puede usar (mínimo privilegio en la UI).
type Item = { href: string; label: string; icon: string; perm?: string };
type Sect = { title: string; items: Item[] };

const NAV: Sect[] = [
  {
    title: "Inicio",
    items: [{ href: "/dashboard", label: "Panel", icon: "⌂" }],
  },
  {
    title: "CRM",
    items: [{ href: "/crm", label: "Oportunidades", icon: "🎯", perm: "cliente.ver" }],
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
      { href: "/centros-costo", label: "Centros de Costo", icon: "🏦", perm: "cotizacion.ver" },
      { href: "/facturas", label: "Facturas", icon: "📄", perm: "factura.ver" },
      { href: "/pagos", label: "Pagos", icon: "💵", perm: "factura.ver" },
      { href: "/notas-credito", label: "Notas de Crédito", icon: "🧾", perm: "nc.gestionar" },
      { href: "/ordenes-compra", label: "Órdenes de Compra", icon: "🛒", perm: "factura.ver" },
      { href: "/viaticos", label: "Viáticos", icon: "✈", perm: "factura.ver" },
    ],
  },
  {
    title: "Laboratorio",
    items: [
      { href: "/ot", label: "Órdenes de Trabajo", icon: "🗂", perm: "ot.ver" },
      { href: "/ot/nueva", label: "Registrar OT", icon: "＋", perm: "ot.crear" },
      { href: "/muestras", label: "Muestras", icon: "🧪", perm: "muestra.ver" },
      { href: "/captura", label: "Captura de Resultados", icon: "📊", perm: "resultado.crear" },
      { href: "/captura-ot", label: "Captura por OT", icon: "📈", perm: "resultado.crear" },
      { href: "/qc", label: "Control de Calidad", icon: "✔", perm: "resultado.revisar" },
      { href: "/spc", label: "Control Estadístico (SPC)", icon: "📉", perm: "resultado.ver" },
      { href: "/consumibles", label: "Consumibles · Kardex", icon: "🧴", perm: "equipo.ver" },
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
      { href: "/saec/ibis", label: "IBIS · Armas importadas", icon: "📥", perm: "ibis.ver" },
      { href: "/saec/verificar", label: "Verificar certificado", icon: "🔎" },
    ],
  },
  {
    title: "Catálogo · Clasificación",
    items: [
      { href: "/catalogo", label: "Índice del catálogo", icon: "🧭", perm: "catalogo.gestionar" },
      { href: "/catalogo/gran-grupos", label: "Grandes Grupos", icon: "🗃", perm: "catalogo.gestionar" },
      { href: "/catalogo/grupos", label: "Grupos", icon: "📁", perm: "catalogo.gestionar" },
      { href: "/catalogo/subgrupos", label: "Subgrupos", icon: "🗂", perm: "catalogo.gestionar" },
      { href: "/catalogo/familias", label: "Familias · Laboratorios", icon: "🏛", perm: "catalogo.gestionar" },
      { href: "/catalogo/elementos", label: "Elementos", icon: "🧱", perm: "catalogo.gestionar" },
      { href: "/catalogo/parametros", label: "Parámetros del sistema", icon: "🎛", perm: "catalogo.gestionar" },
    ],
  },
  {
    title: "Catálogo · Análisis",
    items: [
      { href: "/catalogo/ensayos", label: "Ensayos · Precios", icon: "🧪", perm: "catalogo.gestionar" },
      { href: "/catalogo/metodos", label: "Métodos", icon: "🔬", perm: "catalogo.gestionar" },
      { href: "/catalogo/analitos", label: "Analitos", icon: "⚗", perm: "catalogo.gestionar" },
      { href: "/catalogo/especificaciones", label: "Especificaciones", icon: "📐", perm: "catalogo.gestionar" },
      { href: "/catalogo/formulas", label: "Fórmulas de cálculo", icon: "𝑓", perm: "catalogo.gestionar" },
      { href: "/catalogo/pasos", label: "Pasos por ensayo", icon: "🪜", perm: "catalogo.gestionar" },
    ],
  },
  {
    title: "Reportes y Comunicación",
    items: [
      { href: "/reportes", label: "Reportes · Export CSV", icon: "📊", perm: "resultado.ver" },
      { href: "/mensajeria", label: "Mensajería · Correo", icon: "📧", perm: "resultado.ver" },
      { href: "/documentos", label: "Buscador de Documentos", icon: "🗄", perm: "ot.ver" },
    ],
  },
  {
    title: "Sistema",
    items: [
      { href: "/usuarios", label: "Usuarios y Roles", icon: "👥", perm: "admin.usuarios" },
      { href: "/perfil", label: "Mi Perfil · 2FA", icon: "🔐" },
      { href: "/permisos", label: "Permisos", icon: "🔑", perm: "admin.usuarios" },
      { href: "/config-correo", label: "Configuración de Correo", icon: "✉", perm: "admin.usuarios" },
    ],
  },
];

/** Lee permisos y roles del JWT guardado (claims `permisos` y `roles`). */
function leerAcceso(): { permisos: Set<string>; admin: boolean } {
  try {
    const tok = localStorage.getItem("lims_token");
    if (!tok) return { permisos: new Set(), admin: false };
    const p = JSON.parse(atob(tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    const roles: string[] = p.roles ?? [];
    return {
      permisos: new Set<string>(p.permisos ?? []),
      admin: roles.includes("SUPERADMIN") || roles.includes("ADMIN"),
    };
  } catch {
    return { permisos: new Set(), admin: false };
  }
}

export default function Sidebar() {
  const pathname = usePathname() ?? "";
  const [acceso, setAcceso] = useState<{ permisos: Set<string>; admin: boolean }>({ permisos: new Set(), admin: true });

  // El JWT sólo existe en el cliente; se lee tras montar para no romper SSR.
  useEffect(() => { setAcceso(leerAcceso()); }, [pathname]);

  const puede = (item: Item) => !item.perm || acceso.admin || acceso.permisos.has(item.perm);

  // Filtra ítems por permiso y elimina secciones que quedan vacías.
  const nav = NAV
    .map((s) => ({ ...s, items: s.items.filter(puede) }))
    .filter((s) => s.items.length > 0);

  const hrefs = nav.flatMap((s) => s.items.map((i) => i.href));
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

      {nav.map((sect) => (
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
