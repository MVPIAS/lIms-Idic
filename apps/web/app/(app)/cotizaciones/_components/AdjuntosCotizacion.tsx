"use client";

/**
 * Adjuntos de la cotización (quinto envío del IDIC, 21-11-2026): correos
 * (.msg, .eml), fotos, PDF de la E.T. y documentos Office, desde la creación y
 * en la edición, en cualquier estado. Lista con descarga y, con permiso
 * cotizacion.crear, un selector para adjuntar más. El servidor comprueba el
 * contenido de cada fichero y el tope (parámetro cotizacion_adjuntos.max_mb).
 */
import { useState } from "react";
import { fecha } from "@/lib/format";
import { descargarAdjunto, subirFormulario } from "@/lib/d11";
import { toast } from "@/components/ui/feedback";
import { ACCEPT_ADJUNTO_COT, CLASE_ADJUNTO_LABEL, TIPOS_ADJUNTO_COT } from "./comercial";

export interface AdjuntoCot { id: string; nombre: string; clase: string; bytes?: number; createdAt: string; subidoPor?: string | null }

const kb = (b?: number) => (b == null ? "" : b >= 1024 * 1024 ? `${(b / (1024 * 1024)).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** Sube varios ficheros como adjuntos de la cotización; devuelve los nombres que fallaron con su motivo. */
export async function subirAdjuntosCotizacion(cotId: string, archivos: File[], clase = "antecedente"): Promise<string[]> {
  const errores: string[] = [];
  for (const a of archivos) {
    const f = new FormData();
    f.append("clase", clase);
    f.append("archivo", a, a.name);
    try {
      await subirFormulario(`/cotizaciones/${cotId}/adjuntos`, f);
    } catch (e: any) {
      errores.push(`${a.name}: ${e.message}`);
    }
  }
  return errores;
}

/** Selector de ficheros (varios) con el texto de tipos y tope. */
export function SelectorAdjuntos({ id, archivos, onCambio, maxMb }: { id: string; archivos: File[]; onCambio: (a: File[]) => void; maxMb?: number }) {
  return (
    <div className="field" style={{ gridColumn: "1 / -1" }}>
      <label htmlFor={id}>Adjuntar correos, fotos o E.T.</label>
      <input
        id={id}
        type="file"
        multiple
        accept={ACCEPT_ADJUNTO_COT}
        onChange={(e) => {
          onCambio([...archivos, ...Array.from(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
      <small style={{ color: "var(--muted)" }}>{TIPOS_ADJUNTO_COT}; máx. {maxMb ?? 15} MB cada uno.</small>
      {archivos.length > 0 && (
        <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
          {archivos.map((a, i) => (
            <li key={`${a.name}-${i}`}>
              {a.name} <small style={{ color: "var(--muted)" }}>{kb(a.size)}</small>{" "}
              <button type="button" className="btn outline sm" aria-label={`Quitar ${a.name}`} onClick={() => onCambio(archivos.filter((_, j) => j !== i))}>Quitar</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Lista de adjuntos con descarga y, si se puede, el botón para adjuntar más. */
export function AdjuntosCotizacion({ cotId, adjuntos, puedeAdjuntar, maxMb, onCambio }: { cotId: string; adjuntos: AdjuntoCot[]; puedeAdjuntar: boolean; maxMb?: number; onCambio?: () => void }) {
  const [archivos, setArchivos] = useState<File[]>([]);
  const [clase, setClase] = useState("antecedente");
  const [subiendo, setSubiendo] = useState(false);

  async function subir() {
    if (!archivos.length) return;
    setSubiendo(true);
    try {
      const errores = await subirAdjuntosCotizacion(cotId, archivos, clase);
      const ok = archivos.length - errores.length;
      if (ok) toast.ok(ok === 1 ? "Adjunto agregado." : `${ok} adjuntos agregados.`);
      if (errores.length) toast.error(`No se adjuntaron: ${errores.join(" · ")}`);
      setArchivos([]);
      onCambio?.();
    } finally {
      setSubiendo(false);
    }
  }

  return (
    <div className="field readonly" style={{ gridColumn: "1 / -1" }}>
      <label>Documentos adjuntos</label>
      {adjuntos.length ? (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {adjuntos.map((a) => (
            <li key={a.id}>
              <button type="button" className="btn-link" style={{ background: "none", border: 0, padding: 0, color: "var(--accent)", textDecoration: "underline", cursor: "pointer" }}
                onClick={() => descargarAdjunto(`/cotizaciones/${cotId}/adjuntos/${a.id}`, a.nombre).catch((e) => toast.error(e.message))}>
                {a.nombre}
              </button>{" "}
              <small style={{ color: "var(--muted)" }}>
                {CLASE_ADJUNTO_LABEL[a.clase] ?? a.clase} · {kb(a.bytes)} · {fecha(a.createdAt)}{a.subidoPor ? ` · ${a.subidoPor}` : ""}
              </small>
            </li>
          ))}
        </ul>
      ) : (
        <div style={{ padding: "4px 0", color: "var(--muted)" }}>Sin adjuntos.</div>
      )}
      {puedeAdjuntar && (
        <div className="form-grid cols-2" style={{ marginTop: 8 }}>
          <div className="field">
            <label htmlFor={`adj-clase-${cotId}`}>Tipo de documento</label>
            <select id={`adj-clase-${cotId}`} value={clase} onChange={(e) => setClase(e.target.value)}>
              <option value="antecedente">{CLASE_ADJUNTO_LABEL.antecedente}</option>
              <option value="solicitud">{CLASE_ADJUNTO_LABEL.solicitud}</option>
            </select>
          </div>
          <SelectorAdjuntos id={`adj-arch-${cotId}`} archivos={archivos} onCambio={setArchivos} maxMb={maxMb} />
          {archivos.length > 0 && (
            <div style={{ gridColumn: "1 / -1" }}>
              <button type="button" className="btn primary sm" disabled={subiendo} onClick={subir}>
                {subiendo ? "Adjuntando…" : `Adjuntar ${archivos.length === 1 ? "el documento" : `${archivos.length} documentos`}`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
