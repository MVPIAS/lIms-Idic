"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { calcularCalibracion, nd, fmtN, type Componente, type Divisores } from "@/lib/metrologia";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("lims_token")}`, "Content-Type": "application/json" });

const COND_LBL: Record<string, string> = {
  resolucion: "Resolución d", excentricidad: "Excentricidad máx.", cero: "Error / restitución de cero",
  altura: "Diferencia de altura", reversibilidad: "Reversibilidad", tempc: "Contrib. temperatura",
  gradiente: "Gradiente del medio", estabilidad: "Estabilidad térmica", carga: "Efecto de carga", mpe: "Tolerancia MPE",
};
const YEL = { background: "var(--edit-bg,#FFF3BF)", borderColor: "var(--edit-br,#E0BE3F)" } as const;
const BLUE = { background: "var(--calc-bg,#E4EEF9)", color: "var(--calc-ink,#25567F)", fontFamily: "var(--mono, ui-monospace)" } as const;

// Ejemplos por proceso (números realistas; el servidor recalcula al guardar)
const EJ: Record<string, { instrumento: any; cond: any; pts: any[] }> = {
  ITM01: { instrumento: { item: "Masa patrón 1 kg", marca: "Mettler Toledo", serie: "MP-9001", cap: "1000", res: "0,0001", rango: "1 a 1000", cliente: "Laboratorio de Metrología" }, cond: { resolucion: "0,0001", excentricidad: "0,0001", cero: "0,00005", mpe: "0,0016" }, pts: [[1, "0,00001", "0,00002", "0,000005", 0.000008], [10, "0,00002", "0,00003", "0,00001", 0.00001], [100, "0,00005", "0,00006", "0,00002", 0.00002], [1000, "0,00010", "0,00012", "0,00004", 0.00005]] },
  ITM02: { instrumento: { item: "Balanza analítica", marca: "Mettler Toledo XPE205", serie: "B740123", cap: "220", res: "0,0001", rango: "10 a 200", cliente: "Laboratorio Químico Central (LQC)" }, cond: { resolucion: "0,0001", excentricidad: "0,0002", cero: "0,0001", mpe: "0,0010" }, pts: [[10, "0,00002", "0,00003", "0,00001", 0.000035], [50, "0,00005", "0,00005", "0,00002", 0.000045], [100, "0,00008", "0,00008", "0,00003", 0.000055], [200, "0,00012", "0,00015", "0,00005", 0.000075]] },
  ITM03: { instrumento: { item: "Contrapesa de acero", marca: "Fab. local", serie: "CN-334", cap: "20000", res: "0,01", rango: "1000 a 20000", cliente: "DIVLOG" }, cond: { resolucion: "0,01", excentricidad: "0,02", cero: "0,005", mpe: "0,10" }, pts: [[1000, "0,002", "0,010", "0,004", 0.006], [10000, "0,010", "0,050", "0,020", 0.020], [20000, "0,020", "0,100", "0,040", 0.040]] },
  ITP01: { instrumento: { item: "Manómetro de precisión", marca: "WIKA 332.50", serie: "MN-771", cap: "60", res: "0,05", rango: "0 a 60", cliente: "Banco de Pruebas de Chile" }, cond: { resolucion: "0,05", cero: "0,02", altura: "0,01", mpe: "0,10" }, pts: [[10, "0", "0,006", "0", 0.02], [30, "0", "0,014", "0", 0.03], [60, "0", "0,026", "0", 0.05]] },
  ITP02: { instrumento: { item: "Manómetro Bourdon", marca: "WIKA 232.50", serie: "MN-5521", cap: "25", res: "0,1", rango: "0 a 25", cliente: "Banco de Pruebas de Chile (BPCH)" }, cond: { resolucion: "0,1", cero: "0,05", altura: "0,02", mpe: "0,25" }, pts: [[5, "0", "0,004", "0", 0.04], [10, "0", "0,006", "0", 0.07], [20, "0", "0,012", "0", 0.17]] },
  ITF01: { instrumento: { item: "Máquina universal de ensayos", marca: "Zwick Z100", serie: "MU-450", cap: "100", res: "0,01", rango: "2 a 100", cliente: "Lab. Ensayos Mecánicos (LEM)" }, cond: { resolucion: "0,01", reversibilidad: "0,02", cero: "0,01", mpe: "0,50" }, pts: [[10, "0", "0,015", "0,005", 0.02], [50, "0", "0,045", "0,015", 0.06], [100, "0", "0,090", "0,030", 0.10]] },
  ITF03: { instrumento: { item: "Máquina de compresión", marca: "Controls C104", serie: "MC-210", cap: "50", res: "0,05", rango: "5 a 50", cliente: "Lab. Ensayos Mecánicos (LEM)" }, cond: { resolucion: "0,05", reversibilidad: "0,03", cero: "0,02", mpe: "0,60" }, pts: [[10, "0", "0,020", "0,008", 0.03], [30, "0", "0,050", "0,018", 0.06], [50, "0", "0,090", "0,035", 0.12]] },
  ITV02a: { instrumento: { item: "Matraz aforado 100 mL", marca: "Boeco A", serie: "VA-118", cap: "100", res: "0,02", rango: "clase A", cliente: "Laboratorio Químico Central (LQC)" }, cond: { resolucion: "0,02", tempc: "0,015", mpe: "0,10" }, pts: [[100, "0", "0,010", "0,004", 0.02]] },
  ITV02g: { instrumento: { item: "Probeta graduada 250 mL", marca: "Kartell", serie: "VG-77", cap: "250", res: "1,0", rango: "clase A", cliente: "Lab. Microbiología (LMB)" }, cond: { resolucion: "0,3", tempc: "0,05", mpe: "1,00" }, pts: [[50, "0", "0,04", "0,01", 0.15], [125, "0", "0,06", "0,02", 0.25], [250, "0", "0,10", "0,03", 0.40]] },
  ITV02c: { instrumento: { item: "Contenedor volumétrico 5 L", marca: "Inox", serie: "VC-12", cap: "5000", res: "1,0", rango: "0 a 5000", cliente: "Banco de Pruebas de Chile" }, cond: { resolucion: "1,0", tempc: "0,4", mpe: "2,50" }, pts: [[1000, "0", "0,30", "0,10", 0.6], [2500, "0", "0,60", "0,20", 1.0], [5000, "0", "1,10", "0,35", 1.6]] },
  ITV05: { instrumento: { item: "Micropipeta 1000 µL", marca: "Eppendorf Research", serie: "MP-6620", cap: "1000", res: "1,0", rango: "100 a 1000", cliente: "Lab. Microbiología (LMB)" }, cond: { resolucion: "0,5", tempc: "0,4", mpe: "8,0" }, pts: [[100, "0", "1,2", "0,4", 2.0], [500, "0", "3,0", "1,0", 3.5], [1000, "0", "5,0", "1,6", 5.0]] },
  ITT02: { instrumento: { item: "Baño termostático", marca: "Julabo CORIO", serie: "BT-330", cap: "150", res: "0,01", rango: "20 a 100", cliente: "Lab. Nacional de Fuerza (LNF)" }, cond: { resolucion: "0,01", gradiente: "0,03", estabilidad: "0,02", carga: "0,01", mpe: "0,20" }, pts: [[25, "0", "0,02", "0,005", 0.015], [50, "0", "0,02", "0,008", 0.02], [75, "0", "0,03", "0,010", 0.025], [100, "0", "0,03", "0,012", 0.03]] },
};

function armar(procKey: string, proc: any) {
  const dec = proc.decimales, e = EJ[procKey] ?? { instrumento: {}, cond: { resolucion: "0", mpe: "0" }, pts: [[0, "0", "0", "0", 0]] };
  const pts = e.pts.map(([nom, corr, up, der, err]: any[]) => {
    const base = nom + nd(corr) + err, sp = nd(e.cond.resolucion) || Math.abs(base) * 1e-5 || 1e-4;
    const lect = [base + sp * 0.4, base - sp * 0.3, base + sp * 0.5, base - sp * 0.2].map((x) => x.toLocaleString("es-CL", { minimumFractionDigits: dec, maximumFractionDigits: dec }));
    return { nominal: nom.toLocaleString("es-CL", { minimumFractionDigits: dec > 3 ? 2 : 1, maximumFractionDigits: dec }), correccion: corr, uPatron: up, deriva: der, lect };
  });
  return {
    ident: { ot: "", ...e.instrumento },
    patron: { nombre: "Patrón de referencia", clase: "", cert: "", trazab: "SIM/BIPM" },
    ambiente: { temp: "20,5", tempU: "0,3", hum: "48", humU: "3" },
    cond: e.cond, intervalo: "12", pts,
  };
}

export default function NuevaCalibracionPage() {
  const router = useRouter();
  const [procs, setProcs] = useState<any[]>([]);
  const [divs, setDivs] = useState<Divisores>({});
  const [procKey, setProcKey] = useState("");
  const [D, setD] = useState<any>(null);
  const [error, setError] = useState("");
  const [ok, setOk] = useState<{ codigo: string; id: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [p, c] = await Promise.all([
          fetch(`${API}/metrologia/procesos`, { headers: auth() }).then((x) => x.json()),
          fetch(`${API}/metrologia/config`, { headers: auth() }).then((x) => x.json()),
        ]);
        setProcs(p.data ?? []);
        setDivs(Object.fromEntries((c.distribuciones ?? []).map((d: any) => [d.codigo, Number(d.divisor)])));
        const first = (p.data ?? [])[0];
        if (first) { setProcKey(first.codigo); setD(armar(first.codigo, first)); }
      } catch (e: any) { setError(e.message); }
    })();
  }, []);

  const proc = useMemo(() => procs.find((p) => p.codigo === procKey), [procs, procKey]);
  const componentes: Componente[] = proc?.componentes ?? [];
  const condKeys: string[] = useMemo(() => {
    const fromComp = componentes.map((c) => c.fuente).filter((f) => !["uPatron", "rep", "deriva", "hist"].includes(f));
    return [...new Set([...fromComp, "mpe"])];
  }, [componentes]);

  const calc = useMemo(() => {
    if (!proc || !D) return null;
    const cond: Record<string, number> = {}; Object.entries(D.cond).forEach(([k, v]) => (cond[k] = nd(v)));
    const puntos = D.pts.map((p: any) => ({ nominal: nd(p.nominal), correccion: nd(p.correccion), uPatron: nd(p.uPatron), deriva: nd(p.deriva), lecturas: p.lect.map(nd) }));
    return calcularCalibracion(componentes, divs, cond, puntos);
  }, [proc, D, componentes, divs]);

  function cambiarProc(code: string) {
    setProcKey(code); setOk(null); setError("");
    const p = procs.find((x) => x.codigo === code); if (p) setD(armar(code, p));
  }
  function up() { setD({ ...D }); }

  async function guardar() {
    if (!proc || !D) return;
    setSaving(true); setError(""); setOk(null);
    try {
      const cond: Record<string, number> = {}; Object.entries(D.cond).forEach(([k, v]) => (cond[k] = nd(v)));
      const body = {
        procesoCodigo: procKey,
        instrumento: D.ident, patronSnap: D.patron, ambiente: D.ambiente, cond, intervaloMeses: nd(D.intervalo) || 12,
        puntos: D.pts.map((p: any) => ({ nominal: nd(p.nominal), correccion: nd(p.correccion), uPatron: nd(p.uPatron), deriva: nd(p.deriva), lecturas: p.lect.map(nd) })),
      };
      const r = await fetch(`${API}/metrologia/calibraciones`, { method: "POST", headers: auth(), body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message ?? `Error ${r.status}`);
      setOk({ codigo: j.data.codigo, id: j.data.id });
    } catch (e: any) { setError(Array.isArray(e.message) ? e.message.join(", ") : e.message); }
    finally { setSaving(false); }
  }
  async function emitir() {
    if (!ok) return;
    try {
      const r = await fetch(`${API}/metrologia/calibraciones/${ok.id}/emitir`, { method: "POST", headers: auth() });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? `Error ${r.status}`);
      router.push("/metrologia" as any);
    } catch (e: any) { setError(e.message); }
  }

  if (!D || !proc) return <div className="card" style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>{error || "Cargando procesos…"}</div>;
  const u = proc.unidad, dec = proc.decimales;
  const maxL = Math.max(...D.pts.map((p: any) => p.lect.length), 1);
  const rp = calc?.puntos.reduce((a: any, r: any) => (Math.abs(r.error) > Math.abs(a.error) ? r : a), calc.puntos[0]);

  const fld = (obj: any, key: string, label: string, wide = false) => (
    <div className="field" style={wide ? { gridColumn: "1 / -1" } : undefined}>
      <label>{label}</label>
      <input value={obj[key] ?? ""} style={YEL} onChange={(e) => { obj[key] = e.target.value; up(); }} />
    </div>
  );

  return (
    <div>
      <h1 className="page">Metrología · Nueva calibración</h1>
      <p className="subtitle">
        Elija el proceso, complete los datos (amarillo) y el motor GUM calcula la incertidumbre y la conformidad en vivo
        (azul). Al guardar, el servidor recalcula y persiste; luego puede emitir el certificado sellado.
      </p>
      {error && <div className="alert warn">{error}</div>}
      {ok && (
        <div className="alert success" style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span>Calibración guardada y calculada: <b>{ok.codigo}</b>.</span>
          <button className="btn primary sm" onClick={emitir}>Emitir certificado</button>
        </div>
      )}

      {/* Selector de proceso */}
      <div className="card" style={{ padding: "12px 14px", marginBottom: 12 }}>
        <label style={{ display: "block", marginBottom: 6 }}>Proceso de calibración</label>
        <select value={procKey} onChange={(e) => cambiarProc(e.target.value)} style={{ maxWidth: 520 }}>
          {procs.map((p) => <option key={p.codigo} value={p.codigo}>{p.codigo} · {p.nombre} ({p.unidad})</option>)}
        </select>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,380px) minmax(0,1fr)", gap: 16, alignItems: "start" }}>
        {/* ENTRADA */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="card"><div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line-2,#eee)" }}><b style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--muted)" }}>Instrumento</b></div>
            <div className="body" style={{ padding: 14 }}><div className="form-grid">
              {fld(D.ident, "item", "Descripción", true)}{fld(D.ident, "marca", "Marca y modelo", true)}
              {fld(D.ident, "serie", "N° de serie")}{fld(D.ident, "cap", "Capacidad máx. (" + u + ")")}
              {fld(D.ident, "rango", "Rango")}{fld(D.ident, "res", "Resolución (" + u + ")")}
              {fld(D.ident, "cliente", "Cliente", true)}{fld(D.ident, "ot", "Orden de trabajo")}
            </div></div>
          </div>
          <div className="card"><div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line-2,#eee)" }}><b style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--muted)" }}>Patrón · Ambiente</b></div>
            <div className="body" style={{ padding: 14 }}><div className="form-grid">
              {fld(D.patron, "nombre", "Patrón", true)}{fld(D.patron, "clase", "Clase")}{fld(D.patron, "cert", "N° certificado")}
              {fld(D.patron, "trazab", "Trazabilidad")}
              {fld(D.ambiente, "temp", "Temperatura (°C)")}{fld(D.ambiente, "tempU", "U temp. (°C)")}
              {fld(D.ambiente, "hum", "Humedad (%HR)")}{fld(D.ambiente, "humU", "U hum. (%)")}
            </div></div>
          </div>
          <div className="card"><div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line-2,#eee)" }}><b style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--muted)" }}>Condiciones y contribuciones</b></div>
            <div className="body" style={{ padding: 14 }}><div className="form-grid">
              {condKeys.map((k) => fld(D.cond, k, (COND_LBL[k] ?? k) + " (" + u + ")"))}
              <div className="field"><label>Intervalo (meses)</label>
                <select value={D.intervalo} style={YEL} onChange={(e) => { D.intervalo = e.target.value; up(); }}><option>12</option><option>15</option><option>24</option></select></div>
            </div></div>
          </div>
        </div>

        {/* RESULTADOS */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="card"><div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line-2,#eee)", display: "flex", alignItems: "center" }}>
            <b style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--muted)" }}>Puntos de calibración</b>
            <button className="btn sm" style={{ marginLeft: "auto" }} onClick={() => { const l = D.pts[D.pts.length - 1]; D.pts.push({ nominal: "", correccion: "0", uPatron: l.uPatron, deriva: l.deriva, lect: l.lect.map(() => "") }); up(); }}>＋ Punto</button></div>
            <div className="body" style={{ padding: 14, overflowX: "auto" }}>
              <table className="data">
                <thead><tr><th>Nominal {u}</th><th>Correc.</th><th>U patrón</th><th>Deriva</th>{Array.from({ length: maxL }).map((_, i) => <th key={i}>L{i + 1}</th>)}<th></th></tr></thead>
                <tbody>
                  {D.pts.map((p: any, pi: number) => (
                    <tr key={pi}>
                      {(["nominal", "correccion", "uPatron", "deriva"] as const).map((k) => (
                        <td key={k}><input value={p[k] ?? ""} style={{ ...YEL, width: 74, fontFamily: "var(--mono,monospace)", textAlign: "right", padding: "4px 6px" }} onChange={(e) => { p[k] = e.target.value; up(); }} /></td>
                      ))}
                      {Array.from({ length: maxL }).map((_, i) => (
                        <td key={i}><input value={p.lect[i] ?? ""} style={{ ...YEL, width: 66, fontFamily: "var(--mono,monospace)", textAlign: "right", padding: "4px 6px" }} onChange={(e) => { p.lect[i] = e.target.value; up(); }} /></td>
                      ))}
                      <td><button className="btn sm" onClick={() => { if (D.pts.length > 1) { D.pts.splice(pi, 1); up(); } }}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {calc && (
            <div className="card"><div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line-2,#eee)", display: "flex", alignItems: "center", gap: 8 }}>
              <b style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--muted)" }}>Resultados en vivo</b>
              <span className={`pill ${calc.conforme ? "green" : "red"}`} style={{ marginLeft: "auto" }}>{calc.conforme ? "Dentro de tolerancia" : "Fuera de tolerancia"}</span></div>
              <div className="body" style={{ padding: 14 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 12 }}>
                  <div style={{ ...BLUE, borderRadius: 8, padding: "8px 10px" }}><div style={{ fontSize: 10.5, color: "var(--muted)", textTransform: "uppercase" }}>Mayor U (k=2)</div><div style={{ fontSize: 17, fontWeight: 600 }}>± {fmtN(calc.uMax, dec)} {u}</div></div>
                  <div style={{ ...BLUE, borderRadius: 8, padding: "8px 10px" }}><div style={{ fontSize: 10.5, color: "var(--muted)", textTransform: "uppercase" }}>Error Normalizado</div><div style={{ fontSize: 17, fontWeight: 600 }}>{fmtN(calc.enMax, 2)}</div></div>
                  <div style={{ ...BLUE, borderRadius: 8, padding: "8px 10px" }}><div style={{ fontSize: 10.5, color: "var(--muted)", textTransform: "uppercase" }}>Conformes</div><div style={{ fontSize: 17, fontWeight: 600 }}>{calc.puntos.filter((r: any) => r.dentro).length} / {calc.puntos.length}</div></div>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table className="data">
                    <thead><tr><th>Nominal {u}</th><th>Ind. patrón</th><th>Ind. instr.</th><th>Error</th><th>U (k=2)</th><th>Repetib.</th><th>En</th><th>Estado</th></tr></thead>
                    <tbody>
                      {calc.puntos.map((r: any, i: number) => (
                        <tr key={i}>
                          {[fmtN(r.nominal, dec > 3 ? 2 : 1), fmtN(r.referencia, dec), fmtN(r.media, dec), fmtN(r.error, dec), "± " + fmtN(r.uExp, dec), fmtN(r.repetibilidad, dec), fmtN(r.en, 2)].map((v, j) => (
                            <td key={j} className="num" style={BLUE}>{v}</td>
                          ))}
                          <td>{r.dentro ? <span className="pill green">Cumple</span> : <span className="pill red">No cumple</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {rp && (
                  <>
                    <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".05em", margin: "14px 0 6px" }}>Balance de incertidumbre · punto {fmtN(rp.nominal, dec > 3 ? 2 : 1)} {u}</div>
                    <div style={{ overflowX: "auto" }}>
                      <table className="data">
                        <thead><tr><th>Símbolo</th><th>Componente</th><th>Distribución</th><th>Divisor</th><th>uᵢ ({u})</th></tr></thead>
                        <tbody>
                          {rp.componentes.map((c: any, i: number) => (
                            <tr key={i}><td className="codigo">{c.simbolo}</td><td>{c.nombre}</td><td>{c.distribucion}</td>
                              <td className="num" style={BLUE}>{fmtN(c.divisor, c.divisor < 2 ? 4 : 2)}</td><td className="num" style={BLUE}>{fmtN(c.ui, dec + 1)}</td></tr>
                          ))}
                          <tr><td colSpan={4} style={{ textAlign: "right", fontWeight: 700 }}>u_c → U (k=2)</td><td className="num" style={{ ...BLUE, fontWeight: 700 }}>{fmtN(rp.uc, dec + 1)} → {fmtN(rp.uExp, dec + 1)}</td></tr>
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
                <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end" }}>
                  <button className="btn primary sm" disabled={saving} onClick={guardar}>{saving ? "Guardando…" : "Guardar y calcular en el servidor"}</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
