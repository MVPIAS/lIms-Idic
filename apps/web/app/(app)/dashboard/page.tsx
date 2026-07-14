"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

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
    { label: "Clientes", val: k.clientes, href: "/clientes", color: "border-l-[#2b65d9]" },
    { label: "Cotizaciones", val: k.cotizaciones, href: "/cotizaciones", color: "border-l-accent" },
    { label: "Muestras", val: k.muestras, href: "/muestras", color: "border-l-success" },
    { label: "Métodos catálogo", val: k.metodos, href: "/metodos", color: "border-l-warn" },
    { label: "Plantillas informe", val: k.plantillas, href: "/plantillas", color: "border-l-[#7057c8]" },
    { label: "Proveedores", val: k.proveedores, href: "/proveedores", color: "border-l-danger" },
  ];

  return (
    <div>
      <h1 className="text-xl font-bold mb-1">Dashboard</h1>
      <p className="text-sm text-slate-500 mb-5">
        LIMS IDIC · sistema unificado. Del cliente y la cotización, a la muestra, el análisis y el informe firmado.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        {kpis.map((kpi) => (
          <Link
            key={kpi.label}
            href={kpi.href as any}
            className={`bg-white border border-l-4 ${kpi.color} rounded-lg p-3.5 shadow-sm hover:shadow transition`}
          >
            <div className="text-[10px] text-slate-500 uppercase font-semibold tracking-wider">{kpi.label}</div>
            <div className="text-2xl font-bold mt-1 tabular-nums">{kpi.val ?? "…"}</div>
          </Link>
        ))}
      </div>

      <div className="bg-white rounded-lg border p-5 shadow-sm">
        <h2 className="font-bold mb-3">Accesos rápidos</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Link href="/clientes" className="block bg-slate-50 hover:bg-slate-100 border rounded-lg p-4 transition">
            <div className="text-2xl mb-1">🏛</div>
            <h3 className="font-semibold text-sm">Clientes</h3>
            <p className="text-xs text-slate-500">Alta y gestión de instituciones</p>
          </Link>
          <Link href="/ot" className="block bg-slate-50 hover:bg-slate-100 border rounded-lg p-4 transition">
            <div className="text-2xl mb-1">▤</div>
            <h3 className="font-semibold text-sm">Órdenes de Trabajo</h3>
            <p className="text-xs text-slate-500">Expedientes de laboratorio</p>
          </Link>
          <Link href="/metodos" className="block bg-slate-50 hover:bg-slate-100 border rounded-lg p-4 transition">
            <div className="text-2xl mb-1">⚗</div>
            <h3 className="font-semibold text-sm">Catálogo de métodos</h3>
            <p className="text-xs text-slate-500">Técnicas, normas y fórmulas</p>
          </Link>
        </div>
      </div>
    </div>
  );
}
