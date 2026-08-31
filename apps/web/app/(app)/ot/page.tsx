"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fecha } from "@/lib/format";
import DataTable, { type DataColumn } from "@/components/DataTable";

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

const codigoDe = (r: any) => r.codigo ?? r.numero ?? r.id?.slice(0, 8) ?? "";

export default function OtPage() {
  const router = useRouter();
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

  const columns: DataColumn[] = [
    {
      key: "codigo", label: "Código OT",
      value: (r) => codigoDe(r),
      render: (r) => (
        <Link href={`/ot/${r.id}` as any} className="codigo" style={{ textDecoration: "underline" }}
          onClick={(e) => e.stopPropagation()}>{codigoDe(r)}</Link>
      ),
    },
    { key: "cliente", label: "Cliente", value: (r) => r.cliente?.razonSocial ?? "", render: (r) => r.cliente?.razonSocial ?? "—" },
    { key: "fechaIngreso", label: "Ingreso", value: (r) => r.fechaIngreso ?? r.createdAt ?? "", render: (r) => fecha(r.fechaIngreso ?? r.createdAt) },
    { key: "prioridad", label: "Prioridad", value: (r) => r.prioridad ?? "normal", render: (r) => r.prioridad ?? "normal" },
    { key: "estado", label: "Estado", value: (r) => r.estado ?? "", render: (r) => estadoBadge(r.estado) },
    { key: "flujo", label: "Flujo", sortable: false, filter: false, value: (r) => r.flujo?.estado ?? "", render: (r) => flujoBadge(r.flujo) },
  ];

  return (
    <div>
      <h1 className="page">Expedientes / Órdenes de Trabajo</h1>
      <p className="subtitle">
        Expediente por OT: recepción de muestras → análisis → resultados → informe/certificado. Núcleo del LIMS.
      </p>
      {error && <div className="alert warn">{error}</div>}

      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        searchKeys={["codigo", "cliente", "estado"]}
        onRowClick={(r) => router.push(`/ot/${r.id}` as any)}
        vacio="Sin órdenes de trabajo todavía. Se generan al aceptar una cotización."
      />
    </div>
  );
}
