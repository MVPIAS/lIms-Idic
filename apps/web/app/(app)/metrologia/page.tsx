"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fechaHora } from "@/lib/format";
import { fmtN } from "@/lib/metrologia";
import DataTable, { type DataColumn } from "@/components/DataTable";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("lims_token")}`, "Content-Type": "application/json" });

const PILL: Record<string, string> = { borrador: "gray", calculada: "blue", emitida: "green" };

export default function MetrologiaCalibracionesPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState("");

  async function cargar() {
    try {
      const r = await fetch(`${API}/metrologia/calibraciones?limit=100`, { headers: auth() }).then((x) => x.json());
      setRows(r.data ?? []);
    } catch (e: any) { setError(e.message); }
  }
  useEffect(() => { cargar(); }, []);

  // El PDF va protegido con JWT: se descarga con el token y se abre como blob.
  async function verCertificado(id: string) {
    setError("");
    try {
      const res = await fetch(`${API}/metrologia/calibraciones/${id}/pdf`, { headers: { Authorization: `Bearer ${localStorage.getItem("lims_token")}` } });
      if (!res.ok) throw new Error(`No se pudo generar el certificado (${res.status})`);
      const blob = await res.blob();
      window.open(URL.createObjectURL(blob), "_blank");
    } catch (e: any) { setError(e.message); }
  }

  const columns: DataColumn[] = [
    { key: "codigo", label: "Código", value: (c) => c.codigo ?? "", render: (c) => <span className="codigo">{c.codigo}</span> },
    { key: "proceso", label: "Proceso", value: (c) => `${c.proceso ?? ""} ${c.proceso_nombre ?? ""}`.trim(), render: (c) => <>{c.proceso} · {c.proceso_nombre}</> },
    { key: "instrumento", label: "Instrumento", value: (c) => c.instrumento ?? "", render: (c) => c.instrumento ?? "—" },
    { key: "cliente", label: "Cliente", value: (c) => c.cliente ?? "", render: (c) => c.cliente ?? "—" },
    { key: "u_max", label: "Mayor U (k=2)", num: true, value: (c) => c.u_max, render: (c) => <>± {fmtN(c.u_max, 5)} {c.unidad}</> },
    { key: "conforme", label: "Conforme", value: (c) => (c.conforme == null ? "" : c.conforme ? "Sí" : "No"), render: (c) => (c.conforme == null ? "—" : c.conforme ? <span className="pill green">Sí</span> : <span className="pill red">No</span>) },
    { key: "estado", label: "Estado", value: (c) => c.estado ?? "", render: (c) => <span className={`pill ${PILL[c.estado] ?? "gray"}`}>{c.estado}</span> },
    { key: "created_at", label: "Fecha", value: (c) => c.created_at ?? "", render: (c) => <span style={{ whiteSpace: "nowrap" }}>{fechaHora(c.created_at)}</span> },
  ];

  return (
    <div>
      <h1 className="page">Metrología · Calibraciones</h1>
      <p className="subtitle">
        Calibraciones del Laboratorio de Metrología (LMT). Cada calibración corre el motor de incertidumbre (GUM) del
        proceso y, al emitirse, sella el Certificado de Calibración con HASH SHA-256.
      </p>
      {error && <div className="alert warn">{error}</div>}

      <div className="toolbar" style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <Link className="btn primary sm" href={"/metrologia/nueva" as any}>＋ Nueva calibración</Link>
        <Link className="btn sm" href={"/metrologia/config" as any}>Configuración LMT</Link>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        searchKeys={["codigo", "instrumento", "cliente"]}
        acciones={(c) => (
          <button className="btn sm" onClick={() => verCertificado(c.id)}>Certificado</button>
        )}
        vacio={<>Sin calibraciones. Cree la primera.</>}
      />
    </div>
  );
}
