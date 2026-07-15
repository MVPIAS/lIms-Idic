"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  {
    title: "Inicio",
    items: [{ href: "/dashboard", label: "Panel", icon: "⌂" }],
  },
  {
    title: "CRM",
    items: [{ href: "/crm", label: "Oportunidades", icon: "🎯" }],
  },
  {
    title: "Comercial",
    items: [
      { href: "/clientes", label: "Clientes", icon: "🏢" },
      { href: "/proveedores", label: "Proveedores", icon: "🚚" },
      { href: "/contactos", label: "Contactos", icon: "👤" },
      { href: "/cotizaciones", label: "Cotizaciones", icon: "$" },
      { href: "/cotizaciones/nueva", label: "Nueva · Costeo", icon: "＋" },
      { href: "/listas-precio", label: "Listas de Precio", icon: "≣" },
      { href: "/lista-precio-items", label: "Ítems de Lista", icon: "🏷" },
      { href: "/centros-costo", label: "Centros de Costo", icon: "🏦" },
      { href: "/facturas", label: "Facturas", icon: "📄" },
      { href: "/pagos", label: "Pagos", icon: "💵" },
      { href: "/notas-credito", label: "Notas de Crédito", icon: "🧾" },
      { href: "/ordenes-compra", label: "Órdenes de Compra", icon: "🛒" },
      { href: "/viaticos", label: "Viáticos", icon: "✈" },
    ],
  },
  {
    title: "Laboratorio",
    items: [
      { href: "/ot", label: "Órdenes de Trabajo", icon: "🗂" },
      { href: "/muestras", label: "Muestras", icon: "🧪" },
      { href: "/captura", label: "Captura de Resultados", icon: "📊" },
      { href: "/metodos", label: "Métodos", icon: "🔬" },
      { href: "/analitos", label: "Analitos", icon: "⚗" },
      { href: "/limites", label: "Límites", icon: "📐" },
      { href: "/tipos-muestra", label: "Tipos de Muestra", icon: "🌡" },
      { href: "/plantillas", label: "Plantillas", icon: "📄" },
      { href: "/informes", label: "Emitir Informe", icon: "🖨" },
      { href: "/equipos", label: "Equipos y Calibración", icon: "⚙" },
      { href: "/custodia", label: "Cadena de Custodia", icon: "🔗" },
      { href: "/certificados", label: "Certificados", icon: "📜" },
      { href: "/flujos", label: "Diseñador de Flujos", icon: "⛓" },
    ],
  },
  {
    title: "SAEC · Armas y Evidencias",
    items: [
      { href: "/saec", label: "Evidencias", icon: "🧷" },
      { href: "/saec/armas", label: "Armas", icon: "🔫" },
      { href: "/saec/ibis", label: "Importar IBIS", icon: "📥" },
      { href: "/saec/verificar", label: "Verificar certificado", icon: "🔎" },
    ],
  },
  {
    title: "Catálogo base",
    items: [
      { href: "/gran-grupos", label: "Grandes Grupos", icon: "🗃" },
      { href: "/grupos", label: "Grupos", icon: "📁" },
    ],
  },
  {
    title: "Sistema",
    items: [
      { href: "/usuarios", label: "Usuarios y Roles", icon: "👥" },
      { href: "/permisos", label: "Permisos", icon: "🔑" },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname() ?? "";
  // Ítem activo = el href más específico (más largo) que prefija la ruta actual.
  const hrefs = NAV.flatMap((s) => s.items.map((i) => i.href));
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

      {NAV.map((sect) => (
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
