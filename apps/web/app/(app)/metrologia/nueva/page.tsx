"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { calcularCalibracion, nd, fmtN, motorDe, LAB_NOMBRE, type Componente, type Divisores, type MotorInfo } from "@/lib/metrologia";
import { PageHeader } from "@/components/ui/PageHeader";
import { toast } from "@/components/ui/feedback";
import MotorPanel from "./MotorPanel";
import PuntosPanel from "./PuntosPanel";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("lims_token")}`, "Content-Type": "application/json" });

const COND_LBL: Record<string, string> = {
  resolucion: "Resolución d", excentricidad: "Excentricidad máx.", cero: "Error / restitución de cero",
  altura: "Diferencia de altura", reversibilidad: "Reversibilidad", tempc: "Contrib. temperatura",
  gradiente: "Gradiente del medio", estabilidad: "Estabilidad térmica", carga: "Efecto de carga", mpe: "Tolerancia MPE",
};
const YEL = { background: "var(--edit-bg,#FFF3BF)", borderColor: "var(--edit-br,#E0BE3F)" } as const;
const BLUE = { background: "var(--calc-bg,#E4EEF9)", color: "var(--calc-ink,#25567F)", fontFamily: "var(--mono, ui-monospace)" } as const;
const HEAD = { fontSize: 12, textTransform: "uppercase" as const, letterSpacing: ".06em", color: "var(--muted)" };

// Ejemplos de FORMACIÓN para los procesos con el motor GUM parametrizado (sin caso real):
// solo se cargan con el botón «Cargar ejemplo»; el formulario abre vacío.
const EJ: Record<string, { instrumento: any; cond: any; pts: any[] }> = {
  ITM03: { instrumento: { item: "Contrapesa de acero", marca: "Fab. local", serie: "CN-334", cap: "20000", res: "0,01", rango: "1000 a 20000", cliente: "Cliente de formación" }, cond: { resolucion: "0,01", excentricidad: "0,02", cero: "0,005", mpe: "0,10" }, pts: [[1000, "0,002", "0,010", "0,004", 0.006], [10000, "0,010", "0,050", "0,020", 0.020], [20000, "0,020", "0,100", "0,040", 0.040]] },
  ITV05: { instrumento: { item: "Micropipeta 1000 µL", marca: "Eppendorf Research", serie: "MP-6620", cap: "1000", res: "1,0", rango: "100 a 1000", cliente: "Cliente de formación" }, cond: { resolucion: "0,5", tempc: "0,4", mpe: "8,0" }, pts: [[100, "0", "1,2", "0,4", 2.0], [500, "0", "3,0", "1,0", 3.5], [1000, "0", "5,0", "1,6", 5.0]] },
};

const ptoGum = () => ({ nominal: "", correccion: "", uPatron: "", deriva: "", lect: ["", "", "", ""] });
function vacio() {
  return { ident: {} as any, patron: {} as any, ambiente: {} as any, cond: {} as any, intervalo: "12", fecha: "", laboratorio: "", pts: [ptoGum()] };
}
function ejemploGum(procKey: string, proc: any) {
  const e = EJ[procKey];
  if (!e) return null;
  const dec = proc.decimales;
  const pts = e.pts.map(([nom, corr, up, der, err]: any[]) => {
    const base = nom + nd(corr) + err, sp = nd(e.cond.resolucion) || Math.abs(base) * 1e-5 || 1e-4;
    const lect = [base + sp * 0.4, base - sp * 0.3, base + sp * 0.5, base - sp * 0.2].map((x) => x.toLocaleString("es-CL", { minimumFractionDigits: dec, maximumFractionDigits: dec }));
    return { nominal: nom.toLocaleString("es-CL", { minimumFractionDigits: dec > 3 ? 2 : 1, maximumFractionDigits: dec }), correccion: corr, uPatron: up, deriva: der, lect };
  });
  return { ...vacio(), ident: { ot: "", ...e.instrumento }, patron: { nombre: "Patrón de referencia (formación)", trazab: "SIM/BIPM" }, ambiente: { temp: "20,5", tempU: "0,3", hum: "48", humU: "3" }, cond: { ...e.cond }, pts };
}
const txt = (v: any) => (v == null ? "" : typeof v === "number" ? String(v).replace(".", ",") : String(v));

export default function NuevaCalibracionPage() {
  const router = useRouter();
  const [procs, setProcs] = useState<any[]>([]);
  const [labs, setLabs] = useState<string[]>([]);
  const [divs, setDivs] = useState<Divisores>({});
  const [motores, setMotores] = useState<MotorInfo[]>([]);
  const [paridad, setParidad] = useState<{ casos: { it: string; identicos: number; comparados: number }[] } | null>(null);
  const [procKey, setProcKey] = useState("");
  const [D, setD] = useState<any>(vacio());
  const [editId, setEditId] = useState<string | null>(null);
  const [inicialMotor, setInicialMotor] = useState<{ datos: any; opciones: Record<string, boolean> } | null>(null);
  const [devuelto, setDevuelto] = useState<string | null>(null);
  const [cargado, setCargado] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState<{ codigo: string; id: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [p, c, m, par] = await Promise.all([
          fetch(`${API}/metrologia/procesos`, { headers: auth() }).then((x) => x.json()),
          fetch(`${API}/metrologia/config`, { headers: auth() }).then((x) => x.json()),
          fetch(`${API}/metrologia/motores`, { headers: auth() }).then((x) => x.json()),
          fetch(`${API}/metrologia/motores/paridad`, { headers: auth() }).then((x) => x.json()).catch(() => null),
        ]);
        setProcs(p.data ?? []); setLabs(p.laboratorios ?? []);
        setMotores(m.data ?? []);
        setParidad(par?.casos ? par : null);
        setDivs(Object.fromEntries((c.distribuciones ?? []).map((d: any) => [d.codigo, Number(d.divisor)])));
        // Edición de un borrador: /metrologia/nueva?id=…
        const id = new URLSearchParams(window.location.search).get("id");
        if (id) await cargarBorrador(id);
      } catch (e: any) { setError(e.message); }
      finally { setCargado(true); }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function cargarBorrador(id: string) {
    const r = await fetch(`${API}/metrologia/calibraciones/${id}`, { headers: auth() });
    const cal = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(cal.message ?? `Error ${r.status}`);
    if (!(cal.acciones ?? []).includes("EDITAR")) throw new Error(`La calibración ${cal.codigo} no se puede editar (estado: ${cal.estado}; solo su autor edita un borrador).`);
    setEditId(id); setProcKey(cal.proceso); setDevuelto(cal.devuelto_motivo ?? null);
    setInicialMotor(cal.motor ? { datos: cal.datos, opciones: cal.opciones ?? {} } : null);
    setD({
      ident: cal.instrumento ?? {}, patron: cal.patron_snap ?? {}, ambiente: cal.ambiente ?? {},
      cond: Object.fromEntries(Object.entries(cal.cond ?? {}).map(([k, v]) => [k, txt(v)])),
      intervalo: String(cal.intervalo_meses ?? 12), fecha: (cal.fecha_calibracion ?? "").slice(0, 10), laboratorio: cal.laboratorio ?? "",
      pts: cal.motor || !(cal.puntos ?? []).length ? [ptoGum()] : cal.puntos.map((p: any) => ({
        nominal: txt(p.nominal), correccion: txt(p.correccion), uPatron: txt(p.u_patron), deriva: txt(p.deriva), lect: (p.lecturas ?? []).map(txt),
      })),
    });
  }

  const proc = useMemo(() => procs.find((p) => p.codigo === procKey), [procs, procKey]);
  const motor = useMemo(() => (proc ? motorDe(motores, proc.codigo, proc.motor) : undefined), [motores, proc]);
  const paridadMotor = useMemo(() => {
    const cs = paridad?.casos.filter((c) => c.it === motor?.it) ?? [];
    return cs.length ? { identicos: cs.reduce((s, c) => s + c.identicos, 0), comparados: cs.reduce((s, c) => s + c.comparados, 0) } : null;
  }, [paridad, motor]);
  const componentes: Componente[] = proc?.componentes ?? [];
  const condKeys: string[] = useMemo(() => {
    const fromComp = componentes.map((c) => c.fuente).filter((f) => !["uPatron", "rep", "deriva", "hist"].includes(f));
    return [...new Set([...fromComp, "mpe"])];
  }, [componentes]);
  const grupos = useMemo(() => {
    const g: Record<string, any[]> = {};
    procs.forEach((p) => { (g[p.laboratorio ?? ""] ??= []).push(p); });
    return Object.entries(g);
  }, [procs]);

  const gumPuntos = () => D.pts
    .filter((p: any) => String(p.nominal).trim() !== "")
    .map((p: any) => ({ nominal: nd(p.nominal), correccion: nd(p.correccion), uPatron: nd(p.uPatron), deriva: nd(p.deriva), lecturas: p.lect.filter((x: any) => String(x).trim() !== "").map(nd) }));
  const calc = useMemo(() => {
    if (!proc || motor) return null;
    const puntos = gumPuntos();
    if (!puntos.length || puntos.every((p: any) => !p.lecturas.length)) return null;
    const cond: Record<string, number> = {}; Object.entries(D.cond).forEach(([k, v]) => { if (String(v).trim() !== "") cond[k] = nd(v); });
    return calcularCalibracion(componentes, divs, cond, puntos);
  }, [proc, motor, D, componentes, divs]); // eslint-disable-line react-hooks/exhaustive-deps

  function cambiarProc(code: string) {
    setProcKey(code); setOk(null); setError(""); setInicialMotor(null); setD(vacio());
  }
  function up() { setD({ ...D }); }

  async function guardar(extra: { motor?: { datos: any; opciones: Record<string, boolean> } }) {
    if (!proc) return;
    setSaving(true); setError("");
    try {
      const cond: Record<string, number> = {}; Object.entries(D.cond).forEach(([k, v]) => { if (String(v).trim() !== "") cond[k] = nd(v); });
      const body: any = {
        procesoCodigo: proc.codigo, fecha: D.fecha || null, laboratorio: proc.laboratorio ? null : D.laboratorio || null,
        instrumento: D.ident, patronSnap: D.patron, ambiente: D.ambiente, intervaloMeses: nd(D.intervalo) || 12,
        ...(extra.motor ? { motor: extra.motor } : { cond, puntos: gumPuntos() }),
      };
      const r = await fetch(`${API}/metrologia/calibraciones${editId ? `/${editId}` : ""}`, { method: editId ? "PUT" : "POST", headers: auth(), body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(Array.isArray(j.message) ? j.message.join(", ") : j.message ?? `Error ${r.status}`);
      setOk({ codigo: j.data.codigo, id: j.data.id });
      if (extra.motor) setInicialMotor(extra.motor);
      if (!editId) { setEditId(j.data.id); window.history.replaceState(null, "", `?id=${j.data.id}`); }
      toast.ok(`Borrador ${j.data.codigo} guardado`);
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  }
  async function enviar() {
    if (!ok) return;
    try {
      const r = await fetch(`${API}/metrologia/calibraciones/${ok.id}/enviar`, { method: "POST", headers: auth() });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message ?? `Error ${r.status}`);
      toast.ok(`${ok.codigo} enviada a revisión`);
      router.push("/metrologia" as any);
    } catch (e: any) { setError(e.message); }
  }

  if (!cargado) return <div className="card" style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>Cargando procesos…</div>;
  const u = proc?.unidad ?? "", dec = proc?.decimales ?? 3;
  const maxL = Math.max(...D.pts.map((p: any) => p.lect.length), 1);
  const rp = calc?.puntos.reduce((a: any, r: any) => (Math.abs(r.error) > Math.abs(a.error) ? r : a), calc.puntos[0]);

  const fld = (obj: any, key: string, label: string, wide = false, tipo = "text") => (
    <div className="field" style={wide ? { gridColumn: "1 / -1" } : undefined}>
      <label>{label}</label>
      <input type={tipo} value={obj[key] ?? ""} style={YEL} onChange={(e) => { obj[key] = e.target.value; up(); }} />
    </div>
  );

  return (
    <div>
      <PageHeader
        titulo={editId ? "Metrología · Editar borrador" : "Metrología · Nueva calibración"}
        migas={[{ label: "Calibraciones", href: "/metrologia" }, { label: editId ? "Editar borrador" : "Nueva" }]}
        subtitulo={<>Elija el proceso y complete los datos (en amarillo); los resultados (en azul) se calculan mientras escribe. Al guardar,
          el servidor recalcula y la calibración queda como <b>borrador</b>. Cuando esté conforme, envíela a revisión: el jefe del
          laboratorio emite el certificado o se la devuelve con observaciones.</>}
      />
      {error && <div className="alert warn">{error}</div>}
      {devuelto && !ok && <div className="alert warn"><b>Devuelta por el revisor:</b> {devuelto}</div>}
      {ok && (
        <div className="alert success" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span>Borrador <b>{ok.codigo}</b> guardado. Puede seguir corrigiéndolo o enviarlo a revisión.</span>
          <button className="btn primary sm" onClick={enviar}>Enviar a revisión</button>
          <Link className="btn sm" href={"/metrologia" as any}>Ir a Calibraciones</Link>
        </div>
      )}

      <div className="card" style={{ padding: "12px 14px", marginBottom: 12 }}>
        <label style={{ display: "block", marginBottom: 6 }}>Proceso de calibración</label>
        <select value={procKey} disabled={!!editId} onChange={(e) => cambiarProc(e.target.value)} style={{ maxWidth: 620 }}>
          <option value="">Seleccione el proceso…</option>
          {grupos.map(([lab, ps]) => (
            <optgroup key={lab} label={lab ? LAB_NOMBRE[lab] ?? lab : "Cualquier laboratorio de la sección"}>
              {ps.map((p) => {
                const m = motorDe(motores, p.codigo, p.motor);
                const etiqueta = !m ? "" : m.it === "PUNTOS" ? " · formulario por puntos" : " · motor validado";
                return <option key={p.codigo} value={p.codigo}>{p.codigo} · {p.nombre}{etiqueta}</option>;
              })}
            </optgroup>
          ))}
        </select>
        {proc && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>{proc.metodo}{proc.norma ? ` · ${proc.norma}` : ""} · {proc.acreditacion ? `Acreditación ${proc.acreditacion}` : "Sin acreditación declarada"}</div>}
      </div>

      {!proc ? (
        <div className="card" style={{ padding: 24, color: "var(--muted)" }}>Seleccione un proceso para abrir su formulario.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,380px) minmax(0,1fr)", gap: 16, alignItems: "start" }}>
          {/* CABECERA */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="card"><div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line-2,#eee)" }}><b style={HEAD}>Calibración</b></div>
              <div className="body" style={{ padding: 14 }}><div className="form-grid">
                {fld(D, "fecha", "Fecha de calibración", false, "date")}
                <div className="field"><label>Intervalo recomendado (meses)</label>
                  <select value={D.intervalo} style={YEL} onChange={(e) => { D.intervalo = e.target.value; up(); }}><option>12</option><option>15</option><option>24</option><option>36</option></select></div>
                {!proc.laboratorio && (
                  <div className="field" style={{ gridColumn: "1 / -1" }}><label>Laboratorio que calibra</label>
                    <select value={D.laboratorio} style={YEL} onChange={(e) => { D.laboratorio = e.target.value; up(); }}>
                      <option value="">Seleccione…</option>
                      {labs.map((l) => <option key={l} value={l}>{LAB_NOMBRE[l] ?? l}</option>)}
                    </select></div>
                )}
              </div></div>
            </div>
            <div className="card"><div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line-2,#eee)" }}><b style={HEAD}>Instrumento</b></div>
              <div className="body" style={{ padding: 14 }}><div className="form-grid">
                {fld(D.ident, "item", "Descripción", true)}{fld(D.ident, "marca", "Marca y modelo", true)}
                {fld(D.ident, "serie", "N° de serie")}{fld(D.ident, "cap", "Capacidad máx.")}
                {fld(D.ident, "rango", "Rango")}{fld(D.ident, "res", "Resolución")}
                {fld(D.ident, "cliente", "Cliente", true)}{fld(D.ident, "ot", "Orden de trabajo")}
              </div></div>
            </div>
            <div className="card"><div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line-2,#eee)" }}><b style={HEAD}>Patrón · Ambiente</b></div>
              <div className="body" style={{ padding: 14 }}><div className="form-grid">
                {fld(D.patron, "nombre", "Patrón", true)}{fld(D.patron, "clase", "Clase")}{fld(D.patron, "cert", "N° certificado")}
                {fld(D.patron, "trazab", "Trazabilidad")}
                {fld(D.ambiente, "temp", "Temperatura (°C)")}{fld(D.ambiente, "tempU", "U temp. (°C)")}
                {fld(D.ambiente, "hum", "Humedad (%HR)")}{fld(D.ambiente, "humU", "U hum. (%)")}
              </div></div>
            </div>
            {!motor && (
              <div className="card"><div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line-2,#eee)" }}><b style={HEAD}>Condiciones y contribuciones</b></div>
                <div className="body" style={{ padding: 14 }}><div className="form-grid">
                  {condKeys.map((k) => fld(D.cond, k, (COND_LBL[k] ?? k) + " (" + u + ")"))}
                </div></div>
              </div>
            )}
          </div>

          {/* TOMA DE DATOS Y RESULTADOS */}
          {motor?.it === "PUNTOS" ? (
            <PuntosPanel key={procKey + (editId ?? "")} magnitud={proc.magnitud_nombre ?? proc.magnitud} unidadDefecto={proc.unidad}
              inicial={inicialMotor} guardando={saving} onGuardar={(m) => guardar({ motor: m })} />
          ) : motor ? (
            <MotorPanel key={motor.it + procKey + (editId ?? "")} motor={motor} paridad={paridadMotor}
              inicial={inicialMotor} guardando={saving} onGuardar={(m) => guardar({ motor: m })} />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="card"><div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line-2,#eee)", display: "flex", alignItems: "center", gap: 8 }}>
                <b style={HEAD}>Puntos de calibración</b>
                <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  {EJ[procKey] && <button className="btn sm" onClick={() => { const e = ejemploGum(procKey, proc); if (e) setD(e); }}>Cargar ejemplo (formación)</button>}
                  <button className="btn sm" onClick={() => { D.pts.push({ ...ptoGum(), lect: Array(maxL).fill("") }); up(); }}>＋ Punto</button>
                </span></div>
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

              <div className="card"><div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line-2,#eee)", display: "flex", alignItems: "center", gap: 8 }}>
                <b style={HEAD}>Resultados en vivo</b>
                {calc && <span className={`pill ${calc.conforme ? "green" : "red"}`} style={{ marginLeft: "auto" }}>{calc.conforme ? "Dentro de tolerancia" : "Fuera de tolerancia"}</span>}</div>
                <div className="body" style={{ padding: 14 }}>
                  {!calc && <p style={{ color: "var(--muted)", margin: 0 }}>Registre al menos un punto con sus lecturas: los resultados aparecen aquí a medida que escribe.</p>}
                  {calc && (
                    <>
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
                    </>
                  )}
                  <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end" }}>
                    <button className="btn primary sm" disabled={saving || !calc} onClick={() => guardar({})}>{saving ? "Guardando…" : "Guardar borrador"}</button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
