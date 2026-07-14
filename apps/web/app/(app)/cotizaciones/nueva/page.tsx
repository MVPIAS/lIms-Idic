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

  const inp = "border rounded px-2 py-1.5 text-sm";
  const conIva = (n: number) => n * (1 + Number(ivaPct) / 100);

  return (
    <div className="max-w-5xl">
      <h1 className="text-xl font-bold mb-1">Cotización · Costeo Ejército</h1>
      <p className="text-sm text-slate-500 mb-4">Costos directos → Costo Fijo Asociado (CFA) → Costo Total → tres precios de salida (Ejército, Institucional FFAA, Particular).</p>
      {error && <div className="mb-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{error}</div>}

      <div className="bg-white border rounded-lg shadow-sm p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-bold text-sm">1 · Costos directos</h2>
          <button onClick={add} className="text-accent text-sm font-semibold">＋ Agregar línea</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase text-slate-500 border-b">
                <th className="py-1">Tipo</th><th className="py-1">Descripción</th><th className="py-1 text-right">Cant.</th><th className="py-1 text-right">Valor unit.</th><th className="py-1 text-right">Subtotal</th><th></th>
              </tr>
            </thead>
            <tbody>
              {lineas.map((l, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-1 pr-2">
                    <select className={inp} value={l.tipo} onChange={(e) => set(i, "tipo", e.target.value)}>
                      {TIPOS.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
                    </select>
                  </td>
                  <td className="py-1 pr-2"><input className={`${inp} w-full`} value={l.descripcion} onChange={(e) => set(i, "descripcion", e.target.value)} /></td>
                  <td className="py-1 pr-2"><input type="number" className={`${inp} w-20 text-right`} value={l.cantidad} onChange={(e) => set(i, "cantidad", e.target.value)} /></td>
                  <td className="py-1 pr-2"><input type="number" className={`${inp} w-28 text-right`} value={l.valorUnitario} onChange={(e) => set(i, "valorUnitario", e.target.value)} /></td>
                  <td className="py-1 text-right tabular-nums">{clp((Number(l.cantidad) || 0) * (Number(l.valorUnitario) || 0))}</td>
                  <td className="py-1 text-right"><button onClick={() => del(i)} className="text-danger text-xs">✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white border rounded-lg shadow-sm p-4 mb-4">
        <h2 className="font-bold text-sm mb-2">2 · Parámetros</h2>
        <div className="flex flex-wrap gap-4 items-end">
          <label className="text-sm">CFA % <input type="number" className={`${inp} w-20 ml-1`} value={cfaPct} onChange={(e) => setCfaPct(+e.target.value)} /></label>
          <label className="text-sm">Margen particular % <input type="number" className={`${inp} w-20 ml-1`} value={margenParticularPct} onChange={(e) => setMargen(+e.target.value)} /></label>
          <label className="text-sm">IVA % <input type="number" className={`${inp} w-20 ml-1`} value={ivaPct} onChange={(e) => setIva(+e.target.value)} /></label>
          <button onClick={calcular} className="bg-primary text-white text-sm font-semibold rounded-md px-4 py-2 ml-auto">Calcular costeo</button>
        </div>
      </div>

      {res && (
        <div className="bg-white border rounded-lg shadow-sm p-4">
          <h2 className="font-bold text-sm mb-3">3 · Resultado</h2>
          <div className="grid grid-cols-3 gap-3 mb-4 text-sm">
            <div className="bg-slate-50 rounded p-3"><div className="text-[10px] uppercase text-slate-500 font-semibold">Costo Directo Total</div><div className="text-lg font-bold tabular-nums">{clp(res.cdt)}</div></div>
            <div className="bg-slate-50 rounded p-3"><div className="text-[10px] uppercase text-slate-500 font-semibold">CFA ({res.cfaPct}%)</div><div className="text-lg font-bold tabular-nums">{clp(res.cfa)}</div></div>
            <div className="bg-slate-50 rounded p-3"><div className="text-[10px] uppercase text-slate-500 font-semibold">Costo Total</div><div className="text-lg font-bold tabular-nums">{clp(res.ct)}</div></div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[
              { l: "Precio Ejército", v: res.precios?.ejercito, c: "border-l-primary" },
              { l: "Institucional FFAA", v: res.precios?.institucional, c: "border-l-accent" },
              { l: `Particular (+${res.margenParticularPct}%)`, v: res.precios?.particular, c: "border-l-warn" },
            ].map((p) => (
              <div key={p.l} className={`border border-l-4 ${p.c} rounded-lg p-3`}>
                <div className="text-[11px] uppercase text-slate-500 font-semibold">{p.l}</div>
                <div className="text-xl font-bold tabular-nums">{clp(p.v)}</div>
                <div className="text-xs text-slate-500">c/IVA: {clp(conIva(Number(p.v)))}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
