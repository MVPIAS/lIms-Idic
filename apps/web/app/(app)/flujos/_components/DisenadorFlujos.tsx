"use client";

/**
 * Diseñador de flujos · LIMS IDIC (contratos 4.1.5, 4.3.1 y 4.5.1).
 *
 * Módulo de DISEÑO y SIMULACIÓN de flujos, independiente de la operación: los
 * circuitos con los que trabajan hoy los laboratorios están programados (Matriz
 * de firmas y pasos por método) y no cambian por lo que se diseñe aquí.
 *
 *  · Flujos con sus etapas (tipo, actividad y plazo), transiciones (con
 *    condición para las decisiones) y versiones: guardar crea una versión nueva
 *    en borrador; publicar la deja vigente y archiva la anterior.
 *  · Simular recorre una versión (borrador o publicada) con datos PRUEBA: sin
 *    OT y sin tareas en ninguna bandeja. Las variables de las condiciones se
 *    eligen al empezar y al completar cada paso.
 *  · Ver: flujo.ver. Guardar y simular: flujo.editar. Publicar: flujo.publicar.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { usePermisos } from "@/lib/permisos";
import { fechaHora } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { confirmar, toast } from "@/components/ui/feedback";

type Paso = { tmpId: string; numero: number; tipo: string; actividad: string; slaMinutos?: number | null };
type Trans = { origenTmp: string; destinoTmp: string; etiqueta?: string | null; condicion?: string | null };
type VersionRes = { id: string; version: string; estado: string | null; vigenteDesde: string | null; publicadoAt: string | null; notasCambio: string | null; _count?: { pasos: number } };
type Def = { id: string; codigo: string; nombre: string; versiones?: { id: string; version: string; estado: string | null }[] };

const TIPOS = ["INICIO", "ACTIVIDAD", "AUTO", "DECISION", "ESPERA", "FIN"] as const;
const NOMBRE_TIPO: Record<string, string> = {
  INICIO: "Inicio", ACTIVIDAD: "Actividad (persona)", AUTO: "Automático", DECISION: "Decisión", ESPERA: "Espera", FIN: "Fin", SUBPROCESO: "Subproceso",
};
const COLOR: Record<string, string> = {
  INICIO: "#16a34a", ACTIVIDAD: "#2563eb", AUTO: "#0d9488", DECISION: "#d97706", ESPERA: "#7c3aed", FIN: "#dc2626", SUBPROCESO: "#7c3aed",
};
const ESTADO_PILL: Record<string, string> = { publicado: "teal", borrador: "blue", archivado: "gray" };
const ESTADO_TXT: Record<string, string> = { publicado: "Publicada", borrador: "Borrador", archivado: "Archivada" };
const ESTADO_INST: Record<string, string> = { en_ejecucion: "En curso", completado: "Terminada", iniciado: "Iniciada" };
const ESTADO_PASO: Record<string, string> = { pendiente: "Pendiente", completado: "Hecho" };

/** Minutos → texto «2 d 4 h», «6 h», «30 min». */
function plazoTexto(min?: number | null): string {
  if (!min) return "sin plazo";
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  return [d ? `${d} d` : "", h ? `${h} h` : "", m ? `${m} min` : ""].filter(Boolean).join(" ");
}

/** Variables que usan las condiciones (para pedir su valor al simular). */
function variablesDe(trans: Trans[]): string[] {
  const s = new Set<string>();
  for (const t of trans)
    for (const parte of (t.condicion ?? "").split(/&&|\|\|/)) {
      const m = parte.trim().match(/^([\w.]+)\s*(==|!=|>=|<=|>|<)/);
      if (m) s.add(m[1]);
    }
  return [...s];
}

/** «true»/«false»/número → su tipo; el resto, texto. */
function valorDe(v: string): unknown {
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}


export default function DisenadorFlujos() {
  const { puede } = usePermisos();
  const edita = puede("flujo.editar");
  const publica = puede("flujo.publicar");
  const [defs, setDefs] = useState<Def[]>([]);
  const [pasos, setPasos] = useState<Paso[]>([]);
  const [trans, setTrans] = useState<Trans[]>([]);
  const [meta, setMeta] = useState({ codigo: "", nombre: "", versionId: "", version: "", estado: "", notas: "" });
  const [versiones, setVersiones] = useState<VersionRes[]>([]);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [sucio, setSucio] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [simulacion, setSimulacion] = useState<any | null>(null);
  const [vars, setVars] = useState<Record<string, string>>({});

  const cargarDefs = useCallback(async () => {
    try {
      setDefs(await api.getRaw<Def[]>("flujos"));
    } catch (e: any) {
      toast.error(e.message);
    }
  }, []);
  useEffect(() => { cargarDefs(); }, [cargarDefs]);

  const cargarVersiones = useCallback(async (codigo: string) => {
    try {
      setVersiones(await api.getRaw<VersionRes[]>(`flujos/codigo/${encodeURIComponent(codigo)}/versiones`));
    } catch {
      setVersiones([]);
    }
  }, []);

  /** Carga una versión (por id) o la vigente del flujo (por código) en el editor. */
  function cargarEnEditor(v: any) {
    setSimulacion(null);
    setAvisos([]);
    setSucio(false);
    setMeta({ codigo: v.def.codigo, nombre: v.def.nombre, versionId: v.id, version: v.version, estado: v.estado ?? "", notas: v.notasCambio ?? "" });
    const porId: Record<string, string> = {};
    setPasos(v.pasos.map((p: any) => {
      porId[p.id] = p.bpmnElementId;
      return { tmpId: p.bpmnElementId, numero: p.numero, tipo: p.tipo, actividad: p.actividad, slaMinutos: p.slaMinutos };
    }));
    setTrans(v.transiciones.map((t: any) => ({ origenTmp: porId[t.origenPasoId], destinoTmp: porId[t.destinoPasoId], etiqueta: t.etiqueta, condicion: t.condicion })));
  }

  async function abrir(codigo: string) {
    try {
      cargarEnEditor(await api.getRaw(`flujos/codigo/${encodeURIComponent(codigo)}`));
      cargarVersiones(codigo);
    } catch (e: any) {
      toast.error(e.message);
    }
  }
  async function abrirVersion(id: string) {
    try {
      cargarEnEditor(await api.getRaw(`flujos/version/${id}`));
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  function nuevoFlujo() {
    setSimulacion(null);
    setAvisos([]);
    setVersiones([]);
    setSucio(true);
    setMeta({ codigo: "FLU-PRUEBA", nombre: "Flujo PRUEBA", versionId: "", version: "", estado: "", notas: "" });
    setPasos([
      { tmpId: "p1", numero: 1, tipo: "INICIO", actividad: "Recepción de la solicitud" },
      { tmpId: "p2", numero: 2, tipo: "ACTIVIDAD", actividad: "Revisión", slaMinutos: 1440 },
      { tmpId: "fin", numero: 3, tipo: "FIN", actividad: "Cierre" },
    ]);
    setTrans([{ origenTmp: "p1", destinoTmp: "p2" }, { origenTmp: "p2", destinoTmp: "fin" }]);
  }

  const cambiarPasos = (p: Paso[]) => { setPasos(p); setSucio(true); };
  const cambiarTrans = (t: Trans[]) => { setTrans(t); setSucio(true); };

  function agregarPaso() {
    const tmpId = `p${Date.now() % 1000000}`;
    // Se inserta antes del primer FIN y se enlaza con el último paso que no es FIN.
    const iFin = pasos.findIndex((p) => p.tipo === "FIN");
    const nuevo: Paso = { tmpId, numero: 0, tipo: "ACTIVIDAD", actividad: "Nueva etapa", slaMinutos: null };
    const lista = iFin >= 0 ? [...pasos.slice(0, iFin), nuevo, ...pasos.slice(iFin)] : [...pasos, nuevo];
    cambiarPasos(lista.map((p, i) => ({ ...p, numero: i + 1 })));
    const previo = [...pasos.slice(0, iFin >= 0 ? iFin : pasos.length)].reverse().find((p) => p.tipo !== "FIN");
    if (previo) cambiarTrans([...trans, { origenTmp: previo.tmpId, destinoTmp: tmpId }]);
  }
  function actualizarPaso(i: number, cambio: Partial<Paso>) {
    cambiarPasos(pasos.map((p, j) => (j === i ? { ...p, ...cambio } : p)));
  }
  function eliminarPaso(i: number) {
    const p = pasos[i];
    cambiarPasos(pasos.filter((_, j) => j !== i).map((x, j) => ({ ...x, numero: j + 1 })));
    cambiarTrans(trans.filter((t) => t.origenTmp !== p.tmpId && t.destinoTmp !== p.tmpId));
  }
  function moverPaso(i: number, d: -1 | 1) {
    const j = i + d;
    if (j < 0 || j >= pasos.length) return;
    const c = [...pasos];
    [c[i], c[j]] = [c[j], c[i]];
    cambiarPasos(c.map((x, k) => ({ ...x, numero: k + 1 })));
  }
  const actualizarTrans = (i: number, cambio: Partial<Trans>) => cambiarTrans(trans.map((t, j) => (j === i ? { ...t, ...cambio } : t)));

  async function guardar() {
    setOcupado(true);
    try {
      const r = await api.post<any>("/flujos", {
        codigo: meta.codigo.trim(),
        nombre: meta.nombre.trim(),
        notasCambio: meta.notas,
        pasos: pasos.map((p, i) => ({ ...p, numero: i + 1 })),
        transiciones: trans.map((t, i) => ({ ...t, orden: i })),
      });
      setMeta({ ...meta, versionId: r.versionId, version: r.version, estado: r.estado });
      setAvisos(r.avisos ?? []);
      setSucio(false);
      toast.ok(`Guardado como versión ${r.version} (borrador). La versión publicada no cambia hasta publicar esta.`);
      cargarDefs();
      cargarVersiones(meta.codigo.trim());
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  }

  async function publicar() {
    if (!meta.versionId || sucio) return toast.error("Guarde primero los cambios: se publica una versión guardada.");
    if (!(await confirmar({ titulo: `¿Publicar la versión ${meta.version}?`, mensaje: `Queda como versión publicada de ${meta.codigo}; la publicada anterior queda archivada. Los circuitos operativos de los laboratorios no cambian.`, confirmarTexto: "Publicar" }))) return;
    setOcupado(true);
    try {
      await api.post(`/flujos/version/${meta.versionId}/publicar`, {});
      setMeta({ ...meta, estado: "publicado" });
      toast.ok(`Versión ${meta.version} publicada.`);
      cargarDefs();
      cargarVersiones(meta.codigo);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  }

  const variables = useMemo(() => variablesDe(trans), [trans]);
  const valores = () => Object.fromEntries(variables.map((v) => [v, valorDe(vars[v] ?? "true")]));

  async function simular() {
    if (!meta.versionId || sucio) return toast.error("Guarde primero los cambios: se simula una versión guardada.");
    setOcupado(true);
    try {
      setSimulacion(await api.post(`/flujos/version/${meta.versionId}/simular`, { variables: valores() }));
      toast.ok("Simulación iniciada con datos PRUEBA. Complete los pasos pendientes para avanzar.");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  }
  async function completar(peId: string) {
    setOcupado(true);
    try {
      setSimulacion(await api.post(`/flujos/simulacion/${peId}/completar`, { resultado: valores() }));
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  }

  const nombrePaso = (id: string) => pasos.find((p) => p.tmpId === id)?.actividad ?? id;
  const hayEditor = pasos.length > 0;

  return (
    <div>
      <PageHeader
        icono="⛓"
        titulo="Diseñador de flujos"
        subtitulo="Diseño y simulación de flujos de trabajo: etapas, transiciones, decisiones, plazos por etapa y versiones."
        migas={[{ label: "Administración" }, { label: "Diseñador de flujos" }]}
      />
      <div className="alert info" role="note">
        Este es un <b>módulo de diseño y simulación de flujos</b>. Los circuitos con los que trabajan hoy los laboratorios
        están definidos en la{" "}
        <Link href={"/admin/firmas" as any}>Matriz de firmas</Link> (revisión, aprobación y firma de cada documento) y en los{" "}
        <Link href={"/catalogo/pasos" as any}>Pasos por método</Link> (etapas de cada ensayo); el avance de cada OT se ve en su
        «Ruta de la OT». Lo que se diseñe, publique o simule aquí no cambia esos circuitos. Las simulaciones usan datos PRUEBA y no
        crean tareas en ninguna bandeja.
      </div>

      <div className="card" style={{ display: "grid", gridTemplateColumns: "minmax(200px, 260px) minmax(0, 1fr)", gap: 16, padding: 14 }}>
        <aside style={{ borderRight: "1px solid var(--border)", paddingRight: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ fontSize: 14, margin: 0 }}>Flujos</h2>
            {edita && <button type="button" onClick={nuevoFlujo} className="btn outline sm">＋ Nuevo flujo</button>}
          </div>
          <ul style={{ listStyle: "none", padding: 0, marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
            {defs.map((d) => (
              <li key={d.id}>
                <button type="button" onClick={() => abrir(d.codigo)} className="btn outline sm"
                  style={{ width: "100%", textAlign: "left", display: "block", fontWeight: meta.codigo === d.codigo ? 700 : 400 }}>
                  <span className="codigo" style={{ fontSize: 11 }}>{d.codigo}</span><br />
                  {d.nombre}
                  {d.versiones?.[0] && (
                    <small style={{ display: "block", color: "var(--muted)" }}>
                      Última: {d.versiones[0].version} · {ESTADO_TXT[d.versiones[0].estado ?? ""] ?? d.versiones[0].estado}
                    </small>
                  )}
                </button>
              </li>
            ))}
            {defs.length === 0 && <li style={{ color: "var(--muted)", fontSize: 12 }}>No hay flujos diseñados.</li>}
          </ul>
        </aside>

        <main style={{ minWidth: 0 }}>
          {!hayEditor ? (
            <p style={{ color: "var(--muted)" }}>Elija un flujo de la lista{edita ? " o pulse «＋ Nuevo flujo»" : ""} para ver sus etapas, transiciones y versiones.</p>
          ) : (
            <>
              <div className="form-grid cols-3">
                <div className="field">
                  <label htmlFor="fl-codigo">Código</label>
                  <input id="fl-codigo" value={meta.codigo} readOnly={!edita} maxLength={40}
                    onChange={(e) => { setMeta({ ...meta, codigo: e.target.value }); setSucio(true); }} style={{ fontFamily: "monospace" }} />
                </div>
                <div className="field">
                  <label htmlFor="fl-nombre">Nombre del flujo</label>
                  <input id="fl-nombre" value={meta.nombre} readOnly={!edita} maxLength={200}
                    onChange={(e) => { setMeta({ ...meta, nombre: e.target.value }); setSucio(true); }} />
                </div>
                <div className="field">
                  <label>Versión en pantalla</label>
                  <div style={{ paddingTop: 6 }}>
                    {meta.versionId ? (
                      <><b>{meta.version}</b> <span className={`pill ${ESTADO_PILL[meta.estado] ?? "gray"}`}>{ESTADO_TXT[meta.estado] ?? meta.estado}</span></>
                    ) : <span style={{ color: "var(--muted)" }}>sin guardar</span>}
                    {sucio && <small style={{ color: "var(--warn, #b45309)", marginLeft: 6 }}>cambios sin guardar</small>}
                  </div>
                </div>
              </div>
              {edita && (
                <div className="field">
                  <label htmlFor="fl-notas">Notas del cambio (opcional)</label>
                  <input id="fl-notas" value={meta.notas} maxLength={500} onChange={(e) => setMeta({ ...meta, notas: e.target.value })} />
                </div>
              )}

              <div className="toolbar" style={{ flexWrap: "wrap", marginTop: 8 }}>
                {edita && <button type="button" onClick={agregarPaso} className="btn outline sm" disabled={ocupado}>＋ Etapa</button>}
                {edita && <button type="button" onClick={guardar} className="btn primary sm" disabled={ocupado}>Guardar como nueva versión</button>}
                {publica && <button type="button" onClick={publicar} className="btn outline sm" disabled={ocupado || !meta.versionId || meta.estado === "publicado"}>Publicar versión</button>}
                {edita && <button type="button" onClick={simular} className="btn outline sm" disabled={ocupado || !meta.versionId}>▶ Simular con datos PRUEBA</button>}
              </div>
              {avisos.length > 0 && (
                <div className="alert warn" role="alert">
                  <b>Guardado, pero aún no se puede publicar ni simular:</b>
                  <ul style={{ margin: "4px 0 0 18px" }}>{avisos.map((a) => <li key={a}>{a}</li>)}</ul>
                </div>
              )}

              <h3 style={{ fontSize: 13, margin: "14px 0 4px" }}>Etapas</h3>
              <div style={{ display: "flex", overflowX: "auto", padding: "8px 2px", alignItems: "stretch" }}>
                {pasos.map((p, i) => (
                  <div key={p.tmpId} style={{ display: "flex", alignItems: "center" }}>
                    <div style={{ border: `2px solid ${COLOR[p.tipo] ?? "#6b7280"}`, borderRadius: p.tipo === "DECISION" ? 22 : 10, padding: "8px 10px", width: 190, background: "var(--card, #fff)" }}>
                      <select aria-label={`Tipo de la etapa ${i + 1}`} value={p.tipo} disabled={!edita} onChange={(e) => actualizarPaso(i, { tipo: e.target.value })}
                        style={{ fontSize: 11, color: COLOR[p.tipo], fontWeight: 700, border: "none", background: "transparent", padding: 0 }}>
                        {TIPOS.map((t) => <option key={t} value={t}>{NOMBRE_TIPO[t]}</option>)}
                      </select>
                      <textarea aria-label={`Actividad de la etapa ${i + 1}`} value={p.actividad} readOnly={!edita} rows={2} maxLength={300}
                        onChange={(e) => actualizarPaso(i, { actividad: e.target.value })}
                        style={{ width: "100%", fontSize: 12, resize: "none", marginTop: 4 }} />
                      {!["INICIO", "FIN", "AUTO", "DECISION"].includes(p.tipo) || p.slaMinutos ? (
                        <label style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 4, marginTop: 4 }}>
                          Plazo (horas)
                          <input type="number" min={0} step={1} value={p.slaMinutos ? Math.round(p.slaMinutos / 60) : ""} readOnly={!edita}
                            onChange={(e) => actualizarPaso(i, { slaMinutos: e.target.value === "" ? null : Math.max(0, Math.round(Number(e.target.value))) * 60 })}
                            style={{ width: 70, fontSize: 11, padding: "2px 6px" }} />
                        </label>
                      ) : null}
                      <small style={{ color: "var(--muted)" }}>{plazoTexto(p.slaMinutos)}</small>
                      {edita && (
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 2, marginTop: 4 }}>
                          <button type="button" className="btn link sm" title="Mover a la izquierda" onClick={() => moverPaso(i, -1)} disabled={i === 0}>◀</button>
                          <button type="button" className="btn link sm" title="Mover a la derecha" onClick={() => moverPaso(i, 1)} disabled={i === pasos.length - 1}>▶</button>
                          <button type="button" className="btn link sm" title="Quitar la etapa" style={{ color: "#dc2626" }} onClick={() => eliminarPaso(i)}>Quitar</button>
                        </div>
                      )}
                    </div>
                    {i < pasos.length - 1 && <span aria-hidden style={{ padding: "0 6px", color: "var(--muted)", fontSize: 18 }}>→</span>}
                  </div>
                ))}
              </div>

              <div className="toolbar" style={{ marginTop: 10, marginBottom: 4 }}>
                <h3 style={{ fontSize: 13, margin: 0 }}>Transiciones</h3>
                {edita && (
                  <button type="button" className="btn outline sm"
                    onClick={() => pasos.length && cambiarTrans([...trans, { origenTmp: pasos[0].tmpId, destinoTmp: pasos[pasos.length - 1].tmpId }])}>
                    ＋ Transición
                  </button>
                )}
              </div>
              <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 6px" }}>
                Desde cada etapa se sigue la primera transición cuya condición se cumpla; la que no tiene condición es el camino por
                defecto. Condiciones: «variable == valor» (también !=, &gt;, &lt;, &gt;=, &lt;=, &amp;&amp; y ||), p. ej. «cumple == true».
              </p>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Desde</th><th>Hacia</th><th>Etiqueta</th><th>Condición</th><th></th></tr></thead>
                  <tbody>
                    {trans.map((t, i) => (
                      <tr key={i}>
                        <td>
                          {edita ? (
                            <select aria-label="Etapa de origen" value={t.origenTmp} onChange={(e) => actualizarTrans(i, { origenTmp: e.target.value })}>
                              {pasos.map((p) => <option key={p.tmpId} value={p.tmpId}>{p.numero}. {p.actividad}</option>)}
                            </select>
                          ) : nombrePaso(t.origenTmp)}
                        </td>
                        <td>
                          {edita ? (
                            <select aria-label="Etapa de destino" value={t.destinoTmp} onChange={(e) => actualizarTrans(i, { destinoTmp: e.target.value })}>
                              {pasos.map((p) => <option key={p.tmpId} value={p.tmpId}>{p.numero}. {p.actividad}</option>)}
                            </select>
                          ) : nombrePaso(t.destinoTmp)}
                        </td>
                        <td><input aria-label="Etiqueta" value={t.etiqueta ?? ""} readOnly={!edita} maxLength={60} onChange={(e) => actualizarTrans(i, { etiqueta: e.target.value })} style={{ width: 90 }} /></td>
                        <td><input aria-label="Condición" value={t.condicion ?? ""} readOnly={!edita} placeholder="(camino por defecto)" onChange={(e) => actualizarTrans(i, { condicion: e.target.value || null })} style={{ width: 200, fontFamily: "monospace" }} /></td>
                        <td>{edita && <button type="button" className="btn link sm" style={{ color: "#dc2626" }} onClick={() => cambiarTrans(trans.filter((_, j) => j !== i))}>Quitar</button>}</td>
                      </tr>
                    ))}
                    {trans.length === 0 && <tr><td colSpan={5} style={{ color: "var(--muted)" }}>Sin transiciones.</td></tr>}
                  </tbody>
                </table>
              </div>

              {versiones.length > 0 && (
                <>
                  <h3 style={{ fontSize: 13, margin: "14px 0 4px" }}>Versiones</h3>
                  <div className="table-wrap">
                    <table className="table">
                      <thead><tr><th>Versión</th><th>Estado</th><th>Etapas</th><th>Publicada</th><th>Notas</th><th></th></tr></thead>
                      <tbody>
                        {versiones.map((v) => (
                          <tr key={v.id}>
                            <td><b>{v.version}</b></td>
                            <td><span className={`pill ${ESTADO_PILL[v.estado ?? ""] ?? "gray"}`}>{ESTADO_TXT[v.estado ?? ""] ?? v.estado}</span></td>
                            <td>{v._count?.pasos ?? "—"}</td>
                            <td>{v.publicadoAt ?? v.vigenteDesde ? fechaHora(v.publicadoAt ?? v.vigenteDesde) : "—"}</td>
                            <td>{v.notasCambio ?? "—"}</td>
                            <td><button type="button" className="btn link sm" onClick={() => abrirVersion(v.id)} disabled={v.id === meta.versionId}>{v.id === meta.versionId ? "En pantalla" : "Abrir"}</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {edita && meta.versionId && (
                <div className="card" style={{ marginTop: 14, padding: 12 }}>
                  <h3 style={{ fontSize: 13, margin: "0 0 6px" }}>Simulación con datos PRUEBA</h3>
                  {variables.length > 0 ? (
                    <div className="form-grid cols-3">
                      {variables.map((v) => (
                        <div className="field" key={v}>
                          <label htmlFor={`fl-var-${v}`}>Valor de «{v}»</label>
                          <input id={`fl-var-${v}`} list="fl-valores" value={vars[v] ?? "true"} onChange={(e) => setVars({ ...vars, [v]: e.target.value })} />
                        </div>
                      ))}
                      <datalist id="fl-valores"><option value="true" /><option value="false" /></datalist>
                    </div>
                  ) : (
                    <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>Este flujo no tiene condiciones: la simulación recorre las etapas en orden.</p>
                  )}
                  <small style={{ color: "var(--muted)" }}>Los valores se usan al empezar y al completar cada etapa; cámbielos antes de completar para probar otro camino.</small>
                  {simulacion && (
                    <div style={{ marginTop: 10 }}>
                      <b>Simulación {String(simulacion.id).slice(0, 8)} · {ESTADO_INST[simulacion.estado] ?? simulacion.estado}</b>
                      <ol style={{ marginTop: 6, fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
                        {simulacion.ejecuciones?.map((e: any) => (
                          <li key={e.id}>
                            <span style={{ color: COLOR[e.paso?.tipo] ?? "inherit", fontWeight: 600 }}>{NOMBRE_TIPO[e.paso?.tipo] ?? e.paso?.tipo}</span>{" "}
                            {e.paso?.actividad} — <em>{ESTADO_PASO[e.estado] ?? e.estado}</em>
                            {e.paso?.slaMinutos ? <small style={{ color: "var(--muted)" }}> · plazo {plazoTexto(e.paso.slaMinutos)}</small> : null}
                            {e.excedioSla ? <small style={{ color: "#dc2626" }}> · fuera de plazo</small> : null}
                            {e.estado === "pendiente" && (
                              <button type="button" className="btn primary sm" style={{ marginLeft: 8 }} disabled={ocupado} onClick={() => completar(e.id)}>Completar etapa</button>
                            )}
                          </li>
                        ))}
                      </ol>
                      {simulacion.estado === "completado" && <div className="alert success">La simulación llegó a un paso FIN.</div>}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
