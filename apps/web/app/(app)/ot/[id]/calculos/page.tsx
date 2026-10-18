"use client";

/**
 * Planilla de registros y cálculos de la OT · vista auditable, de solo lectura
 * (Depto. Químico, 15-10-2026: «se debe agregar una vista de planilla de
 * registros y de cálculos; son auditables»).
 *
 * Por cada ensayo: los datos primarios (lecturas con los campos del método,
 * réplicas, variables), la fórmula que se aplicó y de dónde viene (la de la
 * orden o la del catálogo), el factor (del método o ajustado en la OT, con quién,
 * cuándo y por qué), el resultado y su especificación, quién capturó, revisó y
 * aprobó, y el historial de cambios (quién, cuándo, valor anterior y nuevo,
 * motivo). Se descarga para Excel (CSV).
 *
 * API: GET /laboratorio/ot/:id/planilla-calculos[?formato=csv] (resultado.ver + alcance)
 */
import { useParams } from "next/navigation";
import { Fragment, useEffect, useMemo, useState } from "react";
import { PageHeader, EmptyState, SkeletonRows } from "@/components/ui/PageHeader";
import { toast } from "@/components/ui/feedback";
import { fechaHora } from "@/lib/format";
import { ESTADO_RESULTADO, llamar, veredictoInfo } from "@/lib/laboratorio";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";

interface Cambio { fecha: string; usuario: string | null; campo: string; anterior: unknown; nuevo: unknown; motivo: string | null; origen: string | null }
interface Ensayo {
  resultadoId: string; muestra: string; muestraNombre: string | null; ensayo: string; metodo: string | null; norma: string | null;
  unidad: string | null; estado: string; veredicto: string | null; campos: { nombre: string; unidad: string | null }[];
  lecturas: Record<string, number>[]; replicas: number[]; variables: Record<string, number>;
  formula: string | null; formulaOrigen: "orden" | "catalogo" | "sin_formula"; formulaCatalogo: string | null; formulaAplicada: string | null;
  factor: { valor: number; operacion: string; origen: string | null; descripcion: string | null; editadoPor: string | null; editadoAt: string | null; motivo: string | null; aplicado?: boolean | null } | null;
  valorSinFactor: number | null; resultado: string | null; promedio: number | null; desviacion: number | null; cv: number | null;
  limiteInf: string | null; nominal: string | null; limiteSup: string | null; requisito: string | null;
  analista: string | null; revisor: string | null; aprobador: string | null; fecha: string | null; historial: Cambio[];
}
interface Planilla {
  ot: { id: string; codigo: string; estado: string };
  ensayos: Ensayo[];
  eliminados: { resultadoId: string; fecha: string; usuario: string | null; anterior: unknown; motivo: string | null }[];
  /** El usuario trabaja en la OT por orden interna: solo ve los ensayos de su laboratorio. */
  soloSuLaboratorio?: boolean;
}

const CAMPO: Record<string, string> = {
  alta: "Alta del ensayo", baja: "Eliminación", valor_numerico: "Valor", valor_texto: "Valor (texto)", replicas: "Réplicas",
  lecturas: "Lecturas", variables: "Variables", promedio: "Promedio", resultado_final: "Resultado de la fórmula",
  valor_sin_factor: "Valor sin factor", formula: "Fórmula", formula_aplicada: "Fórmula aplicada", factor_valor: "Factor",
  factor_operacion: "Operación del factor", limite_inf: "Mín", nominal: "Nominal", limite_sup: "Máx", unidad: "Unidad",
  requisito: "Requisito", tipo_dato: "Tipo de dato", veredicto: "Veredicto", estado: "Estado", observacion: "Observación",
  equipo_id: "Equipo", deleted_at: "Eliminado",
};
const ORIGEN: Record<string, string> = {
  registro: "Registro de la muestra", captura: "Captura", captura_replicas: "Captura por réplicas", correccion: "Corrección",
  especificacion: "Especificación de la orden", factor: "Ajuste del factor", revision: "Revisión", aprobacion: "Aprobación",
  devolucion: "Devolución", reapertura: "Reapertura", veredicto_manual: "Veredicto del revisor", edicion_manual: "Edición manual",
  eliminacion: "Eliminación", sistema: "Sistema",
};

/** Número con coma decimal y sin redondear de más (dato primario). */
const n = (v: unknown) => (v == null || v === "" ? "—" : Number.isFinite(Number(v)) ? String(Number(Number(v).toPrecision(12))).replace(".", ",") : String(v));
function valor(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "number") return n(v);
  if (typeof v === "string") return /^-?\d+(\.\d+)?$/.test(v) ? n(v) : (ESTADO_RESULTADO[v]?.texto ?? v);
  if (Array.isArray(v)) return v.every((x) => typeof x === "number") ? v.map(n).join("; ") : v.map(valor).join(" | ");
  if (typeof v === "object") return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}=${valor(x)}`).join(" ");
  return String(v);
}
const especTexto = (e: Ensayo) => {
  const p: string[] = [];
  if (e.limiteInf) p.push(`Mín ${e.limiteInf}`);
  if (e.nominal) p.push(`Nom ${e.nominal}`);
  if (e.limiteSup) p.push(`Máx ${e.limiteSup}`);
  return p.length ? p.join(" · ") : "sin límites";
};

export default function PlanillaCalculosPage() {
  const { id } = useParams<{ id: string }>();
  const [p, setP] = useState<Planilla | null>(null);
  const [error, setError] = useState("");
  const [muestra, setMuestra] = useState("");
  const [texto, setTexto] = useState("");
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const [descargando, setDescargando] = useState(false);

  useEffect(() => {
    llamar<Planilla>("GET", `/laboratorio/ot/${id}/planilla-calculos`).then(setP).catch((e) => setError(e.message));
  }, [id]);

  const muestras = useMemo(() => [...new Set((p?.ensayos ?? []).map((e) => e.muestra))], [p]);
  const visibles = useMemo(
    () => (p?.ensayos ?? []).filter((e) => (!muestra || e.muestra === muestra) && (!texto.trim() || `${e.ensayo} ${e.metodo ?? ""}`.toLowerCase().includes(texto.trim().toLowerCase()))),
    [p, muestra, texto],
  );
  const alternar = (rid: string) => setAbiertos((s) => { const x = new Set(s); x.has(rid) ? x.delete(rid) : x.add(rid); return x; });

  async function descargar() {
    setDescargando(true);
    try {
      const r = await fetch(`${API}/laboratorio/ot/${id}/planilla-calculos?formato=csv`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("lims_token") ?? ""}` },
      });
      if (!r.ok) throw new Error(`No se pudo descargar (HTTP ${r.status}).`);
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `planilla_calculos_${p?.ot.codigo ?? id}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setDescargando(false);
    }
  }

  const codigo = p?.ot.codigo ?? "";
  return (
    <div>
      <PageHeader
        icono="🧮"
        titulo="Planilla de registros y cálculos"
        subtitulo={<>Vista de solo lectura y auditable de la OT <b>{codigo}</b>: datos primarios, fórmula aplicada, factor, resultado e historial de cada cambio.</>}
        migas={[{ label: "Expedientes / OT", href: "/ot" }, { label: codigo || "OT", href: `/ot/${id}` }, { label: "Planilla de cálculos" }]}
        acciones={
          <>
            <a className="btn outline sm" href={`/captura-ot?otId=${id}`}>Ir a la captura</a>
            <button className="btn primary sm" onClick={descargar} disabled={descargando || !p?.ensayos.length}>
              {descargando ? "Preparando…" : "Descargar para Excel (CSV)"}
            </button>
          </>
        }
      />
      {error && <div className="alert warn" role="alert">{error}</div>}
      {p?.soloSuLaboratorio && <div className="alert info">Su laboratorio trabaja en esta OT por orden interna: se muestran solo los ensayos de su laboratorio.</div>}

      {!p && !error && <div className="card"><table className="data"><tbody><SkeletonRows cols={6} /></tbody></table></div>}

      {p && (
        <>
          <div className="card">
            <div className="form-grid">
              <div className="field">
                <label htmlFor="f-muestra">Muestra</label>
                <select id="f-muestra" value={muestra} onChange={(e) => setMuestra(e.target.value)}>
                  <option value="">Todas ({muestras.length})</option>
                  {muestras.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="f-texto">Ensayo o método</label>
                <input id="f-texto" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar…" />
              </div>
              <div className="field">
                <label>Detalle</label>
                <div style={{ display: "flex", gap: 6 }}>
                  <button className="btn outline sm" onClick={() => setAbiertos(new Set(visibles.map((e) => e.resultadoId)))}>Abrir todo</button>
                  <button className="btn outline sm" onClick={() => setAbiertos(new Set())}>Cerrar todo</button>
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <h2>Ensayos{visibles.length ? ` (${visibles.length})` : ""}</h2>
            {!visibles.length ? (
              <EmptyState titulo="Sin ensayos" texto={p.ensayos.length ? "Ningún ensayo coincide con el filtro." : "La OT aún no tiene ensayos: se generan al registrar sus muestras."} />
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="data">
                  <thead>
                    <tr>
                      <th>Muestra</th><th>Ensayo</th><th>Fórmula aplicada</th><th>Factor</th><th className="num">Resultado</th>
                      <th>Especificación</th><th>Veredicto</th><th>Estado</th><th className="num">Cambios</th><th aria-label="Detalle"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibles.map((e) => {
                      const ab = abiertos.has(e.resultadoId);
                      const vd = veredictoInfo(e.veredicto);
                      const est = ESTADO_RESULTADO[e.estado] ?? { texto: e.estado, pill: "gray" };
                      const cambios = e.historial.filter((h) => h.campo !== "alta").length;
                      return (
                        <Fragment key={e.resultadoId}>
                          <tr>
                            <td><span className="codigo">{e.muestra}</span></td>
                            <td>{e.ensayo}{e.metodo && <div style={{ fontSize: 11, color: "var(--muted)" }}>{e.metodo}{e.norma ? ` · ${e.norma}` : ""}</div>}</td>
                            <td><code style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>{e.formulaAplicada ?? (e.formula ? "—" : "valor directo")}</code></td>
                            <td>{e.factor ? (e.factor.aplicado === false
                              ? <span className="pill gray" title="El valor se ingresó directo: el factor no se aplicó">no aplicado</span>
                              : <span className={`pill ${e.factor.origen === "orden" ? "amber" : "gray"}`} title={e.factor.origen === "orden" ? "Ajustado en esta OT" : "Del método"}>{e.factor.operacion === "dividir" ? "÷" : "×"} {n(e.factor.valor)}</span>) : "—"}</td>
                            <td className="num" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{e.resultado != null ? valor(e.resultado) : "—"}{e.unidad ? ` ${e.unidad}` : ""}</td>
                            <td style={{ fontSize: 12 }}>{especTexto(e)}{e.requisito && <div style={{ color: "var(--muted)" }}>{e.requisito}</div>}</td>
                            <td><span className={`pill ${vd.pill}`}>{vd.texto}</span></td>
                            <td><span className={`pill ${est.pill}`}>{est.texto}</span></td>
                            <td className="num">{cambios}</td>
                            <td><button className="btn outline sm" aria-expanded={ab} onClick={() => alternar(e.resultadoId)}>{ab ? "Cerrar" : "Ver cálculo"}</button></td>
                          </tr>
                          {ab && (
                            <tr>
                              <td colSpan={10} style={{ background: "#f8fbfc" }}>
                                <DetalleEnsayo e={e} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {p.eliminados.length > 0 && (
            <div className="card">
              <h2>Ensayos eliminados de la OT</h2>
              <table className="data">
                <thead><tr><th>Fecha</th><th>Usuario</th><th>Lo que tenía</th><th>Motivo</th></tr></thead>
                <tbody>
                  {p.eliminados.map((x) => (
                    <tr key={x.resultadoId}><td>{fechaHora(x.fecha)}</td><td>{x.usuario ?? "Sin usuario identificado"}</td><td style={{ fontSize: 12 }}>{valor(x.anterior)}</td><td>{x.motivo ?? "—"}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DetalleEnsayo({ e }: { e: Ensayo }) {
  const nCampos = Math.max(e.campos.length, ...e.lecturas.map((l) => Object.keys(l).length), 0);
  return (
    <div style={{ display: "grid", gap: 12, padding: "4px 2px" }}>
      <div className="form-grid">
        <section>
          <h3 style={{ fontSize: 12.5, margin: "0 0 6px" }}>Datos primarios</h3>
          {e.lecturas.length > 0 ? (
            <table className="data">
              <thead>
                <tr>
                  <th>Lectura</th>
                  {Array.from({ length: nCampos }, (_, i) => (
                    <th key={i}>C{i + 1}{e.campos[i] ? ` · ${e.campos[i].nombre}${e.campos[i].unidad ? ` (${e.campos[i].unidad})` : ""}` : ""}</th>
                  ))}
                  <th className="num">Resultado de la lectura</th>
                </tr>
              </thead>
              <tbody>
                {e.lecturas.map((l, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    {Array.from({ length: nCampos }, (_, c) => <td key={c} style={{ fontFamily: "'JetBrains Mono', monospace" }}>{n(l[`C${c + 1}`])}</td>)}
                    <td className="num" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{n(e.replicas[i])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : e.replicas.length > 0 ? (
            <p style={{ margin: 0, fontSize: 12.5 }}>Réplicas: <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{e.replicas.map(n).join(" · ")}</span></p>
          ) : (
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--muted)" }}>{e.resultado != null ? "Valor ingresado directamente (sin lecturas ni réplicas)." : "Aún sin captura."}</p>
          )}
          {Object.keys(e.variables).length > 0 && (
            <p style={{ margin: "6px 0 0", fontSize: 12.5 }}>Variables: {Object.entries(e.variables).map(([k, v]) => `${k} = ${n(v)}`).join(" · ")}</p>
          )}
        </section>
        <section>
          <h3 style={{ fontSize: 12.5, margin: "0 0 6px" }}>Cálculo</h3>
          <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "3px 10px", fontSize: 12.5 }}>
            <dt>Fórmula</dt>
            <dd style={{ margin: 0 }}>
              <code style={{ fontFamily: "'JetBrains Mono', monospace" }}>{e.formula ?? "—"}</code>{" "}
              {e.formulaOrigen !== "sin_formula" && <span className={`pill ${e.formulaOrigen === "orden" ? "amber" : "gray"}`}>{e.formulaOrigen === "orden" ? "de la orden" : "del catálogo"}</span>}
            </dd>
            {e.formulaOrigen === "orden" && e.formulaCatalogo && (<><dt>En el catálogo</dt><dd style={{ margin: 0 }}><code>{e.formulaCatalogo}</code></dd></>)}
            <dt>Factor</dt>
            <dd style={{ margin: 0 }}>
              {e.factor ? (
                <>
                  {e.factor.operacion === "dividir" ? "÷" : "×"} {n(e.factor.valor)}{e.factor.descripcion ? ` (${e.factor.descripcion})` : ""}
                  {" · "}{e.factor.origen === "orden" ? `ajustado en la OT${e.factor.editadoPor ? ` por ${e.factor.editadoPor}` : ""}${e.factor.editadoAt ? ` el ${fechaHora(e.factor.editadoAt)}` : ""}` : "del método"}
                  {e.factor.motivo && <div style={{ color: "var(--muted)" }}>Motivo: {e.factor.motivo}</div>}
                  {e.factor.aplicado === false && <div style={{ color: "var(--muted)" }}>No se aplicó: el valor se ingresó directo (sin réplicas ni lecturas).</div>}
                </>
              ) : "sin factor"}
            </dd>
            <dt>Fórmula aplicada</dt><dd style={{ margin: 0 }}><code style={{ fontFamily: "'JetBrains Mono', monospace" }}>{e.formulaAplicada ?? "—"}</code></dd>
            {e.valorSinFactor != null && (<><dt>Valor sin factor</dt><dd style={{ margin: 0 }}>{n(e.valorSinFactor)}</dd></>)}
            <dt>Resultado</dt><dd style={{ margin: 0 }}><b>{e.resultado != null ? valor(e.resultado) : "—"}</b>{e.unidad ? ` ${e.unidad}` : ""}</dd>
            {e.promedio != null && (<><dt>Promedio · DE · CV</dt><dd style={{ margin: 0 }}>{n(e.promedio)} · {n(e.desviacion)} · {e.cv != null ? `${n(e.cv)} %` : "—"}</dd></>)}
          </dl>
        </section>
        <section>
          <h3 style={{ fontSize: 12.5, margin: "0 0 6px" }}>Especificación y firmas</h3>
          <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "3px 10px", fontSize: 12.5 }}>
            <dt>Especificación</dt><dd style={{ margin: 0 }}>{especTexto(e)}</dd>
            {e.requisito && (<><dt>Requisito</dt><dd style={{ margin: 0 }}>{e.requisito}</dd></>)}
            <dt>Capturó</dt><dd style={{ margin: 0 }}>{e.analista ?? "—"}{e.fecha ? ` · ${fechaHora(e.fecha)}` : ""}</dd>
            <dt>Revisó</dt><dd style={{ margin: 0 }}>{e.revisor ?? "—"}</dd>
            <dt>Aprobó</dt><dd style={{ margin: 0 }}>{e.aprobador ?? "—"}</dd>
          </dl>
        </section>
      </div>
      <section>
        <h3 style={{ fontSize: 12.5, margin: "0 0 6px" }}>Historial de cambios</h3>
        {e.historial.length ? (
          <table className="data">
            <thead><tr><th>Fecha</th><th>Usuario</th><th>Qué cambió</th><th>Valor anterior</th><th>Valor nuevo</th><th>Motivo</th><th>Origen</th></tr></thead>
            <tbody>
              {e.historial.map((h, i) => (
                <tr key={i}>
                  <td style={{ whiteSpace: "nowrap" }}>{fechaHora(h.fecha)}</td>
                  <td>{h.usuario ?? <span style={{ color: "var(--muted)" }}>Sin usuario identificado</span>}</td>
                  <td>{CAMPO[h.campo] ?? h.campo}</td>
                  <td style={{ fontSize: 12 }}>{h.campo === "alta" ? "—" : valor(h.anterior)}</td>
                  <td style={{ fontSize: 12 }}>{valor(h.nuevo)}</td>
                  <td>{h.motivo ?? "—"}</td>
                  <td>{ORIGEN[h.origen ?? ""] ?? h.origen ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p style={{ margin: 0, fontSize: 12.5, color: "var(--muted)" }}>Sin cambios registrados (ensayo anterior a la activación del historial).</p>
        )}
      </section>
    </div>
  );
}
