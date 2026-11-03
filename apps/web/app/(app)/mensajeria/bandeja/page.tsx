"use client";

/**
 * Bandeja de mensajes internos (contrato §4.5.5, §4.5.6).
 *
 * Mensajes entre personas del instituto con urgencia, adjuntos y vínculo a una
 * OT; recibidos, enviados y archivados, con búsqueda por remitente,
 * destinatario, asunto, urgencia, adjuntos, palabras clave y fechas. Un
 * mensaje puede salir además como copia por correo. Reglas en
 * apps/api/src/mensajeria/mensajes.service.ts.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { llamar, qs } from "@/lib/laboratorio";
import { subirFormulario, descargarAdjunto } from "@/lib/d11";
import { fechaHora } from "@/lib/format";
import { toast } from "@/components/ui/feedback";
import { usePermisos } from "@/lib/permisos";

type Bandeja = "recibidos" | "enviados" | "archivados";

interface Fila {
  id: string;
  asunto: string;
  prioridad: string;
  nAdjuntos: number;
  createdAt: string;
  resumen: string;
  remitente: string;
  destinatarios: string;
  leidoAt: string | null;
  otCodigo: string | null;
  muestraCodigo: string | null;
  cotizacionCodigo: string | null;
  clienteNombre: string | null;
}
interface Detalle {
  id: string;
  asunto: string;
  cuerpo: string;
  prioridad: string;
  createdAt: string;
  remitenteId: string;
  remitente: string;
  otCodigo: string | null;
  otId: string | null;
  muestraCodigo: string | null;
  cotizacionCodigo: string | null;
  clienteNombre: string | null;
  destinatarios: { id: string; nombre: string; leidoAt: string | null }[] | null;
  adjuntos: { id: string; nombre: string; bytes: number }[] | null;
  hilo: { id: string; asunto: string; cuerpo: string; createdAt: string; remitente: string }[];
}
interface Usuario {
  id: string;
  nombre: string;
  email: string | null;
  unidades: string | null;
}

const PRIORIDAD: Record<string, { label: string; pill: string }> = {
  normal: { label: "Normal", pill: "gray" },
  alta: { label: "Alta", pill: "amber" },
  urgente: { label: "Urgente", pill: "red" },
};
const FILTROS = { remitente: "", destinatario: "", asunto: "", prioridad: "", adjuntos: "", q: "", desde: "", hasta: "" };
const kb = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export default function BandejaPage() {
  // Mensajería · correo se abre con correo.enviar o cotizacion.ver (lib/navegacion.ts).
  const verCorreos = usePermisos().puede(["correo.enviar", "cotizacion.ver"]);
  const [bandeja, setBandeja] = useState<Bandeja>("recibidos");
  const [filas, setFilas] = useState<Fila[]>([]);
  const [noLeidos, setNoLeidos] = useState(0);
  const [f, setF] = useState(FILTROS);
  const [abierto, setAbierto] = useState<Detalle | null>(null);
  const [redactar, setRedactar] = useState<null | { respuestaA?: string; asunto?: string; para?: Usuario[]; otCodigo?: string }>(null);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(
    async (filtros = f) => {
      setCargando(true);
      try {
        const r = await llamar<{ data: Fila[]; noLeidos: number }>("GET", `/mensajes${qs({ bandeja, ...filtros })}`);
        setFilas(r.data);
        setNoLeidos(r.noLeidos);
      } catch (e: any) {
        toast.error(e.message);
      } finally {
        setCargando(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bandeja],
  );
  useEffect(() => void cargar(), [cargar]);

  const abrir = async (id: string) => {
    try {
      setAbierto(await llamar<Detalle>("GET", `/mensajes/${id}`));
      setRedactar(null);
      void cargar();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const archivar = async (id: string, si: boolean) => {
    try {
      await llamar("POST", `/mensajes/${id}/${si ? "archivar" : "desarchivar"}`);
      toast.ok(si ? "Mensaje archivado." : "Mensaje devuelto a recibidos.");
      setAbierto(null);
      await cargar();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const set = (k: keyof typeof FILTROS) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <div>
      <PageHeader
        titulo="Mensajes internos"
        migas={[{ label: "Reportes y comunicación" }, { label: "Mensajes internos" }]}
        subtitulo="Mensajes entre personas del instituto, con urgencia, adjuntos y vínculo a una OT. Los correos con clientes están en Mensajería · Correo."
        acciones={
          <>
            {verCorreos && <><Link href="/mensajeria" className="btn outline sm">📧 Correos</Link>{" "}</>}
            <button type="button" className="btn primary sm" onClick={() => { setAbierto(null); setRedactar({}); }}>✏ Nuevo mensaje</button>
          </>
        }
      />

      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }} role="tablist">
        {(["recibidos", "enviados", "archivados"] as Bandeja[]).map((b) => (
          <button key={b} type="button" role="tab" aria-selected={bandeja === b} className={`btn sm ${bandeja === b ? "primary" : "outline"}`} onClick={() => { setBandeja(b); setAbierto(null); }}>
            {b === "recibidos" ? `Recibidos${noLeidos ? ` (${noLeidos} sin leer)` : ""}` : b === "enviados" ? "Enviados" : "Archivados"}
          </button>
        ))}
      </div>

      <form className="card" style={{ marginBottom: 10 }} onSubmit={(e) => { e.preventDefault(); void cargar(); }}>
        <div className="form-grid">
          <div className="field"><label htmlFor="b-q">Palabras clave</label><input id="b-q" value={f.q} onChange={set("q")} placeholder="En el asunto o el texto" /></div>
          <div className="field"><label htmlFor="b-rem">Remitente</label><input id="b-rem" value={f.remitente} onChange={set("remitente")} /></div>
          <div className="field"><label htmlFor="b-dest">Destinatario</label><input id="b-dest" value={f.destinatario} onChange={set("destinatario")} /></div>
          <div className="field"><label htmlFor="b-as">Asunto</label><input id="b-as" value={f.asunto} onChange={set("asunto")} /></div>
          <div className="field">
            <label htmlFor="b-pr">Urgencia</label>
            <select id="b-pr" value={f.prioridad} onChange={set("prioridad")}>
              <option value="">Cualquiera</option><option value="normal">Normal</option><option value="alta">Alta</option><option value="urgente">Urgente</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="b-adj">Adjuntos</label>
            <select id="b-adj" value={f.adjuntos} onChange={set("adjuntos")}>
              <option value="">Con o sin adjuntos</option><option value="si">Con adjuntos</option><option value="no">Sin adjuntos</option>
            </select>
          </div>
          <div className="field"><label htmlFor="b-de">Desde</label><input id="b-de" type="date" value={f.desde} onChange={set("desde")} /></div>
          <div className="field"><label htmlFor="b-ha">Hasta</label><input id="b-ha" type="date" value={f.hasta} onChange={set("hasta")} /></div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
          <button type="button" className="btn outline sm" onClick={() => { setF(FILTROS); void cargar(FILTROS); }}>Limpiar</button>
          <button className="btn primary sm">Buscar</button>
        </div>
      </form>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12, alignItems: "start" }}>
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          {cargando && <p style={{ padding: 12 }}>Cargando…</p>}
          {!cargando && !filas.length && <p style={{ padding: 12, color: "var(--muted)" }}>No hay mensajes {bandeja === "recibidos" ? "recibidos" : bandeja} que coincidan.</p>}
          {filas.map((m) => {
            const nuevo = bandeja === "recibidos" && !m.leidoAt;
            return (
              <button key={m.id} type="button" onClick={() => abrir(m.id)}
                style={{ display: "block", width: "100%", textAlign: "left", border: 0, borderBottom: "1px solid var(--line)", padding: "10px 12px", cursor: "pointer",
                  background: abierto?.id === m.id ? "#eff5ff" : "var(--panel)", fontWeight: nuevo ? 700 : 400 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{bandeja === "enviados" ? `Para: ${m.destinatarios}` : m.remitente}</span>
                  <span style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap" }}>{fechaHora(m.createdAt)}</span>
                </div>
                <div>
                  {m.prioridad !== "normal" && <span className={`pill ${PRIORIDAD[m.prioridad]?.pill}`} style={{ marginRight: 6 }}>{PRIORIDAD[m.prioridad]?.label}</span>}
                  {m.asunto}{m.nAdjuntos > 0 && <span title={`${m.nAdjuntos} adjunto(s)`}> 📎</span>}
                  {m.otCodigo && <span className="tag" style={{ marginLeft: 6 }}>{m.otCodigo}</span>}
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.resumen}</div>
              </button>
            );
          })}
        </div>

        <div>
          {redactar && <Redactar inicial={redactar} onCerrar={() => setRedactar(null)} onEnviado={() => { setRedactar(null); setBandeja("enviados"); void cargar(); }} />}
          {abierto && !redactar && (
            <article className="card">
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <h2 style={{ margin: 0, flex: 1 }}>
                  {abierto.prioridad !== "normal" && <span className={`pill ${PRIORIDAD[abierto.prioridad]?.pill}`} style={{ marginRight: 6 }}>{PRIORIDAD[abierto.prioridad]?.label}</span>}
                  {abierto.asunto}
                </h2>
                <button type="button" className="btn outline sm" onClick={() => setAbierto(null)}>Cerrar</button>
              </div>
              <p style={{ fontSize: 12, color: "var(--muted)" }}>
                {fechaHora(abierto.createdAt)} · de <b>{abierto.remitente}</b> · para {(abierto.destinatarios ?? []).map((d) => `${d.nombre}${d.leidoAt ? " ✓" : ""}`).join(", ")}
              </p>
              {(abierto.otCodigo || abierto.muestraCodigo || abierto.cotizacionCodigo || abierto.clienteNombre) && (
                <p style={{ fontSize: 12 }}>
                  Vinculado a:{" "}
                  {abierto.otId && abierto.otCodigo ? <Link href={`/ot/${abierto.otId}`}>{abierto.otCodigo}</Link> : abierto.otCodigo}
                  {abierto.muestraCodigo && ` · muestra ${abierto.muestraCodigo}`}
                  {abierto.cotizacionCodigo && ` · cotización ${abierto.cotizacionCodigo}`}
                  {abierto.clienteNombre && ` · ${abierto.clienteNombre}`}
                </p>
              )}
              {abierto.hilo.length > 0 && (
                <details style={{ marginBottom: 8 }}>
                  <summary style={{ cursor: "pointer", fontSize: 12 }}>Conversación ({abierto.hilo.length} mensaje(s) más)</summary>
                  {abierto.hilo.map((h) => (
                    <div key={h.id} style={{ borderLeft: "3px solid var(--line)", paddingLeft: 10, margin: "8px 0" }}>
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>{fechaHora(h.createdAt)} · {h.remitente}</div>
                      {/* Cuerpo generado por el servidor desde texto escapado (textoAHtml). */}
                      <div dangerouslySetInnerHTML={{ __html: h.cuerpo }} />
                    </div>
                  ))}
                </details>
              )}
              {/* Cuerpo generado por el servidor desde texto escapado (textoAHtml). */}
              <div dangerouslySetInnerHTML={{ __html: abierto.cuerpo }} />
              {(abierto.adjuntos ?? []).length > 0 && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                  {(abierto.adjuntos ?? []).map((a) => (
                    <button key={a.id} type="button" className="btn outline sm"
                      onClick={() => descargarAdjunto(`/mensajes/${abierto.id}/adjuntos/${a.id}`, a.nombre).catch((e) => toast.error(e.message))}>
                      📎 {a.nombre} · {kb(a.bytes)}
                    </button>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
                {bandeja !== "enviados" && (
                  <button type="button" className="btn outline sm" onClick={() => archivar(abierto.id, bandeja !== "archivados")}>{bandeja === "archivados" ? "Devolver a recibidos" : "Archivar"}</button>
                )}
                <button type="button" className="btn primary sm"
                  onClick={() => setRedactar({
                    respuestaA: abierto.id,
                    asunto: abierto.asunto.startsWith("Re: ") ? abierto.asunto : `Re: ${abierto.asunto}`,
                    para: bandeja === "enviados"
                      ? (abierto.destinatarios ?? []).map((d) => ({ id: d.id, nombre: d.nombre, email: null, unidades: null }))
                      : [{ id: abierto.remitenteId, nombre: abierto.remitente, email: null, unidades: null }],
                    otCodigo: abierto.otCodigo ?? undefined,
                  })}>
                  ↩ Responder
                </button>
              </div>
            </article>
          )}
          {!abierto && !redactar && <div className="card" style={{ color: "var(--muted)" }}>Elija un mensaje para leerlo o escriba uno nuevo.</div>}
        </div>
      </div>
    </div>
  );
}

function Redactar({ inicial, onCerrar, onEnviado }: {
  inicial: { respuestaA?: string; asunto?: string; para?: Usuario[]; otCodigo?: string };
  onCerrar: () => void;
  onEnviado: () => void;
}) {
  const [para, setPara] = useState<Usuario[]>(inicial.para ?? []);
  const [buscar, setBuscar] = useState("");
  const [opciones, setOpciones] = useState<Usuario[]>([]);
  const [asunto, setAsunto] = useState(inicial.asunto ?? "");
  const [cuerpo, setCuerpo] = useState("");
  const [prioridad, setPrioridad] = useState("normal");
  const [otCodigo, setOtCodigo] = useState(inicial.otCodigo ?? "");
  const [archivos, setArchivos] = useState<File[]>([]);
  const [copia, setCopia] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      llamar<Usuario[]>("GET", `/mensajes/usuarios${qs({ q: buscar })}`).then(setOpciones).catch(() => setOpciones([]));
    }, 250);
    return () => clearTimeout(t);
  }, [buscar]);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!para.length) return toast.error("Elija al menos un destinatario.");
    setOcupado(true);
    try {
      const fd = new FormData();
      fd.append("destinatarios", para.map((p) => p.id).join(","));
      fd.append("asunto", asunto);
      fd.append("cuerpo", cuerpo);
      fd.append("prioridad", prioridad);
      if (otCodigo.trim()) fd.append("otCodigo", otCodigo.trim());
      if (inicial.respuestaA) fd.append("respuestaA", inicial.respuestaA);
      if (copia) fd.append("copiaCorreo", "true");
      archivos.forEach((a) => fd.append("adjuntos", a, a.name));
      const r = await subirFormulario<{ correo: string | null }>("/mensajes", fd);
      toast.ok(
        r.correo === null ? "Mensaje enviado." : r.correo === "enviado" ? "Mensaje enviado, con copia por correo." : "Mensaje enviado. La copia por correo no salió (sin servidor de correo): quedó registrada en Mensajería.",
      );
      onEnviado();
    } catch (x: any) {
      toast.error(x.message);
    } finally {
      setOcupado(false);
    }
  };

  const disponibles = opciones.filter((o) => !para.some((p) => p.id === o.id));

  return (
    <form className="card" onSubmit={enviar}>
      <h2 style={{ marginTop: 0 }}>{inicial.respuestaA ? "Responder" : "Nuevo mensaje"}</h2>
      <div className="field">
        <label htmlFor="r-para">Para <span className="req">*</span></label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
          {para.map((p) => (
            <span key={p.id} className="tag">
              {p.nombre}{" "}
              <button type="button" aria-label={`Quitar a ${p.nombre}`} onClick={() => setPara(para.filter((x) => x.id !== p.id))} style={{ border: 0, background: "none", cursor: "pointer" }}>✕</button>
            </span>
          ))}
        </div>
        <input id="r-para" placeholder="Buscar por nombre o correo…" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
        {buscar.trim() && disponibles.length > 0 && (
          <div style={{ border: "1px solid var(--line)", borderRadius: 6, maxHeight: 180, overflowY: "auto", marginTop: 4 }}>
            {disponibles.slice(0, 20).map((o) => (
              <button key={o.id} type="button" onClick={() => { setPara([...para, o]); setBuscar(""); }}
                style={{ display: "block", width: "100%", textAlign: "left", border: 0, borderBottom: "1px solid var(--line)", background: "var(--panel)", padding: "6px 8px", cursor: "pointer" }}>
                {o.nombre} <span style={{ fontSize: 11, color: "var(--muted)" }}>{[o.email, o.unidades].filter(Boolean).join(" · ")}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="form-grid">
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label htmlFor="r-asunto">Asunto <span className="req">*</span></label>
          <input id="r-asunto" required minLength={3} maxLength={200} value={asunto} onChange={(e) => setAsunto(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="r-prio">Urgencia</label>
          <select id="r-prio" value={prioridad} onChange={(e) => setPrioridad(e.target.value)}>
            <option value="normal">Normal</option><option value="alta">Alta</option><option value="urgente">Urgente</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="r-ot">OT vinculada</label>
          <input id="r-ot" placeholder="OT-2026-0012 (opcional)" value={otCodigo} onChange={(e) => setOtCodigo(e.target.value)} />
        </div>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label htmlFor="r-cuerpo">Mensaje <span className="req">*</span></label>
          <textarea id="r-cuerpo" required rows={7} value={cuerpo} onChange={(e) => setCuerpo(e.target.value)} />
        </div>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label htmlFor="r-adj">Adjuntos (hasta 10; 10 MB cada uno · PDF, imágenes, Office, texto, CSV)</label>
          <input id="r-adj" type="file" multiple onChange={(e) => setArchivos(Array.from(e.target.files ?? []))} />
        </div>
        <label style={{ gridColumn: "1 / -1" }}><input type="checkbox" checked={copia} onChange={(e) => setCopia(e.target.checked)} /> Enviar también una copia por correo a los destinatarios</label>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
        <button type="button" className="btn outline sm" onClick={onCerrar}>Cancelar</button>
        <button className="btn primary sm" disabled={ocupado}>{ocupado ? "Enviando…" : "Enviar"}</button>
      </div>
    </form>
  );
}
