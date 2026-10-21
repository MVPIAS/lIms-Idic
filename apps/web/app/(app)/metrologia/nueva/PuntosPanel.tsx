"use client";

import { useEffect, useRef, useState } from "react";
import { fmtG, parseEntrada, verEntrada, type CalculoMotor } from "@/lib/metrologia";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("lims_token")}`, "Content-Type": "application/json" });
const YEL = { background: "var(--edit-bg,#FFF3BF)", borderColor: "var(--edit-br,#E0BE3F)" } as const;
const BLUE = { background: "var(--calc-bg,#E4EEF9)", color: "var(--calc-ink,#25567F)", fontFamily: "var(--mono, ui-monospace)" } as const;
const NUM = { ...YEL, width: 84, fontFamily: "var(--mono,monospace)", textAlign: "right" as const, padding: "4px 6px" };
const HEAD = { fontSize: 12, textTransform: "uppercase" as const, letterSpacing: ".06em", color: "var(--muted)" };

type Pto = { funcion: string; nominal: number | null; unidad: string; res: number | null; Upat: number | null; emp: number | null; inst: (number | null)[]; pat: (number | null)[] };
export type DatosPuntos = { unidad: string; series: number; kPatron: number; regla: "con_u" | "simple"; pts: Pto[] };

const ptoVacio = (n: number, unidad = ""): Pto => ({ funcion: "", nominal: null, unidad, res: null, Upat: null, emp: null, inst: Array(n).fill(null), pat: Array(n).fill(null) });
/** Formulario vacío: 3 series (lo que indica la lista de precios del área), k del patrón = 2 y regla con incertidumbre. */
export const puntosVacios = (unidad = ""): DatosPuntos => ({ unidad, series: 3, kPatron: 2, regla: "con_u", pts: [ptoVacio(3, unidad)] });
const num = (t: string) => { const v = parseEntrada(t); return typeof v === "number" ? v : null; };
const hayDatos = (d: DatosPuntos) => d.pts.some((p) => p.nominal != null || [...p.inst, ...p.pat].some((x) => x != null));

interface Props {
  magnitud: string;
  unidadDefecto: string;
  inicial?: { datos: DatosPuntos; opciones: Record<string, boolean> } | null;
  guardando: boolean;
  onGuardar: (motor: { datos: DatosPuntos; opciones: Record<string, boolean> }) => void;
}

/**
 * Formulario ESTÁNDAR de calibración por puntos: N puntos × n series con la
 * lectura del instrumento y la del patrón. Para eléctrica y tiempo (sin
 * planilla del IDIC) y cualquier magnitud sin motor propio. Todo valor que el
 * IDIC no ha definido (tolerancia, regla de decisión) queda vacío y editable.
 */
export default function PuntosPanel({ magnitud, unidadDefecto, inicial, guardando, onGuardar }: Props) {
  const [d, setD] = useState<DatosPuntos>(inicial?.datos ?? puntosVacios(""));
  const [calc, setCalc] = useState<CalculoMotor | null>(null);
  const [aviso, setAviso] = useState("");
  const seq = useRef(0);

  useEffect(() => {
    if (!hayDatos(d)) { setCalc(null); setAviso(""); return; }
    const n = ++seq.current;
    const h = setTimeout(async () => {
      try {
        const r = await fetch(`${API}/metrologia/motores/PUNTOS/calcular`, { method: "POST", headers: auth(), body: JSON.stringify({ datos: d, opciones: {} }) });
        const j = await r.json().catch(() => ({}));
        if (n !== seq.current) return;
        if (!r.ok) { setCalc(null); setAviso(j.message ?? `Error ${r.status}`); return; }
        setAviso(""); setCalc(j.data);
      } catch (e: any) { if (n === seq.current) setAviso(e.message); }
    }, 350);
    return () => clearTimeout(h);
  }, [d]);

  const set = (cambio: (x: DatosPuntos) => void) => { const x = structuredClone(d); cambio(x); setD(x); };
  function cambiarSeries(n: number) {
    set((x) => {
      x.series = n;
      x.pts.forEach((p) => {
        p.inst = Array.from({ length: n }, (_, i) => p.inst[i] ?? null);
        p.pat = Array.from({ length: n }, (_, i) => p.pat[i] ?? null);
      });
    });
  }
  const rows: any[] = calc?.resultado?.rows ?? [];
  const r = calc?.resumen;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="card">
        <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line-2,#eee)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <b style={HEAD}>Calibración por puntos · {magnitud}</b>
          <span className="pill amber" style={{ marginLeft: "auto" }}>Formulario estándar: el IDIC no entregó planilla ni instrucción</span>
        </div>
        <div className="body" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="form-grid">
            <div className="field"><label>Unidad por defecto de los puntos</label>
              <input value={d.unidad} style={YEL} placeholder={unidadDefecto} onChange={(e) => set((x) => { x.unidad = e.target.value; })} /></div>
            <div className="field"><label>Series por punto</label>
              <select value={d.series} style={YEL} onChange={(e) => cambiarSeries(Number(e.target.value))}>
                {[2, 3, 4, 5, 6, 8, 10].map((n) => <option key={n} value={n}>{n}</option>)}
              </select></div>
            <div className="field"><label>k del certificado del patrón</label>
              <input value={verEntrada(d.kPatron)} style={YEL} onChange={(e) => set((x) => { x.kPatron = num(e.target.value) ?? (null as any); })} /></div>
            <div className="field"><label>Regla de decisión (si hay tolerancia)</label>
              <select value={d.regla} style={YEL} onChange={(e) => set((x) => { x.regla = e.target.value as any; })}>
                <option value="con_u">Cumple si |error| + U ≤ EMP</option>
                <option value="simple">Cumple si |error| ≤ EMP</option>
              </select></div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table className="data">
              <thead>
                <tr>
                  <th>#</th><th>Función / rango</th><th>Nominal</th><th>Unidad</th><th>Resolución d</th><th>U patrón</th><th title="Tolerancia del fabricante: dato informativo para el cliente; el laboratorio no evalúa conformidad">Tolerancia del fabricante ± (informativa)</th>
                  {Array.from({ length: d.series }, (_, i) => <th key={"i" + i}>Instr. {i + 1}</th>)}
                  {Array.from({ length: d.series }, (_, i) => <th key={"p" + i}>Patrón {i + 1}</th>)}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {d.pts.map((p, i) => (
                  <tr key={i}>
                    <td className="num">{i + 1}</td>
                    <td><input value={p.funcion} style={{ ...YEL, width: 120 }} onChange={(e) => set((x) => { x.pts[i].funcion = e.target.value; })} /></td>
                    {(["nominal"] as const).map((k) => <td key={k}><input value={verEntrada(p[k])} style={NUM} onChange={(e) => set((x) => { x.pts[i][k] = num(e.target.value); })} /></td>)}
                    <td><input value={p.unidad} style={{ ...YEL, width: 56 }} placeholder={d.unidad || unidadDefecto} onChange={(e) => set((x) => { x.pts[i].unidad = e.target.value; })} /></td>
                    {(["res", "Upat", "emp"] as const).map((k) => <td key={k}><input value={verEntrada(p[k])} style={NUM} onChange={(e) => set((x) => { x.pts[i][k] = num(e.target.value); })} /></td>)}
                    {p.inst.map((v, j) => <td key={"i" + j}><input value={verEntrada(v)} style={NUM} onChange={(e) => set((x) => { x.pts[i].inst[j] = num(e.target.value); })} /></td>)}
                    {p.pat.map((v, j) => <td key={"p" + j}><input value={verEntrada(v)} style={NUM} onChange={(e) => set((x) => { x.pts[i].pat[j] = num(e.target.value); })} /></td>)}
                    <td><button className="btn sm" title="Quitar el punto" onClick={() => set((x) => { if (x.pts.length > 1) x.pts.splice(i, 1); else x.pts[0] = ptoVacio(x.series, x.unidad); })}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <button className="btn sm" onClick={() => set((x) => { x.pts.push(ptoVacio(x.series, x.pts[x.pts.length - 1]?.unidad || x.unidad)); })}>＋ Punto</button>
          </div>
          <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>
            U patrón: incertidumbre expandida del certificado del patrón (calibrador, multímetro o contador patrón) en el punto, con el k indicado arriba.
            La resolución y la tolerancia son opcionales: sin resolución no se suma su contribución. La tolerancia del fabricante es solo informativa: el laboratorio no evalúa conformidad y el certificado no dice «cumple / no cumple» (EP-04 §5, pregunta 14 al IDIC).
          </p>
        </div>
      </div>

      <div className="card">
        <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line-2,#eee)", display: "flex", alignItems: "center", gap: 8 }}>
          <b style={HEAD}>Resultados en vivo</b>
          {r && r.conforme != null && <span className="pill gray" style={{ marginLeft: "auto" }} title="Informativo: no se certifica conformidad">Tolerancia: informativa</span>}
        </div>
        <div className="body" style={{ padding: 14 }}>
          {!r && !aviso && <p style={{ color: "var(--muted)", margin: 0 }}>Complete al menos un punto: los resultados aparecen aquí a medida que escribe.</p>}
          {aviso && <div className="alert info">{aviso}</div>}
          {r && (
            <div style={{ overflowX: "auto" }}>
              <table className="data">
                <thead><tr><th>Función</th><th>Nominal</th><th>Error ē</th><th>u<sub>A</sub></th><th>u<sub>p</sub></th><th>u<sub>r</sub></th><th>u<sub>c</sub></th><th>U (k=2)</th><th>Tolerancia ±</th><th title="Informativo: |ē| (+ U) frente a la tolerancia del fabricante; no es un veredicto">Frente a la tolerancia (informativo)</th></tr></thead>
                <tbody>
                  {rows.map((x, i) => (
                    <tr key={i}>
                      <td>{x.funcion || "—"}</td>
                      {[`${fmtG(x.nom)} ${x.unidad}`, fmtG(x.err), fmtG(x.uA), fmtG(x.uP), fmtG(x.uR), fmtG(x.uc), "± " + fmtG(x.U), x.emp == null ? "—" : "± " + fmtG(x.emp)].map((v, j) => <td key={j} className="num" style={BLUE}>{v}</td>)}
                      <td>{x.conforme == null ? <span style={{ color: "var(--muted)" }}>—</span> : <span className="pill gray">{x.conforme ? "Dentro" : "Fuera"}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: "pointer", fontSize: 13 }}>Fórmula de cálculo</summary>
            <ul style={{ fontSize: 12.5, fontFamily: "var(--mono, ui-monospace)", margin: "8px 0 0" }}>
              {(calc?.resultado?.formula ?? [
                "eⱼ = lectura del instrumento − lectura del patrón", "ē = promedio de las n diferencias (error del punto)",
                "u_A = s(eⱼ) / √n  (tipo A)", "u_p = U_patrón / k_patrón  (tipo B, certificado del patrón)",
                "u_r = d / (2·√3)  (tipo B, resolución; solo si se informa)", "u_c = √(u_A² + u_p² + u_r²)", "U = k · u_c, con k = 2",
              ]).map((f: string) => <li key={f}>{f}</li>)}
            </ul>
          </details>
          <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end" }}>
            <button className="btn primary sm" disabled={guardando || !r} onClick={() => onGuardar({ datos: d, opciones: {} })}>{guardando ? "Guardando…" : "Guardar borrador"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
