"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { api } from "@/lib/api";

const CRUMB: Record<string, string> = {
  "/dashboard": "Panel",
  "/clientes": "Clientes",
  "/proveedores": "Proveedores",
  "/cotizaciones": "Cotizaciones",
  "/cotizaciones/nueva": "Nueva Cotización",
  "/listas-precio": "Listas de Precio",
  "/facturas": "Facturas",
  "/ot": "Expedientes / OT",
  "/muestras": "Muestras",
  "/captura": "Captura de Resultados",
  "/metodos": "Catálogo / Métodos",
  "/plantillas": "Plantillas de informe",
  "/flujos": "Diseñador de Flujos",
  "/usuarios": "Usuarios y Roles",
};

function crumbFor(pathname: string): string {
  if (CRUMB[pathname]) return CRUMB[pathname];
  if (pathname.startsWith("/ot/")) return "Expediente";
  const best = Object.keys(CRUMB)
    .filter((h) => pathname.startsWith(h))
    .sort((a, b) => b.length - a.length)[0];
  return best ? CRUMB[best] : "";
}

export default function Topbar() {
  const pathname = usePathname() ?? "";
  const [user, setUser] = useState<{ nombreCompleto?: string; cargo?: string; grado?: string } | null>(null);

  useEffect(() => {
    setUser(api.getUser());
  }, []);

  const iniciales = user?.nombreCompleto
    ? user.nombreCompleto.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()
    : "AD";

  return (
    <>
      <div className="breadcrumb">
        LIMS IDIC · <b>{crumbFor(pathname)}</b>
      </div>
      <div className="user">
        <div className="avatar">{iniciales}</div>
        <div style={{ lineHeight: 1.2 }}>
          <div style={{ fontWeight: 600 }}>{user?.nombreCompleto ?? "Administrador"}</div>
          <div style={{ color: "var(--muted)", fontSize: "10.5px" }}>
            {user?.grado ?? user?.cargo ?? "SUPERADMIN"}
          </div>
        </div>
        <button onClick={() => api.logout()} className="btn outline sm" style={{ marginLeft: 8 }} title="Cerrar sesión">
          Salir
        </button>
      </div>
    </>
  );
}
