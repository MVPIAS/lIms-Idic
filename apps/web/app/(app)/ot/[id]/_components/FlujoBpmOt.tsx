"use client";

/**
 * Pestaña «Flujo» del expediente: instancia del motor de flujos genérico (BPM)
 * ligada a la OT. Solo se muestra si el motor está reactivado
 * (lib/motorFlujos.ts · NEXT_PUBLIC_MOTOR_FLUJOS_VISIBLE=true). Con el motor
 * oculto, el avance de la OT es la «Ruta de la OT» (components/ot/RutaOt.tsx).
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { fechaHora } from "@/lib/format";
import { usePermisos } from "@/lib/permisos";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("lims_token")}` });
const authJson = () => ({ ...auth(), "Content-Type": "application/json" });

// color del pill según el estado de la instancia / paso
const estadoPill: Record<string, string> = {
  en_ejecucion: "blue", iniciado: "blue", en_curso: "amber", pendiente: "amber",
  completado: "green", completada: "green", cancelado: "red",
};

export default function FlujoBpmOt({ otId }: { otId: string }) {
  const { puede } = usePermisos();
  const [flujo, setFlujo] = useState<{ instancia: any; tareas: any[] } | null>(null);
  const [defs, setDefs] = useState<any[]>([]);
  const [defSel, setDefSel] = useState("");
  const [busy, setBusy] = useState(false);
  const [flujoMsg, setFlujoMsg] = useState("");

  const cargarFlujo = async () => {
    try {
      setFlujo(await fetch(`${API}/ot/${otId}/flujo`, { headers: auth() }).then((x) => x.json()));
    } catch (e: any) { setFlujoMsg(e.message); }
  };

  useEffect(() => {
    cargarFlujo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otId]);

  // Defs publicadas: solo se ofrecen las que tienen una versión publicada vigente.
  useEffect(() => {
    if (flujo?.instancia || defs.length) return;
    (async () => {
      try {
        const d = await fetch(`${API}/flujos`, { headers: auth() }).then((x) => x.json());
        const arr = Array.isArray(d) ? d : d.data ?? [];
        setDefs(arr.filter((x: any) => x.versiones?.[0]?.estado === "publicado"));
      } catch (e: any) { setFlujoMsg(e.message); }
    })();
  }, [flujo, defs.length]);

  const iniciarFlujo = async () => {
    if (!defSel) return;
    setBusy(true); setFlujoMsg("");
    try {
      const res = await fetch(`${API}/ot/${otId}/flujo`, { method: "POST", headers: authJson(), body: JSON.stringify({ flujoDefId: defSel }) });
      if (!res.ok) throw new Error((await res.json())?.message ?? `Error ${res.status}`);
      await cargarFlujo();
    } catch (e: any) { setFlujoMsg(String(e.message)); }
    finally { setBusy(false); }
  };

  const completarTarea = async (pasoEjecucionId: string) => {
    setBusy(true); setFlujoMsg("");
    try {
      const res = await fetch(`${API}/flujos/tareas/${pasoEjecucionId}/completar`, { method: "POST", headers: authJson(), body: JSON.stringify({}) });
      if (!res.ok) throw new Error((await res.json())?.message ?? `Error ${res.status}`);
      await cargarFlujo();
    } catch (e: any) { setFlujoMsg(String(e.message)); }
    finally { setBusy(false); }
  };

  const instancia = flujo?.instancia;
  const ejecuciones: any[] = instancia?.ejecuciones ?? [];
  const tareas: any[] = flujo?.tareas ?? [];
  const pasoActualId = instancia?.pasoActualId;

  return (
    <div>
      {flujoMsg && <div className="alert warn">{flujoMsg}</div>}
      {!instancia && (
        <div>
          <p className="subtitle" style={{ marginTop: 0 }}>Esta OT no tiene un flujo configurable asociado.</p>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div className="field" style={{ minWidth: 320 }}>
              <label>Flujo publicado</label>
              <select value={defSel} onChange={(e) => setDefSel(e.target.value)}>
                <option value="">— Seleccione un flujo —</option>
                {defs.map((d) => <option key={d.id} value={d.id}>{d.codigo} · {d.nombre} ({d.versiones?.[0]?.version})</option>)}
              </select>
            </div>
            <button className="btn primary" disabled={!defSel || busy} onClick={iniciarFlujo}>{busy ? "Iniciando…" : "Iniciar flujo"}</button>
          </div>
          {!defs.length && <p className="subtitle" style={{ marginBottom: 0 }}>No hay flujos publicados. Publique uno en el <Link href={"/flujos" as any} style={{ color: "var(--accent)" }}>Diseñador de flujos</Link>.</p>}
        </div>
      )}
      {instancia && (
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div>
              <b>{instancia.version?.def?.codigo}</b> · {instancia.version?.def?.nombre}
              <small style={{ display: "block", color: "var(--muted)" }}>Versión {instancia.version?.version} · Instancia {String(instancia.id).slice(0, 8)}</small>
            </div>
            <span className={`pill ${estadoPill[instancia.estado] ?? "gray"}`}>{instancia.estado}</span>
          </div>
          <div className="stepper" style={{ margin: 0 }}>
            {ejecuciones.map((e) => {
              const done = e.estado === "completado";
              const now = e.pasoId === pasoActualId && !done;
              return (
                <div key={e.id} className={`step ${done ? "done" : now ? "now" : "locked"}`}>
                  <div className="dot">{done ? "✓" : e.paso?.numero ?? "•"}</div>
                  <div className="txt">{e.paso?.actividad ?? "—"}<small>{e.paso?.tipo} · {e.estado}{e.excedioSla ? " · ⚠ SLA excedido" : ""}</small></div>
                </div>
              );
            })}
          </div>
          <div>
            <h2 style={{ fontSize: 13, margin: "4px 0 8px" }}>Tareas actuales</h2>
            {tareas.length ? (
              <table className="data">
                <thead><tr><th>Paso</th><th>Tipo</th><th>Responsable</th><th>Vence</th><th>Estado</th><th></th></tr></thead>
                <tbody>
                  {tareas.map((t) => {
                    const p = t.pasoEjecucion?.paso;
                    const permiso: string | undefined = t.permisoRequerido;
                    return (
                      <tr key={t.id}>
                        <td>{p?.numero != null ? `${p.numero}. ` : ""}{p?.actividad ?? "—"}</td>
                        <td>{p?.tipo ?? "—"}</td>
                        <td><span className="codigo">{t.asignadoA ? String(t.asignadoA).slice(0, 8) : "—"}</span></td>
                        <td>{fechaHora(t.venceAt)}</td>
                        <td><span className={`pill ${estadoPill[t.estado] ?? "gray"}`}>{t.estado}</span></td>
                        <td style={{ textAlign: "right" }}>
                          {!permiso || puede(permiso) ? (
                            <button className="btn success sm" disabled={busy} onClick={() => completarTarea(t.pasoEjecucionId)}>{busy ? "…" : "Completar"}</button>
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
  );
}
