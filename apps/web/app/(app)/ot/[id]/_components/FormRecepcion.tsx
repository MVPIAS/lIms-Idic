"use client";

/**
 * Campos de «Recepción e identificación de la muestra» (Depto. Químico, 15-10-2026):
 * toma de muestra, condición de recepción (con observación obligatoria si no
 * cumple), Nº de sello, identificación dada por el cliente y «¿requiere ensayos
 * de otros laboratorios?». Lo usan el registro de muestras (datos comunes) y la
 * corrección de la recepción de una muestra. Las reglas las valida el servidor
 * (apps/api/src/flujo-real/recepcion-muestra.ts); aquí solo se avisa antes.
 */
import { useEffect, useId, useState } from "react";
import { llamar, type Unidad } from "@/lib/laboratorio";

export interface DatosRecepcion {
  tomaMuestra: string;
  condicionRecepcion: "" | "cumple" | "no_cumple";
  condicionObservacion: string;
  selloNumero: string;
  identificacionCliente: string;
  requiereOtrosLabs: boolean;
  otrosLabs: string[];
  otrosLabsDetalle: string;
}

export const RECEPCION_VACIA: DatosRecepcion = {
  tomaMuestra: "",
  condicionRecepcion: "",
  condicionObservacion: "",
  selloNumero: "",
  identificacionCliente: "",
  requiereOtrosLabs: false,
  otrosLabs: [],
  otrosLabsDetalle: "",
};

/** Lo que falta antes de enviar (el servidor vuelve a comprobarlo). */
export function faltantesRecepcion(d: DatosRecepcion): string[] {
  const f: string[] = [];
  if (!d.tomaMuestra) f.push("indique quién tomó la muestra");
  if (!d.condicionRecepcion) f.push("indique la condición de recepción");
  if (d.condicionRecepcion === "no_cumple" && d.condicionObservacion.trim().length < 5) f.push("describa por qué no cumple (mínimo 5 caracteres)");
  if (d.requiereOtrosLabs && !d.otrosLabs.length) f.push("marque qué otro(s) laboratorio(s) deben ensayarla");
  return f;
}

/** Cuerpo para la API (vacíos → null). */
export function cuerpoRecepcion(d: DatosRecepcion) {
  const t = (s: string) => (s.trim() ? s.trim() : null);
  return {
    tomaMuestra: t(d.tomaMuestra),
    condicionRecepcion: d.condicionRecepcion || null,
    condicionObservacion: d.condicionRecepcion === "no_cumple" ? t(d.condicionObservacion) : null,
    selloNumero: t(d.selloNumero),
    identificacionCliente: t(d.identificacionCliente),
    requiereOtrosLabs: d.requiereOtrosLabs,
    otrosLabs: d.requiereOtrosLabs ? d.otrosLabs : [],
    otrosLabsDetalle: d.requiereOtrosLabs ? t(d.otrosLabsDetalle) : null,
  };
}

export default function FormRecepcion({
  valor,
  onCambio,
  opcionesToma,
  labPrincipalId,
  porMuestra = true,
}: {
  valor: DatosRecepcion;
  onCambio: (d: DatosRecepcion) => void;
  opcionesToma: { codigo: string; etiqueta: string }[];
  /** laboratorio responsable de la OT: no se ofrece como «otro laboratorio» */
  labPrincipalId?: string | null;
  /** false = datos comunes a varias muestras (sello e identificación van por muestra) */
  porMuestra?: boolean;
}) {
  const id = useId();
  const [labs, setLabs] = useState<Unidad[]>([]);
  useEffect(() => {
    llamar<Unidad[]>("GET", "/ot/laboratorios").then(setLabs).catch(() => setLabs([]));
  }, []);
  const set = (p: Partial<DatosRecepcion>) => onCambio({ ...valor, ...p });
  const alternarLab = (u: string) =>
    set({ otrosLabs: valor.otrosLabs.includes(u) ? valor.otrosLabs.filter((x) => x !== u) : [...valor.otrosLabs, u] });

  return (
    <div className="form-grid cols-2">
      <div className="field">
        <label htmlFor={`${id}-toma`}>Toma de muestra <span className="req">*</span></label>
        <select id={`${id}-toma`} value={valor.tomaMuestra} onChange={(e) => set({ tomaMuestra: e.target.value })}>
          <option value="">Elija quién tomó la muestra…</option>
          {opcionesToma.map((o) => <option key={o.codigo} value={o.codigo}>{o.etiqueta}</option>)}
        </select>
      </div>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", marginBottom: 4 }}>
          Condición de recepción <span className="req">*</span>
        </legend>
        <div style={{ display: "flex", gap: 16, paddingTop: 4 }}>
          {(["cumple", "no_cumple"] as const).map((c) => (
            <label key={c} style={{ display: "flex", gap: 6, alignItems: "center", fontWeight: 400, textTransform: "none", fontSize: 13 }}>
              <input type="radio" name={`${id}-cond`} style={{ width: "auto" }} checked={valor.condicionRecepcion === c} onChange={() => set({ condicionRecepcion: c })} />
              {c === "cumple" ? "Cumple" : "No cumple"}
            </label>
          ))}
        </div>
      </fieldset>
      {valor.condicionRecepcion === "no_cumple" && (
        <div className="field span-2" style={{ gridColumn: "1 / -1" }}>
          <label htmlFor={`${id}-obs`}>¿Qué no cumple? <span className="req">*</span></label>
          <input id={`${id}-obs`} value={valor.condicionObservacion} maxLength={2000} onChange={(e) => set({ condicionObservacion: e.target.value })}
            placeholder="Por ejemplo: envase con filtración, sello roto, cantidad insuficiente" />
        </div>
      )}
      {porMuestra && (
        <>
          <div className="field">
            <label htmlFor={`${id}-ident`}>Identificación de la muestra dada por el cliente</label>
            <input id={`${id}-ident`} value={valor.identificacionCliente} maxLength={300} onChange={(e) => set({ identificacionCliente: e.target.value })} />
            <span style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>Lo que dice el rótulo del cliente; no es el código del laboratorio.</span>
          </div>
          <div className="field">
            <label htmlFor={`${id}-sello`}>Nº de sello</label>
            <input id={`${id}-sello`} value={valor.selloNumero} maxLength={40} onChange={(e) => set({ selloNumero: e.target.value })} />
            <span style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>Si la muestra llega sellada.</span>
          </div>
        </>
      )}
      <div className="field" style={{ gridColumn: "1 / -1" }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontWeight: 600, textTransform: "none", fontSize: 13 }}>
          <input type="checkbox" style={{ width: "auto" }} checked={valor.requiereOtrosLabs} onChange={(e) => set({ requiereOtrosLabs: e.target.checked })} />
          ¿Requiere ensayos de otros laboratorios?
        </label>
        {valor.requiereOtrosLabs && (
          <div style={{ marginTop: 6 }}>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 4 }}>Marque cuál(es). Queda constancia en la muestra y se enlaza con las órdenes internas de la OT.</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", maxHeight: 150, overflowY: "auto" }}>
              {labs.filter((u) => u.id !== labPrincipalId && u.tipo === "LABORATORIO").map((u) => (
                <label key={u.id} style={{ display: "flex", gap: 6, alignItems: "center", fontWeight: 400, textTransform: "none", fontSize: 12.5 }} title={u.nombre}>
                  <input type="checkbox" style={{ width: "auto" }} checked={valor.otrosLabs.includes(u.id)} onChange={() => alternarLab(u.id)} />
                  {u.codigo}
                </label>
              ))}
            </div>
            <div className="field" style={{ marginTop: 6 }}>
              <label htmlFor={`${id}-det`}>Qué ensayos (opcional)</label>
              <input id={`${id}-det`} value={valor.otrosLabsDetalle} maxLength={2000} onChange={(e) => set({ otrosLabsDetalle: e.target.value })} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
