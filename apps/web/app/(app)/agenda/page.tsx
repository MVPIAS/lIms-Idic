"use client";

// ===========================================================================
// Agenda de recursos y eventos (contrato §4.5.8, §4.5.9). Tres pestañas:
//   · Calendario: eventos únicos y recurrentes en vista día, semana o mes, y la
//     programación de análisis que ocupa equipos;
//   · Disponibilidad: ocupación y costo valorizado de cada recurso por día;
//   · Recursos: catálogo de vehículos, equipos, salas y servicios con su
//     horario y costos (solo quien gestiona recursos lo modifica).
// Las reglas (alcance, choques de reservas, costos) viven en el servidor:
// apps/api/src/agenda/agenda.service.ts.
// ===========================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { llamar, qs } from "@/lib/laboratorio";
import { hoyChile, sumarDiasCalendario } from "@/lib/fecha-chile";
import { money } from "@/lib/format";
import { toast } from "@/components/ui/feedback";

type Vista = "dia" | "semana" | "mes";
type Pestana = "calendario" | "disponibilidad" | "recursos";

interface Recurso {
  id: string;
  tipo: string;
  nombre: string;
  descripcion: string | null;
  unidadId: string | null;
  unidad: string | null;
  equipoId: string | null;
  vehiculoId: string | null;
  ubicacionId: string | null;
  origen: string | null;
  capacidad: number | null;
  costoHora?: number | null;
  costoUso?: number | null;
  moneda: "CLP" | "USD";
  horaDesde: string;
  horaHasta: string;
  diasHabiles: number[];
  activo: boolean;
}
interface Meta {
  puedeGestionar: boolean;
  puedeCrearEventos: boolean;
  verCostos: boolean;
  recursos: Recurso[];
}
interface Ocurrencia {
  eventoId: string;
  fecha: string;
  titulo: string;
  tipo: string;
  lugar: string | null;
  todoDia: boolean;
  horaInicio: string | null;
  horaFin: string | null;
  recurrente: boolean;
  organizador: string | null;
  participantes: number;
  recursos: { id: string; nombre: string; tipo: string }[];
  puedeEditar: boolean;
}
interface Programada {
  recursoId: string;
  recurso: string;
  dia: string;
  horaInicio: string | null;
  horaFin: string | null;
  otCodigo: string | null;
}
interface Ficha {
  id: string;
  titulo: string;
  descripcion: string | null;
  tipo: string;
  lugar: string | null;
  unidadId: string | null;
  unidad: string | null;
  otCodigo: string | null;
  fecha: string;
  todoDia: boolean;
  horaInicio: string | null;
  horaFin: string | null;
  recurrencia: "NINGUNA" | "DIARIA" | "SEMANAL" | "MENSUAL";
  intervalo: number;
  diasSemana: number[] | null;
  repetirHasta: string | null;
  repeticiones: number | null;
  ultimaFecha: string | null;
  excepciones: string[];
  organizador: string | null;
  participantes: { usuarioId: string; nombre: string; username: string; respuesta: "PENDIENTE" | "ACEPTA" | "RECHAZA" }[];
  recursos: Recurso[];
  costoOcurrencia?: number;
  proximas: string[];
  puedeEditar: boolean;
  soyParticipante: boolean;
}

const TIPO_EVENTO: Record<string, { texto: string; color: string }> = {
  REUNION: { texto: "Reunión", color: "#1c4ba6" },
  SALIDA_TERRENO: { texto: "Salida a terreno", color: "#7a4b00" },
  MUESTREO: { texto: "Muestreo", color: "#006879" },
  MANTENCION: { texto: "Mantención", color: "#7d1f1f" },
  CAPACITACION: { texto: "Capacitación", color: "#155e3d" },
  AUDITORIA: { texto: "Auditoría", color: "#5b2a86" },
  OTRO: { texto: "Otro", color: "#516071" },
};
const TIPO_RECURSO: Record<string, string> = { VEHICULO: "Vehículo", EQUIPO: "Equipo", SALA: "Sala", SERVICIO: "Servicio", OTRO: "Otro" };
const DIAS_CORTOS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const RESPUESTA: Record<string, { texto: string; pill: string }> = {
  PENDIENTE: { texto: "Sin responder", pill: "gray" },
  ACEPTA: { texto: "Asiste", pill: "green" },
  RECHAZA: { texto: "No asiste", pill: "red" },
};

/* -------------------------------------------------- calendario (cliente) --- */
const diaSemana = (d: string) => {
  const n = new Date(`${d}T12:00:00Z`).getUTCDay();
  return n === 0 ? 7 : n;
};
const lunesDe = (d: string) => sumarDiasCalendario(d, 1 - diaSemana(d));
const diasDelMes = (d: string) => {
  const [a, m] = d.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
};
function sumarMeses(d: string, n: number): string {
  const [a, m] = d.split("-").map(Number);
  const t = a * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}-01`;
}
function rango(vista: Vista, d: string): { desde: string; hasta: string } {
  if (vista === "dia") return { desde: d, hasta: d };
  if (vista === "semana") return { desde: lunesDe(d), hasta: sumarDiasCalendario(lunesDe(d), 6) };
  return { desde: `${d.slice(0, 7)}-01`, hasta: `${d.slice(0, 7)}-${String(diasDelMes(d)).padStart(2, "0")}` };
}
function dias(desde: string, hasta: string): string[] {
  const s: string[] = [];
  for (let d = desde; d <= hasta; d = sumarDiasCalendario(d, 1)) s.push(d);
  return s;
}
const diaLargo = (d: string) => `${DIAS_CORTOS[diaSemana(d) - 1]} ${Number(d.slice(8))} de ${MESES[Number(d.slice(5, 7)) - 1]}`;
function tituloVista(vista: Vista, d: string): string {
  if (vista === "dia") return `${diaLargo(d)} de ${d.slice(0, 4)}`;
  if (vista === "mes") return `${MESES[Number(d.slice(5, 7)) - 1]} de ${d.slice(0, 4)}`;
  const r = rango("semana", d);
  return `Semana del ${diaLargo(r.desde)} al ${diaLargo(r.hasta)}`;
}
const horario = (o: { todoDia: boolean; horaInicio: string | null; horaFin: string | null }) => (o.todoDia ? "Día completo" : `${o.horaInicio}–${o.horaFin}`);
const horas = (min: number) => (min % 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min / 60} h`);

function describirRepeticion(f: Pick<Ficha, "recurrencia" | "intervalo" | "diasSemana" | "repetirHasta" | "repeticiones">): string {
  if (f.recurrencia === "NINGUNA") return "No se repite";
  const cada = f.intervalo > 1 ? `Cada ${f.intervalo} ${f.recurrencia === "DIARIA" ? "días" : f.recurrencia === "SEMANAL" ? "semanas" : "meses"}` : f.recurrencia === "DIARIA" ? "Todos los días" : f.recurrencia === "SEMANAL" ? "Todas las semanas" : "Todos los meses";
  const ds = f.recurrencia === "SEMANAL" && f.diasSemana?.length ? ` (${f.diasSemana.map((x) => DIAS_CORTOS[x - 1]).join(", ")})` : "";
  const fin = f.repeticiones ? `, ${f.repeticiones} veces` : f.repetirHasta ? `, hasta el ${f.repetirHasta}` : "";
  return `${cada}${ds}${fin}`;
}

function useUnidades() {
  const [u, setU] = useState<{ id: string; codigo: string; nombre: string }[]>([]);
  useEffect(() => {
    llamar<any>("GET", "/ot/laboratorios")
      .then((r) => setU((Array.isArray(r) ? r : r?.data ?? []).map((x: any) => ({ id: x.id, codigo: x.codigo, nombre: x.nombre }))))
      .catch(() => setU([]));
  }, []);
  return u;
}

/* ================================================================= página === */

export default function AgendaPage() {
  const [pestana, setPestana] = useState<Pestana>("calendario");
  const [vista, setVista] = useState<Vista>("semana");
  const [fecha, setFecha] = useState(hoyChile());
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState("");

  const cargarMeta = useCallback(async () => {
    try {
      setMeta(await llamar<Meta>("GET", `/agenda/recursos${qs({ inactivos: "true" })}`));
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }, []);
  useEffect(() => {
    cargarMeta();
  }, [cargarMeta]);
  // Los avisos de la agenda (Mi bandeja) abren la semana del evento: /agenda?fecha=aaaa-mm-dd.
  useEffect(() => {
    const f = new URLSearchParams(window.location.search).get("fecha");
    if (f && /^\d{4}-\d{2}-\d{2}$/.test(f)) setFecha(f);
  }, []);

  const mover = (n: number) => setFecha((d) => (vista === "mes" ? sumarMeses(d, n) : sumarDiasCalendario(d, n * (vista === "semana" ? 7 : 1))));

  const tab = (id: Pestana, texto: string) => (
    <button type="button" role="tab" aria-selected={pestana === id} className={`tab${pestana === id ? " active" : ""}`} onClick={() => setPestana(id)}>
      {texto}
    </button>
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page">Agenda de recursos y eventos</h1>
          <p className="subtitle">
            Reuniones, salidas a terreno, mantenciones y capacitaciones, únicas o repetidas, con sus participantes y los vehículos, equipos, salas o servicios que ocupan. Un recurso no se puede reservar dos veces a la misma hora.
          </p>
        </div>
      </div>
      {error && <div className="alert warn" role="alert">{error}</div>}

      <div className="tabs" role="tablist" style={{ marginBottom: 12 }}>
        {tab("calendario", "Calendario")}
        {tab("disponibilidad", meta?.verCostos ? "Disponibilidad y costos" : "Disponibilidad")}
        {tab("recursos", "Recursos")}
      </div>

      {pestana !== "recursos" && (
        <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", padding: 10 }}>
          <div style={{ display: "flex", gap: 4 }}>
            <button type="button" className="btn sm" onClick={() => mover(-1)} aria-label="Anterior">◀</button>
            <button type="button" className="btn sm" onClick={() => setFecha(hoyChile())}>Hoy</button>
            <button type="button" className="btn sm" onClick={() => mover(1)} aria-label="Siguiente">▶</button>
          </div>
          <strong style={{ fontSize: 14, flex: "1 1 220px" }}>{tituloVista(vista, fecha)}</strong>
          <input type="date" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} aria-label="Ir a la fecha" style={{ width: "auto" }} />
          <div role="group" aria-label="Vista" style={{ display: "inline-flex", border: "1px solid var(--line)", borderRadius: 7, overflow: "hidden" }}>
            {(["dia", "semana", "mes"] as Vista[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setVista(v)}
                aria-pressed={vista === v}
                style={{ border: 0, padding: "5px 12px", fontSize: 12.5, cursor: "pointer", background: vista === v ? "var(--primary)" : "#fff", color: vista === v ? "#fff" : "inherit" }}
              >
                {v === "dia" ? "Día" : v === "semana" ? "Semana" : "Mes"}
              </button>
            ))}
          </div>
        </div>
      )}

      {pestana === "calendario" && meta && <Calendario vista={vista} fecha={fecha} meta={meta} onElegirDia={(d) => { setFecha(d); setVista("dia"); }} />}
      {pestana === "disponibilidad" && meta && <Disponibilidad vista={vista} fecha={fecha} meta={meta} />}
      {pestana === "recursos" && meta && <Recursos meta={meta} onCambio={cargarMeta} />}
    </div>
  );
}

/* ============================================================ calendario === */

function Calendario({ vista, fecha, meta, onElegirDia }: { vista: Vista; fecha: string; meta: Meta; onElegirDia: (d: string) => void }) {
  const [datos, setDatos] = useState<{ ocurrencias: Ocurrencia[]; programacion: Programada[] }>({ ocurrencias: [], programacion: [] });
  const [recursoId, setRecursoId] = useState("");
  const [soloMios, setSoloMios] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [formulario, setFormulario] = useState<{ ficha?: Ficha; fecha?: string } | null>(null);
  const [abierto, setAbierto] = useState<{ id: string; fecha: string } | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setDatos(await llamar("GET", `/agenda/calendario${qs({ vista, fecha, recursoId: recursoId || null, soloMios: soloMios ? "true" : null })}`));
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCargando(false);
    }
  }, [vista, fecha, recursoId, soloMios]);
  useEffect(() => {
    cargar();
  }, [cargar]);

  const r = rango(vista, fecha);
  // El mes se dibuja en semanas completas, de lunes a domingo.
  const celdas = vista === "mes" ? dias(lunesDe(r.desde), sumarDiasCalendario(lunesDe(r.hasta), 6)) : dias(r.desde, r.hasta);
  const porDia = useMemo(() => {
    const m = new Map<string, { o: Ocurrencia[]; p: Programada[] }>();
    for (const o of datos.ocurrencias) (m.get(o.fecha) ?? m.set(o.fecha, { o: [], p: [] }).get(o.fecha)!).o.push(o);
    for (const p of datos.programacion) (m.get(p.dia) ?? m.set(p.dia, { o: [], p: [] }).get(p.dia)!).p.push(p);
    return m;
  }, [datos]);
  const hoy = hoyChile();
  const activos = meta.recursos.filter((x) => x.activo);

  return (
    <>
      <div className="toolbar" style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end", marginBottom: 10 }}>
        <div className="field" style={{ margin: 0, minWidth: 220 }}>
          <label htmlFor="ag-recurso">Recurso</label>
          <select id="ag-recurso" value={recursoId} onChange={(e) => setRecursoId(e.target.value)}>
            <option value="">Todos los eventos</option>
            {activos.map((x) => <option key={x.id} value={x.id}>{TIPO_RECURSO[x.tipo]} · {x.nombre}</option>)}
          </select>
        </div>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
          <input type="checkbox" checked={soloMios} onChange={(e) => setSoloMios(e.target.checked)} style={{ width: "auto" }} />
          Solo donde organizo o participo
        </label>
        <span style={{ flex: 1 }} />
        {meta.puedeCrearEventos && (
          <button type="button" className="btn primary sm" onClick={() => { setAbierto(null); setFormulario({ fecha: vista === "dia" ? fecha : fecha < hoy ? hoy : fecha }); }}>
            + Nuevo evento
          </button>
        )}
      </div>

      {formulario && (
        <FormularioEvento
          inicial={formulario.ficha}
          fecha={formulario.fecha ?? fecha}
          recursos={activos}
          onListo={async (id) => { setFormulario(null); await cargar(); setAbierto({ id, fecha: formulario.ficha?.fecha ?? formulario.fecha ?? fecha }); }}
          onCancelar={() => setFormulario(null)}
        />
      )}

      {abierto && !formulario && (
        <FichaEvento
          id={abierto.id}
          fecha={abierto.fecha}
          verCostos={meta.verCostos}
          onEditar={(f) => setFormulario({ ficha: f })}
          onCambio={cargar}
          onCerrar={() => setAbierto(null)}
        />
      )}

      <div className="card" style={{ padding: 0, overflowX: "auto" }} aria-busy={cargando}>
        {vista === "dia" ? (
          <ListaDia dia={fecha} datos={porDia.get(fecha)} onAbrir={(o) => setAbierto({ id: o.eventoId, fecha: o.fecha })} cargando={cargando} />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(110px, 1fr))", minWidth: 770 }}>
            {DIAS_CORTOS.map((d) => (
              <div key={d} style={{ padding: "6px 8px", fontSize: 11.5, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em", borderBottom: "1px solid var(--line)" }}>
                {d}
              </div>
            ))}
            {celdas.map((d) => {
              const x = porDia.get(d);
              const fuera = d < r.desde || d > r.hasta;
              const max = vista === "mes" ? 3 : 50;
              const total = (x?.o.length ?? 0) + (x?.p.length ?? 0);
              return (
                <div
                  key={d}
                  style={{
                    minHeight: vista === "mes" ? 96 : 260,
                    borderRight: "1px solid var(--line)",
                    borderBottom: "1px solid var(--line)",
                    padding: 5,
                    background: fuera ? "#f7f9fb" : d === hoy ? "rgba(0,140,158,.06)" : "#fff",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => onElegirDia(d)}
                    title={`Ver el ${diaLargo(d)}`}
                    style={{ border: 0, background: "none", padding: "0 2px", cursor: "pointer", fontSize: 12, fontWeight: d === hoy ? 700 : 500, color: fuera ? "var(--muted)" : d === hoy ? "var(--accent)" : "inherit" }}
                  >
                    {vista === "mes" ? Number(d.slice(8)) : `${Number(d.slice(8))} ${MESES[Number(d.slice(5, 7)) - 1].slice(0, 3)}`}
                  </button>
                  <div style={{ display: "grid", gap: 3, marginTop: 3 }}>
                    {x?.o.slice(0, max).map((o) => <Chip key={`${o.eventoId}-${o.fecha}`} o={o} compacto={vista === "mes"} onAbrir={() => setAbierto({ id: o.eventoId, fecha: o.fecha })} />)}
                    {x?.p.slice(0, Math.max(0, max - (x?.o.length ?? 0))).map((p, i) => <ChipAnalisis key={`p${i}`} p={p} />)}
                    {total > max && (
                      <button type="button" onClick={() => onElegirDia(d)} style={{ border: 0, background: "none", padding: 0, fontSize: 11, color: "var(--accent)", cursor: "pointer", textAlign: "left" }}>
                        + {total - max} más
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <p className="subtitle" style={{ marginTop: -4 }}>
        En gris, los análisis programados en equipos registrados como recurso: ocupan el equipo y se gestionan desde la planificación del laboratorio.
      </p>
    </>
  );
}

function Chip({ o, compacto, onAbrir }: { o: Ocurrencia; compacto: boolean; onAbrir: () => void }) {
  const t = TIPO_EVENTO[o.tipo] ?? TIPO_EVENTO.OTRO;
  return (
    <button
      type="button"
      onClick={onAbrir}
      title={`${o.titulo} · ${horario(o)}${o.recursos.length ? ` · ${o.recursos.map((r) => r.nombre).join(", ")}` : ""}`}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        border: 0,
        borderLeft: `3px solid ${t.color}`,
        borderRadius: 4,
        background: "#f1f5f9",
        padding: "2px 5px",
        fontSize: 11.5,
        lineHeight: 1.3,
        cursor: "pointer",
        overflow: "hidden",
        textOverflow: "ellipsis",
        // En el mes una línea por evento; en la semana hay sitio para el título completo.
        whiteSpace: compacto ? "nowrap" : "normal",
        color: "inherit",
      }}
    >
      <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--muted)" }}>{o.todoDia ? "Día" : o.horaInicio}</span> {o.recurrente && <span aria-label="repetido">↻ </span>}
      {o.titulo}
    </button>
  );
}

function ChipAnalisis({ p }: { p: Programada }) {
  return (
    <div
      title={`Análisis programado${p.otCodigo ? ` · OT ${p.otCodigo}` : ""} · ${p.recurso}`}
      style={{ borderLeft: "3px solid #9aa6b2", borderRadius: 4, background: "#eef1f4", padding: "2px 5px", fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
    >
      {p.horaInicio ?? "Día"} · {p.recurso}
    </div>
  );
}

function ListaDia({ dia, datos, onAbrir, cargando }: { dia: string; datos?: { o: Ocurrencia[]; p: Programada[] }; onAbrir: (o: Ocurrencia) => void; cargando: boolean }) {
  if (!datos?.o.length && !datos?.p.length)
    return <p style={{ padding: 18, margin: 0, color: "var(--muted)", textAlign: "center" }}>{cargando ? "Cargando…" : `Sin eventos el ${diaLargo(dia)}.`}</p>;
  return (
    <table className="data">
      <thead>
        <tr><th>Horario</th><th>Evento</th><th>Recursos</th><th>Organiza</th></tr>
      </thead>
      <tbody>
        {datos.o.map((o) => {
          const t = TIPO_EVENTO[o.tipo] ?? TIPO_EVENTO.OTRO;
          return (
            <tr key={o.eventoId} onClick={() => onAbrir(o)} style={{ cursor: "pointer" }}>
              <td style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{horario(o)}</td>
              <td>
                <button type="button" onClick={(e) => { e.stopPropagation(); onAbrir(o); }} style={{ background: "none", border: 0, padding: 0, color: "var(--accent)", cursor: "pointer", textAlign: "left", fontWeight: 600 }}>
                  {o.titulo}
                </button>
                <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                  <span style={{ color: t.color }}>{t.texto}</span>
                  {o.recurrente && " · se repite"}
                  {o.lugar && ` · ${o.lugar}`}
                  {o.participantes > 0 && ` · ${o.participantes} participante${o.participantes === 1 ? "" : "s"}`}
                </div>
              </td>
              <td style={{ fontSize: 12 }}>{o.recursos.map((r) => r.nombre).join(", ") || "—"}</td>
              <td style={{ fontSize: 12 }}>{o.organizador ?? "—"}</td>
            </tr>
          );
        })}
        {datos.p.map((p, i) => (
          <tr key={`p${i}`} style={{ color: "var(--muted)" }}>
            <td style={{ fontVariantNumeric: "tabular-nums" }}>{p.horaInicio && p.horaFin ? `${p.horaInicio}–${p.horaFin}` : "Día completo"}</td>
            <td>Análisis programado{p.otCodigo ? ` · OT ${p.otCodigo}` : ""}</td>
            <td style={{ fontSize: 12 }}>{p.recurso}</td>
            <td>—</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ---------------------------------------------------------- ficha evento --- */

function FichaEvento({ id, fecha, verCostos, onEditar, onCambio, onCerrar }: { id: string; fecha: string; verCostos: boolean; onEditar: (f: Ficha) => void; onCambio: () => void; onCerrar: () => void }) {
  const [f, setF] = useState<Ficha | null>(null);
  // onCerrar llega como función nueva en cada render del calendario: se lee de un ref
  // para no volver a pedir la ficha cada vez que el calendario se recarga.
  const cerrar = useRef(onCerrar);
  cerrar.current = onCerrar;
  const cargar = useCallback(async () => {
    try {
      setF(await llamar("GET", `/agenda/eventos/${id}`));
    } catch (e: any) {
      toast.error(e.message);
      cerrar.current();
    }
  }, [id]);
  useEffect(() => {
    cargar();
  }, [cargar]);
  if (!f) return null;
  const t = TIPO_EVENTO[f.tipo] ?? TIPO_EVENTO.OTRO;
  const moneda = f.recursos[0]?.moneda ?? "CLP";

  const accion = async (fn: () => Promise<unknown>, ok: string, cerrar = false) => {
    try {
      await fn();
      toast.ok(ok);
      onCambio();
      if (cerrar) onCerrar();
      else cargar();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <section className="card" aria-label="Detalle del evento" style={{ borderTop: `3px solid ${t.color}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 11.5, color: t.color, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" }}>{t.texto}</div>
          <h2 style={{ margin: "2px 0 4px" }}>{f.titulo}</h2>
          <div style={{ fontSize: 12.5 }}>
            {diaLargo(fecha)} · {horario(f)}
            {f.lugar && ` · ${f.lugar}`}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "flex-start", flexWrap: "wrap" }}>
          {f.soyParticipante && (
            <>
              <button type="button" className="btn sm" onClick={() => accion(() => llamar("POST", `/agenda/eventos/${id}/respuesta`, { respuesta: "ACEPTA" }), "Respuesta registrada: asiste.")}>Asistiré</button>
              <button type="button" className="btn sm" onClick={() => accion(() => llamar("POST", `/agenda/eventos/${id}/respuesta`, { respuesta: "RECHAZA" }), "Respuesta registrada: no asiste.")}>No asistiré</button>
            </>
          )}
          {f.puedeEditar && (
            <>
              <button type="button" className="btn sm" onClick={() => onEditar(f)}>Editar</button>
              {f.recurrencia !== "NINGUNA" && (
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => confirm(`¿Anular solo la ocurrencia del ${diaLargo(fecha)}? Las demás fechas de la serie se mantienen.`) && accion(() => llamar("POST", `/agenda/eventos/${id}/anular-ocurrencia`, { fecha }), "Ocurrencia anulada.", true)}
                >
                  Anular esta fecha
                </button>
              )}
              <button
                type="button"
                className="btn sm"
                style={{ color: "#7d1f1f" }}
                onClick={() => confirm(f.recurrencia === "NINGUNA" ? "¿Eliminar el evento?" : "¿Eliminar la serie completa con todas sus fechas?") && accion(() => llamar("DELETE", `/agenda/eventos/${id}`), "Evento eliminado.", true)}
              >
                {f.recurrencia === "NINGUNA" ? "Eliminar" : "Eliminar serie"}
              </button>
            </>
          )}
          <button type="button" className="btn ghost sm" onClick={onCerrar} aria-label="Cerrar">✕</button>
        </div>
      </div>

      <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "8px 16px", margin: "12px 0 0", fontSize: 12.5 }}>
        <div><dt style={{ color: "var(--muted)" }}>Repetición</dt><dd style={{ margin: 0 }}>{describirRepeticion(f)}</dd></div>
        <div><dt style={{ color: "var(--muted)" }}>Organiza</dt><dd style={{ margin: 0 }}>{f.organizador ?? "—"}</dd></div>
        <div><dt style={{ color: "var(--muted)" }}>Unidad</dt><dd style={{ margin: 0 }}>{f.unidad ?? "Todas"}</dd></div>
        {f.otCodigo && <div><dt style={{ color: "var(--muted)" }}>OT</dt><dd style={{ margin: 0 }}>{f.otCodigo}</dd></div>}
        {verCostos && f.costoOcurrencia !== undefined && (
          <div><dt style={{ color: "var(--muted)" }}>Costo de recursos por fecha</dt><dd style={{ margin: 0, fontVariantNumeric: "tabular-nums" }}>{money(f.costoOcurrencia, moneda)}</dd></div>
        )}
      </dl>
      {f.descripcion && <p style={{ fontSize: 12.5, whiteSpace: "pre-wrap", margin: "10px 0 0" }}>{f.descripcion}</p>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, marginTop: 12 }}>
        <div>
          <h3 style={{ fontSize: 13, margin: "0 0 6px" }}>Participantes ({f.participantes.length})</h3>
          {f.participantes.length ? (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 4 }}>
              {f.participantes.map((p) => (
                <li key={p.usuarioId} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5 }}>
                  <span>{p.nombre}</span>
                  <span className={`pill ${RESPUESTA[p.respuesta].pill}`}>{RESPUESTA[p.respuesta].texto}</span>
                </li>
              ))}
            </ul>
          ) : <p className="subtitle" style={{ margin: 0 }}>Sin participantes invitados.</p>}
        </div>
        <div>
          <h3 style={{ fontSize: 13, margin: "0 0 6px" }}>Recursos reservados ({f.recursos.length})</h3>
          {f.recursos.length ? (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 4 }}>
              {f.recursos.map((r) => (
                <li key={r.id} style={{ fontSize: 12.5 }}>
                  <span className="pill gray" style={{ marginRight: 6 }}>{TIPO_RECURSO[r.tipo]}</span>
                  {r.nombre}
                </li>
              ))}
            </ul>
          ) : <p className="subtitle" style={{ margin: 0 }}>Sin recursos.</p>}
        </div>
        {f.recurrencia !== "NINGUNA" && (
          <div>
            <h3 style={{ fontSize: 13, margin: "0 0 6px" }}>Próximas fechas</h3>
            <p style={{ fontSize: 12.5, margin: 0 }}>{f.proximas.length ? f.proximas.map(diaLargo).join(" · ") : "La serie ya terminó."}</p>
            {f.excepciones.length > 0 && <p className="subtitle" style={{ margin: "6px 0 0" }}>Anuladas: {f.excepciones.sort().join(", ")}</p>}
          </div>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------ formulario evento --- */

function FormularioEvento({ inicial, fecha, recursos, onListo, onCancelar }: { inicial?: Ficha; fecha: string; recursos: Recurso[]; onListo: (id: string) => void; onCancelar: () => void }) {
  const unidades = useUnidades();
  const [v, setV] = useState({
    titulo: inicial?.titulo ?? "",
    tipo: inicial?.tipo ?? "REUNION",
    fecha: inicial?.fecha ?? fecha,
    todoDia: inicial?.todoDia ?? false,
    horaInicio: inicial?.horaInicio ?? "09:00",
    horaFin: inicial?.horaFin ?? "10:00",
    recurrencia: inicial?.recurrencia ?? "NINGUNA",
    intervalo: inicial?.intervalo ?? 1,
    diasSemana: inicial?.diasSemana ?? [diaSemana(inicial?.fecha ?? fecha)],
    fin: inicial?.repeticiones ? "veces" : "fecha",
    repetirHasta: inicial?.repetirHasta ?? sumarDiasCalendario(inicial?.fecha ?? fecha, 28),
    repeticiones: inicial?.repeticiones ?? 4,
    lugar: inicial?.lugar ?? "",
    unidadId: inicial?.unidadId ?? "",
    otCodigo: inicial?.otCodigo ?? "",
    descripcion: inicial?.descripcion ?? "",
    recursos: inicial?.recursos.map((r) => r.id) ?? ([] as string[]),
  });
  const [participantes, setParticipantes] = useState<{ id: string; nombre: string }[]>(inicial?.participantes.map((p) => ({ id: p.usuarioId, nombre: p.nombre })) ?? []);
  const [busca, setBusca] = useState("");
  const [sugeridos, setSugeridos] = useState<{ id: string; nombre: string; username: string }[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState("");
  const set = <K extends keyof typeof v>(k: K, x: (typeof v)[K]) => setV((s) => ({ ...s, [k]: x }));

  useEffect(() => {
    if (busca.trim().length < 2) return setSugeridos([]);
    const t = setTimeout(() => llamar<any[]>("GET", `/agenda/usuarios${qs({ q: busca.trim() })}`).then(setSugeridos).catch(() => setSugeridos([])), 250);
    return () => clearTimeout(t);
  }, [busca]);

  // Recursos: los activos y, al editar, también los ya reservados aunque estén inactivos.
  const opciones = useMemo(() => {
    const ids = new Set(recursos.map((r) => r.id));
    return [...recursos, ...(inicial?.recursos.filter((r) => !ids.has(r.id)) ?? [])];
  }, [recursos, inicial]);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setOcupado(true);
    setAviso("");
    const cuerpo: any = {
      titulo: v.titulo,
      tipo: v.tipo,
      fecha: v.fecha,
      todoDia: v.todoDia,
      horaInicio: v.todoDia ? null : v.horaInicio,
      horaFin: v.todoDia ? null : v.horaFin,
      recurrencia: v.recurrencia,
      intervalo: Number(v.intervalo) || 1,
      diasSemana: v.recurrencia === "SEMANAL" ? v.diasSemana : null,
      repetirHasta: v.recurrencia !== "NINGUNA" && v.fin === "fecha" ? v.repetirHasta : null,
      repeticiones: v.recurrencia !== "NINGUNA" && v.fin === "veces" ? Number(v.repeticiones) : null,
      lugar: v.lugar,
      unidadId: v.unidadId || null,
      otCodigo: v.otCodigo,
      descripcion: v.descripcion,
      recursos: v.recursos,
      participantes: participantes.map((p) => p.id),
    };
    try {
      const r = inicial ? await llamar<{ id: string }>("PATCH", `/agenda/eventos/${inicial.id}`, cuerpo) : await llamar<{ id: string }>("POST", "/agenda/eventos", cuerpo);
      toast.ok(inicial ? "Evento actualizado." : "Evento creado.");
      onListo(r.id);
    } catch (x: any) {
      setAviso(x.message);
    } finally {
      setOcupado(false);
    }
  };

  const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 };
  return (
    <form className="card" onSubmit={enviar}>
      <h2 style={{ marginTop: 0 }}>{inicial ? `Editar «${inicial.titulo}»` : "Nuevo evento"}</h2>
      {inicial && inicial.recurrencia !== "NINGUNA" && <p className="subtitle" style={{ marginTop: -6 }}>Los cambios se aplican a toda la serie.</p>}
      {aviso && <div className="alert warn" role="alert">{aviso}</div>}

      <div style={grid}>
        <div className="field" style={{ gridColumn: "span 2" }}><label htmlFor="ev-titulo">Título</label><input id="ev-titulo" required maxLength={160} value={v.titulo} onChange={(e) => set("titulo", e.target.value)} placeholder="Ej.: Reunión de revisión de resultados" /></div>
        <div className="field">
          <label htmlFor="ev-tipo">Tipo</label>
          <select id="ev-tipo" value={v.tipo} onChange={(e) => set("tipo", e.target.value)}>
            {Object.entries(TIPO_EVENTO).map(([k, t]) => <option key={k} value={k}>{t.texto}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="ev-fecha">{v.recurrencia === "NINGUNA" ? "Fecha" : "Primera fecha"}</label><input id="ev-fecha" type="date" required value={v.fecha} onChange={(e) => set("fecha", e.target.value)} /></div>
        <div className="field">
          <label htmlFor="ev-ini">Inicio</label>
          <input id="ev-ini" type="time" disabled={v.todoDia} required={!v.todoDia} value={v.horaInicio} onChange={(e) => set("horaInicio", e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="ev-fin">Término</label>
          <input id="ev-fin" type="time" disabled={v.todoDia} required={!v.todoDia} value={v.horaFin} onChange={(e) => set("horaFin", e.target.value)} />
        </div>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, alignSelf: "end", paddingBottom: 8 }}>
          <input type="checkbox" checked={v.todoDia} onChange={(e) => set("todoDia", e.target.checked)} style={{ width: "auto" }} />
          Día completo
        </label>
      </div>

      <fieldset style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10, margin: "4px 0 10px" }}>
        <legend style={{ fontSize: 12.5, fontWeight: 600, padding: "0 4px" }}>Repetición</legend>
        <div style={grid}>
          <div className="field">
            <label htmlFor="ev-rep">Se repite</label>
            <select id="ev-rep" value={v.recurrencia} onChange={(e) => set("recurrencia", e.target.value as Ficha["recurrencia"])}>
              <option value="NINGUNA">No se repite</option>
              <option value="DIARIA">Cada día</option>
              <option value="SEMANAL">Cada semana</option>
              <option value="MENSUAL">Cada mes (mismo día)</option>
            </select>
          </div>
          {v.recurrencia !== "NINGUNA" && (
            <>
              <div className="field">
                <label htmlFor="ev-int">Cada</label>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input id="ev-int" type="number" min={1} max={99} value={v.intervalo} onChange={(e) => set("intervalo", Number(e.target.value))} style={{ width: 70 }} />
                  <span style={{ fontSize: 12.5 }}>{v.recurrencia === "DIARIA" ? "días" : v.recurrencia === "SEMANAL" ? "semanas" : "meses"}</span>
                </div>
              </div>
              <div className="field">
                <label htmlFor="ev-finrep">Termina</label>
                <div style={{ display: "flex", gap: 6 }}>
                  <select id="ev-finrep" value={v.fin} onChange={(e) => set("fin", e.target.value)} style={{ width: "auto" }}>
                    <option value="fecha">el día</option>
                    <option value="veces">tras</option>
                  </select>
                  {v.fin === "fecha" ? (
                    <input type="date" aria-label="Repetir hasta" value={v.repetirHasta} min={v.fecha} onChange={(e) => set("repetirHasta", e.target.value)} />
                  ) : (
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="number" aria-label="Número de veces" min={1} max={500} value={v.repeticiones} onChange={(e) => set("repeticiones", Number(e.target.value))} style={{ width: 70 }} />
                      <span style={{ fontSize: 12.5 }}>veces</span>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
        {v.recurrencia === "SEMANAL" && (
          <div role="group" aria-label="Días de la semana" style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
            {DIAS_CORTOS.map((d, i) => {
              const n = i + 1;
              const on = v.diasSemana.includes(n);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set("diasSemana", on ? v.diasSemana.filter((x) => x !== n) : [...v.diasSemana, n].sort())}
                  style={{ border: "1px solid var(--line)", borderRadius: 14, padding: "3px 10px", fontSize: 12, cursor: "pointer", background: on ? "var(--accent)" : "#fff", color: on ? "#fff" : "inherit" }}
                >
                  {d}
                </button>
              );
            })}
          </div>
        )}
      </fieldset>

      <div style={grid}>
        <div className="field"><label htmlFor="ev-lugar">Lugar</label><input id="ev-lugar" maxLength={160} value={v.lugar} onChange={(e) => set("lugar", e.target.value)} placeholder="Ej.: Sala de reuniones piso 2" /></div>
        <div className="field">
          <label htmlFor="ev-unidad">Unidad (quién lo ve)</label>
          <select id="ev-unidad" value={v.unidadId} onChange={(e) => set("unidadId", e.target.value)}>
            <option value="">Todas las unidades</option>
            {unidades.map((u) => <option key={u.id} value={u.id}>{u.codigo} · {u.nombre}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="ev-ot">OT relacionada (opcional)</label><input id="ev-ot" maxLength={40} value={v.otCodigo} onChange={(e) => set("otCodigo", e.target.value)} placeholder="Ej.: OT-2026-0139" /></div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14, margin: "4px 0 10px" }}>
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>Recursos</div>
          {opciones.length ? (
            <div style={{ display: "grid", gap: 3, maxHeight: 180, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8, padding: 6 }}>
              {opciones.map((r) => (
                <label key={r.id} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
                  <input type="checkbox" style={{ width: "auto" }} checked={v.recursos.includes(r.id)} onChange={(e) => set("recursos", e.target.checked ? [...v.recursos, r.id] : v.recursos.filter((x) => x !== r.id))} />
                  <span className="pill gray">{TIPO_RECURSO[r.tipo]}</span> {r.nombre}
                  <span style={{ color: "var(--muted)", fontSize: 11 }}>{r.horaDesde}–{r.horaHasta}</span>
                </label>
              ))}
            </div>
          ) : <p className="subtitle" style={{ margin: 0 }}>No hay recursos registrados.</p>}
        </div>
        <div>
          <label htmlFor="ev-part" style={{ fontSize: 12.5, fontWeight: 600, display: "block", marginBottom: 4 }}>Participantes</label>
          <input id="ev-part" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nombre o usuario" autoComplete="off" />
          {sugeridos.length > 0 && (
            <div style={{ border: "1px solid var(--line)", borderRadius: 8, marginTop: 4, maxHeight: 140, overflowY: "auto" }}>
              {sugeridos.filter((s) => !participantes.some((p) => p.id === s.id)).map((s) => (
                <button key={s.id} type="button" onClick={() => { setParticipantes((p) => [...p, { id: s.id, nombre: s.nombre }]); setBusca(""); }} style={{ display: "block", width: "100%", textAlign: "left", border: 0, background: "none", padding: "4px 8px", fontSize: 12.5, cursor: "pointer" }}>
                  {s.nombre} <span style={{ color: "var(--muted)" }}>· {s.username}</span>
                </button>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
            {participantes.map((p) => (
              <span key={p.id} className="pill blue" style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                {p.nombre}
                <button type="button" aria-label={`Quitar a ${p.nombre}`} onClick={() => setParticipantes((x) => x.filter((y) => y.id !== p.id))} style={{ border: 0, background: "none", cursor: "pointer", padding: 0, color: "inherit" }}>✕</button>
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="field"><label htmlFor="ev-desc">Descripción</label><textarea id="ev-desc" rows={2} maxLength={2000} value={v.descripcion} onChange={(e) => set("descripcion", e.target.value)} /></div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn primary sm" disabled={ocupado}>{inicial ? "Guardar cambios" : "Crear evento"}</button>
        <button type="button" className="btn sm" onClick={onCancelar}>Cancelar</button>
      </div>
    </form>
  );
}

/* ======================================================== disponibilidad === */

interface FilaDisp {
  recurso: Recurso;
  dias: { dia: string; jornada: number; ocupado: number; eventos: number; analisis: number; costo?: number }[];
  total: { jornada: number; ocupado: number; ocupacion: number | null; costo?: number };
}

function Disponibilidad({ vista, fecha, meta }: { vista: Vista; fecha: string; meta: Meta }) {
  const [d, setD] = useState<{ dias: string[]; verCostos: boolean; recursos: FilaDisp[] } | null>(null);
  const [tipo, setTipo] = useState("");
  useEffect(() => {
    llamar<any>("GET", `/agenda/disponibilidad${qs({ vista, fecha, tipo: tipo || null })}`).then(setD).catch((e) => toast.error(e.message));
  }, [vista, fecha, tipo]);
  if (!d) return null;
  const monedas = new Set(d.recursos.map((r) => r.recurso.moneda));
  const totalCosto = d.recursos.reduce((s, r) => s + (r.total.costo ?? 0), 0);

  return (
    <>
      <div className="toolbar" style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 10 }}>
        <div className="field" style={{ margin: 0, minWidth: 180 }}>
          <label htmlFor="disp-tipo">Tipo de recurso</label>
          <select id="disp-tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(TIPO_RECURSO).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select>
        </div>
        <p className="subtitle" style={{ margin: 0, flex: "1 1 300px" }}>
          Cada celda muestra el tiempo ocupado sobre la jornada del recurso ese día{d.verCostos ? " y su costo (horas × costo por hora + costo por uso)" : ""}. Los días sin jornada aparecen rayados.
        </p>
      </div>
      <div className="card card--table" style={{ overflowX: "auto" }}>
        <table className="data" style={{ minWidth: 300 + d.dias.length * 64 }}>
          <thead>
            <tr>
              <th style={{ position: "sticky", left: 0, background: "#fff", zIndex: 1 }}>Recurso</th>
              {d.dias.map((x) => (
                <th key={x} style={{ textAlign: "center", fontWeight: 500, fontSize: 11, padding: "6px 2px" }}>
                  {DIAS_CORTOS[diaSemana(x) - 1]}<br />{Number(x.slice(8))}
                </th>
              ))}
              <th style={{ textAlign: "right" }}>Ocupación</th>
              {d.verCostos && <th style={{ textAlign: "right" }}>Costo</th>}
            </tr>
          </thead>
          <tbody>
            {d.recursos.map((f) => (
              <tr key={f.recurso.id}>
                <td style={{ position: "sticky", left: 0, background: "#fff", zIndex: 1, minWidth: 180 }}>
                  <div style={{ fontWeight: 600, fontSize: 12.5 }}>{f.recurso.nombre}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>{TIPO_RECURSO[f.recurso.tipo]} · {f.recurso.horaDesde}–{f.recurso.horaHasta}{f.recurso.unidad ? ` · ${f.recurso.unidad.split(" · ")[0]}` : ""}</div>
                </td>
                {f.dias.map((x) => <CeldaDisp key={x.dia} x={x} moneda={f.recurso.moneda} verCostos={d.verCostos} />)}
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                  {f.total.ocupacion === null ? "—" : `${f.total.ocupacion.toLocaleString("es-CL")} %`}
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>{horas(f.total.ocupado)} de {horas(f.total.jornada)}</div>
                </td>
                {d.verCostos && <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{money(f.total.costo ?? 0, f.recurso.moneda)}</td>}
              </tr>
            ))}
            {!d.recursos.length && (
              <tr><td colSpan={d.dias.length + 3} style={{ textAlign: "center", color: "var(--muted)", padding: 18 }}>No hay recursos {tipo ? "de ese tipo " : ""}en su alcance.</td></tr>
            )}
          </tbody>
          {d.verCostos && d.recursos.length > 0 && monedas.size === 1 && (
            <tfoot>
              <tr>
                <td colSpan={d.dias.length + 2} style={{ textAlign: "right", fontWeight: 600 }}>Costo total del período</td>
                <td style={{ textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{money(totalCosto, [...monedas][0])}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {!meta.recursos.length && <p className="subtitle">Registre los recursos en la pestaña «Recursos».</p>}
    </>
  );
}

function CeldaDisp({ x, moneda, verCostos }: { x: FilaDisp["dias"][number]; moneda: "CLP" | "USD"; verCostos: boolean }) {
  if (!x.jornada && !x.ocupado)
    return <td aria-label="Sin jornada" style={{ background: "repeating-linear-gradient(135deg, #f4f6fa 0 4px, #e9edf2 4px 8px)" }} />;
  const pct = x.jornada ? Math.min(100, Math.round((100 * x.ocupado) / x.jornada)) : 100;
  const color = pct >= 90 ? "#c0392b" : pct >= 50 ? "#d68a00" : "#008c9e";
  const titulo = `${x.dia}: ${horas(x.ocupado)} ocupadas de ${horas(x.jornada)}${x.eventos ? ` · ${x.eventos} evento(s)` : ""}${x.analisis ? ` · ${x.analisis} análisis` : ""}${verCostos && x.costo ? ` · ${money(x.costo, moneda)}` : ""}`;
  return (
    <td title={titulo} style={{ padding: "6px 4px", textAlign: "center" }}>
      <div aria-hidden style={{ height: 6, borderRadius: 3, background: "#e6ebf0", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color }} />
      </div>
      <div style={{ fontSize: 10.5, marginTop: 2, fontVariantNumeric: "tabular-nums", color: x.ocupado ? "inherit" : "var(--muted)" }}>{x.ocupado ? `${pct} %` : "libre"}</div>
      <span className="sr-only">{titulo}</span>
    </td>
  );
}

/* ============================================================== recursos === */

function Recursos({ meta, onCambio }: { meta: Meta; onCambio: () => void }) {
  const [editar, setEditar] = useState<Recurso | "nuevo" | null>(null);
  return (
    <>
      {meta.puedeGestionar && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
          <button type="button" className="btn primary sm" onClick={() => setEditar("nuevo")}>+ Nuevo recurso</button>
        </div>
      )}
      {editar && <FormularioRecurso inicial={editar === "nuevo" ? undefined : editar} verCostos={meta.verCostos} onListo={() => { setEditar(null); onCambio(); }} onCancelar={() => setEditar(null)} />}
      <div className="card card--table" style={{ overflowX: "auto" }}>
        <table className="data">
          <thead>
            <tr>
              <th>Recurso</th><th>Tipo</th><th>Unidad</th><th>Horario</th><th>Capacidad</th>
              {meta.verCostos && <th style={{ textAlign: "right" }}>Costo por hora</th>}
              {meta.verCostos && <th style={{ textAlign: "right" }}>Costo por uso</th>}
              <th>Estado</th>
              {meta.puedeGestionar && <th />}
            </tr>
          </thead>
          <tbody>
            {meta.recursos.map((r) => (
              <tr key={r.id} style={{ opacity: r.activo ? 1 : 0.6 }}>
                <td>
                  <div style={{ fontWeight: 600 }}>{r.nombre}</div>
                  {(r.origen || r.descripcion) && <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{[r.origen, r.descripcion].filter(Boolean).join(" · ")}</div>}
                </td>
                <td>{TIPO_RECURSO[r.tipo]}</td>
                <td style={{ fontSize: 12 }}>{r.unidad ?? "Institucional"}</td>
                <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                  {r.horaDesde}–{r.horaHasta}
                  <div style={{ color: "var(--muted)", fontSize: 11 }}>{r.diasHabiles.map((x) => DIAS_CORTOS[x - 1]).join(" ")}</div>
                </td>
                <td>{r.capacidad ?? "—"}</td>
                {meta.verCostos && <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.costoHora != null ? money(r.costoHora, r.moneda) : "—"}</td>}
                {meta.verCostos && <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.costoUso != null ? money(r.costoUso, r.moneda) : "—"}</td>}
                <td>{r.activo ? <span className="pill green">Activo</span> : <span className="pill gray">Inactivo</span>}</td>
                {meta.puedeGestionar && (
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button type="button" className="btn ghost sm" onClick={() => setEditar(r)}>Editar</button>
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={async () => {
                        if (!confirm(`¿Dar de baja «${r.nombre}»?`)) return;
                        try {
                          await llamar("DELETE", `/agenda/recursos/${r.id}`);
                          toast.ok("Recurso dado de baja.");
                          onCambio();
                        } catch (e: any) {
                          toast.error(e.message);
                        }
                      }}
                    >
                      Baja
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {!meta.recursos.length && (
              <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--muted)", padding: 18 }}>No hay recursos registrados{meta.puedeGestionar ? ": use «+ Nuevo recurso»." : "."}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function FormularioRecurso({ inicial, verCostos, onListo, onCancelar }: { inicial?: Recurso; verCostos: boolean; onListo: () => void; onCancelar: () => void }) {
  const unidades = useUnidades();
  const [v, setV] = useState({
    tipo: inicial?.tipo ?? "SALA",
    nombre: inicial?.nombre ?? "",
    descripcion: inicial?.descripcion ?? "",
    unidadId: inicial?.unidadId ?? "",
    origenId: inicial?.equipoId ?? inicial?.vehiculoId ?? inicial?.ubicacionId ?? "",
    capacidad: inicial?.capacidad?.toString() ?? "",
    costoHora: inicial?.costoHora?.toString() ?? "",
    costoUso: inicial?.costoUso?.toString() ?? "",
    moneda: inicial?.moneda ?? "CLP",
    horaDesde: inicial?.horaDesde ?? "08:30",
    horaHasta: inicial?.horaHasta ?? "17:30",
    diasHabiles: inicial?.diasHabiles ?? [1, 2, 3, 4, 5],
    activo: inicial?.activo ?? true,
  });
  const [origenes, setOrigenes] = useState<{ id: string; nombre: string }[]>([]);
  const set = <K extends keyof typeof v>(k: K, x: (typeof v)[K]) => setV((s) => ({ ...s, [k]: x }));
  const liga = ["EQUIPO", "VEHICULO", "SALA"].includes(v.tipo);
  useEffect(() => {
    if (!liga) return setOrigenes([]);
    llamar<any[]>("GET", `/agenda/recursos/origenes${qs({ tipo: v.tipo })}`).then(setOrigenes).catch(() => setOrigenes([]));
  }, [v.tipo, liga]);
  const campoOrigen = v.tipo === "EQUIPO" ? "equipoId" : v.tipo === "VEHICULO" ? "vehiculoId" : "ubicacionId";

  return (
    <form
      className="card"
      onSubmit={async (e) => {
        e.preventDefault();
        const cuerpo: any = {
          tipo: v.tipo, nombre: v.nombre, descripcion: v.descripcion, unidadId: v.unidadId || null, capacidad: v.capacidad === "" ? null : Number(v.capacidad),
          moneda: v.moneda, horaDesde: v.horaDesde, horaHasta: v.horaHasta, diasHabiles: v.diasHabiles, activo: v.activo,
          ...(verCostos ? { costoHora: v.costoHora === "" ? null : Number(v.costoHora), costoUso: v.costoUso === "" ? null : Number(v.costoUso) } : {}),
          ...(liga ? { [campoOrigen]: v.origenId || null } : {}),
        };
        try {
          if (inicial) await llamar("PATCH", `/agenda/recursos/${inicial.id}`, cuerpo);
          else await llamar("POST", "/agenda/recursos", cuerpo);
          toast.ok(inicial ? "Recurso actualizado." : "Recurso registrado.");
          onListo();
        } catch (x: any) {
          toast.error(x.message);
        }
      }}
    >
      <h2 style={{ marginTop: 0 }}>{inicial ? `Recurso «${inicial.nombre}»` : "Nuevo recurso"}</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
        <div className="field">
          <label htmlFor="re-tipo">Tipo</label>
          <select id="re-tipo" value={v.tipo} onChange={(e) => { set("tipo", e.target.value); set("origenId", ""); }}>
            {Object.entries(TIPO_RECURSO).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select>
        </div>
        <div className="field" style={{ gridColumn: "span 2" }}><label htmlFor="re-nombre">Nombre</label><input id="re-nombre" required maxLength={120} value={v.nombre} onChange={(e) => set("nombre", e.target.value)} placeholder="Ej.: Camioneta de muestreo 4x4" /></div>
        {liga && (
          <div className="field">
            <label htmlFor="re-origen">{v.tipo === "EQUIPO" ? "Equipo del inventario" : v.tipo === "VEHICULO" ? "Vehículo registrado" : "Ubicación (sala)"}</label>
            <select id="re-origen" value={v.origenId} onChange={(e) => set("origenId", e.target.value)}>
              <option value="">Sin ligar</option>
              {origenes.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor="re-unidad">Unidad</label>
          <select id="re-unidad" value={v.unidadId} onChange={(e) => set("unidadId", e.target.value)}>
            <option value="">Institucional (todas)</option>
            {unidades.map((u) => <option key={u.id} value={u.id}>{u.codigo} · {u.nombre}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="re-cap">Capacidad (personas o plazas)</label><input id="re-cap" type="number" min={0} value={v.capacidad} onChange={(e) => set("capacidad", e.target.value)} /></div>
        <div className="field"><label htmlFor="re-desde">Disponible desde</label><input id="re-desde" type="time" required value={v.horaDesde} onChange={(e) => set("horaDesde", e.target.value)} /></div>
        <div className="field"><label htmlFor="re-hasta">Hasta</label><input id="re-hasta" type="time" required value={v.horaHasta} onChange={(e) => set("horaHasta", e.target.value)} /></div>
        {verCostos && (
          <>
            <div className="field"><label htmlFor="re-ch">Costo por hora</label><input id="re-ch" type="number" min={0} step="0.01" value={v.costoHora} onChange={(e) => set("costoHora", e.target.value)} /></div>
            <div className="field"><label htmlFor="re-cu">Costo fijo por uso</label><input id="re-cu" type="number" min={0} step="0.01" value={v.costoUso} onChange={(e) => set("costoUso", e.target.value)} /></div>
            <div className="field">
              <label htmlFor="re-mon">Moneda</label>
              <select id="re-mon" value={v.moneda} onChange={(e) => set("moneda", e.target.value as "CLP" | "USD")}>
                <option value="CLP">CLP</option>
                <option value="USD">USD</option>
              </select>
            </div>
          </>
        )}
        <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="re-desc">Descripción</label><input id="re-desc" maxLength={500} value={v.descripcion} onChange={(e) => set("descripcion", e.target.value)} /></div>
      </div>
      <div role="group" aria-label="Días disponibles" style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center", margin: "2px 0 10px" }}>
        <span style={{ fontSize: 12.5, marginRight: 4 }}>Días disponibles:</span>
        {DIAS_CORTOS.map((d, i) => {
          const n = i + 1;
          const on = v.diasHabiles.includes(n);
          return (
            <button key={d} type="button" aria-pressed={on} onClick={() => set("diasHabiles", on ? v.diasHabiles.filter((x) => x !== n) : [...v.diasHabiles, n].sort())}
              style={{ border: "1px solid var(--line)", borderRadius: 14, padding: "3px 10px", fontSize: 12, cursor: "pointer", background: on ? "var(--accent)" : "#fff", color: on ? "#fff" : "inherit" }}>
              {d}
            </button>
          );
        })}
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, marginLeft: 12 }}>
          <input type="checkbox" checked={v.activo} onChange={(e) => set("activo", e.target.checked)} style={{ width: "auto" }} /> Activo
        </label>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn primary sm">{inicial ? "Guardar" : "Registrar recurso"}</button>
        <button type="button" className="btn sm" onClick={onCancelar}>Cancelar</button>
      </div>
    </form>
  );
}
