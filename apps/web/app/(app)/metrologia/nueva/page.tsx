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
const ESTADO_PATRON: Record<string, { label: string; pill: string }> = {
  vigente: { label: "Vigente", pill: "green" }, por_vencer: { label: "Vence en menos de 30 días", pill: "amber" },
  vencido: { label: "Vencido", pill: "red" }, sin_fecha: { label: "Sin vencimiento", pill: "gray" },
};
const dmy = (s: string) => `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}`;

const ptoGum = () => ({ nominal: "", correccion: "", uPatron: "", deriva: "", lect: ["", "", "", ""] });
function vacio() {
  return { ident: {} as any, ambiente: {} as any, cond: {} as any, intervalo: "12", fecha: "", laboratorio: "", patrones: ["", "", ""] as string[], pts: [ptoGum()] };
}
const txt = (v: any) => (v == null ? "" : typeof v === "number" ? String(v).replace(".", ",") : String(v));
const hoy = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Santiago" });

/** Avisos de fechas (los mismos que da el servidor al guardar; no bloquean). */
function avisosFechas(ins: any, fechaCal: string): string[] {
  const a: string[] = [];
  if (ins.fechaOt && ins.fechaRecepcion && ins.fechaOt > ins.fechaRecepcion)
    a.push(`La fecha de la OT (${dmy(ins.fechaOt)}) es posterior a la de recepción (${dmy(ins.fechaRecepcion)}): según el laboratorio, la OT debe ser igual o anterior a la recepción.`);
  if (ins.fechaRecepcion && fechaCal && ins.fechaRecepcion > fechaCal)
    a.push(`La fecha de recepción (${dmy(ins.fechaRecepcion)}) es posterior a la de calibración (${dmy(fechaCal)}): revise las fechas.`);
  return a;
}

export default function NuevaCalibracionPage() {
  const router = useRouter();
  const [procs, setProcs] = useState<any[]>([]);
  const [labs, setLabs] = useState<string[]>([]);
  const [divs, setDivs] = useState<Divisores>({});
  const [motores, setMotores] = useState<MotorInfo[]>([]);
  const [patrones, setPatrones] = useState<any[]>([]);
  const [paridad, setParidad] = useState<{ casos: { it: string; identicos: number; comparados: number }[] } | null>(null);
  const [procKey, setProcKey] = useState("");
  const [D, setD] = useState<any>(vacio());
  const [editId, setEditId] = useState<string | null>(null);
  const [reemplaza, setReemplaza] = useState<string | null>(null);
  const [inicialMotor, setInicialMotor] = useState<{ datos: any; opciones: Record<string, boolean> } | null>(null);
  const [devuelto, setDevuelto] = useState<string | null>(null);
  const [cargado, setCargado] = useState(false);
  const [error, setError] = useState("");
  const [avisosServidor, setAvisosServidor] = useState<string[]>([]);
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

  // Estado de los patrones a la fecha de calibración (bloqueo si vencido, aviso si vence pronto).
  const fechaCal = D.fecha || hoy();
  useEffect(() => {
    fetch(`${API}/metrologia/patrones?fecha=${fechaCal}`, { headers: auth() }).then((x) => x.json())
      .then((j) => setPatrones((j.data ?? []).filter((p: any) => p.activo !== false))).catch(() => setPatrones([]));
  }, [fechaCal]);

  async function cargarBorrador(id: string) {
    const r = await fetch(`${API}/metrologia/calibraciones/${id}`, { headers: auth() });
    const cal = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(cal.message ?? `Error ${r.status}`);
    if (!(cal.acciones ?? []).includes("EDITAR")) throw new Error(`La calibración ${cal.codigo} no se puede editar (estado: ${cal.estado}; solo su autor edita un borrador).`);
    setEditId(id); setProcKey(cal.proceso); setDevuelto(cal.devuelto_motivo ?? null); setReemplaza(cal.reemplaza_numero ?? null);
    setInicialMotor(cal.motor ? { datos: cal.datos, opciones: cal.opciones ?? {} } : null);
    const ids: string[] = (cal.patrones ?? []).map((p: any) => p.id);
    setD({
      ident: cal.instrumento ?? {}, ambiente: cal.ambiente ?? {},
      cond: Object.fromEntries(Object.entries(cal.cond ?? {}).map(([k, v]) => [k, txt(v)])),
      intervalo: String(cal.intervalo_meses ?? 12), fecha: (cal.fecha_calibracion ?? "").slice(0, 10), laboratorio: cal.laboratorio ?? "",
      patrones: [ids[0] ?? "", ids[1] ?? "", ids[2] ?? ""],
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
  // Patrones de la magnitud del proceso primero; los auxiliares (termohigrómetros, barómetros, comparadores) al final.
  const opcionesPatron = useMemo(() => {
    const mag = proc?.magnitud;
    return [...patrones].sort((a, b) => Number(b.magnitud === mag) - Number(a.magnitud === mag) || String(a.tipo).localeCompare(String(b.tipo)) || String(a.codigo).localeCompare(String(b.codigo)));
  }, [patrones, proc]);
  const elegidos = (D.patrones as string[]).map((id) => patrones.find((p) => p.id === id)).filter(Boolean);
  const avisos = [...avisosFechas(D.ident, fechaCal), ...elegidos.filter((p: any) => p.estado === "por_vencer").map((p: any) => `El patrón ${p.codigo} vence el ${dmy(String(p.vence).slice(0, 10))} (menos de 30 días).`)];
  const vencidos = elegidos.filter((p: any) => p.estado === "vencido");

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
    setProcKey(code); setOk(null); setError(""); setInicialMotor(null); setD(vacio()); setAvisosServidor([]);
  }
  function up() { setD({ ...D }); }

  async function guardar(extra: { motor?: { datos: any; opciones: Record<string, boolean> } }) {
    if (!proc) return;
    if (vencidos.length) { setError(`No se puede guardar: ${vencidos.map((p: any) => p.codigo).join(", ")} está vencido a la fecha de calibración.`); return; }
    setSaving(true); setError("");
    try {
      const cond: Record<string, number> = {}; Object.entries(D.cond).forEach(([k, v]) => { if (String(v).trim() !== "") cond[k] = nd(v); });
      const body: any = {
        procesoCodigo: proc.codigo, fecha: D.fecha || null, laboratorio: proc.laboratorio ? null : D.laboratorio || null,
        instrumento: D.ident, ambiente: D.ambiente, intervaloMeses: D.intervalo === "" ? 12 : Number(D.intervalo),
        patronIds: (D.patrones as string[]).filter(Boolean),
        ...(extra.motor ? { motor: extra.motor } : { cond, puntos: gumPuntos() }),
      };
      const r = await fetch(`${API}/metrologia/calibraciones${editId ? `/${editId}` : ""}`, { method: editId ? "PUT" : "POST", headers: auth(), body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(Array.isArray(j.message) ? j.message.join(", ") : j.message ?? `Error ${r.status}`);
      setOk({ codigo: j.data.codigo, id: j.data.id ?? editId });
      setAvisosServidor(j.data.avisos ?? []);
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
      toast.ok(`${ok.codigo} enviada al jefe del laboratorio`);
      router.push("/metrologia" as any);
    } catch (e: any) { setError(e.message); }
  }

  if (!cargado) return <div className="card" style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>Cargando procesos…</div>;
  const u = proc?.unidad ?? "", dec = proc?.decimales ?? 3;
  const maxL = Math.max(...D.pts.map((p: any) => p.lect.length), 1);
  const rp = calc?.puntos.reduce((a: any, r: any) => (Math.abs(r.error) > Math.abs(a.error) ? r : a), calc.puntos[0]);

  const fld = (obj: any, key: string, label: string, wide = false, tipo = "text", ayuda?: string) => (
    <div className="field" style={wide ? { gridColumn: "1 / -1" } : undefined}>
      <label htmlFor={`f-${key}`}>{label}</label>
      <input id={`f-${key}`} type={tipo} value={obj[key] ?? ""} style={YEL} onChange={(e) => { obj[key] = e.target.value; up(); }} />
      {ayuda && <small style={{ color: "var(--muted)" }}>{ayuda}</small>}
    </div>
  );
  const tarjeta = (titulo: string, cuerpo: React.ReactNode) => (
    <div className="card"><div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line-2,#eee)" }}><b style={HEAD}>{titulo}</b></div>
      <div className="body" style={{ padding: 14 }}>{cuerpo}</div></div>
  );

  return (
    <div>
      <PageHeader
        titulo={editId ? "Metrología · Editar borrador" : "Metrología · Nueva calibración"}
        migas={[{ label: "Calibraciones", href: "/metrologia" }, { label: editId ? "Editar borrador" : "Nueva" }]}
        subtitulo={<>Elija el proceso y complete los datos (en amarillo); los resultados (en azul) se calculan mientras escribe. Al guardar,
          el servidor recalcula y la calibración queda como <b>borrador</b>. Al enviarla usted la firma como metrólogo; después la firman
          el jefe del laboratorio y el jefe del departamento, que emite el certificado.</>}
      />
      {error && <div className="alert warn" role="alert">{error}</div>}
      {reemplaza && <div className="alert info">Reemisión: este certificado reemplazará al N° <b>{reemplaza}</b> al emitirse.</div>}
      {devuelto && !ok && <div className="alert warn"><b>Devuelta por el revisor:</b> {devuelto}</div>}
      {[...new Set([...avisos, ...avisosServidor])].map((a) => <div key={a} className="alert info">{a}</div>)}
      {ok && (
        <div className="alert success" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span>Borrador <b>{ok.codigo}</b> guardado. Puede seguir corrigiéndolo o enviarlo al jefe del laboratorio.</span>
          <button className="btn primary sm" onClick={enviar}>Firmar y enviar a revisión</button>
          <Link className="btn sm" href={"/metrologia" as any}>Ir a Calibraciones</Link>
        </div>
      )}

      <div className="card" style={{ padding: "12px 14px", marginBottom: 12 }}>
        <label htmlFor="f-proceso" style={{ display: "block", marginBottom: 6 }}>Proceso de calibración</label>
        <select id="f-proceso" value={procKey} disabled={!!editId} onChange={(e) => cambiarProc(e.target.value)} style={{ maxWidth: 620 }}>
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
        {proc && (
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
            {proc.metodo}{proc.revision ? ` · ${proc.revision}` : ""}{proc.norma ? ` · ${proc.norma}` : ""} ·{" "}
            {proc.acreditacion ? <>Acreditado: <b>{proc.acreditacion}</b></> : <b>Proceso no acreditado</b>}
          </div>
        )}
      </div>

      {!proc ? (
        <div className="card" style={{ padding: 24, color: "var(--muted)" }}>Seleccione un proceso para abrir su formulario.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,400px) minmax(0,1fr)", gap: 16, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {tarjeta("Calibración", <div className="form-grid">
              {fld(D, "fecha", "Fecha de calibración", false, "date")}
              <div className="field"><label htmlFor="f-intervalo">Intervalo de calibración</label>
                <select id="f-intervalo" value={D.intervalo} style={YEL} onChange={(e) => { D.intervalo = e.target.value; up(); }}>
                  {["12", "15", "18", "24", "36", "48", "60"].map((m) => <option key={m} value={m}>{m} meses</option>)}
                  <option value="0">Según requerimiento del cliente</option>
                </select></div>
              {!proc.laboratorio && (
                <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="f-lab">Laboratorio que calibra</label>
                  <select id="f-lab" value={D.laboratorio} style={YEL} onChange={(e) => { D.laboratorio = e.target.value; up(); }}>
                    <option value="">Seleccione…</option>
                    {labs.map((l) => <option key={l} value={l}>{LAB_NOMBRE[l] ?? l}</option>)}
                  </select></div>
              )}
              <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="f-desv">Desviaciones del método</label>
                <input id="f-desv" value={D.ident.desviacion ?? ""} style={YEL} placeholder="No" onChange={(e) => { D.ident.desviacion = e.target.value; up(); }} /></div>
            </div>)}
            {tarjeta("Orden de trabajo y cliente", <div className="form-grid">
              {fld(D.ident, "ot", "Orden de trabajo")}
              {fld(D.ident, "fechaOt", "Fecha de la OT", false, "date")}
              {fld(D.ident, "fechaRecepcion", "Fecha de recepción del instrumento", true, "date")}
              {fld(D.ident, "cliente", "Cliente", true)}{fld(D.ident, "solicitante", "Solicitante")}{fld(D.ident, "contacto", "Contacto")}
              {fld(D.ident, "direccion", "Dirección", true)}
              <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="f-lugar">Lugar de la calibración</label>
                <select id="f-lugar" value={D.ident.lugar ?? "instalaciones"} style={YEL} onChange={(e) => { D.ident.lugar = e.target.value; up(); }}>
                  <option value="instalaciones">Instalaciones del IDIC (Av. Pedro Montt N° 2136)</option>
                  <option value="cliente">Instalaciones del cliente</option>
                </select></div>
            </div>)}
            {tarjeta("Instrumento", <div className="form-grid">
              {fld(D.ident, "item", "Descripción del ítem", true)}{fld(D.ident, "marca", "Marca")}{fld(D.ident, "modelo", "Modelo")}
              {fld(D.ident, "serie", "N° de serie")}{fld(D.ident, "idEspecial", "Identificación especial")}
              {fld(D.ident, "cap", "Capacidad / valor nominal")}{fld(D.ident, "res", "Resolución")}
              {fld(D.ident, "rango", "Rango calibrado")}{fld(D.ident, "clase", "Clase")}
            </div>)}
            {tarjeta("Patrones utilizados (hasta 3)", <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[0, 1, 2].map((i) => {
                const sel = patrones.find((p) => p.id === D.patrones[i]);
                return (
                  <div className="field" key={i}>
                    <label htmlFor={`f-pat-${i}`}>Patrón {i + 1}</label>
                    <select id={`f-pat-${i}`} value={D.patrones[i]} style={YEL} onChange={(e) => { D.patrones[i] = e.target.value; up(); }}>
                      <option value="">{i === 0 ? "Seleccione del maestro…" : "(ninguno)"}</option>
                      {opcionesPatron.map((p) => (
                        <option key={p.id} value={p.id} disabled={p.estado === "vencido" || (D.patrones.includes(p.id) && D.patrones[i] !== p.id)}>
                          {p.codigo} · {p.nombre}{p.rango ? ` (${p.rango})` : ""} · {p.serie ?? "s/s"} · cert. {p.n_certificado ?? "—"}{p.estado === "vencido" ? " · VENCIDO" : ""}
                        </option>
                      ))}
                    </select>
                    {sel && (
                      <small><span className={`pill ${ESTADO_PATRON[sel.estado]?.pill ?? "gray"}`}>{ESTADO_PATRON[sel.estado]?.label ?? sel.estado}</span>{" "}
                        Próxima calibración {sel.vence ? dmy(String(sel.vence).slice(0, 10)) : "—"} · {sel.emisor ?? "—"} · {sel.trazabilidad ?? "—"}</small>
                    )}
                  </div>
                );
              })}
              <small style={{ color: "var(--muted)" }}>Los vencidos a la fecha de calibración no se pueden elegir. El maestro se mantiene en Metrología › Configuración.</small>
            </div>)}
            {tarjeta("Condiciones ambientales", <div className="form-grid">
              {fld(D.ambiente, "temp", "Temperatura (°C)")}{fld(D.ambiente, "tempU", "U temperatura (°C)")}
              {fld(D.ambiente, "hum", "Humedad (%HR)")}{fld(D.ambiente, "humU", "U humedad (%)")}
              {fld(D.ambiente, "pres", "Presión (hPa)")}{fld(D.ambiente, "presU", "U presión (hPa)")}
              {(motor?.it === "ITM03" || motor?.it === "ITV05") && (
                <small style={{ gridColumn: "1 / -1", color: "var(--muted)" }}>En {motor.it} el certificado informa las condiciones corregidas que calcula la planilla.</small>
              )}
            </div>)}
            {!motor && tarjeta("Condiciones y contribuciones", <div className="form-grid">
              {condKeys.map((k) => fld(D.cond, k, (COND_LBL[k] ?? k) + " (" + u + ")"))}
            </div>)}
          </div>

          {motor?.it === "PUNTOS" ? (
            <PuntosPanel key={procKey + (editId ?? "")} magnitud={proc.magnitud_nombre ?? proc.magnitud} unidadDefecto={proc.unidad}
              inicial={inicialMotor} guardando={saving} onGuardar={(m) => guardar({ motor: m })} />
          ) : motor ? (
            <MotorPanel key={motor.it + procKey + (editId ?? "")} motor={motor} paridad={paridadMotor} fecha={fechaCal}
              inicial={inicialMotor} guardando={saving} onGuardar={(m) => guardar({ motor: m })} />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="card"><div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line-2,#eee)", display: "flex", alignItems: "center", gap: 8 }}>
                <b style={HEAD}>Puntos de calibración</b>
                <span style={{ marginLeft: "auto" }}>
                  <button className="btn sm" onClick={() => { D.pts.push({ ...ptoGum(), lect: Array(maxL).fill("") }); up(); }}>＋ Punto</button>
                </span></div>
                <div className="body" style={{ padding: 14, overflowX: "auto" }}>
                  <table className="data">
                    <thead><tr><th>Nominal {u}</th><th>Correc.</th><th>U patrón</th><th>Deriva</th>{Array.from({ length: maxL }).map((_, i) => <th key={i}>L{i + 1}</th>)}<th></th></tr></thead>
                    <tbody>
                      {D.pts.map((p: any, pi: number) => (
                        <tr key={pi}>
                          {(["nominal", "correccion", "uPatron", "deriva"] as const).map((k) => (
                            <td key={k}><input aria-label={`${k} punto ${pi + 1}`} value={p[k] ?? ""} style={{ ...YEL, width: 74, fontFamily: "var(--mono,monospace)", textAlign: "right", padding: "4px 6px" }} onChange={(e) => { p[k] = e.target.value; up(); }} /></td>
                          ))}
                          {Array.from({ length: maxL }).map((_, i) => (
                            <td key={i}><input aria-label={`Lectura ${i + 1} punto ${pi + 1}`} value={p.lect[i] ?? ""} style={{ ...YEL, width: 66, fontFamily: "var(--mono,monospace)", textAlign: "right", padding: "4px 6px" }} onChange={(e) => { p.lect[i] = e.target.value; up(); }} /></td>
                          ))}
                          <td><button className="btn sm" aria-label={`Quitar punto ${pi + 1}`} onClick={() => { if (D.pts.length > 1) { D.pts.splice(pi, 1); up(); } }}>✕</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="card"><div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line-2,#eee)" }}><b style={HEAD}>Resultados en vivo</b></div>
                <div className="body" style={{ padding: 14 }}>
                  {!calc && <p style={{ color: "var(--muted)", margin: 0 }}>Registre al menos un punto con sus lecturas: los resultados aparecen aquí a medida que escribe.</p>}
                  {calc && (
                    <div style={{ overflowX: "auto" }}>
                      <table className="data">
                        <thead><tr><th>Nominal {u}</th><th>Ind. patrón</th><th>Ind. instr.</th><th>Error</th><th>U (k=2)</th><th>Repetib.</th></tr></thead>
                        <tbody>
                          {calc.puntos.map((r: any, i: number) => (
                            <tr key={i}>
                              {[fmtN(r.nominal, dec > 3 ? 2 : 1), fmtN(r.referencia, dec), fmtN(r.media, dec), fmtN(r.error, dec), "± " + fmtN(r.uExp, dec), fmtN(r.repetibilidad, dec)].map((v, j) => (
                                <td key={j} className="num" style={BLUE}>{v}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {rp && <p style={{ fontSize: 12, color: "var(--muted)" }}>Mayor error en el punto {fmtN(rp.nominal, dec > 3 ? 2 : 1)} {u}.</p>}
                    </div>
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
