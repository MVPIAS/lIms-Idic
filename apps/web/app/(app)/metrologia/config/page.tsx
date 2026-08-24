"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fmtN } from "@/lib/metrologia";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("lims_token")}`, "Content-Type": "application/json" });

export default function MetrologiaConfigPage() {
  const [cfg, setCfg] = useState<any>(null);
  const [mag, setMag] = useState("masa");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  async function cargar() {
    try {
      const c = await fetch(`${API}/metrologia/config`, { headers: auth() }).then((x) => x.json());
      setCfg(c);
    } catch (e: any) { setError(e.message); }
  }
  useEffect(() => { cargar(); }, []);

  const divisores: Record<string, number> = useMemo(
    () => Object.fromEntries((cfg?.distribuciones ?? []).map((d: any) => [d.codigo, Number(d.divisor)])), [cfg]);

  async function cambiarDist(id: string, distribucion: string) {
    setMsg(""); setError("");
    try {
      const r = await fetch(`${API}/metrologia/componentes/${id}`, { method: "PUT", headers: auth(), body: JSON.stringify({ distribucion }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? `Error ${r.status}`);
      setMsg("Distribución actualizada. Las próximas calibraciones usan el nuevo divisor.");
      cargar();
    } catch (e: any) { setError(Array.isArray(e.message) ? e.message.join(", ") : e.message); }
  }

  if (!cfg) return <div className="card" style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>Cargando configuración…</div>;

  const comps = (cfg.componentes ?? []).filter((c: any) => c.magnitud === mag);

  return (
    <div>
      <h1 className="page">Metrología · Configuración del LMT</h1>
      <p className="subtitle">
        Parámetros del motor de incertidumbre: componentes por magnitud (con su distribución/divisor), tabla de
        distribuciones, tolerancias OIML R 111 y patrones. Editar un divisor cambia el cálculo de las nuevas calibraciones.
      </p>
      {msg && <div className="alert info">{msg}</div>}
      {error && <div className="alert warn">{error}</div>}
      <div className="toolbar" style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <Link className="btn sm" href={"/metrologia" as any}>← Calibraciones</Link>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line-2, #eee)", display: "flex", gap: 10, alignItems: "center" }}>
          <h3 style={{ margin: 0, fontSize: 13 }}>Componentes de incertidumbre</h3>
          <select value={mag} onChange={(e) => setMag(e.target.value)} style={{ marginLeft: "auto", width: "auto" }}>
            {(cfg.magnitudes ?? []).map((m: any) => <option key={m.codigo} value={m.codigo}>{m.nombre}</option>)}
          </select>
        </div>
        <div style={{ padding: 0 }}>
          <table className="data">
            <thead><tr><th>Símbolo</th><th>Componente</th><th>Distribución</th><th className="num">Divisor</th><th>Fuente del valor</th></tr></thead>
            <tbody>
              {comps.map((c: any) => (
                <tr key={c.id}>
                  <td className="codigo">{c.simbolo}</td>
                  <td>{c.nombre}</td>
                  <td>
                    <select value={c.distribucion} onChange={(e) => cambiarDist(c.id, e.target.value)} style={{ width: "auto" }}>
                      {(cfg.distribuciones ?? []).map((d: any) => <option key={d.codigo} value={d.codigo}>{d.codigo}</option>)}
                    </select>
                  </td>
                  <td className="num">{fmtN(divisores[c.distribucion], 4)}</td>
                  <td style={{ color: "var(--muted)" }}>{c.fuente}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div className="card card--table">
          <h3 style={{ margin: "0 0 8px", fontSize: 13, padding: "12px 16px 0" }}>Distribuciones · divisores</h3>
          <table className="data">
            <thead><tr><th>Distribución</th><th className="num">Divisor</th><th>Uso</th></tr></thead>
            <tbody>{(cfg.distribuciones ?? []).map((d: any) => (
              <tr key={d.codigo}><td className="codigo">{d.codigo}</td><td className="num">{fmtN(d.divisor, 4)}</td><td style={{ color: "var(--muted)" }}>{d.uso}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <div className="card card--table">
          <h3 style={{ margin: "0 0 8px", fontSize: 13, padding: "12px 16px 0" }}>Tolerancias OIML R 111 (mg)</h3>
          <table className="data">
            <thead><tr><th>Nominal</th><th>Clase</th><th className="num">MPE (mg)</th></tr></thead>
            <tbody>{(cfg.oiml ?? []).map((o: any, i: number) => (
              <tr key={i}><td>{o.nominal}</td><td className="codigo">{o.clase}</td><td className="num">{fmtN(o.mpe_mg, 3)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </div>

      <div className="card card--table" style={{ marginTop: 14 }}>
        <h3 style={{ margin: "0 0 8px", fontSize: 13, padding: "12px 16px 0" }}>Patrones de referencia</h3>
        <table className="data">
          <thead><tr><th>Código</th><th>Nombre</th><th>Magnitud</th><th>Clase</th><th className="num">U</th><th>Certificado</th><th>Vence</th><th>Trazabilidad</th></tr></thead>
          <tbody>
            {(cfg.patrones ?? []).map((p: any) => (
              <tr key={p.id}><td className="codigo">{p.codigo}</td><td>{p.nombre}</td><td>{p.magnitud}</td><td>{p.clase}</td>
                <td className="num">{fmtN(p.u_expandida, 5)}</td><td>{p.n_certificado}</td><td>{p.vence ? String(p.vence).slice(0, 10) : "—"}</td><td>{p.trazabilidad}</td></tr>
            ))}
            {(cfg.patrones ?? []).length === 0 && <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--muted)", padding: 14 }}>Sin patrones registrados.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
