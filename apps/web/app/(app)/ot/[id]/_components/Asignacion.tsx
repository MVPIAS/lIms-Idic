"use client";

/**
 * Asignación de la OT a analistas (pestaña del expediente).
 *
 * · La jefatura del laboratorio (permiso «ot.asignar») elige qué personas del
 *   laboratorio trabajan la OT —puede haber varias— y, si hace falta, a quién
 *   va cada muestra o cada ensayo.
 * · Solo aparece el personal con rol vigente en el laboratorio responsable
 *   (analistas, técnicos, metrólogos, inspectores, revisores, jefatura).
 * · Quien no tiene el permiso ve la asignación en modo consulta.
 *
 * API: GET /ot/:id/asignacion · PUT /ot/:id/analistas · POST /ot/:id/asignar-ensayos
 */
import { useCallback, useEffect, useState } from "react";
import { fechaHora } from "@/lib/format";
import { toast } from "@/components/ui/feedback";
import { ESTADO_RESULTADO, llamar } from "@/lib/laboratorio";

interface Persona { id: string; nombre: string; username?: string; roles?: string[]; asignadoAt?: string | null; asignadoPor?: string | null }
interface Ensayo { resultadoId: string; estado: string; analito: string; metodo: string | null; asignadoA: string | null; asignadoNombre: string | null }
interface MuestraAsig { id: string; codigo: string; nombre: string | null; estado: string; ensayos: Ensayo[] }
interface DatosAsignacion {
  ot: { id: string; codigo: string; estado: string; unidadPrincipal: string | null };
  puedeAsignar: boolean;
  analistas: Persona[];
  personal: Persona[];
  muestras: MuestraAsig[];
}

const ROL: Record<string, string> = {
  ANALISTA: "Analista", ANALISTA_SR: "Analista senior", REVISOR: "Revisor", TECNICO: "Técnico",
  METROLOGO: "Metrólogo", INSPECTOR: "Inspector", JEFE_LAB: "Jefatura",
};

export default function Asignacion({ otId, onCambio }: { otId: string; onCambio?: () => void }) {
  const [d, setD] = useState<DatosAsignacion | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const r = await llamar<DatosAsignacion>("GET", `/ot/${otId}/asignacion`);
      setD(r);
      setSel(new Set(r.analistas.map((a) => a.id)));
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }, [otId]);

  useEffect(() => { cargar(); }, [cargar]);

  if (error) return <div className="alert warn">{error}</div>;
  if (!d) return <p className="subtitle" style={{ margin: 0 }}>Cargando asignación…</p>;
  if (!d.ot.unidadPrincipal)
    return <div className="alert warn">La OT no tiene laboratorio responsable. Fíjelo en la pestaña «Cabecera» para poder asignar analistas.</div>;

  const editable = d.puedeAsignar && !["cerrada", "anulada"].includes(d.ot.estado);
  const cambiado =
    sel.size !== d.analistas.length || d.analistas.some((a) => !sel.has(a.id));

  async function guardarAnalistas() {
    setGuardando(true);
    try {
      const r = await llamar<DatosAsignacion>("PUT", `/ot/${otId}/analistas`, { usuarioIds: [...sel] });
      setD(r);
      setSel(new Set(r.analistas.map((a) => a.id)));
      toast.ok("Analistas de la OT actualizados.");
      onCambio?.();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setGuardando(false);
    }
  }

  async function asignar(usuarioId: string | null, cuerpo: { muestraIds?: string[]; resultadoIds?: string[] }) {
    try {
      const r = await llamar<DatosAsignacion & { actualizados: number }>("POST", `/ot/${otId}/asignar-ensayos`, { usuarioId, ...cuerpo });
      setD(r);
      setSel(new Set(r.analistas.map((a) => a.id)));
      toast.ok(usuarioId ? `Asignado (${r.actualizados} ensayo${r.actualizados === 1 ? "" : "s"}).` : "Asignación concreta retirada.");
      onCambio?.();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  const opcionesPersonal = (
    <>
      <option value="">— cualquiera de los asignados —</option>
      {d.personal.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
    </>
  );

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div>
        <h2 style={{ fontSize: 13, margin: "0 0 6px" }}>Analistas de la OT</h2>
        <p className="subtitle" style={{ margin: "0 0 8px" }}>
          {editable
            ? "Marque las personas del laboratorio que trabajarán esta OT. La verán en «Mis OT» y en su bandeja."
            : "Personas asignadas a esta OT. Solo la jefatura del laboratorio puede cambiarlas."}
        </p>
        {d.personal.length === 0 && (
          <div className="alert warn">El laboratorio no tiene personal con rol vigente. Pida a Administración que asigne los roles.</div>
        )}
        <table className="data">
          <thead><tr><th style={{ width: 36 }}></th><th>Persona</th><th>Rol en el laboratorio</th><th>Asignada</th></tr></thead>
          <tbody>
            {d.personal.map((p) => {
              const asignada = d.analistas.find((a) => a.id === p.id);
              return (
                <tr key={p.id}>
                  <td>
                    <input type="checkbox" style={{ width: "auto" }} disabled={!editable} checked={sel.has(p.id)}
                      aria-label={`Asignar a ${p.nombre}`}
                      onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(p.id); else n.delete(p.id); return n; })} />
                  </td>
                  <td>{p.nombre}</td>
                  <td>{(p.roles ?? []).map((r) => ROL[r] ?? r).join(", ")}</td>
                  <td style={{ fontSize: 11.5, color: "var(--muted)" }}>
                    {asignada ? <>{fechaHora(asignada.asignadoAt)}{asignada.asignadoPor ? ` · por ${asignada.asignadoPor}` : ""}</> : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {editable && (
          <div className="toolbar" style={{ marginTop: 8 }}>
            <div className="spacer" />
            <button className="btn primary sm" disabled={!cambiado || guardando} onClick={guardarAnalistas}>
              {guardando ? "Guardando…" : "Guardar analistas"}
            </button>
          </div>
        )}
      </div>

      <div>
        <h2 style={{ fontSize: 13, margin: "0 0 6px" }}>Muestras y ensayos</h2>
        <p className="subtitle" style={{ margin: "0 0 8px" }}>
          Opcional: asigne una muestra completa o un ensayo concreto a una persona. Si no, cualquiera de los analistas de la OT puede capturarlo.
        </p>
        {d.muestras.length === 0 && <p className="subtitle" style={{ margin: 0 }}>La OT aún no tiene muestras registradas.</p>}
        {d.muestras.map((m) => (
          <div key={m.id} className="card" style={{ padding: 10, marginBottom: 8 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
              <span className="codigo">{m.codigo}</span>
              <span>{m.nombre ?? ""}</span>
              <div style={{ flex: 1 }} />
              {editable && m.ensayos.length > 0 && (
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                  Toda la muestra a
                  <select defaultValue="" onChange={(e) => { const v = e.target.value; e.target.value = ""; if (v) asignar(v === "__nadie" ? null : v, { muestraIds: [m.id] }); }}>
                    <option value="">— elegir —</option>
                    {d.personal.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                    <option value="__nadie">Quitar asignación concreta</option>
                  </select>
                </label>
              )}
            </div>
            {m.ensayos.length === 0 ? (
              <p className="subtitle" style={{ margin: 0 }}>Sin ensayos generados para esta muestra.</p>
            ) : (
              <table className="data">
                <thead><tr><th>Ensayo</th><th>Método</th><th>Estado</th><th style={{ width: 260 }}>Asignado a</th></tr></thead>
                <tbody>
                  {m.ensayos.map((e) => (
                    <tr key={e.resultadoId}>
                      <td>{e.analito}</td>
                      <td>{e.metodo ?? "—"}</td>
                      <td><span className={`pill ${ESTADO_RESULTADO[e.estado]?.pill ?? "gray"}`}>{ESTADO_RESULTADO[e.estado]?.texto ?? e.estado}</span></td>
                      <td>
                        {editable && e.estado !== "aprobado" ? (
                          <select value={e.asignadoA ?? ""} onChange={(ev) => asignar(ev.target.value || null, { resultadoIds: [e.resultadoId] })}>
                            {opcionesPersonal}
                          </select>
                        ) : (
                          e.asignadoNombre ?? <span style={{ color: "var(--muted)" }}>cualquiera de los asignados</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
