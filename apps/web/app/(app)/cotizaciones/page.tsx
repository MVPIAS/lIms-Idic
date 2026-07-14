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

const ESTADO_PILL: Record<Cot["estado"], string> = {
  borrador: "gray",
  enviada: "blue",
  aceptada: "green",
  rechazada: "red",
  vencida: "amber",
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
      <h1 className="page">Cotizaciones <span className="tag">≠ OT</span></h1>
      <p className="subtitle">
        Etapa comercial. Una cotización aceptada genera la OT (expediente). En contratos internos no hay cotización.{" "}
        {origen === "demo" && <span style={{ color: "var(--amber)" }}>· Datos de muestra (backend no conectado)</span>}
      </p>

      <div className="toolbar">
        <input
          placeholder="Buscar por cliente o N°…"
          style={{ flex: 1 }}
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
        />
        <Link href="/cotizaciones/nueva" className="btn primary sm">＋ Nueva Cotización</Link>
      </div>

      <div className="card card--table">
        <table className="data">
          <thead>
            <tr>
              <th>N° Cotización</th>
              <th>Cliente</th>
              <th>Formato</th>
              <th>Estado</th>
              <th className="num">Total (c/ IVA)</th>
              <th>OT generada</th>
              <th>Fecha</th>
            </tr>
          </thead>
          <tbody>
            {vis.map((c) => (
              <tr key={c.id}>
                <td><span className="codigo">{c.numero}</span></td>
                <td>{c.cliente}</td>
                <td>{c.formato}</td>
                <td><span className={`pill ${ESTADO_PILL[c.estado]}`}>{c.estado}</span></td>
                <td className="num">{clp(c.total)}</td>
                <td>
                  {c.otNumero ? (
                    <Link href={"/ot" as any} className="codigo" style={{ textDecoration: "underline" }}>
                      {c.otNumero}
                    </Link>
                  ) : (
                    <span style={{ color: "var(--muted)" }}>—</span>
                  )}
                </td>
                <td style={{ color: "var(--muted)" }}>{c.fecha}</td>
              </tr>
            ))}
            {vis.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", padding: 24, color: "var(--muted)" }}>
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
