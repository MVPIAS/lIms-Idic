"use client";

/**
 * Listado de Cotizaciones · Módulo Comercial LIMS IDIC
 * Lista las cotizaciones con su estado. Una cotización aceptada da origen a una OT
 * (columna "OT" enlaza al expediente cuando existe). Cotización ≠ OT.
 */
import { useEffect, useState } from "react";
import Link from "next/link";

const API = process.env.NEXT_PUBLIC_API_URL ?? "/api";

type Cot = {
  id: string;
  numero: string;
  cliente: string;
  formato: string;
  estado: "borrador" | "enviada" | "aceptada" | "rechazada" | "vencida";
  total: number;
  otNumero?: string | null;
  fecha: string;
};

const DEMO: Cot[] = [
  { id: "1", numero: "COT-2026-14397", cliente: "FAMAE", formato: "F3", estado: "aceptada", total: 934080, otNumero: "OT-2026-00142", fecha: "2026-06-28" },
  { id: "2", numero: "COT-2026-14402", cliente: "DGMN", formato: "F1", estado: "enviada", total: 412300, otNumero: null, fecha: "2026-07-01" },
  { id: "3", numero: "COT-2026-14410", cliente: "PDI · Lab. Criminalística", formato: "F4", estado: "borrador", total: 1207774, otNumero: null, fecha: "2026-07-03" },
  { id: "4", numero: "COT-2026-14388", cliente: "Aduanas Valparaíso", formato: "F2", estado: "rechazada", total: 288000, otNumero: null, fecha: "2026-06-20" },
];

const ESTADO_STYLE: Record<Cot["estado"], string> = {
  borrador: "bg-slate-100 text-slate-600",
  enviada: "bg-blue-100 text-blue-700",
  aceptada: "bg-green-100 text-green-700",
  rechazada: "bg-red-100 text-red-700",
  vencida: "bg-amber-100 text-amber-700",
};

const clp = (n: number) =>
  new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(n || 0);

export default function CotizacionesPage() {
  const [cots, setCots] = useState<Cot[]>(DEMO);
  const [origen, setOrigen] = useState<"api" | "demo">("demo");
  const [filtro, setFiltro] = useState("");

  useEffect(() => {
    fetch(`${API}/cotizaciones`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        if (Array.isArray(data) && data.length) {
          setCots(data);
          setOrigen("api");
        }
      })
      .catch(() => setOrigen("demo"));
  }, []);

  const vis = cots.filter(
    (c) =>
      !filtro ||
      c.cliente.toLowerCase().includes(filtro.toLowerCase()) ||
      c.numero.toLowerCase().includes(filtro.toLowerCase()),
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold">Cotizaciones</h1>
        <Link
          href="/cotizaciones/nueva"
          className="bg-primary text-white text-sm font-semibold rounded-md px-3.5 py-2 hover:opacity-90"
        >
          ＋ Nueva Cotización
        </Link>
      </div>
      <p className="text-sm text-slate-500 mb-4">
        Una cotización aceptada genera la OT (expediente).{" "}
        {origen === "demo" && <span className="text-amber-700">· Datos de muestra (backend no conectado)</span>}
      </p>

      <input
        className="mb-3 w-72 border rounded-md px-3 py-1.5 text-sm"
        placeholder="Buscar por cliente o N°…"
        value={filtro}
        onChange={(e) => setFiltro(e.target.value)}
      />

      <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase text-slate-500 bg-slate-50 border-b">
              <th className="px-3 py-2">N° Cotización</th>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2">Formato</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2 text-right">Total (c/ IVA)</th>
              <th className="px-3 py-2">OT generada</th>
              <th className="px-3 py-2">Fecha</th>
            </tr>
          </thead>
          <tbody>
            {vis.map((c) => (
              <tr key={c.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2 font-medium">{c.numero}</td>
                <td className="px-3 py-2">{c.cliente}</td>
                <td className="px-3 py-2">{c.formato}</td>
                <td className="px-3 py-2">
                  <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${ESTADO_STYLE[c.estado]}`}>
                    {c.estado}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{clp(c.total)}</td>
                <td className="px-3 py-2">
                  {c.otNumero ? (
                    <Link href={"/ot" as any} className="text-primary hover:underline font-medium">
                      {c.otNumero}
                    </Link>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-slate-500">{c.fecha}</td>
              </tr>
            ))}
            {vis.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                  Sin resultados
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
