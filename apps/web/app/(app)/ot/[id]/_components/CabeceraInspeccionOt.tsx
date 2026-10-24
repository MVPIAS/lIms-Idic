"use client";

/**
 * «Cabecera de inspección» de una OT del BPCH (EP-10 10.3 · SAC-PG01-IT10 ·
 * NCh 44), en la pestaña «Cabecera» de la ficha de la OT. Es la que imprimen
 * el Informe de Inspección y el documento final (Certificado de Conformidad o
 * Informe de Incumplimiento). OT directa y Producción Nacional se registran
 * aquí; en Internación y Reinspección vive en su expediente y aquí solo se
 * agregan dirección, comuna y contacto. No se muestra en OT de otras unidades.
 * API: GET/PUT /bpch/cabecera-ot/:otId (docs/FLUJO_BPCH_CABECERA_OT.md).
 */
import { conPunto } from "@/lib/etiquetas";
import { avisarCambioOt } from "@/lib/refresco";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { llamar } from "@/lib/laboratorio";
import { fechaHora } from "@/lib/format";
import { toast } from "@/components/ui/feedback";

type Cabecera = Record<string, any>;
interface Ficha {
  esBpch: boolean;
  proceso?: "INTERNACION" | "REINSPECCION" | "PRODUCCION_NACIONAL" | "DIRECTA";
  enlaceExpediente?: string | null;
  soloComplemento?: boolean;
  editable?: boolean;
  cabecera?: Cabecera | null;
  vista?: Record<string, string | null> | null;
  faltantesEmision?: string[];
  sugeridos?: { inspectores: string; procedimientos: string[] };
  /** B-019: datos conocidos del producto (Producción Nacional) o del prototipo para los campos vacíos. */
  heredados?: Cabecera;
  historial?: { id: string; cambios: Record<string, { antes: any; despues: any }>; createdAt: string; usuarioNombre: string | null }[];
}

const PROCESO: Record<string, string> = {
  INTERNACION: "Internación",
  REINSPECCION: "Reinspección",
  PRODUCCION_NACIONAL: "Producción Nacional",
  DIRECTA: "OT directa",
};

/** Campos del formulario (EP-10 10.3), en el orden de la planilla oficial. */
const CAMPOS: { k: string; etiqueta: string; tipo?: "date" | "number" | "esquema" | "procedimiento" | "area"; max?: number; ancho?: 2; ayuda?: string; vista?: string }[] = [
  { k: "lugarInspeccion", etiqueta: "Lugar de inspección", max: 240, ancho: 2, ayuda: "Obligatorio para emitir el Informe de Inspección.", vista: "lugar_inspeccion" },
  { k: "direccion", etiqueta: "Dirección", max: 240, vista: "direccion" },
  { k: "comuna", etiqueta: "Comuna", max: 120, vista: "comuna" },
  { k: "contacto", etiqueta: "Contacto en el lugar", max: 200, ayuda: "Cargo o iniciales (si se sigue imprimiendo: por confirmar).", vista: "contacto" },
  { k: "fechaInspeccion", etiqueta: "Fecha de inspección", tipo: "date", ayuda: "Obligatoria para emitir el Informe de Inspección.", vista: "fecha_inspeccion" },
  { k: "inspectores", etiqueta: "Inspectores LCA", max: 300, ayuda: "Por iniciales.", vista: "inspectores" },
  { k: "procedimiento", etiqueta: "Procedimiento de control", tipo: "procedimiento", max: 120, vista: "procedimiento" },
  { k: "documentoOrigen", etiqueta: "Documento de origen", max: 200, ayuda: "Resolución, RAF o solicitud.", vista: "documento" },
  { k: "fechaDocumento", etiqueta: "Fecha del documento", tipo: "date" },
  { k: "esquema", etiqueta: "Esquema", tipo: "esquema", vista: "esquema" },
  { k: "elementoGenerico", etiqueta: "Elemento genérico", max: 240, vista: "elemento_generico" },
  { k: "elementoEspecifico", etiqueta: "Elemento específico", max: 240, vista: "elemento_especifico" },
  { k: "cncDgmn", etiqueta: "CNC-DGMN", max: 60, ayuda: "Formato E-I/n/n/n/n/n.", vista: "cnc_dgmn" },
  { k: "claseDivisionUn", etiqueta: "Clase/División UN", max: 40 },
  { k: "numeroUn", etiqueta: "Nº UN", max: 20 },
  { k: "identificacionLote", etiqueta: "Identificación del lote", max: 200, vista: "lote" },
  { k: "tamanoLote", etiqueta: "Tamaño del lote", tipo: "number" },
  { k: "tamanoMuestra", etiqueta: "Tamaño de la muestra", tipo: "number", ayuda: "No mayor que el lote (NCh 44)." },
  { k: "fechaVencimientoProducto", etiqueta: "Vencimiento del producto", tipo: "date", vista: "vencimiento_producto" },
  { k: "vigenciaInforme", etiqueta: "Vigencia del informe", tipo: "date", ayuda: "Regla de cálculo por confirmar con el IDIC.", vista: "vigencia_informe" },
  { k: "observaciones", etiqueta: "Observaciones", tipo: "area", max: 4000, ancho: 2, vista: "observaciones" },
];
const COMPLEMENTO = new Set(["direccion", "comuna", "contacto"]);

export default function CabeceraInspeccionOt({ otId }: { otId: string }) {
  const [f, setF] = useState<Ficha | null>(null);
  const [form, setForm] = useState<Cabecera>({});
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const r = await llamar<Ficha>("GET", `/bpch/cabecera-ot/${otId}`);
      setF(r);
      // B-019: la cabecera llega precargada con lo que ya se conoce; lo guardado manda.
      setForm({ ...(r.heredados ?? {}), ...(r.cabecera ?? {}) });
    } catch {
      setF({ esBpch: false });
    }
  }, [otId]);
  useEffect(() => {
    cargar();
  }, [cargar]);

  if (!f?.esBpch) return null;
  const campos = f.soloComplemento ? CAMPOS.filter((c) => COMPLEMENTO.has(c.k)) : CAMPOS;
  const heredado = (c: (typeof CAMPOS)[number]) =>
    !f.soloComplemento && c.vista && (form[c.k] === null || form[c.k] === undefined || form[c.k] === "") ? f.vista?.[c.vista] ?? null : null;

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setGuardando(true);
    try {
      const cuerpo: Record<string, any> = {};
      for (const c of campos) {
        const v = form[c.k];
        cuerpo[c.k] = v === "" || v === undefined ? null : c.tipo === "number" ? Number(v) : v;
      }
      const r = await llamar<Ficha>("PUT", `/bpch/cabecera-ot/${otId}`, cuerpo);
      setF({ ...f, ...r });
      setForm(r.cabecera ?? {});
      toast.ok(r.faltantesEmision?.length ? "Cabecera guardada. Aún falta para emitir el Informe de Inspección." : "Cabecera guardada: siga con el muestreo de los lotes.");
      avisarCambioOt(otId); // B-041: la ruta deja de decir «Cabecera · etapa actual».
    } catch (err: any) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section className="card" style={{ padding: 12, margin: 0 }} aria-labelledby="cab-insp-titulo">
      <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", justifyContent: "space-between" }}>
        <h3 id="cab-insp-titulo" style={{ margin: 0, fontSize: 14 }}>Cabecera de inspección · SAC-PG01-IT10 · NCh 44</h3>
        <span className="pill blue">{PROCESO[f.proceso ?? "DIRECTA"]}</span>
      </div>
      <p className="subtitle" style={{ margin: "4px 0 8px" }}>
        Se imprime en el Informe de Inspección y en el documento final (Certificado de Conformidad o Informe de Incumplimiento).
        {f.soloComplemento && f.enlaceExpediente && (
          <> La cabecera de esta OT se registra en su <Link href={f.enlaceExpediente as any} style={{ color: "var(--accent)" }}>expediente de {PROCESO[f.proceso!].toLowerCase()}</Link>; aquí solo se agregan dirección, comuna y contacto.</>
        )}
        {f.proceso === "PRODUCCION_NACIONAL" && " Lo que no registre aquí sale del programa de Producción Nacional (RAF, producto, lote, lugar y fecha programada)."}
      </p>

      {(f.faltantesEmision ?? []).length > 0 ? (
        <div className="alert warn" role="status">
          <b>Para emitir el Informe de Inspección falta:</b>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{f.faltantesEmision!.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      ) : (
        <div className="alert success" role="status">La cabecera tiene lo necesario para emitir el Informe de Inspección.</div>
      )}
      {error && <div className="alert warn" role="alert">{error}</div>}

      <form onSubmit={guardar} aria-label="Cabecera de inspección">
        <fieldset disabled={!f.editable} style={{ border: 0, padding: 0, margin: 0 }}>
          <div className="form-grid cols-2">
            {campos.map((c) => {
              const id = `cab-${c.k}`;
              const her = heredado(c);
              const valor = form[c.k] ?? "";
              const set = (v: any) => setForm((x) => ({ ...x, [c.k]: v }));
              return (
                <div key={c.k} className={`field${c.ancho === 2 ? " span-2" : ""}`}>
                  <label htmlFor={id}>{c.etiqueta}{c.k === "procedimiento" && <span className="req"> *</span>}</label>
                  {c.tipo === "esquema" ? (
                    <select id={id} value={valor} onChange={(e) => set(e.target.value)}>
                      <option value="">— Seleccione —</option>
                      <option value="LOTES">Por lotes</option>
                      <option value="TIPO">Tipo</option>
                    </select>
                  ) : c.tipo === "area" ? (
                    <textarea id={id} rows={2} maxLength={c.max} value={valor} onChange={(e) => set(e.target.value)} />
                  ) : (
                    <input id={id} value={valor} maxLength={c.max}
                      type={c.tipo === "date" ? "date" : c.tipo === "number" ? "number" : "text"}
                      min={c.tipo === "number" ? 1 : undefined}
                      list={c.tipo === "procedimiento" ? "cab-procedimientos" : undefined}
                      onChange={(e) => set(e.target.value)} />
                  )}
                  {f.heredados?.[c.k] !== undefined && f.heredados?.[c.k] === form[c.k] && (
                    <small style={{ color: "var(--accent)" }}>Precargado {f.proceso === "PRODUCCION_NACIONAL" ? "del producto y su clasificación" : "del prototipo"}: revíselo y guarde.</small>
                  )}
                  {(her || c.ayuda || (c.k === "inspectores" && f.sugeridos?.inspectores)) && (
                    <small style={{ color: "var(--muted)" }}>
                      {her ? `Si lo deja vacío se imprime: ${her}. ` : ""}
                      {c.k === "inspectores" && f.sugeridos?.inspectores ? `${conPunto(`Asignados a la OT: ${f.sugeridos.inspectores}`)} ` : ""}
                      {c.ayuda ?? ""}
                    </small>
                  )}
                </div>
              );
            })}
          </div>
          <datalist id="cab-procedimientos">{(f.sugeridos?.procedimientos ?? []).map((p) => <option key={p} value={p} />)}</datalist>
        </fieldset>
        <PlanNch44 tamanoLote={form.tamanoLote} tamanoMuestra={form.tamanoMuestra} editable={!!f.editable}
          onUsar={(n) => setForm((x) => ({ ...x, tamanoMuestra: n }))} />
        {f.editable ? (
          <div className="toolbar" style={{ margin: "10px 0 0" }}>
            <button type="submit" className="btn primary" disabled={guardando}>{guardando ? "Guardando…" : "Guardar cabecera → muestrear lotes"}</button>
          </div>
        ) : (
          <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--muted)" }}>La registran la jefatura de la sucursal y sus inspectores mientras la OT está abierta.</p>
        )}
      </form>

      {!!f.historial?.length && (
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 12.5 }}>Historial de la cabecera ({f.historial.length})</summary>
          <table className="data" style={{ marginTop: 6 }}>
            <thead><tr><th scope="col">Fecha</th><th scope="col">Quién</th><th scope="col">Cambios</th></tr></thead>
            <tbody>
              {f.historial.map((h) => (
                <tr key={h.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{fechaHora(h.createdAt)}</td>
                  <td>{h.usuarioNombre ?? "—"}</td>
                  <td>{Object.entries(h.cambios).map(([k, v]) => `${CAMPOS.find((c) => c.k === k)?.etiqueta ?? k}: ${v.antes ?? "—"} → ${v.despues ?? "—"}`).join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}

/**
 * B-046 · Plan NCh 44 propuesto para el lote (EP-10 10.4): letra código, tamaño
 * de muestra y Ac/Re por clase, con el nivel y los AQL de Parámetros de la
 * operación (el mismo plan del muestreo del lote). Quien inspecciona lo usa o
 * escribe otro tamaño.
 */
function PlanNch44({ tamanoLote, tamanoMuestra, editable, onUsar }: { tamanoLote: unknown; tamanoMuestra: unknown; editable: boolean; onUsar: (n: number) => void }) {
  const lote = Number(String(tamanoLote ?? "").trim());
  const valido = Number.isInteger(lote) && lote >= 2;
  const [plan, setPlan] = useState<any>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!valido) { setPlan(null); setError(""); return; }
    const t = setTimeout(() => {
      llamar<any>("GET", `/muestreo/plan?tamanoLote=${lote}&config=1`)
        .then((p) => { setPlan(p); setError(""); })
        .catch((e) => { setPlan(null); setError(e.message); });
    }, 300);
    return () => clearTimeout(t);
  }, [lote, valido]);
  if (!valido) return null;
  if (error) return <div className="alert warn" style={{ marginTop: 8 }}>Plan NCh 44: {error}</div>;
  if (!plan) return null;
  const clases = Object.entries(plan.clases ?? {}) as [string, any][];
  const ETQ: Record<string, string> = { critico: "Críticos", mayor: "Mayores", menor: "Menores" };
  const n = Number(plan.nExtraer);
  const actual = Number(String(tamanoMuestra ?? "").trim());
  return (
    <div className="alert info" style={{ marginTop: 8, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ flex: 1, minWidth: 260 }}>
        <b>Plan NCh 44 propuesto</b> · nivel {plan.nivel} · letra código <b>{plan.letra}</b> · tamaño de muestra <b>n = {n}</b>
        {clases.length ? <> · {clases.map(([c, p]) => `${ETQ[c] ?? c} AQL ${String(p.aql).replace(".", ",")}: Ac ${p.ac} / Re ${p.re}`).join(" · ")}</> : " · sin AQL configurado (Ac/Re a criterio)"}
        {plan.avisos?.length ? <small style={{ display: "block", color: "var(--muted)" }}>{plan.avisos.join(" ")}</small> : null}
      </span>
      {editable && actual !== n && (
        <button type="button" className="btn outline sm" onClick={() => onUsar(n)}>Usar n = {n} como tamaño de la muestra</button>
      )}
    </div>
  );
}
