"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL ?? "/api";

async function total(recurso: string): Promise<number> {
  try {
    const res = await fetch(`${API}/${recurso}?limit=1`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("lims_token")}` },
    });
    if (!res.ok) return 0;
    const d = await res.json();
    if (Array.isArray(d)) return d.length;
    return d?.meta?.total ?? d?.data?.length ?? 0;
  } catch {
    return 0;
  }
}

export default function DashboardPage() {
  const [k, setK] = useState<Record<string, number>>({});

  useEffect(() => {
    (async () => {
      const [clientes, proveedores, cotizaciones, muestras, metodos, plantillas, facturas] = await Promise.all([
        total("clientes"), total("proveedores"), total("cotizaciones"),
        total("muestras"), total("metodos"), total("plantillas"), total("facturas"),
      ]);
      setK({ clientes, proveedores, cotizaciones, muestras, metodos, plantillas, facturas });
    })();
  }, []);

  const kpis = [
    { label: "Clientes", val: k.clientes, href: "/clientes", cls: "k-blue" },
    { label: "Cotizaciones", val: k.cotizaciones, href: "/cotizaciones", cls: "" },
    { label: "Muestras", val: k.muestras, href: "/muestras", cls: "k-green" },
    { label: "Métodos catálogo", val: k.metodos, href: "/metodos", cls: "k-amber" },
    { label: "Plantillas informe", val: k.plantillas, href: "/plantillas", cls: "k-violet" },
    { label: "Proveedores", val: k.proveedores, href: "/proveedores", cls: "k-red" },
  ];

  return (
    <div>
      <h1 className="page">Panel · sistema unificado</h1>
      <p className="subtitle">
        LIMS IDIC · Comercial y LIMS en un mismo sistema. Del cliente y la cotización, a la muestra, el análisis y el informe firmado.
      </p>

      <div className="kpis">
        {kpis.map((kpi) => (
          <Link key={kpi.label} href={kpi.href as any} className={`kpi ${kpi.cls}`} style={{ textDecoration: "none", color: "inherit" }}>
            <div className="lab">{kpi.label}</div>
            <div className="val">{kpi.val ?? "…"}</div>
          </Link>
        ))}
      </div>

      <div className="card">
        <h2>Acciones rápidas</h2>
        <div className="form-grid">
          <QuickAction href="/cotizaciones/nueva" title="＋ Nueva Cotización" desc="Con costeo Ejército en vivo" />
          <QuickAction href="/ot" title="🗂 Abrir expediente" desc="Órdenes de trabajo (14 fases)" />
          <QuickAction href="/flujos" title="⛓ Crear un flujo" desc="Diseñador no-code" />
        </div>
      </div>
    </div>
  );
}

function QuickAction({ href, title, desc }: { href: string; title: string; desc: string }) {
  const router = useRouter();
  return (
    <div
      onClick={() => router.push(href as any)}
      style={{ cursor: "pointer", border: "1px solid var(--line)", borderRadius: 9, padding: 13 }}
    >
      <b>{title}</b>
      <div className="subtitle" style={{ margin: "4px 0 0" }}>{desc}</div>
    </div>
  );
}
