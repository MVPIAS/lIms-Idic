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

  const num = (x: any, d = 3) => Number(x ?? 0).toLocaleString("es-CL", { maximumFractionDigits: d });

  return (
    <div>
      <h1 className="page">Captura de resultados</h1>
      <p className="subtitle">Réplicas RN1..RNn → promedio, desviación estándar y CV. Al guardar, el sistema evalúa el veredicto contra el límite del producto.</p>
      {error && <div className="alert warn">{error}</div>}

      <div className="card">
        <h2>Datos del ensayo</h2>
        <div className="form-grid cols-2">
          <div className="field">
            <label>Muestra</label>
            <select value={muestraId} onChange={(e) => setMuestraId(e.target.value)}>
              <option value="">— seleccionar —</option>
              {muestras.map((m) => <option key={m.id} value={m.id}>{m.codigo} · {m.nombre ?? ""}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Analito {analitos.length === 0 && <span style={{ textTransform: "none", color: "var(--muted)", fontStyle: "italic" }}>(sin analitos cargados)</span>}</label>
            <select value={analitoId} onChange={(e) => setAnalitoId(e.target.value)}>
              <option value="">— seleccionar —</option>
              {analitos.map((a) => <option key={a.id} value={a.id}>{a.codigo} · {a.nombre} {a.unidad ? `(${a.unidad})` : ""}</option>)}
            </select>
          </div>
          <div className="field span-2">
            <label>Réplicas (separadas por coma o espacio)</label>
            <input style={{ fontFamily: "'JetBrains Mono', monospace" }} value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="12.4, 12.6, 12.5" />
          </div>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi k-blue"><div className="lab">n réplicas</div><div className="val">{st.n}</div></div>
        <div className="kpi"><div className="lab">Promedio</div><div className="val">{num(st.promedio)}</div></div>
        <div className="kpi k-violet"><div className="lab">Desv. estándar</div><div className="val">{num(st.desviacion)}</div></div>
        <div className="kpi k-amber"><div className="lab">CV %</div><div className="val">{num(st.cv, 2)}</div></div>
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button onClick={guardar} className="btn primary sm">Guardar resultado</button>
        </div>
      </div>

      {saved && (
        <div className="card">
          <h2>Resultado persistido</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", fontSize: 12.5 }}>
            <span>Promedio: <b>{num(saved.promedio)}</b> {saved.unidad}</span>
            <span>DE: <b>{num(saved.desviacion)}</b></span>
            <span>CV: <b>{num(saved.cv, 2)}%</b></span>
            <span className={`pill ${saved.veredicto === "Cumple" ? "green" : saved.veredicto === "No cumple" ? "red" : "gray"}`}>{saved.veredicto}</span>
          </div>
        </div>
      )}
    </div>
  );
}
