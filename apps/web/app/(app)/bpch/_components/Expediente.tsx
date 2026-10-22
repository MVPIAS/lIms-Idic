"use client";

/**
 * Piezas del expediente BPCH: avance por fases, emisión de los documentos
 * oficiales (Informe de Inspección, Certificado de Conformidad, Informe de
 * Incumplimiento) y el estado de la OT ligada. La firma, la entrega y el
 * cierre son los del flujo general (PanelCierreOt / PanelDocumento).
 */
import { useState } from "react";
import Link from "next/link";
import { toast } from "@/components/ui/feedback";
import PanelCierreOt from "@/components/documentos/PanelCierreOt";
import NotificacionDgmn from "@/components/bpch-procesos/NotificacionDgmn";
import { CONDICION, type ConfigBpch, type Fase, pedir } from "./bpch";

const ICONO: Record<Fase["estado"], string> = { hecho: "✓", en_curso: "•", pendiente: "", no_aplica: "–" };

export function Fases({ fases }: { fases: Fase[] }) {
  return (
    <nav className="stepper" aria-label="Avance del expediente">
      {fases.map((f, i) => (
        <div
          key={f.clave}
          className={`step ${f.estado === "hecho" ? "done" : f.estado === "en_curso" ? "now" : "locked"}`}
          style={{ cursor: "default", opacity: f.estado === "no_aplica" ? 0.45 : undefined }}
          aria-current={f.estado === "en_curso" ? "step" : undefined}
        >
          <div className="dot" aria-hidden>{ICONO[f.estado] || i + 1}</div>
          <div className="txt">
            {f.titulo}
            <small>{f.estado === "no_aplica" ? "No aplica" : f.detalle ?? (f.estado === "hecho" ? "Hecho" : f.estado === "en_curso" ? "En curso" : "Pendiente")}</small>
          </div>
        </div>
      ))}
    </nav>
  );
}

type TipoDoc = "INFORME_INSPECCION" | "CERTIFICADO_CONFORMIDAD" | "INFORME_INCUMPLIMIENTO";
const NOMBRE_DOC: Record<TipoDoc, string> = {
  INFORME_INSPECCION: "Informe de Inspección",
  CERTIFICADO_CONFORMIDAD: "Certificado de Conformidad",
  INFORME_INCUMPLIMIENTO: "Informe de Incumplimiento",
};

/** Emite un documento BPCH con la plantilla elegida, tras revisar las condiciones del servidor. */
function EmitirDocumento({ otId, tipo, plantillas, onEmitido }: { otId: string; tipo: TipoDoc; plantillas: ConfigBpch["plantillas"][TipoDoc]; onEmitido: () => void }) {
  const [plantillaId, setPlantillaId] = useState(plantillas[0]?.id ?? "");
  const [faltantes, setFaltantes] = useState<string[] | null>(null);
  const [ocupado, setOcupado] = useState(false);
  if (!plantillas.length) return <div className="alert warn">No hay plantilla activa para el {NOMBRE_DOC[tipo]} (SCC). Revise Configuración › Plantillas de informe.</div>;

  async function revisar() {
    setOcupado(true);
    try {
      const c = await pedir<any>("POST", "/informes/condiciones", { otId, plantillaId, tipoDocumento: tipo });
      setFaltantes(c.faltantes ?? []);
      return c.puedeEmitir as boolean;
    } catch (e: any) {
      toast.error(e.message);
      return false;
    } finally {
      setOcupado(false);
    }
  }
  async function emitir() {
    if (!(await revisar())) return;
    setOcupado(true);
    try {
      await pedir("POST", "/informes/emitir", { otId, plantillaId, tipoDocumento: tipo });
      toast.ok(`${NOMBRE_DOC[tipo]} emitido: queda en firma según la matriz.`);
      setFaltantes(null);
      onEmitido();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  }
  return (
    <div style={{ border: "1px dashed var(--line)", borderRadius: 7, padding: 10 }}>
      <div className="toolbar" style={{ marginBottom: 6 }}>
        <label style={{ fontSize: 12 }}>
          Plantilla{" "}
          <select value={plantillaId} onChange={(e) => setPlantillaId(e.target.value)} aria-label={`Plantilla del ${NOMBRE_DOC[tipo]}`}>
            {plantillas.map((p) => <option key={p.id} value={p.id}>{p.repid} · {p.nombre}</option>)}
          </select>
        </label>
        <button type="button" className="btn outline sm" onClick={revisar} disabled={ocupado}>¿Qué falta?</button>
        <button type="button" className="btn primary sm" onClick={emitir} disabled={ocupado}>{ocupado ? "Procesando…" : `Emitir ${NOMBRE_DOC[tipo]}`}</button>
      </div>
      {faltantes && faltantes.length > 0 && (
        <div className="alert warn" role="status" style={{ margin: 0 }}>
          <b>Aún no se puede emitir:</b>
          <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>{faltantes.map((f, i) => <li key={i}>{f}</li>)}</ul>
        </div>
      )}
      {faltantes && faltantes.length === 0 && <div className="alert success" style={{ margin: 0 }}>Se cumplen las condiciones para emitir.</div>}
    </div>
  );
}

/**
 * Bloque «Inspección, documentos y cierre»: resultados de la OT (con enlace a
 * la captura), emisión del Informe de Inspección y del documento final según la
 * condición, y el panel de firma / entrega / cierre del flujo general.
 */
export function DocumentosYCierre({
  estadoOt,
  config,
  documentoFinal,
  puedeEmitir,
  onCambio,
}: {
  estadoOt: any;
  config: ConfigBpch | null;
  /** Internación: emite Certificado o Incumplimiento. Reinspección: solo el Informe de Inspección. */
  documentoFinal: boolean;
  puedeEmitir: boolean;
  onCambio: () => void;
}) {
  if (!estadoOt) return null;
  const { ot, condicion, resultados, informeInspeccion, certificado, incumplimiento, muestras } = estadoOt;
  const cond = CONDICION[condicion] ?? CONDICION.pendiente;
  const informeOficial = informeInspeccion && ["oficial", "emitido"].includes(informeInspeccion.estado);
  const abierta = !["cerrada", "anulada"].includes(ot.estado);
  return (
    <>
      <div className="card">
        <h2>
          Resultados de la inspección
          <span className="right">OT <Link href={`/ot/${ot.id}` as any} className="codigo">{ot.codigo}</Link> · {ot.unidadCodigo} · {ot.estado}</span>
        </h2>
        {muestras.length === 0 ? (
          <p className="subtitle" style={{ margin: 0 }}>Aún no hay lotes registrados como muestra de la OT.</p>
        ) : (
          <table className="data">
            <thead><tr><th>Muestra</th><th>Lote</th><th className="num">Ensayos</th><th className="num">Capturados</th><th className="num">Aprobados</th><th>Veredicto</th></tr></thead>
            <tbody>
              {muestras.map((m: any) => (
                <tr key={m.id}>
                  <td className="codigo">{m.codigo}</td>
                  <td>{m.lote ?? "—"}</td>
                  <td className="num">{m.ensayos}</td>
                  <td className="num">{m.capturados}</td>
                  <td className="num">{m.aprobados}</td>
                  <td>{m.veredicto ? <span className={`pill ${m.veredicto === "cumple" ? "green" : m.veredicto === "no_cumple" ? "red" : "gray"}`}>{m.veredicto.replace("_", " ")}</span> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="toolbar" style={{ marginTop: 10, marginBottom: 0 }}>
          <span>Condición final: <span className={`pill ${cond.c}`}>{cond.l}</span></span>
          <span style={{ color: "var(--muted)", fontSize: 12 }}>{resultados.aprobados} de {resultados.total} resultados aprobados</span>
          <span className="spacer" />
          {muestras.length > 0 && abierta && (
            <Link href={`/captura-ot?otId=${ot.id}` as any} className="btn outline sm">Capturar, revisar y aprobar →</Link>
          )}
        </div>
        <p className="subtitle" style={{ margin: "8px 0 0" }}>
          Cada fila cumple si Mínimo ≤ Resultado ≤ Máximo (los defectos se registran como conteo: crítico 0/0, menor 0/6). Si el catálogo no trae los límites, quien captura los completa en la orden.
        </p>
      </div>

      {puedeEmitir && abierta && (
        <div className="card">
          <h2>Documentos oficiales</h2>
          {!informeInspeccion && <EmitirDocumento otId={ot.id} tipo="INFORME_INSPECCION" plantillas={config?.plantillas.INFORME_INSPECCION ?? []} onEmitido={onCambio} />}
          {informeInspeccion && !informeOficial && <div className="alert info">El Informe de Inspección {informeInspeccion.numero} está {informeInspeccion.estado === "en_firma" ? "en firma" : informeInspeccion.estado}: fírmelo en el panel de abajo (o en Documentos por firmar).</div>}
          {documentoFinal && informeOficial && condicion === "cumple" && !certificado && (
            <EmitirDocumento otId={ot.id} tipo="CERTIFICADO_CONFORMIDAD" plantillas={config?.plantillas.CERTIFICADO_CONFORMIDAD ?? []} onEmitido={onCambio} />
          )}
          {documentoFinal && informeOficial && condicion === "no_cumple" && !incumplimiento && (
            <EmitirDocumento otId={ot.id} tipo="INFORME_INCUMPLIMIENTO" plantillas={config?.plantillas.INFORME_INCUMPLIMIENTO ?? []} onEmitido={onCambio} />
          )}
          {documentoFinal && informeOficial && condicion === "pendiente" && <div className="alert warn">La condición final está pendiente: faltan resultados por capturar o aprobar.</div>}
          {/* Qué documento final corresponde y por qué no se ofrece el otro (pautas IN-1 p. 8 e IN-2 p. 4; D06-11). */}
          {documentoFinal && !informeOficial && condicion !== "pendiente" && (
            <p className="subtitle" style={{ margin: "6px 0 0" }}>
              Condición {cond.l}: después del Informe de Inspección oficial corresponde
              {condicion === "cumple" ? " el Certificado de Conformidad (el Informe de Incumplimiento no aplica)." : " el Informe de Incumplimiento a DGMN (el Certificado de Conformidad no se emite)."}
            </p>
          )}
          {documentoFinal && informeOficial && condicion === "no_cumple" && (
            <p className="subtitle" style={{ margin: "6px 0 0" }}>Condición NO CUMPLE: no se emite Certificado de Conformidad; corresponde el Informe de Incumplimiento.</p>
          )}
          {documentoFinal && informeOficial && condicion === "cumple" && !certificado && (
            <p className="subtitle" style={{ margin: "6px 0 0" }}>Condición CUMPLE: corresponde el Certificado de Conformidad; el Informe de Incumplimiento no aplica.</p>
          )}
          {incumplimiento && (
            <div className="alert warn" style={{ marginTop: 8 }}>
              <b>No cumple → informar a DGMN.</b> Cuando el Informe de Incumplimiento {incumplimiento.numero} sea oficial, la Subdirección BPCH registra la
              notificación a DGMN y al internador en el recuadro de abajo; sin ella la OT no se cierra (EP-10 10.15).
            </div>
          )}
          {((documentoFinal && (certificado || incumplimiento)) || (!documentoFinal && informeInspeccion)) && (
            <p className="subtitle" style={{ margin: "6px 0 0" }}>Los documentos ya emitidos se firman, entregan y cierran en el panel de abajo.</p>
          )}
        </div>
      )}

      {incumplimiento && <NotificacionDgmn key={`${incumplimiento.id ?? incumplimiento.numero}:${incumplimiento.estado}`} otId={ot.id} onCambio={onCambio} />}

      {/* Se vuelve a montar al emitir o firmar: la tabla «Informes y certificados» no queda desfasada (D06-12). */}
      <PanelCierreOt
        key={[informeInspeccion, certificado, incumplimiento].map((x: any) => (x ? `${x.id ?? x.numero}:${x.estado}` : "-")).join("|")}
        otId={ot.id}
        onCambio={onCambio}
      />
    </>
  );
}
