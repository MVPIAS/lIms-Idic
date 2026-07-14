"use client";

import { useEffect, useMemo, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("lims_token")}`, "Content-Type": "application/json" });

function stats(rep: number[]) {
  const xs = rep.filter((x) => Number.isFinite(x));
  const n = xs.length;
  if (!n) return { n: 0, promedio: 0, desviacion: 0, cv: 0 };
  const m = xs.reduce((a, b) => a + b, 0) / n;
  const s = n > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)) : 0;
  return { n, promedio: m, desviacion: s, cv: m ? (s / Math.abs(m)) * 100 : 0 };
}

export default function CapturaPage() {
  const [muestras, setMuestras] = useState<any[]>([]);
  const [analitos, setAnalitos] = useState<any[]>([]);
  const [muestraId, setMuestraId] = useState("");
  const [analitoId, setAnalitoId] = useState("");
  const [raw, setRaw] = useState("12.4, 12.6, 12.5");
  const [saved, setSaved] = useState<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [m, a] = await Promise.all([
          fetch(`${API}/muestras?limit=100`, { headers: auth() }).then((x) => x.json()),
          fetch(`${API}/analitos?limit=200`, { headers: auth() }).then((x) => x.json()),
        ]);
        setMuestras(m.data ?? []);
        setAnalitos(a.data ?? []);
      } catch (e: any) { setError(e.message); }
    })();
  }, []);

  const replicas = useMemo(() => raw.split(/[,\s;]+/).map((x) => parseFloat(x)).filter((x) => Number.isFinite(x)), [raw]);
  const st = useMemo(() => stats(replicas), [replicas]);

  async function guardar() {
    setError(""); setSaved(null);
    if (!muestraId || !analitoId) { setError("Seleccione muestra y analito para persistir."); return; }
    try {
      const r = await fetch(`${API}/resultados`, { method: "POST", headers: auth(), body: JSON.stringify({ muestraId, analitoId, replicas }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? `Error ${r.status}`);
      setSaved(await r.json());
    } catch (e: any) { setError(Array.isArray(e.message) ? e.message.join(", ") : e.message); }
  }

  const inp = "border rounded px-2 py-1.5 text-sm";
  const num = (x: any, d = 3) => Number(x ?? 0).toLocaleString("es-CL", { maximumFractionDigits: d });

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-bold mb-1">Captura de resultados</h1>
      <p className="text-sm text-slate-500 mb-4">Réplicas RN1..RNn → promedio, desviación estándar y CV. Al guardar, el sistema evalúa el veredicto contra el límite del producto.</p>
      {error && <div className="mb-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{error}</div>}

      <div className="bg-white border rounded-lg shadow-sm p-4 mb-4 grid md:grid-cols-2 gap-3">
        <label className="block"><span className="block text-[11px] uppercase text-slate-500 font-semibold mb-1">Muestra</span>
          <select className={`${inp} w-full`} value={muestraId} onChange={(e) => setMuestraId(e.target.value)}>
            <option value="">— seleccionar —</option>
            {muestras.map((m) => <option key={m.id} value={m.id}>{m.codigo} · {m.nombre ?? ""}</option>)}
          </select>
        </label>
        <label className="block"><span className="block text-[11px] uppercase text-slate-500 font-semibold mb-1">Analito {analitos.length === 0 && <em className="text-slate-400 normal-case">(sin analitos cargados)</em>}</span>
          <select className={`${inp} w-full`} value={analitoId} onChange={(e) => setAnalitoId(e.target.value)}>
            <option value="">— seleccionar —</option>
            {analitos.map((a) => <option key={a.id} value={a.id}>{a.codigo} · {a.nombre} {a.unidad ? `(${a.unidad})` : ""}</option>)}
          </select>
        </label>
        <label className="block md:col-span-2"><span className="block text-[11px] uppercase text-slate-500 font-semibold mb-1">Réplicas (separadas por coma o espacio)</span>
          <input className={`${inp} w-full font-mono`} value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="12.4, 12.6, 12.5" />
        </label>
      </div>

      <div className="bg-white border rounded-lg shadow-sm p-4 mb-4">
        <div className="grid grid-cols-4 gap-3 text-sm">
          <div className="bg-slate-50 rounded p-3"><div className="text-[10px] uppercase text-slate-500 font-semibold">n réplicas</div><div className="text-lg font-bold tabular-nums">{st.n}</div></div>
          <div className="bg-slate-50 rounded p-3"><div className="text-[10px] uppercase text-slate-500 font-semibold">Promedio</div><div className="text-lg font-bold tabular-nums">{num(st.promedio)}</div></div>
          <div className="bg-slate-50 rounded p-3"><div className="text-[10px] uppercase text-slate-500 font-semibold">Desv. estándar</div><div className="text-lg font-bold tabular-nums">{num(st.desviacion)}</div></div>
          <div className="bg-slate-50 rounded p-3"><div className="text-[10px] uppercase text-slate-500 font-semibold">CV %</div><div className="text-lg font-bold tabular-nums">{num(st.cv, 2)}</div></div>
        </div>
        <div className="flex justify-end mt-3">
          <button onClick={guardar} className="bg-primary text-white text-sm font-semibold rounded-md px-4 py-2">Guardar resultado</button>
        </div>
      </div>

      {saved && (
        <div className="bg-white border rounded-lg shadow-sm p-4">
          <h2 className="font-bold text-sm mb-2">Resultado persistido</h2>
          <div className="flex items-center gap-4 text-sm">
            <span>Promedio: <b>{num(saved.promedio)}</b> {saved.unidad}</span>
            <span>DE: <b>{num(saved.desviacion)}</b></span>
            <span>CV: <b>{num(saved.cv, 2)}%</b></span>
            <span className={`text-[12px] px-2 py-1 rounded-full font-semibold ${saved.veredicto === "Cumple" ? "bg-emerald-100 text-emerald-700" : saved.veredicto === "No cumple" ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600"}`}>
              {saved.veredicto}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
