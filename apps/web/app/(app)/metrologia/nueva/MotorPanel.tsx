"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fmtG, parseEntrada, verEntrada, ETIQUETA_ENTRADA, type MotorInfo, type CalculoMotor } from "@/lib/metrologia";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("lims_token")}`, "Content-Type": "application/json" });
const YEL = { background: "var(--edit-bg,#FFF3BF)", borderColor: "var(--edit-br,#E0BE3F)" } as const;
const BLUE = { background: "var(--calc-bg,#E4EEF9)", color: "var(--calc-ink,#25567F)", fontFamily: "var(--mono, ui-monospace)" } as const;
const CELL = { ...YEL, width: 76, fontFamily: "var(--mono,monospace)", textAlign: "right" as const, padding: "4px 6px" };
const HEAD = { fontSize: 12, textTransform: "uppercase" as const, letterSpacing: ".06em", color: "var(--muted)" };

const esObj = (v: any) => v && typeof v === "object" && !Array.isArray(v);
const esFilaObj = (v: any) => Array.isArray(v) && v.length > 0 && v.every(esObj);
const esMatriz = (v: any) => Array.isArray(v) && v.length > 0 && v.every(Array.isArray);
const lbl = (k: string) => ETIQUETA_ENTRADA[k] ?? k;

/** Aplana objetos anidados (p. ej. thA.err, pat["20 mg E2"].U) en rutas editables. */
function hojas(o: any, pre: string[] = []): { ruta: string[]; v: any }[] {
  return Object.entries(o).flatMap(([k, v]) => (esObj(v) ? hojas(v, [...pre, k]) : [{ ruta: [...pre, k], v }]));
}
function fijar(o: any, ruta: (string | number)[], v: any) {
  let x = o;
  for (const k of ruta.slice(0, -1)) x = x[k];
  x[ruta[ruta.length - 1]] = v;
}

interface Props {
  procesoCodigo: string;
  motor: MotorInfo;
  paridad?: { identicos: number; comparados: number } | null;
  cabecera: { instrumento: any; patronSnap: any; ambiente: any; intervaloMeses: number };
  onGuardado: (c: { codigo: string; id: string }) => void;
}

export default function MotorPanel({ procesoCodigo, motor, paridad, cabecera, onGuardado }: Props) {
  const [caso, setCaso] = useState(motor.casos[0]?.caso ?? "");
  const [datos, setDatos] = useState<any>(null);
  const [opciones, setOpciones] = useState<Record<string, boolean>>({});
  const [calc, setCalc] = useState<CalculoMotor | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const seq = useRef(0);

  // Carga el caso de referencia elegido (entradas reales, sin los valores del Excel).
  useEffect(() => {
    if (!caso) return;
    setError(""); setOpciones({});
    fetch(`${API}/metrologia/motores/${motor.it}/ejemplo?caso=${encodeURIComponent(caso)}`, { headers: auth() })
      .then((r) => r.json()).then((j) => setDatos(j.data?.datos ?? null)).catch((e) => setError(e.message));
  }, [motor.it, caso]);

  // Vista previa: el servidor calcula con el mismo motor que usa al guardar.
  useEffect(() => {
    if (!datos) return;
    const n = ++seq.current;
    const h = setTimeout(async () => {
      try {
        const r = await fetch(`${API}/metrologia/motores/${motor.it}/calcular`, { method: "POST", headers: auth(), body: JSON.stringify({ datos, opciones }) });
        const j = await r.json().catch(() => ({}));
        if (n !== seq.current) return;
        if (!r.ok) { setCalc(null); setError(j.message ?? `Error ${r.status}`); return; }
        setError(""); setCalc(j.data);
      } catch (e: any) { if (n === seq.current) setError(e.message); }
    }, 300);
    return () => clearTimeout(h);
  }, [datos, opciones, motor.it]);

  const partes = useMemo(() => {
    if (!datos) return null;
    const puntosKey = ["pts", "blocks"].find((k) => esFilaObj(datos[k])) ?? Object.keys(datos).find((k) => esFilaObj(datos[k]));
    const escalares = hojas(Object.fromEntries(Object.entries(datos).filter(([k, v]) => k !== puntosKey && !Array.isArray(v))));
    const series = Object.entries(datos).filter(([k, v]) => k !== puntosKey && Array.isArray(v) && !esMatriz(v) && !v.some(esObj));
    const matrices = Object.entries(datos).filter(([k, v]) => k !== puntosKey && esMatriz(v)) as [string, any[][]][];
    const filas: any[] = puntosKey ? datos[puntosKey] : [];
    const cols: { k: string; n: number }[] = [];
    filas.forEach((f) => Object.entries(f).forEach(([k, v]) => {
      const n = Array.isArray(v) ? v.length : 0, c = cols.find((x) => x.k === k);
      if (!c) cols.push({ k, n }); else c.n = Math.max(c.n, n);
    }));
    return { puntosKey, escalares, series, matrices, filas, cols };
  }, [datos]);

  function cambiar(ruta: (string | number)[], texto: string) {
    const d = structuredClone(datos);
    fijar(d, ruta, parseEntrada(texto));
    setDatos(d);
  }

  async function guardar() {
    setSaving(true); setError("");
    try {
      const body = {
        procesoCodigo, instrumento: cabecera.instrumento, patronSnap: cabecera.patronSnap, ambiente: cabecera.ambiente,
        intervaloMeses: cabecera.intervaloMeses, motor: { datos, opciones },
      };
      const r = await fetch(`${API}/metrologia/calibraciones`, { method: "POST", headers: auth(), body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message ?? `Error ${r.status}`);
      onGuardado({ codigo: j.data.codigo, id: j.data.id });
    } catch (e: any) { setError(Array.isArray(e.message) ? e.message.join(", ") : e.message); }
    finally { setSaving(false); }
  }

  const inp = (ruta: (string | number)[], v: any, key?: string) => (
    <input key={key} value={verEntrada(v)} style={CELL} onChange={(e) => cambiar(ruta, e.target.value)} />
  );
  const r = calc?.resumen;
  const uu = motor.unidadU;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="card">
        <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line-2,#eee)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <b style={HEAD}>Motor {motor.it} · {motor.nombre}</b>
          {paridad && (
            <span className={`pill ${paridad.identicos === paridad.comparados ? "green" : "red"}`} style={{ marginLeft: "auto" }}>
              Validado contra el Excel: {paridad.identicos}/{paridad.comparados} valores idénticos
            </span>
          )}
        </div>
        <div className="body" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="form-grid">
            <div className="field">
              <label>Cargar caso de referencia</label>
              <select value={caso} onChange={(e) => setCaso(e.target.value)}>
                {motor.casos.map((c) => <option key={c.caso} value={c.caso}>{c.caso} · {c.instrumento}</option>)}
              </select>
            </div>
          </div>
          {motor.opciones.length > 0 && (
            <div>
              <div style={{ ...HEAD, fontSize: 11, marginBottom: 6 }}>Correcciones propuestas (desactivadas = cálculo idéntico al Excel)</div>
              {motor.opciones.map((o) => (
                <label key={o.clave} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginBottom: 4 }}>
                  <input type="checkbox" checked={!!opciones[o.clave]} onChange={(e) => setOpciones({ ...opciones, [o.clave]: e.target.checked })} />
                  <span className="codigo">{o.hallazgo}</span> {o.etiqueta}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {partes && (
        <div className="card">
          <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line-2,#eee)" }}><b style={HEAD}>Toma de datos</b></div>
          <div className="body" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 14 }}>
            {partes.escalares.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 8 }}>
                {partes.escalares.map(({ ruta, v }) => (
                  <div className="field" key={ruta.join(".")} style={{ minWidth: 0 }}>
                    <label title={ruta.join(".")}>{ruta.length > 1 ? `${lbl(ruta[0])} · ${lbl(ruta.slice(1).join(" · "))}` : lbl(ruta[0])}</label>
                    <input value={verEntrada(v)} style={{ ...YEL, fontFamily: "var(--mono,monospace)" }} onChange={(e) => cambiar(ruta, e.target.value)} />
                  </div>
                ))}
              </div>
            )}
            {[...partes.series.map(([k, v]) => ({ k, filas: [v as any[]], base: [k] })), ...partes.matrices.map(([k, m]) => ({ k, filas: m, base: [k] }))].map(({ k, filas, base }) => (
              <div key={k} style={{ overflowX: "auto" }}>
                <div style={{ fontSize: 12, marginBottom: 4 }}><b>{lbl(k)}</b> <span className="codigo" style={{ fontSize: 11 }}>{k}</span></div>
                {filas.map((fila, i) => (
                  <div key={i} style={{ display: "flex", gap: 4, marginBottom: 4 }}>
                    {fila.map((v: any, j: number) => inp(filas.length > 1 || esMatriz((datos as any)[k]) ? [...base, i, j] : [...base, j], v, `${i}-${j}`))}
                  </div>
                ))}
              </div>
            ))}
            {partes.puntosKey && (
              <div style={{ overflowX: "auto" }}>
                <table className="data">
                  <thead><tr><th>#</th>{partes.cols.flatMap((c) => (c.n ? Array.from({ length: c.n }, (_, i) => <th key={c.k + i}>{lbl(c.k)} {i + 1}</th>) : [<th key={c.k}>{lbl(c.k)}</th>]))}</tr></thead>
                  <tbody>
                    {partes.filas.map((f, i) => (
                      <tr key={i}>
                        <td className="num">{i + 1}</td>
                        {partes.cols.flatMap((c) => (c.n
                          ? Array.from({ length: c.n }, (_, j) => <td key={c.k + j}>{Array.isArray(f[c.k]) && j < f[c.k].length ? inp([partes.puntosKey!, i, c.k, j], f[c.k][j]) : null}</td>)
                          : [<td key={c.k}>{esObj(f[c.k]) ? "—" : inp([partes.puntosKey!, i, c.k], f[c.k])}</td>]))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="card">
        <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line-2,#eee)", display: "flex", alignItems: "center", gap: 8 }}>
          <b style={HEAD}>Resultados en vivo</b>
          {r && r.conforme != null && (
            <span className={`pill ${r.conforme ? "green" : "red"}`} style={{ marginLeft: "auto" }}>{r.conforme ? "Conforme" : "No conforme"}</span>
          )}
        </div>
        <div className="body" style={{ padding: 14 }}>
          {error && <div className="alert warn">{error}</div>}
          {r && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 12 }}>
                {[["Mayor U calculada (k=2)", `± ${fmtG(r.uMax)} ${uu}`], ["U informada en el certificado", r.uCert == null ? "—" : `± ${fmtG(r.uCert)} ${uu}`],
                  ["Puntos conformes", r.conforme == null ? "Sin criterio" : `${r.puntos.filter((p) => p.conforme).length} / ${r.puntos.length}`]].map(([l, v]) => (
                  <div key={l} style={{ ...BLUE, borderRadius: 8, padding: "8px 10px" }}>
                    <div style={{ fontSize: 10.5, color: "var(--muted)", textTransform: "uppercase" }}>{l}</div>
                    <div style={{ fontSize: 17, fontWeight: 600 }}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{ overflowX: "auto" }}>
                <table className="data">
                  <thead><tr><th>Nominal {motor.unidad}</th><th>Error {uu === "%" ? "%" : motor.unidad}</th><th>u<sub>c</sub> {uu}</th><th>U (k=2) {uu}</th><th>U certificado {uu}</th><th>Estado</th></tr></thead>
                  <tbody>
                    {r.puntos.map((p, i) => (
                      <tr key={i}>
                        {[fmtG(p.nominal), fmtG(p.error), fmtG(p.uc), fmtG(p.U), fmtG(p.Ucert)].map((v, j) => <td key={j} className="num" style={BLUE}>{v}</td>)}
                        <td>{p.conforme == null ? "—" : p.conforme ? <span className="pill green">Cumple</span> : <span className="pill red">No cumple</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end" }}>
            <button className="btn primary sm" disabled={saving || !r} onClick={guardar}>{saving ? "Guardando…" : "Guardar y calcular en el servidor"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
