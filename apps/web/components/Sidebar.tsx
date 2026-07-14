"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  {
    title: "Inicio",
    items: [{ href: "/dashboard", label: "Panel", icon: "⌂" }],
  },
  {
    title: "Comercial",
    items: [
      { href: "/clientes", label: "Clientes", icon: "🏢" },
      { href: "/proveedores", label: "Proveedores", icon: "🚚" },
      { href: "/cotizaciones", label: "Cotizaciones", icon: "$" },
      { href: "/cotizaciones/nueva", label: "Nueva Cotización", icon: "＋" },
      { href: "/listas-precio", label: "Listas de Precio", icon: "≣" },
      { href: "/facturas", label: "Facturas", icon: "📄" },
    ],
  },
  {
    title: "Operación · LIMS",
    items: [
      { href: "/ot", label: "Expedientes / OT", icon: "🗂" },
      { href: "/muestras", label: "Muestras", icon: "🧪" },
      { href: "/captura", label: "Captura de Resultados", icon: "📊" },
      { href: "/metodos", label: "Catálogo / Métodos", icon: "🔬" },
      { href: "/plantillas", label: "Plantillas de informe", icon: "📄" },
      { href: "/flujos", label: "Diseñador de Flujos", icon: "⛓" },
    ],
  },
  {
    title: "Sistema",
    items: [{ href: "/usuarios", label: "Usuarios y Roles", icon: "👥" }],
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
