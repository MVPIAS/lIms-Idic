"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";

const estadoBadge = (e: string) => {
  const map: Record<string, string> = {
    borrador: "gray",
    en_proceso: "blue",
    en_analisis: "amber",
    finalizada: "green",
    cerrada: "green",
    anulada: "red",
  };
  return <span className={`pill ${map[e] ?? "gray"}`}>{e ?? "—"}</span>;
};

// Indicador de flujo (BPM) activo: estado de la instancia + paso actual.
const flujoBadge = (f: any) => {
  if (!f) return <span className="pill gray">sin flujo</span>;
  const color = f.estado === "completado" ? "green" : f.estado === "cancelado" ? "red" : "blue";
  const paso = f.pasoActual;
  return (
    <span title={paso ? `${paso.tipo} · ${paso.actividad}` : f.estado}>
      <span className={`pill ${color}`}>{f.estado}</span>
      {paso ? <small style={{ marginLeft: 6, color: "var(--muted)" }}>#{paso.numero} {paso.actividad}</small> : null}
    </span>
  );
};

export default function OtPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API}/ot`, {
          headers: { Authorization: `Bearer ${localStorage.getItem("lims_token")}` },
        });
        if (!res.ok) throw new Error(`Error ${res.status}`);
        const data = await res.json();
        setRows(Array.isArray(data) ? data : data.data ?? []);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div>
      <h1 className="page">Expedientes / Órdenes de Trabajo</h1>
      <p className="subtitle">
        Expediente por OT: recepción de muestras → análisis → resultados → informe/certificado. Núcleo del LIMS.
      </p>
      {error && <div className="alert warn">{error}</div>}

      <div className="card card--table">
        <table className="data">
          <thead>
            <tr>
              <th>Código OT</th>
              <th>Cliente</th>
              <th>Ingreso</th>
              <th>Prioridad</th>
              <th>Estado</th>
              <th>Flujo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="row-action">
                <td>
                  <Link href={`/ot/${r.id}` as any} className="codigo" style={{ textDecoration: "underline" }}>{r.codigo ?? r.numero ?? r.id?.slice(0, 8)}</Link>
                </td>
                <td>{r.cliente?.razonSocial ?? "—"}</td>
                <td>{r.fechaIngreso ? String(r.fechaIngreso).slice(0, 10) : r.createdAt ? String(r.createdAt).slice(0, 10) : "—"}</td>
                <td>{r.prioridad ?? "normal"}</td>
                <td>{estadoBadge(r.estado)}</td>
                <td>{flujoBadge(r.flujo)}</td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: "center", padding: 32, color: "var(--muted)" }}>Sin órdenes de trabajo todavía. Se generan al aceptar una cotización.</td></tr>
            )}
            {loading && (
              <tr><td colSpan={6} style={{ textAlign: "center", padding: 32, color: "var(--muted)" }}>Cargando…</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
