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
import { montoCl } from "@/lib/monto-cl";
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
  /** R3: listas de unidades y lugares de inspección (plantas del cliente y tabla del BPCH). */
  opciones?: {
    unidadesLote: { valor: string; etiqueta: string }[];
    unidadesMuestra: { valor: string; etiqueta: string }[];
    lugares: { origen: "planta" | "tabla"; lugar: string; direccion: string | null; comuna: string | null }[];
  };
  lotes?: LoteCab[];
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

type LoteCab = {
  identificacion: string;
  tamanoLote: number | string | null;
  unidadLote: string | null;
  tamanoMuestra: number | string | null;
  unidadMuestra: string | null;
  vencimiento: string | null;
  especificacion: string | null;
  observacion: string | null;
};
const LOTE_VACIO: LoteCab = { identificacion: "", tamanoLote: "", unidadLote: "", tamanoMuestra: "", unidadMuestra: "", vencimiento: "", especificacion: "", observacion: "" };

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
      if (!f?.soloComplemento) {
        cuerpo.unidadLote = form.unidadLote || null;
        cuerpo.unidadMuestra = form.unidadMuestra || null;
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
    <section className="card" style={{ padding: 12, margin: 0, minWidth: 0, maxWidth: "100%" }} aria-labelledby="cab-insp-titulo">
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
        <fieldset disabled={!f.editable} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <div className="form-grid cols-2" style={{ minWidth: 0 }}>
            {campos.map((c) => {
              const id = `cab-${c.k}`;
              const her = heredado(c);
              const valor = form[c.k] ?? "";
              const set = (v: any) => setForm((x) => ({ ...x, [c.k]: v }));
              return (
                <div key={c.k} className={`field${c.ancho === 2 ? " span-2" : ""}`} style={{ minWidth: 0 }}>
                  <label htmlFor={id}>{c.etiqueta}{c.k === "procedimiento" && <span className="req"> *</span>}</label>
                  {c.k === "lugarInspeccion" && (f.opciones?.lugares ?? []).length > 0 && (
                    <select
                      aria-label="Elegir el lugar de la tabla de plantas y lugares"
                      value=""
                      style={{ marginBottom: 4, width: "100%", maxWidth: "100%" }}
                      onChange={(e) => {
                        const l = f.opciones!.lugares[Number(e.target.value)];
                        if (l) setForm((x) => ({ ...x, lugarInspeccion: l.lugar, direccion: l.direccion ?? x.direccion ?? "", comuna: l.comuna ?? x.comuna ?? "" }));
                      }}
                    >
                      <option value="">— Elegir planta o lugar (trae la dirección) · o escriba si es en terreno —</option>
                      {f.opciones!.lugares.map((l, i) => (
                        <option key={`${l.origen}-${l.lugar}`} value={i}>{l.origen === "planta" ? "Planta del cliente" : "Lugar"} · {l.lugar}{l.comuna ? ` (${l.comuna})` : ""}</option>
                      ))}
                    </select>
                  )}
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
                  {(c.k === "tamanoLote" || c.k === "tamanoMuestra") && (
                    <select
                      aria-label={c.k === "tamanoLote" ? "Unidad del tamaño del lote" : "Unidad del tamaño de la muestra"}
                      value={form[c.k === "tamanoLote" ? "unidadLote" : "unidadMuestra"] ?? ""}
                      style={{ marginTop: 4 }}
                      onChange={(e) => setForm((x) => ({ ...x, [c.k === "tamanoLote" ? "unidadLote" : "unidadMuestra"]: e.target.value }))}
                    >
                      <option value="">— Unidad —</option>
                      {(c.k === "tamanoLote" ? f.opciones?.unidadesLote : f.opciones?.unidadesMuestra)?.map((u) => <option key={u.valor} value={u.valor}>{u.etiqueta}</option>)}
                    </select>
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
        <PlanNch44 tamanoLote={form.tamanoLote} unidadLote={form.unidadLote} tamanoMuestra={form.tamanoMuestra} editable={!!f.editable}
          onUsar={(n) => setForm((x) => ({ ...x, tamanoMuestra: n }))} />
        {f.editable ? (
          <div className="toolbar" style={{ margin: "10px 0 0" }}>
            <button type="submit" className="btn primary" disabled={guardando}>{guardando ? "Guardando…" : "Guardar cabecera → muestrear lotes"}</button>
          </div>
        ) : (
          <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--muted)" }}>La registran la jefatura de la sucursal y sus inspectores mientras la OT está abierta.</p>
        )}
      </form>

      <LotesInspeccion otId={otId} ficha={f} onGuardado={(r) => setF({ ...f, ...r })} />

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
 * Sesión R3 · lotes de la inspección: especificación por lote, tamaño del lote
 * (kilos, toneladas) y de la muestra (toneladas, kilos, gramos, unidades) y la
 * fecha de vencimiento o vigencia de cada lote. API: PUT /bpch/cabecera-ot/:otId/lotes.
 */
function LotesInspeccion({ otId, ficha, onGuardado }: { otId: string; ficha: Ficha; onGuardado: (r: Ficha) => void }) {
  const [filas, setFilas] = useState<LoteCab[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setFilas((ficha.lotes ?? []).map((l) => ({ ...LOTE_VACIO, ...Object.fromEntries(Object.entries(l).map(([k, v]) => [k, v ?? ""])) }) as LoteCab));
  }, [ficha.lotes]);
  const editable = !!ficha.editable;
  const set = (i: number, k: keyof LoteCab, v: string) => setFilas((xs) => xs.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const num = (v: unknown) => (v === "" || v === null || v === undefined ? null : montoCl(v) ?? Number.NaN);

  async function guardar() {
    setGuardando(true);
    setError("");
    try {
      const lotes = filas.map((l) => ({
        identificacion: String(l.identificacion ?? "").trim(),
        tamanoLote: num(l.tamanoLote),
        unidadLote: l.unidadLote || null,
        tamanoMuestra: num(l.tamanoMuestra),
        unidadMuestra: l.unidadMuestra || null,
        vencimiento: l.vencimiento || null,
        especificacion: l.especificacion || null,
        observacion: l.observacion || null,
      }));
      const r = await llamar<Ficha>("PUT", `/bpch/cabecera-ot/${otId}/lotes`, { lotes });
      onGuardado(r);
      toast.ok("Lotes de la inspección guardados.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  if (!editable && !filas.length) return null;
  return (
    <section style={{ marginTop: 12, minWidth: 0, maxWidth: "100%" }} aria-labelledby="cab-lotes">
      <h4 id="cab-lotes" style={{ margin: "0 0 4px", fontSize: 13 }}>Lotes de la inspección</h4>
      <p className="subtitle" style={{ margin: "0 0 6px" }}>Uno o más lotes, cada uno con su especificación, tamaños con unidad y fecha de vencimiento o vigencia.</p>
      {error && <div className="alert warn" role="alert">{error}</div>}
      {/* F016: la tabla se desplaza dentro de su caja y no ensancha la pestaña. */}
      {filas.length > 0 && (
        <div style={{ overflowX: "auto", maxWidth: "100%" }}>
          <table className="data" aria-label="Lotes de la inspección" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th scope="col">Lote *</th><th scope="col">Tamaño del lote</th><th scope="col">Tamaño de la muestra</th>
                <th scope="col">Vencimiento o vigencia</th><th scope="col">Especificación</th><th scope="col">Observación</th>{editable && <th scope="col" />}
              </tr>
            </thead>
            <tbody>
              {filas.map((l, i) => (
                <tr key={i}>
                  <td><input aria-label={`Identificación del lote ${i + 1}`} style={{ width: 130 }} value={l.identificacion ?? ""} maxLength={200} disabled={!editable} onChange={(e) => set(i, "identificacion", e.target.value)} /></td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <input aria-label={`Tamaño del lote ${i + 1}`} inputMode="decimal" style={{ width: 80 }} value={String(l.tamanoLote ?? "")} disabled={!editable} onChange={(e) => set(i, "tamanoLote", e.target.value)} />
                    <select aria-label={`Unidad del lote ${i + 1}`} style={{ width: "auto" }} value={l.unidadLote ?? ""} disabled={!editable} onChange={(e) => set(i, "unidadLote", e.target.value)}>
                      <option value="">—</option>
                      {ficha.opciones?.unidadesLote.map((u) => <option key={u.valor} value={u.valor}>{u.etiqueta}</option>)}
                    </select>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <input aria-label={`Tamaño de la muestra del lote ${i + 1}`} inputMode="decimal" style={{ width: 80 }} value={String(l.tamanoMuestra ?? "")} disabled={!editable} onChange={(e) => set(i, "tamanoMuestra", e.target.value)} />
                    <select aria-label={`Unidad de la muestra del lote ${i + 1}`} style={{ width: "auto" }} value={l.unidadMuestra ?? ""} disabled={!editable} onChange={(e) => set(i, "unidadMuestra", e.target.value)}>
                      <option value="">—</option>
                      {ficha.opciones?.unidadesMuestra.map((u) => <option key={u.valor} value={u.valor}>{u.etiqueta}</option>)}
                    </select>
                  </td>
                  <td><input aria-label={`Vencimiento o vigencia del lote ${i + 1}`} type="date" style={{ width: 140 }} value={l.vencimiento ?? ""} disabled={!editable} onChange={(e) => set(i, "vencimiento", e.target.value)} /></td>
                  <td><input aria-label={`Especificación del lote ${i + 1}`} style={{ width: 150 }} value={l.especificacion ?? ""} maxLength={1000} disabled={!editable} onChange={(e) => set(i, "especificacion", e.target.value)} /></td>
                  <td><input aria-label={`Observación del lote ${i + 1}`} style={{ width: 150 }} value={l.observacion ?? ""} maxLength={1000} disabled={!editable} onChange={(e) => set(i, "observacion", e.target.value)} /></td>
                  {editable && (
                    <td><button type="button" className="btn ghost-danger sm" aria-label={`Quitar el lote ${i + 1}`} onClick={() => setFilas((xs) => xs.filter((_, j) => j !== i))}>Quitar</button></td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editable && (
        <div className="toolbar" style={{ margin: "6px 0 0", gap: 6 }}>
          <button type="button" className="btn outline sm" onClick={() => setFilas((xs) => [...xs, { ...LOTE_VACIO }])}>Agregar lote</button>
          <button type="button" className="btn primary sm" disabled={guardando} onClick={guardar}>{guardando ? "Guardando…" : "Guardar lotes"}</button>
        </div>
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
function PlanNch44({ tamanoLote, unidadLote, tamanoMuestra, editable, onUsar }: { tamanoLote: unknown; unidadLote?: unknown; tamanoMuestra: unknown; editable: boolean; onUsar: (n: number) => void }) {
  const lote = Number(String(tamanoLote ?? "").trim());
  // F005: NCh 44 cuenta unidades (envases, piezas, pares); con el lote en masa no se propone un plan.
  const enMasa = ["t", "kg", "g"].includes(String(unidadLote ?? "").trim());
  const valido = Number.isInteger(lote) && lote >= 2 && !enMasa;
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
  if (enMasa && Number.isInteger(lote) && lote >= 2)
    return <div className="alert info" style={{ marginTop: 8 }}>El plan NCh 44 se calcula con el tamaño del lote en unidades (envases, piezas o pares): con el lote en kilos o toneladas indique el tamaño de la muestra según el procedimiento.</div>;
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
