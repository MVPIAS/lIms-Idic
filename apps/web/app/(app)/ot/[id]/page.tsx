"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { fecha, fechaHora, fechaDia, rut, clp, num } from "@/lib/format";
import { ORIGEN_LABEL } from "../../cotizaciones/_components/comercial";
import { usePermisos } from "@/lib/permisos";
import { llamar, etiquetaUnidad } from "@/lib/laboratorio";
import { toast } from "@/components/ui/feedback";
import SelectorLaboratorio from "@/components/SelectorLaboratorio";
import Asignacion from "./_components/Asignacion";
import RegistroMuestras from "./_components/RegistroMuestras";
import OrdenesInternasOt from "./_components/OrdenesInternasOt";
import PanelCierreOt from "@/components/documentos/PanelCierreOt";
import OrigenBpchOt from "@/components/bpch-procesos/OrigenBpchOt";

/** Texto legible de un hecho del historial de la OT. */
function textoHistorial(h: any): string {
  const d = h.detalle ?? {};
  if (h.tipo === "laboratorio") {
    const hacia = d.hacia?.codigo ?? "—";
    if (d.desde) return `Laboratorio cambiado de ${d.desde.codigo} a ${hacia}${d.motivo ? ` · motivo: ${d.motivo}` : ""}`;
    const como: Record<string, string> = {
      alta_indicado: "indicado al registrar la OT",
      alta_deducido: "deducido del catálogo al registrar la OT",
      aceptacion_indicado: "indicado al aceptar la cotización",
      aceptacion_deducido: "deducido de la cotización al aceptarla",
      saec: "OT del SAEC (Delegación Nº 11)",
      metodos_de_la_muestra: "deducido de los métodos de la muestra",
    };
    return `Laboratorio responsable: ${hacia}${como[d.origen] ? ` (${como[d.origen]})` : ""}`;
  }
  if (h.tipo === "registro_muestras") {
    const ms: any[] = d.muestras ?? [];
    const ensayos = ms.reduce((s, m) => s + Number(m.ensayos ?? 0), 0);
    return `Se registraron ${ms.length} muestra(s) (${ms.map((m) => m.codigo).join(", ")}) con ${ensayos} ensayo(s) por analizar`;
  }
  if (h.tipo === "reapertura_resultado") {
    const docs: any[] = d.documentosAnulados ?? [];
    return `Resultado reabierto: ${d.muestra ?? ""} · ${d.ensayo ?? ""}${d.motivo ? ` · motivo: ${d.motivo}` : ""}` +
      (docs.length ? ` · se anuló ${docs.map((x) => x.numero).join(", ")} (reemitir tras aprobar de nuevo)` : "");
  }
  if (h.tipo === "recepcion_muestra") {
    const cond = (c?: string | null) => (c === "cumple" ? "Cumple" : c === "no_cumple" ? "No cumple" : "sin condición");
    return `Recepción de ${d.muestra ?? "la muestra"} corregida: ${cond(d.anterior?.condicionRecepcion)} → ${cond(d.nuevo?.condicionRecepcion)}`;
  }
  if (h.tipo === "costos_reales")
    return d.accion === "reabrir" ? `Planilla de costos reales reabierta · motivo: ${d.motivo ?? ""}` : `Planilla de costos reales cerrada · total $${Math.round(Number(d.total ?? 0)).toLocaleString("es-CL")}`;
  const n = (d.usuarios ?? []).length;
  if (h.tipo === "asignacion") return `Se asignaron ${n} persona${n === 1 ? "" : "s"} a la OT`;
  if (h.tipo === "desasignacion") return `Se retiraron ${n} persona${n === 1 ? "" : "s"} de la OT${d.motivo ? ` (${d.motivo})` : ""}`;
  if (h.tipo === "asignacion_ensayo")
    return d.usuario ? `Asignación de ${d.actualizados ?? ""} ensayo(s) a una persona concreta` : `Se retiró la asignación concreta de ${d.actualizados ?? ""} ensayo(s)`;
  return h.tipo;
}

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("lims_token")}` });
const authJson = () => ({ ...auth(), "Content-Type": "application/json" });

const FASES = [
  "Recepción", "Registro", "Asignación", "Preparación", "Análisis", "Captura RN",
  "Cálculo", "Validación técnica", "Revisión", "Aprobación", "Emisión informe",
  "Firma", "Entrega", "Cierre",
];

// mapea el estado de la OT a un índice de avance aproximado en el stepper
const idxEstado: Record<string, number> = {
  borrador: 0, recibida: 1, en_proceso: 4, en_analisis: 4, resultados: 6,
  validacion: 8, aprobada: 9, informe: 10, finalizada: 12, cerrada: 13,
};

// color del pill según el estado de la instancia / paso
const estadoPill: Record<string, string> = {
  en_ejecucion: "blue", iniciado: "blue", en_curso: "amber", pendiente: "amber",
  completado: "green", completada: "green", cancelado: "red",
};

export default function ExpedientePage() {
  const { id } = useParams<{ id: string }>();
  const [ot, setOt] = useState<any>(null);
  const [muestras, setMuestras] = useState<any[]>([]);
  const [tab, setTab] = useState<"cabecera" | "asignacion" | "muestras" | "ordenes" | "resultados" | "informe" | "flujo" | "historial">("cabecera");
  /** Laboratorio propuesto como destino al pulsar «Emitir orden interna» en la recepción de una muestra. */
  const [destinoOi, setDestinoOi] = useState<string | null>(null);
  const { puede } = usePermisos();
  const [historial, setHistorial] = useState<any[]>([]);
  const [cambiandoLab, setCambiandoLab] = useState(false);
  const [labNuevo, setLabNuevo] = useState("");
  const [labMotivo, setLabMotivo] = useState("");
  const [error, setError] = useState("");

  // ---- flujo (BPM) ----
  const [flujo, setFlujo] = useState<{ instancia: any; tareas: any[] } | null>(null);
  const [defs, setDefs] = useState<any[]>([]);
  const [defSel, setDefSel] = useState("");
  const [busy, setBusy] = useState(false);
  const [flujoMsg, setFlujoMsg] = useState("");

  const cargarFlujo = async () => {
    try {
      const f = await fetch(`${API}/ot/${id}/flujo`, { headers: auth() }).then((x) => x.json());
      setFlujo(f);
    } catch (e: any) { setFlujoMsg(e.message); }
  };

  const cargarOt = async () => {
    try {
      const o = await llamar("GET", `/ot/${id}`);
      setOt(o);
    } catch (e: any) { setError(e.message); }
  };
  const cargarHistorial = async () => {
    try { setHistorial(await llamar("GET", `/ot/${id}/historial`)); } catch { setHistorial([]); }
  };

  const cargarMuestras = async () => {
    try {
      // Solo las muestras de ESTA OT (antes se traían 200 y se filtraban aquí).
      const m = await llamar("GET", `/muestras?otId=${id}&limit=200`);
      setMuestras(m.data ?? []);
    } catch (e: any) { setError(e.message); }
  };

  useEffect(() => {
    (async () => {
      await cargarOt();
      await cargarMuestras();
    })();
    cargarFlujo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (tab === "historial") cargarHistorial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // ---- Laboratorio responsable (PATCH /ot/:id/laboratorio) ----
  const guardarLaboratorio = async () => {
    if (!labNuevo) return;
    if (ot?.unidadPrincipal && labMotivo.trim().length < 5) { toast.error("Indique el motivo del cambio (mínimo 5 caracteres)."); return; }
    setBusy(true);
    try {
      const r = await llamar("PATCH", `/ot/${id}/laboratorio`, { unidadPrincipalId: labNuevo, motivo: labMotivo.trim() || undefined });
      toast.ok(`Laboratorio responsable: ${r?.unidad?.codigo ?? ""}.`);
      setCambiandoLab(false); setLabNuevo(""); setLabMotivo("");
      await cargarOt();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  // Defs publicadas: solo se ofrecen las que tienen una versión publicada vigente.
  useEffect(() => {
    if (tab !== "flujo" || flujo?.instancia || defs.length) return;
    (async () => {
      try {
        const d = await fetch(`${API}/flujos`, { headers: auth() }).then((x) => x.json());
        const arr = Array.isArray(d) ? d : d.data ?? [];
        setDefs(arr.filter((x: any) => x.versiones?.[0]?.estado === "publicado"));
      } catch (e: any) { setFlujoMsg(e.message); }
    })();
  }, [tab, flujo, defs.length]);

  const iniciarFlujo = async () => {
    if (!defSel) return;
    setBusy(true); setFlujoMsg("");
    try {
      const res = await fetch(`${API}/ot/${id}/flujo`, {
        method: "POST", headers: authJson(), body: JSON.stringify({ flujoDefId: defSel }),
      });
      if (!res.ok) throw new Error((await res.json())?.message ?? `Error ${res.status}`);
      await cargarFlujo();
      const o = await fetch(`${API}/ot/${id}`, { headers: auth() }).then((x) => x.json());
      setOt(o);
    } catch (e: any) { setFlujoMsg(String(e.message)); }
    finally { setBusy(false); }
  };

  // ---- SVT7 · registrar OPI (limpia «OPI pendiente») ----
  const [opiNumero, setOpiNumero] = useState("");
  const [opiFecha, setOpiFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [opiMsg, setOpiMsg] = useState("");
  const registrarOpi = async () => {
    setBusy(true); setOpiMsg("");
    try {
      const res = await fetch(`${API}/ot/${id}/registrar-opi`, {
        method: "POST", headers: authJson(), body: JSON.stringify({ numero: opiNumero.trim(), fecha: opiFecha }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.message ?? `Error ${res.status}`);
      setOt((prev: any) => ({ ...prev, ...j }));
    } catch (e: any) { setOpiMsg(String(e.message)); }
    finally { setBusy(false); }
  };

  const completarTarea = async (pasoEjecucionId: string) => {
    setBusy(true); setFlujoMsg("");
    try {
      const res = await fetch(`${API}/flujos/tareas/${pasoEjecucionId}/completar`, {
        method: "POST", headers: authJson(), body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error((await res.json())?.message ?? `Error ${res.status}`);
      await cargarFlujo();
    } catch (e: any) { setFlujoMsg(String(e.message)); }
    finally { setBusy(false); }
  };

  const avance = ot ? idxEstado[ot.estado] ?? 0 : 0;
  const codOt = ot?.codigo ?? ot?.numero ?? (typeof id === "string" ? id.slice(0, 8) : "");
  const tabBtn = (t: typeof tab, l: string) =>
    <button onClick={() => setTab(t)} className={`tab${tab === t ? " active" : ""}`}>{l}</button>;

  const instancia = flujo?.instancia;
  const ejecuciones: any[] = instancia?.ejecuciones ?? [];
  const tareas: any[] = flujo?.tareas ?? [];
  const pasoActualId = instancia?.pasoActualId;
  const tieneFlujo = Boolean(instancia);
  const flujoBadge = tieneFlujo
    ? <span className={`pill ${estadoPill[instancia.estado] ?? "gray"}`}>{instancia.estado}</span>
    : <span className="pill gray">sin flujo</span>;

  return (
    <div>
      <Link href={"/ot" as any} className="subtitle" style={{ display: "inline-block", color: "var(--accent)", textDecoration: "none" }}>← Expedientes / OT</Link>
      {error && <div className="alert warn">{error}</div>}

      <div className="exphead">
        <div className="id">🗂 {codOt}</div>
        <div className="meta">
          Cliente: <b>{ot?.cliente?.razonSocial ?? "—"}</b>
          {ot?.cliente?.rut ? <> ({rut(ot.cliente.rut)})</> : null} · Estado: <b>{ot?.estado ?? "—"}</b> · Prioridad: <b>{ot?.prioridad ?? "normal"}</b>
          {ot?.origenTrabajo ? <> · Origen: <b>{ORIGEN_LABEL[ot.origenTrabajo] ?? ot.origenTrabajo}</b></> : null}
          {" · "}Laboratorio: {ot?.unidad ? <b title={ot.unidad.nombre}>{ot.unidad.codigo}</b> : <span className="pill amber">sin laboratorio</span>}
          {ot?.fechaCompromiso ? <> · Compromiso: <b>{fechaDia(ot.fechaCompromiso)}</b></> : null}
          {ot?.opiPendiente && <span className="pill amber" style={{ marginLeft: 8 }}>OPI pendiente</span>}
          {ot?.conCobro === false && <span className="pill gray" style={{ marginLeft: 8 }}>Sin cobro</span>}
        </div>
      </div>

      {ot && <OrigenBpchOt otId={ot.id} origenTrabajo={ot.origenTrabajo} />}

      {ot && !ot.unidadPrincipal && (
        <div className="alert warn">
          Esta OT <b>no tiene laboratorio responsable</b>: nadie del laboratorio la ve.
          {puede("ot.cambiar_laboratorio") ? " Fíjelo en la pestaña «Cabecera»." : " Pida a Planificación o a la jefatura que lo fije."}
        </div>
      )}

      {/* SVT7 · OT por disposición del Director con cobro: falta la OPI. */}
      {ot?.opiPendiente && (
        <div className="alert warn">
          <div style={{ marginBottom: 6 }}>
            OT creada por <b>disposición del Director</b>{ot.disposicionRef ? <> ({ot.disposicionRef})</> : null} con cobro: está <b>pendiente la OPI</b>.
          </div>
          {!puede("ot.crear") ? (
            <div>La registra Comercial o Planificación cuando llegue la OPI.</div>
          ) : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div className="field"><label>Nº OPI</label><input value={opiNumero} onChange={(e) => setOpiNumero(e.target.value)} maxLength={60} /></div>
            <div className="field"><label>Fecha OPI</label><input type="date" value={opiFecha} onChange={(e) => setOpiFecha(e.target.value)} /></div>
            <button className="btn primary sm" disabled={busy || !opiNumero.trim() || !opiFecha} onClick={registrarOpi}>Registrar OPI</button>
          </div>
          )}
          {opiMsg && <div style={{ marginTop: 6 }}>{opiMsg}</div>}
        </div>
      )}

      <div className="expgrid">
        {/* Stepper vertical de 14 fases */}
        <div className="stepper">
          {FASES.map((f, i) => {
            const estado = i < avance ? "done" : i === avance ? "now" : "pend";
            return (
              <div key={f} className={`step ${estado === "done" ? "done" : estado === "now" ? "now" : "locked"}`}>
                <div className="dot">{estado === "done" ? "✓" : i + 1}</div>
                <div className="txt">{f}<small>Fase {i + 1}</small></div>
              </div>
            );
          })}
        </div>

        <div className="card" style={{ padding: 0 }}>
          <div className="tabs" style={{ padding: "0 8px" }}>
            {tabBtn("cabecera", "Cabecera")}
            {tabBtn("asignacion", `Asignación${ot?.analistas?.length ? ` (${ot.analistas.length})` : ""}`)}
            {tabBtn("muestras", `Muestras (${muestras.length})`)}
            {tabBtn("ordenes", "Órdenes internas")}
            {tabBtn("resultados", "Resultados")}
            {tabBtn("informe", "Informe y cierre")}
            {tabBtn("flujo", `Flujo${tieneFlujo ? ` (${tareas.length})` : ""}`)}
            {tabBtn("historial", "Historial")}
          </div>
          <div style={{ padding: 15 }}>
            {tab === "cabecera" && (
              <div style={{ display: "grid", gap: 12 }}>
              <div className="card" style={{ padding: 10, margin: 0 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", fontWeight: 600 }}>Laboratorio responsable</div>
                    <div style={{ fontWeight: 700 }}>{ot?.unidad ? etiquetaUnidad(ot.unidad) : "Sin laboratorio"}</div>
                    {ot?.unidadAsignadaAt && (
                      <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                        Fijado el {fechaHora(ot.unidadAsignadaAt)}{ot.unidadAsignadaPorNombre ? ` por ${ot.unidadAsignadaPorNombre}` : ""}. Ver «Historial».
                      </div>
                    )}
                  </div>
                  <div style={{ flex: 1 }} />
                  {puede("ot.cambiar_laboratorio") && !["cerrada", "anulada"].includes(ot?.estado) && !cambiandoLab && (
                    <button className="btn outline sm" onClick={() => setCambiandoLab(true)}>
                      {ot?.unidadPrincipal ? "Cambiar laboratorio" : "Fijar laboratorio"}
                    </button>
                  )}
                </div>
                {cambiandoLab && (
                  <div className="form-grid cols-2" style={{ marginTop: 10 }}>
                    <SelectorLaboratorio valor={labNuevo} onCambio={setLabNuevo} excluirId={ot?.unidadPrincipal} etiqueta="Nuevo laboratorio responsable" />
                    {ot?.unidadPrincipal ? (
                      <div className="field">
                        <label>Motivo del cambio <span className="req">*</span></label>
                        <input value={labMotivo} onChange={(e) => setLabMotivo(e.target.value)} maxLength={500} />
                      </div>
                    ) : <div />}
                    <p className="hint" style={{ margin: 0, gridColumn: "1 / -1", fontSize: 11.5, color: "var(--muted)" }}>
                      {ot?.unidadPrincipal
                        ? "Al cambiar de laboratorio se retiran las asignaciones del personal del laboratorio anterior. Queda registrado quién y cuándo."
                        : "Queda registrado quién lo fijó y cuándo."}
                    </p>
                    <div className="toolbar" style={{ gridColumn: "1 / -1", margin: 0 }}>
                      <button className="btn outline sm" onClick={() => { setCambiandoLab(false); setLabNuevo(""); setLabMotivo(""); }}>Cancelar</button>
                      <button className="btn primary sm" disabled={busy || !labNuevo} onClick={guardarLaboratorio}>Guardar</button>
                    </div>
                  </div>
                )}
              </div>
              <div className="form-grid">
                <div className="field readonly"><label>Código OT</label><input value={ot?.codigo ?? "—"} readOnly /></div>
                <div className="field readonly"><label>Cliente</label><input value={ot?.cliente?.razonSocial ?? "—"} readOnly /></div>
                <div className="field readonly"><label>RUT cliente</label><input value={ot?.cliente?.rut ? rut(ot.cliente.rut) : "—"} readOnly /></div>
                <div className="field readonly"><label>Estado</label><input value={ot?.estado ?? "—"} readOnly /></div>
                <div className="field readonly"><label>Prioridad</label><input value={ot?.prioridad ?? "normal"} readOnly /></div>
                <div className="field readonly"><label>Ingreso</label><input value={fecha(ot?.fechaIngreso ?? ot?.createdAt)} readOnly /></div>
                <div className="field readonly"><label>Origen</label><input value={ot?.origenTrabajo ? ORIGEN_LABEL[ot.origenTrabajo] ?? ot.origenTrabajo : "—"} readOnly /></div>
                <div className="field readonly"><label>Cobro</label><input value={ot ? (ot.conCobro === false ? "Sin cobro" : "Con cobro") : "—"} readOnly /></div>
                <div className="field readonly"><label>OPI</label><input value={ot?.opiNumero ? `${ot.opiNumero} · ${fechaDia(ot.opiFecha)}` : ot?.opiPendiente ? "Pendiente" : "—"} readOnly /></div>
                {ot?.disposicionRef && <div className="field readonly"><label>Disposición del Director</label><input value={`${ot.disposicionRef}${ot.disposicionFecha ? ` · ${fechaDia(ot.disposicionFecha)}` : ""}`} readOnly /></div>}
                {ot?.numeroLey && <div className="field readonly"><label>Resolución DGMN</label><input value={ot.numeroLey} readOnly /></div>}
                <div className="field readonly"><label>Horas hombre</label><input value={num(ot?.horasHombre, 1)} readOnly /></div>
                <div className="field readonly"><label>Costo estimado</label><input value={clp(ot?.costoEstimado)} readOnly /></div>
                {/* La fecha de compromiso se fija en «Informe y cierre» (PUT /ot/:id/fecha-compromiso):
                    ahí queda registrado quién la fijó, cuándo y por qué se cambió. */}
                <div className="field readonly"><label>Fecha de compromiso</label><input value={ot?.fechaCompromiso ? fechaDia(ot.fechaCompromiso) : "Sin fecha (ver «Informe y cierre»)"} readOnly /></div>
              </div>
              </div>
            )}
            {tab === "asignacion" && typeof id === "string" && <Asignacion otId={id} onCambio={cargarOt} />}
            {tab === "historial" && (
              historial.length ? (
                <table className="data">
                  <thead><tr><th>Fecha</th><th>Quién</th><th>Qué</th></tr></thead>
                  <tbody>
                    {historial.map((h) => (
                      <tr key={h.id}><td style={{ whiteSpace: "nowrap" }}>{fechaHora(h.createdAt)}</td><td>{h.usuarioNombre ?? "—"}</td><td>{textoHistorial(h)}</td></tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="subtitle" style={{ margin: 0 }}>Sin movimientos registrados de laboratorio ni de asignación.</p>
            )}
            {tab === "muestras" && typeof id === "string" && (
              <RegistroMuestras otId={id} onCambio={() => { cargarMuestras(); cargarOt(); }}
                onOrdenInterna={(unidadId) => { setDestinoOi(unidadId ?? null); setTab("ordenes"); }} />
            )}
            {tab === "ordenes" && typeof id === "string" && (
              <OrdenesInternasOt otId={id} otCodigo={ot?.codigo} otEstado={ot?.estado}
                destinoSugerido={destinoOi} onSugerenciaUsada={() => setDestinoOi(null)} />
            )}
            {tab === "resultados" && (
              <div style={{ display: "grid", gap: 8 }}>
                <p className="subtitle" style={{ margin: 0 }}>
                  Los resultados de esta OT se capturan, revisan y aprueban en{" "}
                  <Link href={`/captura-ot?otId=${id}` as any} style={{ color: "var(--accent)" }}>Captura y revisión por OT</Link>:
                  ahí se ve quién capturó, revisó y aprobó cada valor, y cuándo.
                </p>
                <div className="toolbar" style={{ margin: 0 }}>
                  {puede("resultado.ver") && <Link href={`/ot/${id}/calculos` as any} className="btn outline sm">Planilla de registros y cálculos</Link>}
                  {puede("costo_real.ver") && <Link href={`/ot/${id}/costos` as any} className="btn outline sm">Planilla de costos reales</Link>}
                </div>
              </div>
            )}
            {/* Fecha de compromiso, documentos (firma y entrega) y cierre de la OT. */}
            {tab === "informe" && typeof id === "string" && <PanelCierreOt otId={id} onCambio={cargarOt} />}
            {tab === "flujo" && (
              <div>
                {flujoMsg && <div className="alert warn">{flujoMsg}</div>}

                {/* Sin flujo → selector + iniciar */}
                {!tieneFlujo && (
                  <div>
                    <p className="subtitle" style={{ marginTop: 0 }}>Esta OT no tiene un flujo (BPM) asociado. Selecciona un flujo publicado para iniciar su ejecución.</p>
                    <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                      <div className="field" style={{ minWidth: 320 }}>
                        <label>Flujo publicado</label>
                        <select value={defSel} onChange={(e) => setDefSel(e.target.value)}>
                          <option value="">— Selecciona un flujo —</option>
                          {defs.map((d) => (
                            <option key={d.id} value={d.id}>{d.codigo} · {d.nombre} ({d.versiones?.[0]?.version})</option>
                          ))}
                        </select>
                      </div>
                      <button className="btn primary" disabled={!defSel || busy} onClick={iniciarFlujo}>
                        {busy ? "Iniciando…" : "Iniciar flujo"}
                      </button>
                    </div>
                    {!defs.length && <p className="subtitle" style={{ marginBottom: 0 }}>No hay flujos publicados disponibles. Publica uno en <Link href={"/flujos" as any} style={{ color: "var(--accent)" }}>Diseñador de flujos</Link>.</p>}
                  </div>
                )}

                {/* Con flujo → estado + pasos + tareas */}
                {tieneFlujo && (
                  <div style={{ display: "grid", gap: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <div>
                        <b>{instancia.version?.def?.codigo}</b> · {instancia.version?.def?.nombre}
                        <small style={{ display: "block", color: "var(--muted)" }}>Versión {instancia.version?.version} · Instancia {String(instancia.id).slice(0, 8)}</small>
                      </div>
                      {flujoBadge}
                    </div>

                    {/* Recorrido del flujo (ejecuciones) como mini-stepper */}
                    <div className="stepper" style={{ margin: 0 }}>
                      {ejecuciones.map((e) => {
                        const done = e.estado === "completado";
                        const now = e.pasoId === pasoActualId && !done;
                        return (
                          <div key={e.id} className={`step ${done ? "done" : now ? "now" : "locked"}`}>
                            <div className="dot">{done ? "✓" : e.paso?.numero ?? "•"}</div>
                            <div className="txt">
                              {e.paso?.actividad ?? "—"}
                              <small>{e.paso?.tipo} · {e.estado}{e.excedioSla ? " · ⚠ SLA excedido" : ""}</small>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Tareas actuales (bandeja de esta instancia) */}
                    <div>
                      <h2 style={{ fontSize: 13, margin: "4px 0 8px" }}>Tareas actuales</h2>
                      {tareas.length ? (
                        <table className="data">
                          <thead><tr><th>Paso</th><th>Tipo</th><th>Responsable</th><th>Vence</th><th>Estado</th><th></th></tr></thead>
                          <tbody>
                            {tareas.map((t) => {
                              const p = t.pasoEjecucion?.paso;
                              const permiso: string | undefined = t.permisoRequerido;
                              const habilitado = !permiso || puede(permiso);
                              return (
                                <tr key={t.id}>
                                  <td>{p?.numero != null ? `${p.numero}. ` : ""}{p?.actividad ?? "—"}</td>
                                  <td>{p?.tipo ?? "—"}</td>
                                  <td><span className="codigo">{t.asignadoA ? String(t.asignadoA).slice(0, 8) : "—"}</span></td>
                                  <td>{fechaHora(t.venceAt)}</td>
                                  <td><span className={`pill ${estadoPill[t.estado] ?? "gray"}`}>{t.estado}</span></td>
                                  <td style={{ textAlign: "right" }}>
                                    {habilitado ? (
                                      <button className="btn success sm" disabled={busy} onClick={() => completarTarea(t.pasoEjecucionId)}>
                                        {busy ? "…" : "Completar"}
                                      </button>
                                    ) : (
                                      <span className="pill gray" title={`Este paso lo completa quien tiene el permiso «${permiso}».`}>Sin permiso</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      ) : instancia.estado === "completado" ? (
                        <div className="alert success">Flujo completado. No hay tareas pendientes.</div>
                      ) : (
                        <p className="subtitle" style={{ margin: 0 }}>Sin tareas pendientes en este momento.</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
