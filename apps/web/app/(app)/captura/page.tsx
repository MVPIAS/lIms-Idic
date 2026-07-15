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

/**
 * Ciclo de vida del resultado (RF-E01), tal y como lo devuelve la API en
 * `estado`. El vocabulario es el de `common/estados.ts`: el estado intermedio
 * es `revisado_n1`, no `revisado`.
 */
const ESTADO: Record<string, { texto: string; pill: string }> = {
  capturado: { texto: "Capturado", pill: "gray" },
  revisado_n1: { texto: "Revisado N1", pill: "blue" },
  aprobado: { texto: "Aprobado", pill: "green" },
  devuelto: { texto: "Devuelto", pill: "amber" },
  rechazado: { texto: "Rechazado", pill: "red" },
};

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

  // Analito seleccionado y su fórmula (RF-A06). La fórmula NO se evalúa aquí:
  // el motor vive en la API (apps/api/src/common/formula.ts) y es el servidor
  // quien la aplica al guardar. Duplicar el evaluador en el navegador daría dos
  // implementaciones que pueden divergir — y el valor que vale es el que se
  // persiste, no el que se pinta.
  const analito = useMemo(() => analitos.find((a) => a.id === analitoId), [analitos, analitoId]);
  const formula: string = (analito?.formula ?? "").trim();

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
      <p className="subtitle">Réplicas RN1..RNn → promedio, desviación estándar y CV → fórmula del analito (si tiene) → veredicto contra el límite del producto. El resultado nace en estado «capturado» y pasa por revisión y aprobación.</p>
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
          {analitoId && (
            <div className="field span-2">
              <label>Fórmula del analito</label>
              {formula ? (
                <>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5, background: "#f6f9fc", border: "1px solid var(--line)", borderRadius: 7, padding: "8px 10px", wordBreak: "break-word" }}>
                    {formula}
                  </div>
                  <span style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, display: "block" }}>
                    Se evalúa en el servidor al guardar, con las réplicas (RN1..RN{st.n || "n"}), PROMEDIO, DE, CV y N.
                    El valor que devuelve sustituye al promedio como valor del ensayo para el veredicto.
                  </span>
                </>
              ) : (
                <span style={{ fontSize: 12, color: "var(--muted)", fontStyle: "italic" }}>
                  Este analito no tiene fórmula: el valor del ensayo es el promedio de las réplicas.
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="kpis">
        <div className="kpi k-blue"><div className="lab">n réplicas</div><div className="val">{st.n}</div></div>
        <div className="kpi"><div className="lab">Promedio</div><div className="val">{num(st.promedio)}</div></div>
        <div className="kpi k-violet"><div className="lab">Desv. estándar</div><div className="val">{num(st.desviacion)}</div></div>
        <div className="kpi k-amber"><div className="lab">CV %</div><div className="val">{num(st.cv, 2)}</div></div>
        {formula && (
          <div className="kpi k-green">
            <div className="lab">Valor final (fórmula)</div>
            <div className="val">{saved?.resultadoFinal != null ? num(saved.resultadoFinal) : "—"}</div>
            <div className="delta">{saved?.resultadoFinal != null ? "calculado por el servidor" : "se calcula al guardar"}</div>
          </div>
        )}
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
            {saved.resultadoFinal != null && (
              <span>Valor final (fórmula): <b>{num(saved.resultadoFinal)}</b> {saved.unidad}</span>
            )}
            <span>DE: <b>{num(saved.desviacion)}</b></span>
            <span>CV: <b>{num(saved.cv, 2)}%</b></span>
            <span className={`pill ${saved.veredicto === "Cumple" ? "green" : saved.veredicto === "No cumple" ? "red" : "gray"}`}>{saved.veredicto}</span>
            <span className={`pill ${ESTADO[saved.estado]?.pill ?? "gray"}`}>{ESTADO[saved.estado]?.texto ?? saved.estado}</span>
          </div>
          {saved.formulaAplicada && (
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>
              Fórmula aplicada: <code style={{ fontFamily: "'JetBrains Mono', monospace" }}>{saved.formulaAplicada}</code>
              {" · "}se guarda con el resultado para que siga siendo reproducible aunque el catálogo cambie.
            </div>
          )}
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
            El resultado queda en <b>capturado</b>. Debe revisarlo y aprobarlo otro usuario:
            quien captura no puede revisar ni aprobar su propio resultado (ISO/IEC 17025).
          </div>
        </div>
      )}
    </div>
  );
}
