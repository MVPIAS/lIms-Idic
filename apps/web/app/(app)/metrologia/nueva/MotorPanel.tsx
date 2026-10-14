"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fmtG, parseEntrada, verEntrada, ETIQUETA_ENTRADA, ETIQUETA_MOTOR, type MotorInfo, type CalculoMotor } from "@/lib/metrologia";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("lims_token")}`, "Content-Type": "application/json" });
const YEL = { background: "var(--edit-bg,#FFF3BF)", borderColor: "var(--edit-br,#E0BE3F)" } as const;
const BLUE = { background: "var(--calc-bg,#E4EEF9)", color: "var(--calc-ink,#25567F)", fontFamily: "var(--mono, ui-monospace)" } as const;
const CELL = { ...YEL, width: 76, fontFamily: "var(--mono,monospace)", textAlign: "right" as const, padding: "4px 6px" };
const HEAD = { fontSize: 12, textTransform: "uppercase" as const, letterSpacing: ".06em", color: "var(--muted)" };

const esObj = (v: any) => v && typeof v === "object" && !Array.isArray(v);
const esFilaObj = (v: any) => Array.isArray(v) && v.length > 0 && v.every(esObj);
const esMatriz = (v: any) => Array.isArray(v) && v.length > 0 && v.every(Array.isArray);
/** ¿El formulario tiene al menos un valor escrito? (si no, no se pide vista previa). */
const tieneValores = (v: any): boolean =>
  Array.isArray(v) ? v.some(tieneValores) : esObj(v) ? Object.values(v).some(tieneValores) : typeof v === "number" || (typeof v === "string" && v.trim() !== "");

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
  motor: MotorInfo;
  paridad?: { identicos: number; comparados: number } | null;
  /** Datos ya guardados (al editar un borrador). Sin ellos, el formulario abre vacío. */
  inicial?: { datos: any; opciones: Record<string, boolean> } | null;
  guardando: boolean;
  onGuardar: (motor: { datos: any; opciones: Record<string, boolean> }) => void;
}

/**
 * Toma de datos genérica de un motor validado: la forma del formulario sale de
 * la planilla de la IT (GET /motores/:it/plantilla), abre VACÍO y el servidor
 * calcula la vista previa con el mismo motor que usa al guardar. «Cargar
 * ejemplo» trae las entradas de un caso real, solo para formación.
 */
export default function MotorPanel({ motor, paridad, inicial, guardando, onGuardar }: Props) {
  const [caso, setCaso] = useState(motor.casos[0]?.caso ?? "");
  const [datos, setDatos] = useState<any>(inicial?.datos ?? null);
  const [opciones, setOpciones] = useState<Record<string, boolean>>(inicial?.opciones ?? {});
  const [calc, setCalc] = useState<CalculoMotor | null>(null);
  const [aviso, setAviso] = useState("");
  const [esEjemplo, setEsEjemplo] = useState(false);
  const seq = useRef(0);
  const lbl = (k: string) => ETIQUETA_MOTOR[motor.it]?.[k] ?? ETIQUETA_ENTRADA[k] ?? k;

  // Formulario vacío con la forma de la planilla (si no se está editando un borrador).
  useEffect(() => {
    if (inicial?.datos) return;
    fetch(`${API}/metrologia/motores/${encodeURIComponent(motor.it)}/plantilla`, { headers: auth() })
      .then((r) => r.json()).then((j) => setDatos(j.data?.datos ?? {})).catch((e) => setAviso(e.message));
  }, [motor.it]); // eslint-disable-line react-hooks/exhaustive-deps

  async function cargarEjemplo() {
    if (!caso) return;
    setAviso("");
    try {
      const j = await fetch(`${API}/metrologia/motores/${encodeURIComponent(motor.it)}/ejemplo?caso=${encodeURIComponent(caso)}`, { headers: auth() }).then((r) => r.json());
      setDatos(j.data?.datos ?? null); setOpciones({}); setEsEjemplo(true);
    } catch (e: any) { setAviso(e.message); }
  }
  async function vaciar() {
    const j = await fetch(`${API}/metrologia/motores/${encodeURIComponent(motor.it)}/plantilla`, { headers: auth() }).then((r) => r.json()).catch(() => null);
    setDatos(j?.data?.datos ?? {}); setOpciones({}); setEsEjemplo(false); setCalc(null);
  }

  // Vista previa: el servidor calcula con el mismo motor que usa al guardar.
  useEffect(() => {
    if (!datos || !tieneValores(datos)) { setCalc(null); setAviso(""); return; }
    const n = ++seq.current;
    const h = setTimeout(async () => {
      try {
        const r = await fetch(`${API}/metrologia/motores/${encodeURIComponent(motor.it)}/calcular`, { method: "POST", headers: auth(), body: JSON.stringify({ datos, opciones }) });
        const j = await r.json().catch(() => ({}));
        if (n !== seq.current) return;
        if (!r.ok) { setCalc(null); setAviso(j.message ?? `Error ${r.status}`); return; }
        setAviso(""); setCalc(j.data);
      } catch (e: any) { if (n === seq.current) setAviso(e.message); }
    }, 350);
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

  const inp = (ruta: (string | number)[], v: any, key?: string) => (
    <input key={key} value={verEntrada(v)} style={CELL} onChange={(e) => cambiar(ruta, e.target.value)} />
  );
  const r = calc?.resumen;
  const uu = motor.unidadU;
  const conClase = !!r?.puntos.some((p) => p.clase);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="card">
        <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line-2,#eee)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <b style={HEAD}>Motor {motor.it} · {motor.nombre}</b>
          {paridad && (
            <span className={`pill ${paridad.identicos === paridad.comparados ? "green" : "red"}`} style={{ marginLeft: "auto" }}>
              Validado contra la planilla: {paridad.identicos}/{paridad.comparados} valores idénticos
            </span>
          )}
        </div>
        <div className="body" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
          {motor.casos.length > 0 && (
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div className="field" style={{ minWidth: 260 }}>
                <label>Caso real de la planilla (para formación)</label>
                <select value={caso} onChange={(e) => setCaso(e.target.value)}>
                  {motor.casos.map((c) => <option key={c.caso} value={c.caso}>{c.caso} · {c.instrumento}</option>)}
                </select>
              </div>
              <button className="btn sm" onClick={cargarEjemplo}>Cargar ejemplo</button>
              {esEjemplo && <button className="btn sm" onClick={vaciar}>Vaciar formulario</button>}
            </div>
          )}
          {esEjemplo && <div className="alert warn" style={{ margin: 0 }}>Está viendo los datos de un caso real de formación. Reemplácelos por los de su calibración antes de guardar.</div>}
          {motor.opciones.length > 0 && (
            <div>
              <div style={{ ...HEAD, fontSize: 11, marginBottom: 6 }}>Correcciones propuestas (desactivadas = cálculo idéntico a la planilla)</div>
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
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: 8 }}>
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
          {!r && !aviso && <p style={{ color: "var(--muted)", margin: 0 }}>Complete la toma de datos: los resultados aparecen aquí a medida que escribe.</p>}
          {aviso && <div className="alert info">{aviso}</div>}
          {r && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 12 }}>
                {[["Mayor U calculada", `± ${fmtG(r.uMax)} ${uu}`], ["U informada en el certificado", r.uCert == null ? "—" : `± ${fmtG(r.uCert)} ${uu}`],
                  [conClase ? "Clase desde el primer punto" : "Puntos conformes", conClase ? r.puntos[0]?.clase ?? "—" : r.conforme == null ? "Sin criterio" : `${r.puntos.filter((p) => p.conforme).length} / ${r.puntos.length}`]].map(([l, v]) => (
                  <div key={l} style={{ ...BLUE, borderRadius: 8, padding: "8px 10px" }}>
                    <div style={{ fontSize: 10.5, color: "var(--muted)", textTransform: "uppercase" }}>{l}</div>
                    <div style={{ fontSize: 17, fontWeight: 600 }}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{ overflowX: "auto" }}>
                <table className="data">
                  <thead><tr><th>Nominal {motor.unidad}</th><th>{conClase ? "fc %" : `Error ${uu === "%" ? "%" : motor.unidad}`}</th><th>u<sub>c</sub> {uu}</th><th>U {uu}</th><th>U certificado {uu}</th><th>{conClase ? "Clase del rango" : "Estado"}</th></tr></thead>
                  <tbody>
                    {r.puntos.map((p, i) => (
                      <tr key={i}>
                        {[fmtG(p.nominal), fmtG(p.error), fmtG(p.uc), fmtG(p.U), fmtG(p.Ucert)].map((v, j) => <td key={j} className="num" style={BLUE}>{v}</td>)}
                        <td>{conClase ? <span className="pill blue">{p.clase}</span> : p.conforme == null ? "—" : p.conforme ? <span className="pill green">Cumple</span> : <span className="pill red">No cumple</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {r.extra && r.extra.length > 0 && (
                <table className="data" style={{ marginTop: 12 }}>
                  <tbody>{r.extra.map((x, i) => <tr key={i}><th style={{ width: 240 }}>{x.etiqueta}</th><td style={BLUE}>{x.valor}</td></tr>)}</tbody>
                </table>
              )}
            </>
          )}
          <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end" }}>
            <button className="btn primary sm" disabled={guardando || !r} onClick={() => onGuardar({ datos, opciones })}>
              {guardando ? "Guardando…" : "Guardar borrador"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
