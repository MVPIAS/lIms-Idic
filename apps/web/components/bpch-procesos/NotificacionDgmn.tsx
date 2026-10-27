"use client";

/**
 * EP-10 10.15 · Notificación a DGMN del Informe de Incumplimiento y copia al
 * internador. Destinatarios fijos (distribución del documento), medio, Nº de
 * oficio, fecha de envío y copia al internador (obligatoria). Sin ella la OT no
 * se cierra. La registra la Subdirección BPCH (bpch.dgmn.notificar). Si la OT no
 * tiene incumplimientos, no pinta nada. API: /bpch/notificacion-dgmn/ot/:otId.
 */
import { avisarCambioOt, useCambiosOt } from "@/lib/refresco";
import { useCallback, useEffect, useState } from "react";
import { toast } from "@/components/ui/feedback";
import { fecha, fechaHora } from "@/lib/format";
import { llamar } from "@/lib/laboratorio";
import { hoyChile } from "@/lib/fecha-chile";

interface Estado {
  aplica: boolean;
  destinatarios: string[];
  medios: { valor: string; texto: string }[];
  puedeNotificar: boolean;
  incumplimientos: {
    certificadoId: string;
    numero: string;
    estado: string;
    oficial: boolean;
    notificacion: null | {
      medioTexto: string;
      oficioNumero: string | null;
      fechaEnvio: string;
      copiaInternador: boolean;
      destinatarios: string[];
      observaciones: string | null;
      registradaAt: string;
      registradaPor: string | null;
    };
  }[];
}

const hoyCl = () => hoyChile();

export default function NotificacionDgmn({ otId, onCambio }: { otId: string; onCambio?: () => void }) {
  const [e, setE] = useState<Estado | null>(null);
  // B-072 (recorrido MP-06, D06-21): la fecha de envío viene propuesta (hoy en Chile), como en la entrega.
  const [f, setF] = useState({ medio: "", oficioNumero: "", fechaEnvio: hoyCl(), copia: "", observaciones: "" });
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(() => {
    llamar<Estado>("GET", `/bpch/notificacion-dgmn/ot/${otId}`).then(setE).catch(() => setE(null));
  }, [otId]);
  useEffect(() => {
    cargar();
  }, [cargar]);
  useCambiosOt(otId, cargar);

  if (!e?.aplica) return null;
  const pendiente = e.incumplimientos.find((x) => x.oficial && !x.notificacion) ?? null;
  const enFirma = e.incumplimientos.find((x) => !x.oficial && ["en_firma"].includes(x.estado));
  // El botón dice qué falta en vez de quedar desactivado sin explicación.
  const faltan = [
    !f.medio && "el medio",
    f.medio === "oficina_partes" && !f.oficioNumero.trim() && "el Nº de oficio",
    !f.fechaEnvio && "la fecha de envío",
    !f.copia && "si va con copia al internador",
  ].filter(Boolean) as string[];
  const listo = pendiente && !faltan.length;

  async function registrar() {
    if (!pendiente) return;
    setOcupado(true);
    try {
      const r = await llamar<Estado>("POST", `/bpch/notificacion-dgmn/ot/${otId}`, {
        certificadoId: pendiente.certificadoId,
        medio: f.medio,
        oficioNumero: f.oficioNumero.trim() || null,
        fechaEnvio: f.fechaEnvio,
        copiaInternador: f.copia === "si",
        observaciones: f.observaciones.trim() || null,
      });
      setE(r);
      setF({ medio: "", oficioNumero: "", fechaEnvio: hoyCl(), copia: "", observaciones: "" });
      toast.ok("Notificación a DGMN registrada. La OT ya puede cerrarse.");
      onCambio?.();
      avisarCambioOt(otId);
    } catch (x: any) {
      toast.error(x.message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="card">
      <h2>Notificación a DGMN del incumplimiento <span className="right">Subdirección BPCH · EP-10 10.15</span></h2>
      {e.incumplimientos.filter((x) => x.notificacion).map((x) => (
        <div key={x.certificadoId} className="alert success" style={{ marginBottom: 8 }}>
          <b>{x.numero}</b> notificado el {fecha(x.notificacion!.fechaEnvio)} por {x.notificacion!.medioTexto.toLowerCase()}
          {x.notificacion!.oficioNumero ? ` (oficio ${x.notificacion!.oficioNumero})` : ""} · copia al internador: {x.notificacion!.copiaInternador ? "sí" : "no"} ·
          registró {x.notificacion!.registradaPor ?? "—"} el {fechaHora(x.notificacion!.registradaAt)}.
        </div>
      ))}
      {enFirma && !pendiente && <div className="alert info">El Informe de Incumplimiento {enFirma.numero} está en firma: se notifica a DGMN cuando quede oficial.</div>}
      {pendiente && (
        <>
          <div className="alert warn" role="status">
            El Informe de Incumplimiento <b>{pendiente.numero}</b> es oficial: falta informarlo a DGMN. <b>Sin esta notificación la OT no se cierra.</b>
          </div>
          <p style={{ fontSize: 12.5, margin: "6px 0" }}>
            Distribución (destinatarios fijos): {e.destinatarios.map((d, i) => <span key={d}>{i + 1}. {d}{i < e.destinatarios.length - 1 ? " · " : ""}</span>)}
          </p>
          {e.puedeNotificar ? (
            <>
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="dg-medio">Medio <span className="req">*</span></label>
                  <select id="dg-medio" value={f.medio} onChange={(x) => setF({ ...f, medio: x.target.value })}>
                    <option value="">Elija…</option>
                    {e.medios.map((m) => <option key={m.valor} value={m.valor}>{m.texto}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="dg-oficio">Nº de oficio {f.medio === "oficina_partes" && <span className="req">*</span>}</label>
                  <input id="dg-oficio" value={f.oficioNumero} onChange={(x) => setF({ ...f, oficioNumero: x.target.value })} maxLength={60} />
                </div>
                <div className="field">
                  <label htmlFor="dg-fecha">Fecha de envío <span className="req">*</span></label>
                  <input id="dg-fecha" type="date" max={hoyCl()} value={f.fechaEnvio} onChange={(x) => setF({ ...f, fechaEnvio: x.target.value })} />
                </div>
                <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
                  <legend style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>¿Copia al internador? <span className="req">*</span></legend>
                  <label style={{ marginRight: 12 }}><input type="radio" name="dg-copia" checked={f.copia === "si"} onChange={() => setF({ ...f, copia: "si" })} /> Sí</label>
                  <label><input type="radio" name="dg-copia" checked={f.copia === "no"} onChange={() => setF({ ...f, copia: "no" })} /> No</label>
                </fieldset>
                <div className="field span-2">
                  <label htmlFor="dg-obs">Observaciones</label>
                  <input id="dg-obs" value={f.observaciones} onChange={(x) => setF({ ...f, observaciones: x.target.value })} maxLength={2000} />
                </div>
              </div>
              <div className="toolbar">
                <button type="button" className="btn primary" disabled={!listo || ocupado} onClick={registrar}
                  aria-describedby={faltan.length ? "dg-faltan" : undefined}>{ocupado ? "Registrando…" : "Registrar notificación → cierre"}</button>
                {faltan.length > 0 && <small id="dg-faltan" role="status" style={{ color: "#7a4b00" }}>Falta indicar {faltan.join(", ")}.</small>}
                <small style={{ color: "var(--muted)" }}>El oficio lo genera hoy la Subdirección fuera del LIMS (por confirmar con el IDIC si se emite con la matriz OFICIO).</small>
              </div>
            </>
          ) : (
            <div className="alert info">La registra la Subdirección BPCH.</div>
          )}
        </>
      )}
    </div>
  );
}
