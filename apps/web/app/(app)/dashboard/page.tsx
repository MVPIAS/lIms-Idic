"use client";

/**
 * Panel de indicadores · conteos generales agrupados por área.
 * Cada tarjeta solo se pide y se muestra si el usuario tiene permiso para ver
 * ese recurso (así no se generan errores 403 ni tarjetas vacías).
 * Para el trabajo pendiente personal está «Mi bandeja» (/inicio).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePermisos } from "@/lib/permisos";
import { PageHeader, Skeleton } from "@/components/ui/PageHeader";

const API = process.env.NEXT_PUBLIC_API_URL ?? "/api";

/** Total de registros de un recurso (tolera {data,meta} o array plano). null = no disponible. */
async function total(recurso: string): Promise<number | null> {
  try {
    const sep = recurso.includes("?") ? "&" : "?";
    const res = await fetch(`${API}/${recurso}${sep}limit=1`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("lims_token")}` },
    });
    if (!res.ok) return null;
    const d = await res.json();
    if (Array.isArray(d)) return d.length;
    return d?.meta?.total ?? d?.data?.length ?? null;
  } catch {
    return null;
  }
}

interface Kpi { clave: string; label: string; recurso: string; href: string; icono: string; cls: string; perm: string; ayuda: string }
interface Grupo { titulo: string; kpis: Kpi[] }

const GRUPOS: Grupo[] = [
  {
    titulo: "Comercial",
    kpis: [
      { clave: "clientes", label: "Clientes", recurso: "clientes", href: "/clientes", icono: "🏢", cls: "k-blue", perm: "cliente.ver", ayuda: "Clientes registrados" },
      { clave: "cotizaciones", label: "Cotizaciones", recurso: "cotizaciones", href: "/cotizaciones", icono: "💲", cls: "", perm: "cotizacion.ver", ayuda: "Cotizaciones emitidas" },
      { clave: "facturas", label: "Facturas", recurso: "facturas", href: "/facturas", icono: "📄", cls: "k-green", perm: "factura.ver", ayuda: "Facturas registradas" },
      { clave: "proveedores", label: "Proveedores", recurso: "proveedores", href: "/proveedores", icono: "🚚", cls: "k-violet", perm: "factura.ver", ayuda: "Proveedores activos" },
    ],
  },
  {
    titulo: "Laboratorio",
    kpis: [
      { clave: "ot", label: "Órdenes de trabajo", recurso: "ot", href: "/ot", icono: "🗂", cls: "k-blue", perm: "ot.ver", ayuda: "OT registradas" },
      { clave: "muestras", label: "Muestras", recurso: "muestras", href: "/muestras", icono: "🧫", cls: "k-green", perm: "muestra.ver", ayuda: "Muestras registradas" },
      { clave: "equipos", label: "Equipos", recurso: "equipos", href: "/equipos", icono: "⚙", cls: "k-amber", perm: "equipo.ver", ayuda: "Equipos en inventario" },
      { clave: "certificados", label: "Certificados", recurso: "certificados", href: "/certificados", icono: "📜", cls: "k-violet", perm: "ot.ver", ayuda: "Certificados emitidos" },
    ],
  },
  {
    titulo: "Catálogo",
    kpis: [
      { clave: "ensayos", label: "Ensayos", recurso: "cat/ensayos", href: "/catalogo/ensayos", icono: "🧪", cls: "k-amber", perm: "catalogo.gestionar", ayuda: "Ensayos del catálogo" },
      { clave: "metodos", label: "Métodos", recurso: "cat/metodos", href: "/catalogo/metodos", icono: "🔬", cls: "", perm: "catalogo.gestionar", ayuda: "Métodos analíticos" },
      { clave: "elementos", label: "Elementos", recurso: "cat/elementos", href: "/catalogo/elementos", icono: "🧱", cls: "k-blue", perm: "catalogo.gestionar", ayuda: "Productos / matrices" },
      { clave: "plantillas", label: "Plantillas de informe", recurso: "plantillas", href: "/plantillas", icono: "📄", cls: "k-violet", perm: "plantilla.ver", ayuda: "Plantillas disponibles" },
    ],
  },
];

export default function DashboardPage() {
  const { listo, puede } = usePermisos();
  const [valores, setValores] = useState<Record<string, number | null | undefined>>({});

  const grupos = GRUPOS
    .map((g) => ({ ...g, kpis: g.kpis.filter((k) => listo && puede(k.perm)) }))
    .filter((g) => g.kpis.length > 0);

  useEffect(() => {
    if (!listo) return;
    let vivo = true;
    const visibles = GRUPOS.flatMap((g) => g.kpis).filter((k) => puede(k.perm));
    visibles.forEach(async (k) => {
      const v = await total(k.recurso);
      if (vivo) setValores((prev) => ({ ...prev, [k.clave]: v }));
    });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listo]);

  return (
    <div>
      <PageHeader
        titulo="Panel de indicadores"
        subtitulo="Comercial y laboratorio en un mismo sistema: del cliente y la cotización a la muestra, el análisis y el informe firmado."
        acciones={<Link href="/inicio" className="btn outline sm">📥 Ir a Mi bandeja</Link>}
      />

      {listo && grupos.length === 0 && (
        <div className="alert info">Tu perfil no tiene indicadores asignados. Revisa «Mi bandeja» para ver tus accesos.</div>
      )}

      {grupos.map((g) => (
        <section key={g.titulo} style={{ marginBottom: 6 }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".6px", margin: "6px 0 8px" }}>
            {g.titulo}
          </h2>
          <div className="kpis" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))" }}>
            {g.kpis.map((k) => {
              const v = valores[k.clave];
              return (
                <Link key={k.clave} href={k.href as any} className={`kpi ${k.cls}`} title={k.ayuda}>
                  <div className="kpi-top">
                    <div className="lab">{k.label}</div>
                    <span className="kpi-ico" aria-hidden>{k.icono}</span>
                  </div>
                  <div className="val">
                    {v === undefined ? <Skeleton w={54} h={22} style={{ marginTop: 4 }} /> : v === null ? "—" : v.toLocaleString("es-CL")}
                  </div>
                  <div className="delta">{v === null ? "No disponible" : k.ayuda}</div>
                </Link>
              );
            })}
          </div>
        </section>
      ))}

      <div className="card">
        <h2>Accesos frecuentes</h2>
        <div className="acciones-rapidas">
          {puede("cotizacion.crear") && (
            <Link href="/cotizaciones/nueva" className="accion-rapida"><span className="ar-ico">＋</span><span><b>Nueva cotización</b><small>Con costeo en vivo</small></span></Link>
          )}
          {puede("ot.ver") && (
            <Link href="/ot" className="accion-rapida"><span className="ar-ico">🗂</span><span><b>Órdenes de trabajo</b><small>Expedientes y su avance</small></span></Link>
          )}
          {puede("resultado.ver") && (
            <Link href="/reportes" className="accion-rapida"><span className="ar-ico">📊</span><span><b>Reportes</b><small>Exporta a CSV / Excel</small></span></Link>
          )}
          {puede("flujo.ver") && (
            <Link href="/flujos" className="accion-rapida"><span className="ar-ico">⛓</span><span><b>Diseñador de flujos</b><small>Configura el recorrido de una OT</small></span></Link>
          )}
          <Link href="/inicio" className="accion-rapida"><span className="ar-ico">📥</span><span><b>Mi bandeja</b><small>Tus pendientes y accesos</small></span></Link>
        </div>
      </div>
    </div>
  );
}
