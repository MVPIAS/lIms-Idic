"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fechaHora } from "@/lib/format";
import { fmtN } from "@/lib/metrologia";

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

      <div className="card card--table">
        <table className="data">
          <thead>
            <tr>
              <th>Código</th><th>Proceso</th><th>Instrumento</th><th>Cliente</th>
              <th className="num">Mayor U (k=2)</th><th>Conforme</th><th>Estado</th><th>Fecha</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td><span className="codigo">{c.codigo}</span></td>
                <td>{c.proceso} · {c.proceso_nombre}</td>
                <td>{c.instrumento ?? "—"}</td>
                <td>{c.cliente ?? "—"}</td>
                <td className="num">± {fmtN(c.u_max, 5)} {c.unidad}</td>
                <td>{c.conforme == null ? "—" : c.conforme ? <span className="pill green">Sí</span> : <span className="pill red">No</span>}</td>
                <td><span className={`pill ${PILL[c.estado] ?? "gray"}`}>{c.estado}</span></td>
                <td style={{ whiteSpace: "nowrap" }}>{fechaHora(c.created_at)}</td>
                <td>
                  <button className="btn sm" onClick={() => verCertificado(c.id)}>Certificado</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--muted)", padding: 18 }}>Sin calibraciones. Cree la primera.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
