"use client";

/**
 * Campos de «Recepción e identificación de la muestra» (Depto. Químico, 15-10-2026;
 * entrega R1 · EP-01 §1.3, EP-02 §2.1, EP-03 §1.2, EP-05 §3.1; LME 20-10-2026):
 * toma de muestra, condición de recepción Cumple / No cumple (botones; si no
 * cumple, qué no cumple), cliente de la muestra (maestro), identificación dada
 * por el cliente, sellos y si se verificaron, campos propios del laboratorio
 * (Catálogo › Parámetros · recepcion_campo) y «¿requiere ensayos de otros
 * laboratorios?». Lo usan el registro de muestras (datos comunes) y la
 * corrección de la recepción de una muestra. Las reglas las valida el servidor
 * (apps/api/src/flujo-real/recepcion-muestra.ts y recepcion/reglas-recepcion.ts).
 */
import { useEffect, useId, useState } from "react";
import { llamar, type Unidad } from "@/lib/laboratorio";
import { faltantesLaboratorio, valorCampo, type CampoRecepcion, type ConfigRecepcion, type ValorCampo } from "@/lib/recepcion";

export interface DatosRecepcion {
  tomaMuestra: string;
  condicionRecepcion: "" | "cumple" | "no_cumple";
  condicionObservacion: string;
  selloNumero: string;
  identificacionCliente: string;
  requiereOtrosLabs: boolean;
  otrosLabs: string[];
  otrosLabsDetalle: string;
  /** Cliente de la muestra (maestro); vacío = el de la OT. */
  clienteId: string;
  sellosVerificados: boolean;
  claseCustodia: string;
  ubicacion: string;
  datos: Record<string, ValorCampo>;
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
  clienteId: "",
  sellosVerificados: false,
  claseCustodia: "",
  ubicacion: "",
  datos: {},
};

/** Lo que falta antes de enviar (el servidor vuelve a comprobarlo). */
export function faltantesRecepcion(d: DatosRecepcion, cfg?: ConfigRecepcion | null): string[] {
  const f: string[] = [];
  if (!d.tomaMuestra) f.push("indique quién tomó la muestra");
  if (!d.condicionRecepcion) f.push("indique la condición de recepción");
  if (d.condicionRecepcion === "no_cumple" && d.condicionObservacion.trim().length < 5) f.push("describa por qué no cumple (mínimo 5 caracteres)");
  if (d.requiereOtrosLabs && !d.otrosLabs.length) f.push("marque qué otro(s) laboratorio(s) deben ensayarla");
  if (d.sellosVerificados && !d.selloNumero.trim()) f.push("indique el Nº de los sellos que verificó");
  f.push(...faltantesLaboratorio(cfg, d));
  return f;
}

/** Cuerpo para la API (vacíos → null). */
export function cuerpoRecepcion(d: DatosRecepcion) {
  const t = (s: string) => (s.trim() ? s.trim() : null);
  const datos: Record<string, ValorCampo> = {};
  for (const [k, v] of Object.entries(d.datos)) {
    if (v === "" || v === undefined) continue;
    datos[k] = typeof v === "string" ? v.trim() : v;
  }
  return {
    tomaMuestra: t(d.tomaMuestra),
    condicionRecepcion: d.condicionRecepcion || null,
    condicionObservacion: d.condicionRecepcion === "no_cumple" ? t(d.condicionObservacion) : null,
    selloNumero: t(d.selloNumero),
    identificacionCliente: t(d.identificacionCliente),
    requiereOtrosLabs: d.requiereOtrosLabs,
    otrosLabs: d.requiereOtrosLabs ? d.otrosLabs : [],
    otrosLabsDetalle: d.requiereOtrosLabs ? t(d.otrosLabsDetalle) : null,
    clienteId: d.clienteId || null,
    sellosVerificados: d.selloNumero.trim() ? d.sellosVerificados : null,
    claseCustodia: t(d.claseCustodia),
    ubicacion: t(d.ubicacion),
    datos,
  };
}

const estiloLegend = { fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" as const, marginBottom: 4 };
const estiloCasilla = { display: "flex", gap: 6, alignItems: "center", fontWeight: 400, textTransform: "none" as const, fontSize: 13 };

/** Un campo propio del laboratorio, según su tipo. */
function CampoLab({ c, valor, onCambio, idBase }: { c: CampoRecepcion; valor: ValorCampo; onCambio: (v: ValorCampo) => void; idBase: string }) {
  const id = `${idBase}-${c.codigo}`;
  const req = c.obligatorio ? <span className="req">*</span> : null;
  const ayuda = c.ayuda ? <span style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>{c.ayuda}</span> : null;
  if (c.tipo === "casilla")
    return (
      <div className="field">
        <label style={estiloCasilla}>
          <input type="checkbox" style={{ width: "auto" }} checked={valor === true} onChange={(e) => onCambio(e.target.checked)} />
          {c.etiqueta} {req}
        </label>
        {ayuda}
      </div>
    );
  if (c.tipo === "lista")
    return (
      <div className="field">
        <label htmlFor={id}>{c.etiqueta} {req}</label>
        <select id={id} value={String(valor ?? "")} onChange={(e) => onCambio(e.target.value)}>
          <option value="">Elija…</option>
          {c.opciones.map((o) => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}
        </select>
        {ayuda}
      </div>
    );
  return (
    <div className="field">
      <label htmlFor={id}>{c.etiqueta} {req}</label>
      <input
        id={id}
        type={c.tipo === "fecha" ? "date" : "text"}
        inputMode={c.tipo === "numero" ? "decimal" : c.tipo === "entero" ? "numeric" : undefined}
        value={String(valor ?? "")}
        maxLength={300}
        onChange={(e) => onCambio(e.target.value)}
      />
      {ayuda}
    </div>
  );
}

export default function FormRecepcion({
  valor,
  onCambio,
  opcionesToma,
  labPrincipalId,
  porMuestra = true,
  config,
  clienteOt,
}: {
  valor: DatosRecepcion;
  onCambio: (d: DatosRecepcion) => void;
  opcionesToma: { codigo: string; etiqueta: string }[];
  /** laboratorio responsable de la OT: no se ofrece como «otro laboratorio» */
  labPrincipalId?: string | null;
  /** false = datos comunes a varias muestras (sello e identificación van por muestra) */
  porMuestra?: boolean;
  /** Configuración de la recepción del laboratorio (campos propios). */
  config?: ConfigRecepcion | null;
  /** Cliente de la OT (opción por defecto del cliente de la muestra). */
  clienteOt?: { id: string | null; nombre: string | null } | null;
}) {
  const id = useId();
  const [labs, setLabs] = useState<Unidad[]>([]);
  const [busqCliente, setBusqCliente] = useState("");
  const [clientes, setClientes] = useState<{ id: string; razonSocial: string; nombreFantasia: string | null }[]>([]);
  useEffect(() => {
    llamar<Unidad[]>("GET", "/ot/laboratorios").then(setLabs).catch(() => setLabs([]));
  }, []);
  // Clientes del maestro (LME 20-10: «MAXAM, AUSTIN, DEGESCH…»): se buscan al escribir.
  useEffect(() => {
    const q = busqCliente.trim();
    const t = setTimeout(() => {
      llamar<typeof clientes>("GET", `/recepcion/clientes${q ? `?search=${encodeURIComponent(q)}` : ""}`).then(setClientes).catch(() => setClientes([]));
    }, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [busqCliente]);
  const set = (p: Partial<DatosRecepcion>) => onCambio({ ...valor, ...p });
  const setCampo = (c: CampoRecepcion, v: ValorCampo) => {
    if (c.codigo === "clase_custodia") set({ claseCustodia: String(v ?? "") });
    else if (c.codigo === "ubicacion") set({ ubicacion: String(v ?? "") });
    else set({ datos: { ...valor.datos, [c.codigo]: v } });
  };
  const alternarLab = (u: string) =>
    set({ otrosLabs: valor.otrosLabs.includes(u) ? valor.otrosLabs.filter((x) => x !== u) : [...valor.otrosLabs, u] });
  const camposLab = config?.campos ?? [];
  const tieneUbicacion = camposLab.some((c) => c.codigo === "ubicacion");
  const elegido = clientes.find((c) => c.id === valor.clienteId);

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
        <legend style={estiloLegend}>Condición de recepción <span className="req">*</span></legend>
        <div className="segmentado" role="group" aria-label="Condición de recepción" style={{ display: "flex", gap: 6 }}>
          {(["cumple", "no_cumple"] as const).map((c) => {
            const activo = valor.condicionRecepcion === c;
            return (
              <button
                key={c}
                type="button"
                aria-pressed={activo}
                className={`btn sm ${activo ? (c === "cumple" ? "primary" : "danger") : "outline"}`}
                style={{ minWidth: 110 }}
                onClick={() => set({ condicionRecepcion: c })}
              >
                {activo ? "✓ " : ""}{c === "cumple" ? "Cumple" : "No cumple"}
              </button>
            );
          })}
        </div>
      </fieldset>
      {valor.condicionRecepcion === "no_cumple" && (
        <div className="field span-2" style={{ gridColumn: "1 / -1" }}>
          <label htmlFor={`${id}-obs`}>¿Qué no cumple? <span className="req">*</span></label>
          <input id={`${id}-obs`} value={valor.condicionObservacion} maxLength={2000} onChange={(e) => set({ condicionObservacion: e.target.value })}
            placeholder="Por ejemplo: envase con filtración, sello roto, cantidad insuficiente" />
          <span style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>Queda registrado en la muestra y se avisa en la bandeja del laboratorio.</span>
        </div>
      )}
      <div className="field">
        <label htmlFor={`${id}-cli`}>Cliente de la muestra</label>
        <div style={{ display: "flex", gap: 6 }}>
          <input id={`${id}-cli-busca`} aria-label="Buscar cliente en el maestro" value={busqCliente} onChange={(e) => setBusqCliente(e.target.value)}
            placeholder="Buscar…" style={{ flex: "0 0 110px", minWidth: 0 }} />
          <select id={`${id}-cli`} value={valor.clienteId} onChange={(e) => set({ clienteId: e.target.value })} style={{ flex: 1, minWidth: 0, width: "100%" }}>
            <option value="">{clienteOt?.nombre ? `El de la OT · ${clienteOt.nombre}` : "El de la OT"}</option>
            {valor.clienteId && !elegido && <option value={valor.clienteId}>Cliente elegido</option>}
            {clientes.filter((c) => c.id !== clienteOt?.id).map((c) => (
              <option key={c.id} value={c.id}>{c.razonSocial}{c.nombreFantasia ? ` (${c.nombreFantasia})` : ""}</option>
            ))}
          </select>
        </div>
        <span style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>Empresa dueña de la muestra si no es el cliente de la OT (p. ej. el importador en una internación).</span>
      </div>
      {porMuestra && (
        <>
          <div className="field">
            <label htmlFor={`${id}-ident`}>Identificación de la muestra dada por el cliente</label>
            <input id={`${id}-ident`} value={valor.identificacionCliente} maxLength={300} onChange={(e) => set({ identificacionCliente: e.target.value })} />
            <span style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>Lo que dice el rótulo del cliente; no es el código del laboratorio.</span>
          </div>
          <div className="field">
            <label htmlFor={`${id}-sello`}>Nº de sello(s)</label>
            <input id={`${id}-sello`} value={valor.selloNumero} maxLength={200} onChange={(e) => set({ selloNumero: e.target.value })} placeholder="Varios: sepárelos con coma" />
            <label style={{ ...estiloCasilla, fontSize: 12, marginTop: 4 }}>
              <input type="checkbox" style={{ width: "auto" }} checked={valor.sellosVerificados} disabled={!valor.selloNumero.trim()}
                onChange={(e) => set({ sellosVerificados: e.target.checked })} />
              Sellos verificados e íntegros
            </label>
          </div>
        </>
      )}
      {!porMuestra && (
        <div className="field">
          <span style={estiloLegend}>Sellos</span>
          <label style={{ ...estiloCasilla, fontSize: 12 }}>
            <input type="checkbox" style={{ width: "auto" }} checked={valor.sellosVerificados} onChange={(e) => set({ sellosVerificados: e.target.checked })} />
            Sellos verificados e íntegros (indique sus números en cada muestra)
          </label>
        </div>
      )}
      {!tieneUbicacion && (
        <div className="field">
          <label htmlFor={`${id}-ubic`}>Ubicación de almacenamiento</label>
          <input id={`${id}-ubic`} value={valor.ubicacion} maxLength={120} onChange={(e) => set({ ubicacion: e.target.value })} />
        </div>
      )}
      {camposLab.length > 0 && (
        <fieldset style={{ gridColumn: "1 / -1", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px 4px", margin: 0 }}>
          <legend style={{ ...estiloLegend, padding: "0 4px" }}>Datos propios del {config?.laboratorio?.codigo ?? "laboratorio"}</legend>
          <div className="form-grid cols-2">
            {camposLab.map((c) => (
              <CampoLab key={c.codigo} c={c} valor={valorCampo(c, valor)} onCambio={(v) => setCampo(c, v)} idBase={id} />
            ))}
          </div>
        </fieldset>
      )}
      <div className="field" style={{ gridColumn: "1 / -1" }}>
        <label style={{ ...estiloCasilla, fontWeight: 600 }}>
          <input type="checkbox" style={{ width: "auto" }} checked={valor.requiereOtrosLabs} onChange={(e) => set({ requiereOtrosLabs: e.target.checked })} />
          ¿Requiere ensayos de otros laboratorios?
        </label>
        {valor.requiereOtrosLabs && (
          <div style={{ marginTop: 6 }}>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 4 }}>Marque cuál(es). Queda constancia en la muestra y se enlaza con las órdenes internas de la OT.</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", maxHeight: 150, overflowY: "auto" }}>
              {labs.filter((u) => u.id !== labPrincipalId && u.tipo === "LABORATORIO").map((u) => (
                <label key={u.id} style={{ ...estiloCasilla, fontSize: 12.5 }} title={u.nombre}>
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
