"use client";

/**
 * Plantillas de correo por etapa de la actividad (contrato §4.5.4).
 *
 * Cada etapa (cotización enviada, OT creada, muestras recibidas, informe
 * oficial, resultado, avisos internos) tiene sus plantillas con marcadores
 * {{variable}}. Quien tiene `correo_plantilla.editar` cambia asunto y cuerpo,
 * crea variantes, las activa o desactiva y enciende el ENVÍO AUTOMÁTICO en las
 * etapas que tienen disparador (una automática por etapa). El servidor rechaza
 * marcadores que la etapa no conoce (mensajeria/plantillas.service.ts).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { api } from "@/lib/api";
import { usePermisos } from "@/lib/permisos";
import { fechaHora } from "@/lib/format";
import { toast } from "@/components/ui/feedback";

interface Etapa {
  etapa: string;
  nombre: string;
  disparador: string | null;
  destino: "cliente" | "interno";
  variables: string[];
}
interface Plantilla {
  id: string | null;
  clave: string;
  etapa: string;
  nombre: string;
  asunto: string;
  cuerpo: string;
  destino: string;
  automatico: boolean;
  activa: boolean;
  actualizadoEn?: string | null;
  actualizadoPor?: string | null;
}

/** Vista previa con valores de ejemplo (el envío real escapa los valores en el servidor). */
const EJEMPLO: Record<string, string> = {
  cliente: "Laboratorio PRUEBA S.A.",
  codigo: "OT-2026-0042",
  total: "$ 125.000",
  validez: "30",
  fecha: "02-11-2026",
  laboratorio: "LQA · Laboratorio Químico de Alimentos",
  fecha_compromiso: "16-11-2026",
  cantidad: "3",
  muestras: "M-0101, M-0102, M-0103",
  documento: "IE-LQA-2026-0042",
  veredicto: "Cumple",
  titulo: "OT por vencer · OT-2026-0042",
  mensaje: "La OT OT-2026-0042 vence el 05-11-2026 y aún no está terminada.",
  tipo: "ot_por_vencer",
};
const vistaPrevia = (t: string) => t.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, k: string) => EJEMPLO[k] ?? `{{${k}}}`);

export default function PlantillasCorreoPage() {
  const { puede } = usePermisos();
  const editor = puede("correo_plantilla.editar");
  const [etapas, setEtapas] = useState<Etapa[]>([]);
  const [filas, setFilas] = useState<Plantilla[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [edit, setEdit] = useState<Plantilla | null>(null);
  const [nueva, setNueva] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const r = await api.getRaw<{ etapas: Etapa[]; data: Plantilla[] }>("mensajeria/plantillas");
      setEtapas(r.etapas ?? []);
      setFilas(r.data ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }, []);
  useEffect(() => void cargar(), [cargar]);

  const porEtapa = useMemo(() => {
    const m = new Map<string, Plantilla[]>();
    for (const p of filas) m.set(p.etapa, [...(m.get(p.etapa) ?? []), p]);
    return m;
  }, [filas]);

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!edit) return;
    setGuardando(true);
    try {
      if (nueva) {
        await api.post("/mensajeria/plantillas", { etapa: nueva, nombre: edit.nombre, asunto: edit.asunto, cuerpo: edit.cuerpo });
        toast.ok("Plantilla creada.");
      } else {
        await api.patch(`/mensajeria/plantillas/${edit.id}`, { nombre: edit.nombre, asunto: edit.asunto, cuerpo: edit.cuerpo, automatico: edit.automatico, activa: edit.activa });
        toast.ok("Plantilla guardada.");
      }
      setEdit(null);
      setNueva(null);
      await cargar();
    } catch (x: any) {
      toast.error(x.message);
    } finally {
      setGuardando(false);
    }
  };

  const alternar = async (p: Plantilla, campo: "automatico" | "activa") => {
    try {
      await api.patch(`/mensajeria/plantillas/${p.id}`, { [campo]: !p[campo] });
      toast.ok(campo === "automatico" ? (!p.automatico ? "Envío automático encendido." : "Envío automático apagado.") : !p.activa ? "Plantilla activada." : "Plantilla desactivada.");
      await cargar();
    } catch (x: any) {
      toast.error(x.message);
    }
  };

  const etapaEdit = etapas.find((x) => x.etapa === (nueva ?? edit?.etapa));

  return (
    <div>
      <PageHeader
        titulo="Plantillas de correo"
        migas={[{ label: "Reportes y comunicación" }, { label: "Mensajería", href: "/mensajeria" }, { label: "Plantillas" }]}
        subtitulo="Textos de los correos de cada etapa de la actividad. Los marcadores {{cliente}}, {{codigo}}… se reemplazan al enviar. En las etapas con disparador, la plantilla con «envío automático» sale sola al cliente cuando ocurre la etapa."
        acciones={<Link href="/mensajeria" className="btn primary sm">📧 Ir a Mensajería</Link>}
      />
      {!editor && <div className="alert info">Puede consultar las plantillas. Editarlas es de la Dirección, las jefaturas de departamento y la administración.</div>}
      {error && <div className="alert warn">No se pudieron cargar las plantillas: {error}</div>}
      {cargando && <p>Cargando…</p>}

      {edit && etapaEdit && (
        <form className="card" onSubmit={guardar} style={{ marginBottom: 14 }}>
          <h2 style={{ marginTop: 0 }}>{nueva ? "Nueva plantilla" : "Editar plantilla"} · {etapaEdit.nombre}</h2>
          <div className="form-grid">
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label htmlFor="pl-nombre">Nombre</label>
              <input id="pl-nombre" required minLength={3} maxLength={120} value={edit.nombre} onChange={(e) => setEdit({ ...edit, nombre: e.target.value })} />
            </div>
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label htmlFor="pl-asunto">Asunto</label>
              <input id="pl-asunto" required minLength={3} maxLength={300} value={edit.asunto} onChange={(e) => setEdit({ ...edit, asunto: e.target.value })} />
            </div>
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label htmlFor="pl-cuerpo">Cuerpo (HTML simple: &lt;p&gt;, &lt;b&gt;, &lt;br&gt;)</label>
              <textarea id="pl-cuerpo" required rows={8} value={edit.cuerpo} onChange={(e) => setEdit({ ...edit, cuerpo: e.target.value })} style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12 }} />
              <small style={{ color: "var(--muted)" }}>Marcadores de esta etapa: {etapaEdit.variables.map((v) => `{{${v}}}`).join(" ")}</small>
            </div>
            {!nueva && (
              <div className="field" style={{ display: "flex", gap: 16, alignItems: "center", gridColumn: "1 / -1" }}>
                <label><input type="checkbox" checked={edit.activa} onChange={(e) => setEdit({ ...edit, activa: e.target.checked })} /> Activa</label>
                {etapaEdit.disparador && (
                  <label><input type="checkbox" checked={edit.automatico} onChange={(e) => setEdit({ ...edit, automatico: e.target.checked })} /> Envío automático ({etapaEdit.disparador.toLowerCase()})</label>
                )}
              </div>
            )}
          </div>
          <div className="card" style={{ background: "var(--bg)", marginTop: 10 }}>
            <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em" }}>Vista previa con datos de ejemplo</div>
            <p style={{ fontWeight: 600 }}>{vistaPrevia(edit.asunto)}</p>
            {/* Solo texto de la propia plantilla con valores de ejemplo fijos. */}
            <div dangerouslySetInnerHTML={{ __html: vistaPrevia(edit.cuerpo).replace(/<script[\s\S]*?<\/script>/gi, "") }} />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
            <button type="button" className="btn outline sm" onClick={() => { setEdit(null); setNueva(null); }}>Cancelar</button>
            <button className="btn primary sm" disabled={guardando}>{guardando ? "Guardando…" : "Guardar"}</button>
          </div>
        </form>
      )}

      {etapas.map((et) => (
        <section key={et.etapa} className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0 }}>{et.nombre}</h2>
            <span className={`pill ${et.destino === "cliente" ? "blue" : "gray"}`}>{et.destino === "cliente" ? "Al cliente" : "Interno"}</span>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{et.disparador ? `Automático: ${et.disparador.toLowerCase()}` : "Se envía a mano desde Mensajería"}</span>
            <div style={{ flex: 1 }} />
            {editor && (
              <button type="button" className="btn outline sm"
                onClick={() => { setNueva(et.etapa); setEdit({ id: null, clave: "", etapa: et.etapa, nombre: "", asunto: "", cuerpo: "", destino: et.destino, automatico: false, activa: true }); }}>
                ＋ Variante
              </button>
            )}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="data" style={{ marginTop: 8 }}>
              <thead><tr><th>Plantilla</th><th>Asunto</th><th>Estado</th><th>Última edición</th><th></th></tr></thead>
              <tbody>
                {(porEtapa.get(et.etapa) ?? []).map((p) => (
                  <tr key={p.clave}>
                    <td><b>{p.nombre}</b><div style={{ fontSize: 11, color: "var(--muted)" }}>{p.clave}</div></td>
                    <td style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11.5 }}>{p.asunto}</td>
                    <td>
                      <span className={`pill ${p.activa ? "green" : "gray"}`}>{p.activa ? "Activa" : "Inactiva"}</span>{" "}
                      {p.automatico && <span className="pill amber">Envío automático</span>}
                    </td>
                    <td style={{ fontSize: 12 }}>{p.actualizadoEn ? `${fechaHora(p.actualizadoEn)}${p.actualizadoPor ? ` · ${p.actualizadoPor}` : ""}` : "Texto inicial"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {editor && p.id && (
                        <>
                          <button type="button" className="btn outline sm" onClick={() => { setNueva(null); setEdit(p); }}>Editar</button>{" "}
                          {et.disparador && (
                            <button type="button" className="btn outline sm" onClick={() => alternar(p, "automatico")}>{p.automatico ? "Apagar automático" : "Envío automático"}</button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
                {!(porEtapa.get(et.etapa) ?? []).length && <tr><td colSpan={5} style={{ color: "var(--muted)" }}>Sin plantillas en esta etapa.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
