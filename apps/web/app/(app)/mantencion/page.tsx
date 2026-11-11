"use client";

// ===========================================================================
// Mantención y gestión de equipos (contrato §4.4.3). Tres pestañas:
//   · Plan preventivo: tareas por equipo con frecuencia y próxima fecha; se
//     registra lo ejecutado (corre la próxima fecha) o una correctiva (falla
//     fuera del plan), y se consulta el historial del equipo (mantenciones y
//     calibraciones). Un resultado «no conforme» deja el equipo fuera de servicio;
//   · Calendario: calibraciones y mantenciones programadas en el rango;
//   · Reporte de gestión: cumplimiento del plan, atrasos, costos y
//     calibraciones vencidas, con descarga en Excel.
// Las reglas viven en el servidor: apps/api/src/equipos/mantencion.module.ts.
// ===========================================================================

import { MESES_LARGOS } from "@/lib/bpchProcesos";
import { useCallback, useEffect, useState } from "react";
import { llamar, qs } from "@/lib/laboratorio";
import { descargarAdjunto } from "@/lib/d11";
import { hoyChile } from "@/lib/fecha-chile";
import { usePermisos } from "@/lib/permisos";
import { toast } from "@/components/ui/feedback";
import { ESTADO_EQUIPO_META } from "@/lib/equipos";

type Pestana = "plan" | "programas" | "calendario" | "reporte";

const fechaCl = (f: string | null | undefined) => (f ? f.slice(0, 10).split("-").reverse().join("-") : "—");
const ESTADO: Record<string, { texto: string; pill: string }> = {
  vencido: { texto: "Vencida", pill: "red" },
  por_vencer: { texto: "Por vencer", pill: "amber" },
  al_dia: { texto: "Al día", pill: "green" },
  sin_fecha: { texto: "Sin plan", pill: "gray" },
};
const TIPO: Record<string, string> = { preventiva: "Preventiva", verificacion: "Verificación", limpieza: "Limpieza", calibracion: "Calibración", correctiva: "Correctiva" };
const clp = (n: number | null | undefined) => (n == null ? "—" : `$${Math.round(n).toLocaleString("es-CL")}`);
const RESULTADO: Record<string, { texto: string; pill: string }> = {
  conforme: { texto: "Conforme", pill: "green" },
  conforme_con_obs: { texto: "Conforme con observaciones", pill: "amber" },
  no_conforme: { texto: "No conforme", pill: "red" },
};
const pillResultado = (r: string | null | undefined) => (r ? <span className={`pill ${RESULTADO[r]?.pill ?? "gray"}`}>{RESULTADO[r]?.texto ?? r}</span> : "—");
const pillEstadoEquipo = (e: { estado: string; estadoTexto?: string }) => (
  <span className={`pill ${ESTADO_EQUIPO_META[e.estado]?.pill ?? "gray"}`}>{e.estadoTexto || ESTADO_EQUIPO_META[e.estado]?.label || e.estado}</span>
);

export default function MantencionPage() {
  const [pestana, setPestana] = useState<Pestana>("plan");
  const tab = (id: Pestana, t: string) => (
    <button type="button" role="tab" aria-selected={pestana === id} className={`tab${pestana === id ? " active" : ""}`} onClick={() => setPestana(id)}>{t}</button>
  );
  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page">Mantención y gestión de equipos</h1>
          <p className="subtitle">Plan de mantención preventiva por equipo, calendario de calibraciones y mantenciones, y reporte de gestión con su cumplimiento.</p>
        </div>
      </div>
      <div className="tabs" role="tablist" style={{ marginBottom: 12 }}>
        {tab("plan", "Plan preventivo")}
        {tab("programas", "Programas auditables")}
        {tab("calendario", "Calendario")}
        {tab("reporte", "Reporte de gestión")}
      </div>
      {pestana === "plan" && <Plan />}
      {pestana === "programas" && <Programas />}
      {pestana === "calendario" && <Calendario />}
      {pestana === "reporte" && <Reporte />}
    </div>
  );
}

/* ================================================================= plan === */

const CORRECTIVA_VACIA = { equipoId: "", fecha: "", ejecutadaPor: "", descripcion: "", resultado: "conforme", costo: "", observaciones: "" };
const PLAN_VACIO = { id: "", equipoId: "", tipo: "preventiva", descripcion: "", frecuenciaDias: "180", proximaFecha: "", proveedor: "", programaId: "" };

function Plan() {
  const { puede } = usePermisos();
  const gestiona = puede("equipo.gestionar");
  const [planes, setPlanes] = useState<any[] | null>(null);
  const [equipos, setEquipos] = useState<any[]>([]);
  const [filtro, setFiltro] = useState("");
  const [form, setForm] = useState<typeof PLAN_VACIO | null>(null);
  const [ejecutando, setEjecutando] = useState<any | null>(null);
  const [ej, setEj] = useState({ fecha: "", ejecutadaPor: "", resultado: "conforme", costo: "", observaciones: "" });
  const [correctiva, setCorrectiva] = useState<typeof CORRECTIVA_VACIA | null>(null);
  const [historial, setHistorial] = useState<string | null>(null);
  // Programas en borrador a los que se puede vincular una tarea (Químico, R5).
  const [programas, setProgramas] = useState<any[]>([]);
  useEffect(() => {
    llamar<any[]>("GET", "/mantencion/programas").then((r) => setProgramas(r ?? [])).catch(() => setProgramas([]));
  }, []);
  const cargar = useCallback(async () => {
    try {
      setPlanes(await llamar<any[]>("GET", `/mantencion/planes${qs({ estado: filtro || undefined })}`));
    } catch (e: any) {
      toast.error(e.message);
    }
  }, [filtro]);
  useEffect(() => {
    cargar();
  }, [cargar]);
  useEffect(() => {
    llamar<any>("GET", "/equipos?limit=500").then((r) => setEquipos(r?.data ?? r ?? [])).catch(() => setEquipos([]));
  }, []);

  const guardar = async () => {
    if (!form) return;
    try {
      const datos = { ...form, frecuenciaDias: Number(form.frecuenciaDias), programaId: form.programaId || null };
      if (form.id) await llamar("PATCH", `/mantencion/planes/${form.id}`, datos);
      else await llamar("POST", "/mantencion/planes", datos);
      toast.ok("Plan guardado.");
      setForm(null);
      cargar();
    } catch (e: any) {
      toast.error(e.message);
    }
  };
  const ejecutar = async () => {
    try {
      const r = await llamar<any>("POST", `/mantencion/planes/${ejecutando.id}/ejecutar`, { ...ej, costo: ej.costo || null });
      toast.ok(`Mantención registrada. Próxima: ${fechaCl(r.proximaFecha)}.${r.fueraDeServicio ? " El equipo quedó fuera de servicio." : ""}`);
      setEjecutando(null);
      cargar();
    } catch (e: any) {
      toast.error(e.message);
    }
  };
  const registrarCorrectiva = async () => {
    if (!correctiva) return;
    try {
      const r = await llamar<any>("POST", `/mantencion/equipos/${correctiva.equipoId}/correctiva`, { ...correctiva, costo: correctiva.costo || null });
      toast.ok(`Mantención correctiva registrada.${r?.fueraDeServicio ? " El equipo quedó fuera de servicio." : ""}`);
      const equipoId = correctiva.equipoId;
      setCorrectiva(null);
      setHistorial(equipoId);
      cargar();
    } catch (e: any) {
      toast.error(e.message);
    }
  };
  const baja = async (p: any) => {
    if (!window.confirm(`¿Dar de baja el plan «${p.descripcion}» de ${p.equipoCodigo}?`)) return;
    try {
      await llamar("DELETE", `/mantencion/planes/${p.id}`);
      cargar();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <>
      <section className="card" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label htmlFor="pl-f" style={{ fontSize: 13 }}>Ver</label>
        <select id="pl-f" value={filtro} onChange={(e) => setFiltro(e.target.value)} style={{ width: "auto" }}>
          <option value="">Todos los planes</option>
          <option value="vencido">Vencidos</option>
          <option value="por_vencer">Por vencer (30 días)</option>
          <option value="al_dia">Al día</option>
        </select>
        <span style={{ flex: 1 }} />
        <select aria-label="Equipo para ver su historial" value="" onChange={(e) => e.target.value && setHistorial(e.target.value)} style={{ width: "auto" }}>
          <option value="">Historial de un equipo…</option>
          {equipos.map((e) => <option key={e.id} value={e.id}>{e.codigo} · {e.nombre ?? e.descripcion}</option>)}
        </select>
        {gestiona && !correctiva && <button className="btn sm" onClick={() => setCorrectiva({ ...CORRECTIVA_VACIA, fecha: hoyChile() })}>Registrar correctiva</button>}
        {gestiona && !form && <button className="btn primary sm" onClick={() => setForm({ ...PLAN_VACIO, proximaFecha: hoyChile() })}>Nueva tarea de mantención</button>}
      </section>
      {form && (
        <section className="card" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10, alignItems: "end" }}>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="pl-eq">Equipo</label>
            <select id="pl-eq" value={form.equipoId} disabled={!!form.id} onChange={(e) => setForm({ ...form, equipoId: e.target.value })}>
              <option value="">Elija…</option>
              {equipos.map((e) => <option key={e.id} value={e.id}>{e.codigo} · {e.nombre ?? e.descripcion}</option>)}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="pl-tipo">Tipo</label>
            <select id="pl-tipo" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
              <option value="preventiva">Preventiva</option>
              <option value="verificacion">Verificación intermedia</option>
              <option value="limpieza">Limpieza</option>
            </select>
          </div>
          <div className="field" style={{ margin: 0, gridColumn: "span 2" }}>
            <label htmlFor="pl-desc">Tarea</label>
            <input id="pl-desc" value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} placeholder="Ej.: cambio de lámpara y limpieza de óptica" maxLength={300} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="pl-frec">Cada (días)</label>
            <input id="pl-frec" inputMode="numeric" value={form.frecuenciaDias} onChange={(e) => setForm({ ...form, frecuenciaDias: e.target.value })} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="pl-prox">Próxima fecha</label>
            <input id="pl-prox" type="date" value={form.proximaFecha} onChange={(e) => setForm({ ...form, proximaFecha: e.target.value })} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="pl-prog">Programa auditable</label>
            <select id="pl-prog" value={form.programaId} onChange={(e) => setForm({ ...form, programaId: e.target.value })}>
              <option value="">(sin programa)</option>
              {programas.filter((g) => g.estado === "borrador" || g.id === form.programaId).map((g) => (
                <option key={g.id} value={g.id} disabled={g.estado !== "borrador"}>{g.codigo} · {g.anio}{g.estado !== "borrador" ? ` (${g.estado})` : ""}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="pl-prov">Proveedor (opcional)</label>
            <input id="pl-prov" value={form.proveedor} onChange={(e) => setForm({ ...form, proveedor: e.target.value })} maxLength={200} />
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn primary sm" onClick={guardar}>Guardar</button>
            <button className="btn outline sm" onClick={() => setForm(null)}>Cancelar</button>
          </div>
        </section>
      )}
      {correctiva && (
        <section className="card" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, alignItems: "end" }}>
          <h3 style={{ gridColumn: "1 / -1", margin: 0, fontSize: 15 }}>Registrar mantención correctiva (falla fuera del plan)</h3>
          <div className="field" style={{ margin: 0, gridColumn: "span 2" }}>
            <label htmlFor="co-eq">Equipo</label>
            <select id="co-eq" value={correctiva.equipoId} onChange={(e) => setCorrectiva({ ...correctiva, equipoId: e.target.value })}>
              <option value="">Elija…</option>
              {equipos.map((e) => <option key={e.id} value={e.id}>{e.codigo} · {e.nombre ?? e.descripcion}</option>)}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="co-f">Fecha en que se hizo</label>
            <input id="co-f" type="date" value={correctiva.fecha} max={hoyChile()} onChange={(e) => setCorrectiva({ ...correctiva, fecha: e.target.value })} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="co-por">Hecha por</label>
            <input id="co-por" value={correctiva.ejecutadaPor} onChange={(e) => setCorrectiva({ ...correctiva, ejecutadaPor: e.target.value })} maxLength={200} />
          </div>
          <div className="field" style={{ margin: 0, gridColumn: "1 / -1" }}>
            <label htmlFor="co-d">Falla y reparación</label>
            <input id="co-d" value={correctiva.descripcion} onChange={(e) => setCorrectiva({ ...correctiva, descripcion: e.target.value })} placeholder="Ej.: no enciende la lámpara; se reemplazó la fuente de poder" maxLength={2000} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="co-r">Resultado</label>
            <select id="co-r" value={correctiva.resultado} onChange={(e) => setCorrectiva({ ...correctiva, resultado: e.target.value })}>
              <option value="conforme">Conforme</option>
              <option value="conforme_con_obs">Conforme con observaciones</option>
              <option value="no_conforme">No conforme (equipo fuera de servicio)</option>
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="co-c">Costo (CLP)</label>
            <input id="co-c" inputMode="numeric" value={correctiva.costo} onChange={(e) => setCorrectiva({ ...correctiva, costo: e.target.value })} />
          </div>
          <div className="field" style={{ margin: 0, gridColumn: "1 / -1" }}>
            <label htmlFor="co-o">Observaciones</label>
            <input id="co-o" value={correctiva.observaciones} onChange={(e) => setCorrectiva({ ...correctiva, observaciones: e.target.value })} maxLength={2000} />
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn primary sm" disabled={!correctiva.equipoId || !correctiva.fecha || !correctiva.descripcion.trim()} onClick={registrarCorrectiva}>Registrar</button>
            <button className="btn outline sm" onClick={() => setCorrectiva(null)}>Cancelar</button>
          </div>
        </section>
      )}
      {historial && <HistorialEquipo equipoId={historial} onCerrar={() => setHistorial(null)} />}
      {ejecutando && (
        <section className="card" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, alignItems: "end" }}>
          <h3 style={{ gridColumn: "1 / -1", margin: 0, fontSize: 15 }}>Registrar · {ejecutando.equipoCodigo} · {ejecutando.descripcion} (programada {fechaCl(ejecutando.proximaFecha)})</h3>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="ej-f">Fecha en que se hizo</label>
            <input id="ej-f" type="date" value={ej.fecha} max={hoyChile()} onChange={(e) => setEj({ ...ej, fecha: e.target.value })} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="ej-por">Hecha por</label>
            <input id="ej-por" value={ej.ejecutadaPor} onChange={(e) => setEj({ ...ej, ejecutadaPor: e.target.value })} maxLength={200} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="ej-r">Resultado</label>
            <select id="ej-r" value={ej.resultado} onChange={(e) => setEj({ ...ej, resultado: e.target.value })}>
              <option value="conforme">Conforme</option>
              <option value="conforme_con_obs">Conforme con observaciones</option>
              <option value="no_conforme">No conforme (equipo fuera de servicio)</option>
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="ej-c">Costo (CLP)</label>
            <input id="ej-c" inputMode="numeric" value={ej.costo} onChange={(e) => setEj({ ...ej, costo: e.target.value })} />
          </div>
          <div className="field" style={{ margin: 0, gridColumn: "1 / -1" }}>
            <label htmlFor="ej-o">Observaciones</label>
            <input id="ej-o" value={ej.observaciones} onChange={(e) => setEj({ ...ej, observaciones: e.target.value })} maxLength={2000} />
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn primary sm" disabled={!ej.fecha} onClick={ejecutar}>Registrar</button>
            <button className="btn outline sm" onClick={() => setEjecutando(null)}>Cancelar</button>
          </div>
        </section>
      )}
      <section className="card">
        {!planes ? (
          <p>Cargando…</p>
        ) : !planes.length ? (
          <p style={{ margin: 0, color: "var(--muted)" }}>No hay tareas de mantención {filtro ? "en esta vista" : "planificadas"}.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead><tr><th>Equipo</th><th>Tarea</th><th>Cada</th><th>Próxima</th><th>Última</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                {planes.map((p) => (
                  <tr key={p.id}>
                    <td><b>{p.equipoCodigo}</b> {p.equipoNombre}<div style={{ fontSize: 11.5, color: "var(--muted)" }}>{p.laboratorio ?? "común"}</div></td>
                    <td>{TIPO[p.tipo] ?? p.tipo} · {p.descripcion}{p.proveedor ? <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{p.proveedor}</div> : null}
                      {p.programaCodigo ? <div style={{ fontSize: 11.5 }}><span className="pill teal">{p.programaCodigo}</span></div> : null}</td>
                    <td>{p.frecuenciaDias} días</td>
                    <td>{fechaCl(p.proximaFecha)}</td>
                    <td>{fechaCl(p.ultimaEjecucion)}</td>
                    <td><span className={`pill ${ESTADO[p.estado]?.pill ?? "gray"}`}>{ESTADO[p.estado]?.texto ?? p.estado}</span></td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button className="btn outline sm" onClick={() => setHistorial(p.equipoId)}>Historial</button>
                      {gestiona && (
                        <>
                        {" "}<button className="btn sm" onClick={() => { setEjecutando(p); setEj({ fecha: hoyChile(), ejecutadaPor: "", resultado: "conforme", costo: "", observaciones: "" }); }}>Registrar hecha</button>{" "}
                        <button className="btn outline sm" onClick={() => setForm({ ...PLAN_VACIO, ...p, frecuenciaDias: String(p.frecuenciaDias), proveedor: p.proveedor ?? "", programaId: p.programaId ?? "" })}>Editar</button>{" "}
                        <button className="btn outline sm" onClick={() => baja(p)}>Baja</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

/* ============================================================ programas === */

const ESTADO_PROGRAMA: Record<string, { texto: string; pill: string }> = {
  borrador: { texto: "Borrador", pill: "gray" },
  aprobado: { texto: "Aprobado", pill: "green" },
  cerrado: { texto: "Cerrado", pill: "blue" },
};
const PROGRAMA_VACIO = { id: "", codigo: "", nombre: "", anio: "", unidadId: "", documentoCodigo: "", observaciones: "" };

/**
 * Programas de mantención auditables (Químico, R5): registro del sistema de calidad
 * que agrupa los planes de un laboratorio y año. Aprobado ya no se modifica; cada
 * mantención ejecutada guarda su programa y aquí se ve el cumplimiento.
 */
function Programas() {
  const { puede } = usePermisos();
  const gestiona = puede("equipo.gestionar");
  const [lista, setLista] = useState<any[] | null>(null);
  const [labs, setLabs] = useState<{ id: string; codigo: string; nombre: string }[]>([]);
  const [form, setForm] = useState<typeof PROGRAMA_VACIO | null>(null);
  const [detalle, setDetalle] = useState<any | null>(null);
  const cargar = useCallback(async () => {
    try { setLista(await llamar<any[]>("GET", "/mantencion/programas")); } catch (e: any) { toast.error(e.message); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => {
    llamar<any>("GET", "/ot/laboratorios").then((r) => setLabs(Array.isArray(r) ? r : r?.data ?? [])).catch(() => setLabs([]));
  }, []);
  const guardar = async () => {
    if (!form) return;
    try {
      const datos = { ...form, anio: Number(form.anio), unidadId: form.unidadId || null };
      if (form.id) await llamar("PATCH", `/mantencion/programas/${form.id}`, datos);
      else await llamar("POST", "/mantencion/programas", datos);
      toast.ok("Programa guardado.");
      setForm(null);
      cargar();
    } catch (e: any) { toast.error(e.message); }
  };
  const estado = async (g: any, accion: "aprobar" | "cerrar") => {
    const texto = accion === "aprobar"
      ? `¿Aprobar el programa ${g.codigo}? Ya no se podrá modificar ni cambiar sus tareas: queda como evidencia de auditoría.`
      : `¿Cerrar el programa ${g.codigo}? Queda como evidencia con su cumplimiento.`;
    if (!window.confirm(texto)) return;
    try { await llamar("POST", `/mantencion/programas/${g.id}/${accion}`, {}); toast.ok(accion === "aprobar" ? "Programa aprobado." : "Programa cerrado."); cargar(); }
    catch (e: any) { toast.error(e.message); }
  };
  const ver = async (id: string) => {
    try { setDetalle(await llamar<any>("GET", `/mantencion/programas/${id}`)); } catch (e: any) { toast.error(e.message); }
  };
  return (
    <>
      <section className="card" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <p style={{ margin: 0, fontSize: 13, flex: 1 }}>
          Cada programa agrupa las tareas de mantención de un laboratorio en un año. Vincule las tareas en «Plan preventivo» mientras el programa está en borrador;
          al aprobarlo queda fijo y cada mantención registrada guarda su programa.
        </p>
        {gestiona && !form && <button className="btn primary sm" onClick={() => setForm({ ...PROGRAMA_VACIO, anio: hoyChile().slice(0, 4) })}>Nuevo programa</button>}
      </section>
      {form && (
        <section className="card" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10, alignItems: "end" }}>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="pg-cod">Código</label>
            <input id="pg-cod" value={form.codigo} maxLength={40} onChange={(e) => setForm({ ...form, codigo: e.target.value })} placeholder="Ej.: PM-LQC-2026" />
          </div>
          <div className="field" style={{ margin: 0, gridColumn: "span 2" }}>
            <label htmlFor="pg-nom">Nombre</label>
            <input id="pg-nom" value={form.nombre} maxLength={200} onChange={(e) => setForm({ ...form, nombre: e.target.value })} placeholder="Ej.: Programa anual de mantención de equipos" />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="pg-anio">Año</label>
            <input id="pg-anio" inputMode="numeric" value={form.anio} onChange={(e) => setForm({ ...form, anio: e.target.value })} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="pg-lab">Laboratorio</label>
            <select id="pg-lab" value={form.unidadId} disabled={!!form.id} onChange={(e) => setForm({ ...form, unidadId: e.target.value })}>
              <option value="">(común)</option>
              {labs.map((l) => <option key={l.id} value={l.id}>{l.codigo} · {l.nombre}</option>)}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="pg-doc">Código del registro de calidad</label>
            <input id="pg-doc" value={form.documentoCodigo} maxLength={60} onChange={(e) => setForm({ ...form, documentoCodigo: e.target.value })} placeholder="El del sistema de gestión" />
          </div>
          <div className="field" style={{ margin: 0, gridColumn: "1 / -1" }}>
            <label htmlFor="pg-obs">Observaciones</label>
            <input id="pg-obs" value={form.observaciones} maxLength={2000} onChange={(e) => setForm({ ...form, observaciones: e.target.value })} />
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn primary sm" onClick={guardar}>Guardar</button>
            <button className="btn outline sm" onClick={() => setForm(null)}>Cancelar</button>
          </div>
        </section>
      )}
      <section className="card">
        {!lista ? <p>Cargando…</p> : !lista.length ? (
          <p style={{ margin: 0, color: "var(--muted)" }}>No hay programas de mantención registrados.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead><tr><th>Programa</th><th>Año</th><th>Lab.</th><th>Tareas</th><th>Cumplimiento</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                {lista.map((g) => (
                  <tr key={g.id}>
                    <td><b>{g.codigo}</b> {g.nombre}{g.documentoCodigo ? <div style={{ fontSize: 11.5, color: "var(--muted)" }}>Registro {g.documentoCodigo}</div> : null}</td>
                    <td>{g.anio}</td>
                    <td>{g.laboratorio ?? "común"}</td>
                    <td>{g.planes}</td>
                    <td>{g.cumplimiento?.porcentaje == null ? "—" : `${String(g.cumplimiento.porcentaje).replace(".", ",")} %`}
                      <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{g.cumplimiento?.aTiempo ?? 0} a tiempo · {g.cumplimiento?.atrasadas ?? 0} atrasadas · {g.cumplimiento?.pendientes ?? 0} pendientes</div></td>
                    <td><span className={`pill ${ESTADO_PROGRAMA[g.estado]?.pill ?? "gray"}`}>{ESTADO_PROGRAMA[g.estado]?.texto ?? g.estado}</span>
                      {g.aprobadoPor ? <div style={{ fontSize: 11.5, color: "var(--muted)" }}>Aprobó {g.aprobadoPor}</div> : null}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button className="btn outline sm" onClick={() => ver(g.id)}>Ver</button>
                      {gestiona && g.estado === "borrador" && (<>{" "}<button className="btn outline sm" onClick={() => setForm({ ...PROGRAMA_VACIO, ...g, anio: String(g.anio), unidadId: g.unidadId ?? "", documentoCodigo: g.documentoCodigo ?? "", observaciones: g.observaciones ?? "" })}>Editar</button>{" "}<button className="btn sm" onClick={() => estado(g, "aprobar")}>Aprobar</button></>)}
                      {gestiona && g.estado === "aprobado" && (<>{" "}<button className="btn outline sm" onClick={() => estado(g, "cerrar")}>Cerrar</button></>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {detalle && (
        <section className="card">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <h3 style={{ margin: 0, fontSize: 15, flex: 1 }}>{detalle.programa.codigo} · {detalle.programa.nombre} ({detalle.programa.anio})</h3>
            <button className="btn outline sm" onClick={() => setDetalle(null)}>Cerrar</button>
          </div>
          <h4 style={{ fontSize: 13 }}>Tareas del programa</h4>
          {!detalle.planes.length ? <p style={{ color: "var(--muted)" }}>Sin tareas vinculadas.</p> : (
            <table className="table">
              <thead><tr><th>Equipo</th><th>Tarea</th><th>Cada</th><th>Próxima</th></tr></thead>
              <tbody>{detalle.planes.map((p: any) => <tr key={p.id}><td>{p.equipoCodigo} {p.equipoNombre}</td><td>{TIPO[p.tipo] ?? p.tipo} · {p.descripcion}{p.activo ? "" : " (de baja)"}</td><td>{p.frecuenciaDias} días</td><td>{fechaCl(p.proximaFecha)}</td></tr>)}</tbody>
            </table>
          )}
          <h4 style={{ fontSize: 13 }}>Mantenciones ejecutadas con este programa</h4>
          {!detalle.ejecutadas.length ? <p style={{ color: "var(--muted)" }}>Aún no hay mantenciones registradas.</p> : (
            <table className="table">
              <thead><tr><th>Equipo</th><th>Programada</th><th>Hecha</th><th>Resultado</th><th>Hecha por</th><th>Registró</th></tr></thead>
              <tbody>{detalle.ejecutadas.map((m: any) => <tr key={m.id}><td>{m.equipoCodigo}</td><td>{fechaCl(m.fechaProgramada)}</td><td>{fechaCl(m.fecha)}</td><td>{pillResultado(m.resultado)}</td><td>{m.ejecutadaPor ?? "—"}</td><td>{m.registradaPor ?? "—"}</td></tr>)}</tbody>
            </table>
          )}
        </section>
      )}
    </>
  );
}

/* ============================================================ historial === */

/** Historial del equipo: mantenciones (preventivas y correctivas) y calibraciones. */
function HistorialEquipo({ equipoId, onCerrar }: { equipoId: string; onCerrar: () => void }) {
  const [h, setH] = useState<any | null>(null);
  useEffect(() => {
    setH(null);
    llamar<any>("GET", `/mantencion/equipos/${equipoId}/historial`).then(setH).catch((e) => toast.error(e.message));
  }, [equipoId]);
  return (
    <section className="card">
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>Historial · {h ? `${h.equipo.codigo} · ${h.equipo.nombre ?? ""}` : "…"}</h3>
        <span style={{ flex: 1 }} />
        <button className="btn outline sm" onClick={onCerrar}>Cerrar</button>
      </div>
      {!h ? (
        <p style={{ margin: 0 }}>Cargando…</p>
      ) : (
        <>
          <h4 style={{ margin: "6px 0", fontSize: 13.5 }}>Mantenciones</h4>
          {!h.mantenciones.length ? (
            <p style={{ margin: 0, color: "var(--muted)" }}>Sin mantenciones registradas.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead><tr><th>Fecha</th><th>Tipo</th><th>Detalle</th><th>Hecha por</th><th>Resultado</th><th>Costo</th><th>Registró</th></tr></thead>
                <tbody>
                  {h.mantenciones.map((m: any) => (
                    <tr key={m.id}>
                      <td style={{ whiteSpace: "nowrap" }}>{fechaCl(m.fecha)}{m.fechaProgramada ? <div style={{ fontSize: 11.5, color: "var(--muted)" }}>programada {fechaCl(m.fechaProgramada)}</div> : null}</td>
                      <td>{TIPO[m.tipo] ?? m.tipo}</td>
                      <td>{m.descripcion ?? "—"}{m.observaciones ? <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{m.observaciones}</div> : null}</td>
                      <td>{m.ejecutadaPor ?? "—"}</td>
                      <td>{pillResultado(m.resultado)}</td>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>{clp(m.costo)}</td>
                      <td>{m.registradaPor ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <h4 style={{ margin: "12px 0 6px", fontSize: 13.5 }}>Calibraciones</h4>
          {!h.calibraciones.length ? (
            <p style={{ margin: 0, color: "var(--muted)" }}>Sin calibraciones registradas.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead><tr><th>Fecha</th><th>Hecha por</th><th>Resultado</th><th>Próxima</th><th>Certificado</th></tr></thead>
                <tbody>
                  {h.calibraciones.map((c: any) => (
                    <tr key={c.id}>
                      <td>{fechaCl(c.fecha)}</td>
                      <td>{c.ejecutadaPor ?? "—"}</td>
                      <td>{pillResultado(c.resultado)}</td>
                      <td>{fechaCl(c.proximaFecha)}</td>
                      <td>{c.certificado ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/* =========================================================== calendario === */

function Calendario() {
  const hoy = hoyChile();
  const [rango, setRango] = useState({ desde: hoy, hasta: "" });
  const [datos, setDatos] = useState<any | null>(null);
  const cargar = useCallback(async () => {
    try {
      setDatos(await llamar<any>("GET", `/mantencion/calendario${qs({ desde: rango.desde || undefined, hasta: rango.hasta || undefined })}`));
    } catch (e: any) {
      toast.error(e.message);
    }
  }, [rango]);
  useEffect(() => {
    cargar();
  }, [cargar]);
  const meses = new Map<string, any[]>();
  for (const e of datos?.eventos ?? []) {
    const k = e.fecha.slice(0, 7);
    (meses.get(k) ?? meses.set(k, []).get(k)!).push(e);
  }
  // «2027-01» → «Enero de 2027» (solo la inicial en mayúscula; capitalize dejaba «Enero De 2027»).
  const nombreMes = (k: string) => {
    const mes = MESES_LARGOS[Number(k.slice(5, 7)) - 1] ?? k;
    return `${mes.charAt(0).toUpperCase()}${mes.slice(1)} de ${k.slice(0, 4)}`;
  };
  return (
    <>
      <section className="card" style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="ca-d">Desde</label>
          <input id="ca-d" type="date" value={rango.desde} onChange={(e) => setRango({ ...rango, desde: e.target.value })} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="ca-h">Hasta</label>
          <input id="ca-h" type="date" value={rango.hasta} placeholder="90 días" onChange={(e) => setRango({ ...rango, hasta: e.target.value })} />
        </div>
        <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Sin «hasta», los próximos 90 días. Lo vencido y aún pendiente aparece al inicio.</span>
      </section>
      {!datos ? (
        <p>Cargando…</p>
      ) : !datos.eventos.length ? (
        <div className="card"><p style={{ margin: 0, color: "var(--muted)" }}>Nada programado en el rango.</p></div>
      ) : (
        [...meses.entries()].map(([k, evs]) => (
          <section key={k} className="card">
            <h2 style={{ margin: "0 0 6px", fontSize: 16 }}>{nombreMes(k)}</h2>
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <tbody>
                  {evs.map((e, i) => (
                    <tr key={i}>
                      <td style={{ width: 100, fontVariantNumeric: "tabular-nums" }}>{fechaCl(e.fecha)}</td>
                      <td style={{ width: 120 }}><span className={`pill ${e.tipo === "calibracion" ? "blue" : "teal"}`}>{TIPO[e.tipo] ?? e.tipo}</span></td>
                      <td><b>{e.equipo}</b> <span style={{ color: "var(--muted)", fontSize: 12 }}>{e.laboratorio ?? ""}</span><div style={{ fontSize: 12.5 }}>{e.detalle}</div></td>
                      <td style={{ width: 110 }}><span className={`pill ${ESTADO[e.estado]?.pill ?? "gray"}`}>{ESTADO[e.estado]?.texto ?? e.estado}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </>
  );
}

/* ============================================================== reporte === */

function Reporte() {
  const hoy = hoyChile();
  const [historial, setHistorial] = useState<string | null>(null);
  const [rango, setRango] = useState({ desde: `${hoy.slice(0, 4)}-01-01`, hasta: hoy });
  const [r, setR] = useState<any | null>(null);
  const cargar = useCallback(async () => {
    try {
      setR(await llamar<any>("GET", `/mantencion/reporte${qs(rango)}`));
    } catch (e: any) {
      toast.error(e.message);
    }
  }, [rango]);
  useEffect(() => {
    cargar();
  }, [cargar]);
  const kpi = (lab: string, val: string | number, cls = "") => (
    <div className={`kpi ${cls}`}><div className="lab">{lab}</div><div className="val">{val}</div></div>
  );
  return (
    <>
      <section className="card" style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="rp-d">Desde</label>
          <input id="rp-d" type="date" value={rango.desde} onChange={(e) => setRango({ ...rango, desde: e.target.value })} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="rp-h">Hasta</label>
          <input id="rp-h" type="date" value={rango.hasta} onChange={(e) => setRango({ ...rango, hasta: e.target.value })} />
        </div>
        <button className="btn outline sm" onClick={() => descargarAdjunto(`/mantencion/reporte.xlsx${qs(rango)}`, `gestion_equipos_${rango.desde}_${rango.hasta}.xlsx`).catch((e) => toast.error(e.message))}>⬇ Excel</button>
      </section>
      {historial && <HistorialEquipo equipoId={historial} onCerrar={() => setHistorial(null)} />}
      {r && (
        <>
          <div className="kpis" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 12 }}>
            {kpi("Cumplimiento del plan", r.resumen.porcentaje == null ? "—" : `${String(r.resumen.porcentaje).replace(".", ",")} %`, r.resumen.porcentaje == null ? "" : r.resumen.porcentaje >= 90 ? "k-green" : r.resumen.porcentaje >= 70 ? "k-amber" : "k-red")}
            {kpi("Programadas", r.resumen.programadas)}
            {kpi("A tiempo", r.resumen.aTiempo, "k-green")}
            {kpi("Atrasadas", r.resumen.atrasadas, r.resumen.atrasadas ? "k-amber" : "")}
            {kpi("Pendientes vencidas", r.resumen.pendientes, r.resumen.pendientes ? "k-red" : "")}
            {kpi("Calibración vencida", r.resumen.calibracionVencida, r.resumen.calibracionVencida ? "k-red" : "")}
            {kpi("Fuera de servicio", r.resumen.fueraDeServicio)}
            {kpi("Costo", clp(r.resumen.costo))}
          </div>
          <section className="card">
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead><tr><th>Equipo</th><th>Estado</th><th>Calibración</th><th>Mantención</th><th>Programadas</th><th>A tiempo</th><th>Atrasadas</th><th>Pendientes</th><th>Correctivas</th><th>Costo</th></tr></thead>
                <tbody>
                  {r.equipos.map((e: any) => (
                    <tr key={e.id}>
                      <td><b>{e.codigo}</b> {e.nombre}<div style={{ fontSize: 11.5, color: "var(--muted)" }}>{e.laboratorio ?? "común"} · <button type="button" onClick={() => setHistorial(e.id)} style={{ background: "none", border: 0, padding: 0, color: "var(--accent)", cursor: "pointer", fontSize: 11.5 }}>Historial</button></div></td>
                      <td>{pillEstadoEquipo(e)}</td>
                      <td><span className={`pill ${ESTADO[e.calibracion]?.pill ?? "gray"}`}>{ESTADO[e.calibracion]?.texto}</span><div style={{ fontSize: 11.5 }}>{fechaCl(e.proximaCalibracion)}</div></td>
                      <td><span className={`pill ${ESTADO[e.mantencion]?.pill ?? "gray"}`}>{ESTADO[e.mantencion]?.texto}</span><div style={{ fontSize: 11.5 }}>{fechaCl(e.proximaMantencion)}</div></td>
                      <td>{e.programadas}</td>
                      <td>{e.aTiempo}</td>
                      <td>{e.atrasadas}</td>
                      <td>{e.pendientes}</td>
                      <td>{e.correctivas}</td>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>{clp(e.costo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}
