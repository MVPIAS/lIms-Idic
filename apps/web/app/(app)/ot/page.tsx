"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";

const estadoBadge = (e: string) => {
  const map: Record<string, string> = {
    borrador: "bg-slate-100 text-slate-600",
    en_proceso: "bg-blue-100 text-blue-700",
    en_analisis: "bg-amber-100 text-amber-700",
    finalizada: "bg-emerald-100 text-emerald-700",
    cerrada: "bg-emerald-100 text-emerald-700",
    anulada: "bg-red-100 text-red-700",
  };
  return <span className={`text-[11px] px-2 py-0.5 rounded-full ${map[e] ?? "bg-slate-100 text-slate-600"}`}>{e ?? "—"}</span>;
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
      <h1 className="text-xl font-bold mb-1">Órdenes de Trabajo</h1>
      <p className="text-sm text-slate-500 mb-4">
        Expediente por OT: recepción de muestras → análisis → resultados → informe/certificado. Núcleo del LIMS.
      </p>
      {error && <div className="mb-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{error}</div>}

      <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase text-slate-500 bg-slate-50 border-b">
              <th className="px-3 py-2">Código OT</th>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2">Ingreso</th>
              <th className="px-3 py-2">Prioridad</th>
              <th className="px-3 py-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2 font-mono text-[13px]">
                  <Link href={`/ot/${r.id}` as any} className="text-accent hover:underline">{r.codigo ?? r.numero ?? r.id?.slice(0, 8)}</Link>
                </td>
                <td className="px-3 py-2">{r.cliente?.razonSocial ?? "—"}</td>
                <td className="px-3 py-2">{r.fechaIngreso ? String(r.fechaIngreso).slice(0, 10) : r.createdAt ? String(r.createdAt).slice(0, 10) : "—"}</td>
                <td className="px-3 py-2">{r.prioridad ?? "normal"}</td>
                <td className="px-3 py-2">{estadoBadge(r.estado)}</td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-400">Sin órdenes de trabajo todavía. Se generan al aceptar una cotización.</td></tr>
            )}
            {loading && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-400">Cargando…</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
