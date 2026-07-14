"use client";

import { useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
const clp = (n: any) => "$ " + Math.round(Number(n ?? 0)).toLocaleString("es-CL");

const TIPOS = [
  { v: "viatico", l: "Viático" },
  { v: "hora_hombre_civil", l: "Hora-Hombre Civil" },
  { v: "hora_hombre_militar", l: "Hora-Hombre Militar" },
  { v: "hora_maquina", l: "Hora-Máquina" },
  { v: "pasaje", l: "Pasaje" },
  { v: "insumo", l: "Insumo" },
  { v: "otros", l: "Otros" },
];

type Linea = { tipo: string; descripcion: string; cantidad: number; valorUnitario: number };

export default function CosteoPage() {
  const [lineas, setLineas] = useState<Linea[]>([
    { tipo: "hora_hombre_civil", descripcion: "Analista LQC", cantidad: 8, valorUnitario: 12000 },
    { tipo: "hora_maquina", descripcion: "Absorción atómica", cantidad: 3, valorUnitario: 35000 },
    { tipo: "insumo", descripcion: "Estándares y reactivos", cantidad: 1, valorUnitario: 45000 },
  ]);
  const [cfaPct, setCfaPct] = useState(12);
  const [margenParticularPct, setMargen] = useState(20);
  const [ivaPct, setIva] = useState(19);
  const [res, setRes] = useState<any>(null);
  const [error, setError] = useState("");

  const set = (i: number, k: keyof Linea, v: any) => setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const add = () => setLineas((ls) => [...ls, { tipo: "otros", descripcion: "", cantidad: 1, valorUnitario: 0 }]);
  const del = (i: number) => setLineas((ls) => ls.filter((_, j) => j !== i));

  async function calcular() {
    setError("");
    try {
      const body = {
        lineas: lineas.map((l) => ({ tipo: l.tipo, descripcion: l.descripcion, cantidad: Number(l.cantidad), valorUnitario: Number(l.valorUnitario) })),
        cfaPct: Number(cfaPct), margenParticularPct: Number(margenParticularPct), ivaPct: Number(ivaPct),
      };
      const r = await fetch(`${API}/cotizaciones/costeo`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("lims_token")}` },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? `Error ${r.status}`);
      setRes(await r.json());
    } catch (e: any) { setError(Array.isArray(e.message) ? e.message.join(", ") : e.message); }
  }

  const conIva = (n: number) => n * (1 + Number(ivaPct) / 100);
  const cellInput: React.CSSProperties = { width: "100%", border: "1px solid var(--line)", borderRadius: 4, padding: "3px 6px", font: "inherit", fontSize: 12.5 };

  return (
    <div>
      <h1 className="page">Nueva Cotización</h1>
      <p className="subtitle">Wizard · costeo Ejército en vivo. Costos directos → CFA → Costo Total → tres precios de salida. Al aceptarse genera la OT/expediente.</p>

      <div className="wizard">
        <div className="st done"><div className="n">1</div>Cliente</div>
        <div className="st cur"><div className="n">2</div>Costeo</div>
        <div className="st"><div className="n">3</div>Condiciones</div>
        <div className="st"><div className="n">4</div>Revisión</div>
      </div>

      {error && <div className="alert warn">{error}</div>}

      <div className="split-3-1">
        <div className="card">
          <h2>2 · Costo directo <span className="right">Costeo Ejército</span></h2>
          <table className="data">
            <thead>
              <tr>
                <th>Concepto</th><th>Detalle</th><th className="num">Cant.</th><th className="num">Valor u.</th><th className="num">Subtotal</th><th></th>
              </tr>
            </thead>
            <tbody>
              {lineas.map((l, i) => (
                <tr key={i}>
                  <td>
                    <select style={cellInput} value={l.tipo} onChange={(e) => set(i, "tipo", e.target.value)}>
                      {TIPOS.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
                    </select>
                  </td>
                  <td><input style={cellInput} value={l.descripcion} onChange={(e) => set(i, "descripcion", e.target.value)} /></td>
                  <td className="num"><input type="number" style={{ ...cellInput, width: 56, textAlign: "right" }} value={l.cantidad} onChange={(e) => set(i, "cantidad", e.target.value)} /></td>
                  <td className="num"><input type="number" style={{ ...cellInput, width: 84, textAlign: "right" }} value={l.valorUnitario} onChange={(e) => set(i, "valorUnitario", e.target.value)} /></td>
                  <td className="num">{clp((Number(l.cantidad) || 0) * (Number(l.valorUnitario) || 0))}</td>
                  <td className="num"><span style={{ cursor: "pointer", color: "var(--muted)" }} onClick={() => del(i)}>✕</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 9 }}>
            <button onClick={add} className="btn outline sm">＋ Añadir línea</button>
          </div>

          <div className="form-grid cols-4" style={{ marginTop: 12 }}>
            <div className="field"><label>CFA %</label><input type="number" value={cfaPct} onChange={(e) => setCfaPct(+e.target.value)} /></div>
            <div className="field"><label>Margen particular %</label><input type="number" value={margenParticularPct} onChange={(e) => setMargen(+e.target.value)} /></div>
            <div className="field"><label>IVA %</label><input type="number" value={ivaPct} onChange={(e) => setIva(+e.target.value)} /></div>
            <div className="field" style={{ justifyContent: "flex-end" }}><button onClick={calcular} className="btn primary sm" style={{ justifyContent: "center" }}>Calcular costeo</button></div>
          </div>
        </div>

        <div>
          <div className="card">
            <h2>Resumen</h2>
            <div className="totals-box">
              <div className="row"><span>CDT</span><b>{res ? clp(res.cdt) : "—"}</b></div>
              <div className="row"><span>CFA {res ? `(${res.cfaPct}%)` : ""}</span><b>{res ? clp(res.cfa) : "—"}</b></div>
              <div className="row total"><span>CT</span><b>{res ? clp(res.ct) : "—"}</b></div>
            </div>
            <div className="totals-box" style={{ marginTop: 6 }}>
              <div className="row"><span>Ejército</span><b>{res ? clp(res.precios?.ejercito) : "—"}</b></div>
              <div className="row"><span>Institucional</span><b>{res ? clp(res.precios?.institucional) : "—"}</b></div>
              <div className="row"><span>Particular {res ? `(+${res.margenParticularPct}%)` : ""}</span><b>{res ? clp(res.precios?.particular) : "—"}</b></div>
            </div>
          </div>
          <div className="card" style={{ background: "var(--primary)", color: "#fff" }}>
            <div style={{ fontSize: 10, textTransform: "uppercase", opacity: 0.8 }}>Precio a cotizar (c/IVA · Ejército)</div>
            <div style={{ fontSize: 24, fontWeight: 800 }}>{res ? clp(conIva(Number(res.precios?.ejercito ?? res.ct))) : "—"}</div>
            <button className="btn success sm" style={{ width: "100%", marginTop: 8, justifyContent: "center" }}>Guardar borrador</button>
          </div>
        </div>
      </div>
    </div>
  );
}
