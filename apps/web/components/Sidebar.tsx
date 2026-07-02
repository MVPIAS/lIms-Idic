"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  {
    title: "Inicio",
    items: [{ href: "/dashboard", label: "Dashboard", icon: "⌂" }],
  },
  {
    title: "Comercial",
    items: [
      { href: "/cotizaciones", label: "Cotizaciones", icon: "$" },
      { href: "/cotizaciones/nueva", label: "Nueva Cotización", icon: "+" },
      { href: "/listas-precio", label: "Listas de Precio", icon: "≣" },
    ],
  },
  {
    title: "Operación",
    items: [
      { href: "/ot", label: "Órdenes Trabajo", icon: "▤" },
      { href: "/ot/nueva", label: "Nueva OT", icon: "+" },
      { href: "/flujos", label: "Diseñador de Flujos", icon: "⛓" },
    ],
  },
  {
    title: "Facturación",
    items: [
      { href: "/facturas", label: "Facturas", icon: "📄" },
      { href: "/clientes-bloqueados", label: "Bloqueados", icon: "🚫" },
    ],
  },
  {
    title: "Sistema",
    items: [
      { href: "/usuarios", label: "Usuarios", icon: "👥" },
      { href: "/audit", label: "Audit Trail", icon: "⏚" },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <div>
      <div className="flex items-center gap-2.5 p-3.5 border-b border-white/10">
        <div className="w-8 h-8 bg-gradient-to-br from-primary-600 to-accent rounded-lg flex items-center justify-center text-white font-bold">
          L
        </div>
        <div>
          <b className="text-white text-sm">LIMS IDIC</b>
          <div className="text-[10px] text-slate-400">Comercial · v0.1</div>
        </div>
      </div>

      <nav>
        {NAV.map((sect) => (
          <div key={sect.title}>
            <div className="px-4 pt-3 pb-1 text-[10px] tracking-widest uppercase text-slate-400 font-semibold">
              {sect.title}
            </div>
            {sect.items.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href as any}
                  className={`flex items-center gap-2.5 px-4 py-2 text-sm border-l-[3px] ${
                    active
                      ? "bg-white/10 text-white border-accent"
                      : "border-transparent text-slate-300 hover:bg-white/5"
                  }`}
                >
                  <span className="w-4 text-center text-slate-400">{item.icon}</span>
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </div>
  );
}
