"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { fecha, fechaHora, rut } from "@/lib/format";

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
  const [tab, setTab] = useState<"cabecera" | "muestras" | "resultados" | "informe" | "flujo">("cabecera");
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

  useEffect(() => {
    (async () => {
      try {
        const o = await fetch(`${API}/ot/${id}`, { headers: auth() }).then((x) => x.json());
        setOt(o);
        const m = await fetch(`${API}/muestras?limit=200`, { headers: auth() }).then((x) => x.json());
        setMuestras((m.data ?? []).filter((x: any) => x.otId === id));
      } catch (e: any) { setError(e.message); }
    })();
    cargarFlujo();
  }, [id]);

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
        </div>
      </div>

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
            {tabBtn("muestras", `Muestras (${muestras.length})`)}
            {tabBtn("resultados", "Resultados")}
            {tabBtn("informe", "Informe")}
            {tabBtn("flujo", `Flujo${tieneFlujo ? ` (${tareas.length})` : ""}`)}
          </div>
          <div style={{ padding: 15 }}>
            {tab === "cabecera" && (
              <div className="form-grid">
                <div className="field readonly"><label>Código OT</label><input value={ot?.codigo ?? "—"} readOnly /></div>
                <div className="field readonly"><label>Cliente</label><input value={ot?.cliente?.razonSocial ?? "—"} readOnly /></div>
                <div className="field readonly"><label>RUT cliente</label><input value={ot?.cliente?.rut ? rut(ot.cliente.rut) : "—"} readOnly /></div>
                <div className="field readonly"><label>Estado</label><input value={ot?.estado ?? "—"} readOnly /></div>
                <div className="field readonly"><label>Prioridad</label><input value={ot?.prioridad ?? "normal"} readOnly /></div>
                <div className="field readonly"><label>Ingreso</label><input value={fecha(ot?.fechaIngreso ?? ot?.createdAt)} readOnly /></div>
              </div>
            )}
            {tab === "muestras" && (
              muestras.length ? (
                <table className="data">
                  <thead><tr><th>Código</th><th>Muestra</th><th>Estado</th></tr></thead>
                  <tbody>{muestras.map((m) => <tr key={m.id}><td><span className="codigo">{m.codigo}</span></td><td>{m.nombre ?? "—"}</td><td><span className="pill gray">{m.estado}</span></td></tr>)}</tbody>
                </table>
              ) : <p className="subtitle" style={{ margin: 0 }}>Sin muestras asociadas a esta OT.</p>
            )}
            {tab === "resultados" && (
              <p className="subtitle" style={{ margin: 0 }}>Captura de réplicas y estadística en <Link href={"/captura" as any} style={{ color: "var(--accent)" }}>Captura de resultados</Link>. Cada resultado calcula promedio/DE/CV y veredicto contra el límite del producto.</p>
            )}
            {tab === "informe" && (
              <p className="subtitle" style={{ margin: 0 }}>El informe/certificado se genera con las plantillas del repositorio (autorelleno con datos de la OT, cliente y resultados), con HASH y código de verificación. Ver <Link href={"/plantillas" as any} style={{ color: "var(--accent)" }}>Plantillas de informe</Link>.</p>
            )}
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
                              return (
                                <tr key={t.id}>
                                  <td>{p?.numero != null ? `${p.numero}. ` : ""}{p?.actividad ?? "—"}</td>
                                  <td>{p?.tipo ?? "—"}</td>
                                  <td><span className="codigo">{t.asignadoA ? String(t.asignadoA).slice(0, 8) : "—"}</span></td>
                                  <td>{fechaHora(t.venceAt)}</td>
                                  <td><span className={`pill ${estadoPill[t.estado] ?? "gray"}`}>{t.estado}</span></td>
                                  <td style={{ textAlign: "right" }}>
                                    <button className="btn success sm" disabled={busy} onClick={() => completarTarea(t.pasoEjecucionId)}>
                                      {busy ? "…" : "Completar"}
                                    </button>
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
