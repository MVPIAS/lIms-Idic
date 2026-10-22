"use client";

/**
 * BPCH · Expediente de internación (IDIC-PG 24 Anexo 03). Recorre el proceso
 * desde cero: registro de la resolución → análisis técnico (con solicitud de
 * antecedentes a DGMN) → OT automática → inspección y lotes → resultados →
 * Informe de Inspección → Certificado de Conformidad o Informe de
 * Incumplimiento → Codificación Única → tasa → cierre. API: /bpch/internaciones/:id
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PageHeader, Skeleton } from "@/components/ui/PageHeader";
import RequierePermiso from "@/components/RequierePermiso";
import { toast, confirmar } from "@/components/ui/feedback";
import Modal from "@/components/documentos/Modal";
import { usePermisos } from "@/lib/permisos";
import { clp, fecha, fechaHora } from "@/lib/format";
import { DocumentosYCierre, Fases } from "../../_components/Expediente";
import { FormInternacion } from "../../_components/FormInternacion";
import { SelectorPanel } from "../../_components/Buscadores";
import { AVANCE_INTERNACION, type ConfigBpch, DOC_ADM, ESTADO_COD, ESTADO_INTERNACION, LISTADOS, dia, hoy, pedir } from "../../_components/bpch";
import { ESTADO_FACTURA } from "@/lib/documentos";
import { textoTipo } from "@/lib/d11";

type Pestana = "registro" | "inspeccion" | "documentos" | "tasa" | "codificacion";

export default function InternacionDetallePage() {
  return (
    <RequierePermiso perm="bpch.internacion.ver" titulo="Internación BPCH">
      <Detalle />
    </RequierePermiso>
  );
}

function Detalle() {
  const { id } = useParams<{ id: string }>();
  const { puede } = usePermisos();
  const [d, setD] = useState<any>(null);
  const [config, setConfig] = useState<ConfigBpch | null>(null);
  const [error, setError] = useState("");
  const [pestana, setPestana] = useState<Pestana>("registro");

  const cargar = useCallback(async () => {
    try {
      setD(await pedir("GET", `/bpch/internaciones/${id}`));
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }, [id]);
  useEffect(() => {
    cargar();
    pedir<ConfigBpch>("GET", "/bpch/config").then(setConfig).catch(() => null);
  }, [cargar]);

  /** Ejecuta una acción del expediente y refresca con lo que devuelve el servidor. */
  const accion = useCallback(
    async (metodo: "POST" | "PATCH", ruta: string, cuerpo: unknown, okTexto: string) => {
      try {
        const r = await pedir<any>(metodo, `/bpch/internaciones/${id}${ruta}`, cuerpo);
        if (r?.id === id) setD(r);
        else await cargar();
        toast.ok(okTexto);
        for (const a of r?.avisos ?? []) toast.info(a);
        return true;
      } catch (e: any) {
        toast.error(e.message);
        return false;
      }
    },
    [id, cargar],
  );

  if (error) return <div className="alert warn" role="alert">{error}</div>;
  if (!d) return <Skeleton h={220} />;

  const est = AVANCE_INTERNACION[d.avance ?? d.estado] ?? ESTADO_INTERNACION[d.estado] ?? { l: d.estado, c: "gray" };
  const tab = (k: Pestana, l: string) => (
    <button type="button" role="tab" aria-selected={pestana === k} className={`tab ${pestana === k ? "active" : ""}`} onClick={() => setPestana(k)}>{l}</button>
  );

  return (
    <div>
      <PageHeader
        icono="🛃"
        titulo={<>Internación <span className="codigo">{d.numero}</span></>}
        subtitulo={<>Resolución DGMN <b>{d.resolucionNumero}</b> del {fecha(d.resolucionFecha)} · {d.cliente.razonSocial} ({d.cliente.rut}) · inspecciona <b>{d.unidad.codigo}</b></>}
        migas={[{ label: "BPCH" }, { label: "Internaciones", href: "/bpch/internaciones" }, { label: d.numero }]}
        acciones={<span className={`pill ${est.c}`}>{est.l}</span>}
      />
      <div className="expgrid">
        <Fases fases={d.fases} />
        <div>
          <div className="tabs" role="tablist" style={{ marginBottom: 12 }}>
            {tab("registro", "Registro y análisis técnico")}
            {tab("inspeccion", "Inspección y lotes")}
            {tab("documentos", "Resultados, documentos y cierre")}
            {tab("tasa", d.sujetaTasa ? "Tasa de internación" : "Tasa (no aplica)")}
            {tab("codificacion", "Codificación Única")}
          </div>
          {pestana === "registro" && <Registro d={d} config={config} puede={puede} accion={accion} onCambio={cargar} />}
          {pestana === "inspeccion" && <Inspeccion d={d} puede={puede} accion={accion} />}
          {pestana === "documentos" &&
            (d.estadoOt ? (
              <DocumentosYCierre estadoOt={d.estadoOt} config={config} documentoFinal puedeEmitir={puede("certificado.emitir")} onCambio={cargar} />
            ) : (
              <div className="alert info">La OT se genera al completar el análisis técnico.</div>
            ))}
          {pestana === "tasa" && <Tasa d={d} config={config} puede={puede} accion={accion} />}
          {pestana === "codificacion" && <Codificacion d={d} puede={puede} accion={accion} />}
        </div>
      </div>
    </div>
  );
}

type Accion = (metodo: "POST" | "PATCH", ruta: string, cuerpo: unknown, okTexto: string) => Promise<boolean>;
type Puede = (p?: string | string[] | null) => boolean;

/* ------------------------------------------------------------------ Registro --- */
function Registro({ d, config, puede, accion, onCambio }: { d: any; config: ConfigBpch | null; puede: Puede; accion: Accion; onCambio: () => void }) {
  const [editar, setEditar] = useState(false);
  const [anular, setAnular] = useState<string | null>(null);
  const antesDeOt = ["registrada", "antecedentes_pendientes"].includes(d.estado);
  if (editar && config)
    return <FormInternacion config={config} inicial={d} onGuardado={() => { setEditar(false); onCambio(); }} onCancelar={() => setEditar(false)} />;
  return (
    <>
      <div className="card">
        <h2>Registro de la resolución <span className="right">registrado el {fechaHora(d.createdAt)}</span></h2>
        <div className="form-grid">
          {[
            ["Empresa importadora", `${d.cliente.razonSocial} · ${d.cliente.rut ?? ""}`],
            ["Resolución DGMN", `${d.resolucionNumero} · ${fecha(d.resolucionFecha)}`],
            ["Oficio IDIC-DGMN", d.oficio],
            ["Documento aduanero", d.documentoAduanero],
            ["País de origen", d.paisOrigen],
            ["Esquema", d.esquema === "TIPO" ? "Tipo" : "Por lotes"],
            ["Procedimiento", d.procedimiento],
            ["Unidad que inspecciona", `${d.unidad.codigo} · ${d.unidad.nombre}`],
            ["¿Sujeta a la tasa?", d.sujetaTasa ? "Sí" : "No"],
          ].map(([l, v]) => (
            <div key={l} className="field readonly"><label>{l}</label><input value={v || "—"} readOnly /></div>
          ))}
        </div>
        {d.items.length > 0 && <table className="data" style={{ marginTop: 12 }}>
          <thead><tr><th>#</th><th>Elemento específico</th><th>Genérico</th><th>CNC-DGMN</th><th>Clase · Nº UN</th><th className="num">Cantidad</th><th>Catálogo</th></tr></thead>
          <tbody>
            {d.items.map((it: any) => (
              <tr key={it.id}>
                <td>{it.orden}</td>
                <td>{it.elementoEspecifico}{it.codificacionId && <small style={{ display: "block", color: "var(--muted)" }}>de la Codificación Única</small>}</td>
                <td>{it.elementoGenerico ?? "—"}</td>
                <td className="codigo">{it.cnc ?? "—"}</td>
                <td>{it.claseDivisionUn} · {it.numeroUn}</td>
                <td className="num">{it.cantidad != null ? `${it.cantidad.toLocaleString("es-CL")} ${it.unidadMedida ?? ""}` : "—"}</td>
                <td>{it.catElementoNombre ?? <span className="pill amber">sin elemento</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>}
        {d.armas?.length > 0 && (
          <>
            <h3 style={{ margin: "14px 0 6px", fontSize: 13 }}>
              Listado de armas de la resolución · {d.armas.reduce((s: number, a: any) => s + (a.cantidad || 0), 0)} arma(s)
            </h3>
            <table className="data">
              <thead><tr><th>#</th><th>Tipo</th><th>Marca</th><th>Modelo</th><th>Calibre</th><th>Nº de serie</th><th>Accesorios</th><th className="num">Cantidad</th></tr></thead>
              <tbody>
                {d.armas.map((a: any) => (
                  <tr key={a.id}>
                    <td>{a.orden}</td><td>{textoTipo(a.tipo)}</td><td>{a.marca}</td><td>{a.modelo ?? "—"}</td><td>{a.calibre ?? "—"}</td>
                    <td>{a.serie ?? "—"}</td><td>{a.accesorios ?? "—"}</td><td className="num">{a.cantidad}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {d.otId && d.unidad.codigo === "D11" && puede("arma.ver") && (
              <div className="alert info" style={{ marginTop: 8 }}>
                La Delegación Nº 11 recibe, registra y certifica cada arma en{" "}
                <Link href={`/saec/ot/${d.otId}` as any}>BPCH · SAEC › Certificación de armas</Link>.
              </div>
            )}
          </>
        )}
        {antesDeOt && puede("bpch.internacion.registrar") && (
          <div className="toolbar" style={{ marginTop: 10, marginBottom: 0 }}>
            <button type="button" className="btn outline sm" onClick={() => setEditar(true)} disabled={!config}>Corregir registro</button>
            <button type="button" className="btn ghost-danger sm" onClick={() => setAnular("")}>Anular</button>
          </div>
        )}
        {d.anuladaMotivo && <div className="alert warn" style={{ marginTop: 10 }}>Anulada: {d.anuladaMotivo}</div>}
        {anular !== null && (
          <Modal
            titulo={`Anular la internación ${d.numero}`}
            onCerrar={() => setAnular(null)}
            acciones={<>
              <button type="button" className="btn danger" disabled={anular.trim().length < 5} onClick={async () => { if (await accion("POST", "/anular", { motivo: anular.trim() }, "Internación anulada.")) setAnular(null); }}>Anular</button>
              <button type="button" className="btn outline" onClick={() => setAnular(null)}>Volver</button>
            </>}
          >
            <p>No se generará la OT. Queda constancia del motivo.</p>
            <div className="field"><label htmlFor="mot-anular">Motivo (mínimo 5 caracteres) <span className="req">*</span></label><input id="mot-anular" value={anular} onChange={(e) => setAnular(e.target.value)} autoFocus /></div>
          </Modal>
        )}
      </div>
      <Analisis d={d} puede={puede} accion={accion} />
    </>
  );
}

function Analisis({ d, puede, accion }: { d: any; puede: Puede; accion: Accion }) {
  const [completa, setCompleta] = useState<"" | "si" | "no">("");
  const [f, setF] = useState({ fechaAnalisis: hoy(), observaciones: "", destinatario: "", detalle: "", fechaEnvio: hoy() });
  const [resp, setResp] = useState<Record<string, { fecha: string; texto: string }>>({});
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const puedeAnalizar = puede("bpch.internacion.gestionar") && ["registrada", "antecedentes_pendientes"].includes(d.estado);
  const pendientes = d.solicitudes.filter((s: any) => !s.fechaRespuesta).length;

  return (
    <div className="card">
      <h2>Análisis técnico <span className="right">carril SCC · ¿información completa?</span></h2>
      {d.otId ? (
        <div className="alert success">
          Información técnica completa ({fecha(d.analisis.fecha)}, {d.analisis.analistaNombre ?? "—"}). OT generada automáticamente:{" "}
          <Link href={`/ot/${d.otId}` as any} className="codigo">{d.estadoOt?.ot?.codigo ?? "ver OT"}</Link> · laboratorio {d.unidad.codigo} · {d.sujetaTasa ? "con cobro (tasa)" : "sin cobro"}.
          {d.analisis.observaciones && <div style={{ marginTop: 4 }}>{d.analisis.observaciones}</div>}
        </div>
      ) : (
        <p className="subtitle" style={{ marginTop: 0 }}>Si falta información se solicita a DGMN y el expediente queda en espera. Con la información completa la OT se crea sin cotización ni aprobación.</p>
      )}

      {d.solicitudes.length > 0 && (
        <table className="data" style={{ marginBottom: 10 }}>
          <thead><tr><th>Enviada</th><th>Destinatario</th><th>Antecedentes solicitados</th><th>Respuesta DGMN</th></tr></thead>
          <tbody>
            {d.solicitudes.map((s: any) => (
              <tr key={s.id}>
                <td>{fecha(s.fechaEnvio)}</td>
                <td>{s.destinatario}</td>
                <td>{s.detalle}</td>
                <td>
                  {s.fechaRespuesta ? (
                    <>{fecha(s.fechaRespuesta)} · {s.respuesta}</>
                  ) : puede("bpch.internacion.gestionar") ? (
                    <div style={{ display: "grid", gap: 4 }}>
                      <input type="date" aria-label="Fecha de la respuesta" value={resp[s.id]?.fecha ?? hoy()} onChange={(e) => setResp((r) => ({ ...r, [s.id]: { fecha: e.target.value, texto: r[s.id]?.texto ?? "" } }))} />
                      <input aria-label="Respuesta de DGMN" placeholder="Qué remitió DGMN" value={resp[s.id]?.texto ?? ""} onChange={(e) => setResp((r) => ({ ...r, [s.id]: { fecha: r[s.id]?.fecha ?? hoy(), texto: e.target.value } }))} />
                      <button type="button" className="btn outline sm" onClick={() => accion("POST", `/solicitudes/${s.id}/respuesta`, { fechaRespuesta: resp[s.id]?.fecha ?? hoy(), respuesta: resp[s.id]?.texto ?? "" }, "Respuesta de DGMN registrada.")}>Registrar respuesta</button>
                    </div>
                  ) : (
                    <span className="pill amber">Pendiente</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {puedeAnalizar && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!completa) return toast.error("Indique si la información técnica está completa.");
            if (completa === "si" && !(await confirmar({ titulo: "¿Información técnica completa?", mensaje: `Se generará la OT de ${d.unidad.codigo} automáticamente.` }))) return;
            const cuerpo = {
              infoCompleta: completa === "si",
              fechaAnalisis: f.fechaAnalisis,
              observaciones: f.observaciones || null,
              ...(completa === "no" ? { solicitud: { destinatario: f.destinatario, detalle: f.detalle, fechaEnvio: f.fechaEnvio } } : {}),
            };
            if (await accion("POST", "/analisis", cuerpo, completa === "si" ? "OT generada." : "Solicitud de antecedentes registrada.")) setCompleta("");
          }}
        >
          <div className="form-grid">
            <div className="field">
              <label htmlFor="ic">¿Información técnica completa? <span className="req">*</span></label>
              <select id="ic" value={completa} onChange={(e) => setCompleta(e.target.value as any)}>
                <option value="">Elija…</option>
                <option value="si" disabled={pendientes > 0}>Sí — generar la OT{pendientes ? " (hay solicitudes sin respuesta)" : ""}</option>
                <option value="no">No — solicitar antecedentes a DGMN</option>
              </select>
            </div>
            <div className="field"><label htmlFor="fa">Fecha del análisis</label><input id="fa" type="date" value={f.fechaAnalisis} onChange={set("fechaAnalisis")} /></div>
            <div className="field"><label htmlFor="ob">Observaciones</label><input id="ob" value={f.observaciones} onChange={set("observaciones")} /></div>
            {completa === "no" && (
              <>
                <div className="field"><label htmlFor="de">Destinatario en DGMN <span className="req">*</span></label><input id="de" value={f.destinatario} onChange={set("destinatario")} /></div>
                <div className="field span-2"><label htmlFor="dt">Antecedentes que faltan <span className="req">*</span></label><input id="dt" value={f.detalle} onChange={set("detalle")} /></div>
                <div className="field"><label htmlFor="fe">Fecha de envío</label><input id="fe" type="date" value={f.fechaEnvio} onChange={set("fechaEnvio")} /></div>
              </>
            )}
          </div>
          <button type="submit" className="btn primary sm" style={{ marginTop: 10 }}>Registrar análisis</button>
        </form>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Inspección --- */
function Inspeccion({ d, puede, accion }: { d: any; puede: Puede; accion: Accion }) {
  const i = d.inspeccion;
  const [f, setF] = useState({
    lugarInspeccion: i.lugar ?? "",
    fechaInspeccion: dia(i.fecha),
    inspectores: i.inspectores ?? "",
    fechaVencimientoProducto: dia(i.vencimientoProducto),
    vigenciaInforme: dia(i.vigenciaInforme),
    observaciones: i.observaciones ?? "",
    procedimiento: d.procedimiento ?? "",
  });
  const [lotes, setLotes] = useState<Record<string, { identificacionLote: string; tamanoLote: string; tamanoMuestra: string }>>(
    Object.fromEntries(d.items.map((it: any) => [it.id, { identificacionLote: it.identificacionLote ?? "", tamanoLote: it.tamanoLote != null ? String(it.tamanoLote) : "", tamanoMuestra: it.tamanoMuestra != null ? String(it.tamanoMuestra) : "" }])),
  );
  const [metodos, setMetodos] = useState<Record<string, string[]>>({});
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  if (!d.otId) return <div className="alert info">La inspección se programa una vez generada la OT (análisis técnico completo).</div>;
  const editable = puede("bpch.internacion.gestionar") && !["cerrada", "anulada"].includes(d.estadoOt?.ot?.estado);
  const entero = (v: string) => (v.trim() ? Number(v) : null);

  return (
    <>
      <div className="card">
        <h2>Programación de la inspección <span className="right">SAC-PG01-IT10 · NCh 44 · muestra ≤ lote</span></h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            accion("PATCH", "/inspeccion", {
              ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v || null])),
              items: d.items.map((it: any) => ({
                id: it.id,
                identificacionLote: lotes[it.id].identificacionLote || null,
                tamanoLote: entero(lotes[it.id].tamanoLote),
                tamanoMuestra: entero(lotes[it.id].tamanoMuestra),
              })),
            }, "Inspección guardada.");
          }}
        >
          <fieldset disabled={!editable} style={{ border: "none", padding: 0, margin: 0 }}>
            <div className="form-grid">
              <div className="field span-2"><label htmlFor="lu">Lugar de inspección</label><input id="lu" value={f.lugarInspeccion} onChange={set("lugarInspeccion")} /></div>
              <div className="field"><label htmlFor="fi">Fecha de inspección</label><input id="fi" type="date" value={f.fechaInspeccion} onChange={set("fechaInspeccion")} /></div>
              <div className="field span-2"><label htmlFor="in">Inspectores (LCA)</label><input id="in" value={f.inspectores} onChange={set("inspectores")} placeholder="Iniciales de los dos inspectores" /></div>
              <div className="field"><label htmlFor="pr">Procedimiento de control</label><input id="pr" value={f.procedimiento} onChange={set("procedimiento")} /></div>
              <div className="field"><label htmlFor="ve">Vencimiento del producto</label><input id="ve" type="date" value={f.fechaVencimientoProducto} onChange={set("fechaVencimientoProducto")} /></div>
              <div className="field"><label htmlFor="vi">Vigencia del informe</label><input id="vi" type="date" value={f.vigenciaInforme} onChange={set("vigenciaInforme")} /></div>
              <div className="field"><label htmlFor="obs">Observaciones</label><input id="obs" value={f.observaciones} onChange={set("observaciones")} /></div>
            </div>
            <table className="data" style={{ marginTop: 12 }}>
              <thead><tr><th>Elemento</th><th>Identificación del lote *</th><th>Tamaño lote (uu) *</th><th>Tamaño muestra (uu) *</th></tr></thead>
              <tbody>
                {d.items.map((it: any) => (
                  <tr key={it.id}>
                    <td>{it.orden}. {it.elementoEspecifico}</td>
                    {(["identificacionLote", "tamanoLote", "tamanoMuestra"] as const).map((k) => (
                      <td key={k}>
                        <input
                          aria-label={`${{ identificacionLote: "Identificación del lote", tamanoLote: "Tamaño del lote", tamanoMuestra: "Tamaño de la muestra" }[k]} del elemento ${it.orden}`}
                          type={k === "identificacionLote" ? "text" : "number"}
                          min={k === "identificacionLote" ? undefined : 1}
                          value={lotes[it.id][k]}
                          onChange={(e) => setLotes((l) => ({ ...l, [it.id]: { ...l[it.id], [k]: e.target.value } }))}
                          style={{ width: "100%" }}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {editable && <button type="submit" className="btn primary sm" style={{ marginTop: 10 }}>Guardar inspección</button>}
          </fieldset>
        </form>
      </div>

      <div className="card">
        <h2>Lotes como muestras de la OT <span className="right">ensayos del panel del catálogo</span></h2>
        {d.items.map((it: any) => (
          <div key={it.id} style={{ borderTop: "1px solid var(--line)", paddingTop: 8, marginTop: 8 }}>
            <b>{it.orden}. {it.elementoEspecifico}</b> · lote {it.identificacionLote ?? <span className="pill amber">sin identificar</span>}
            {it.muestraId ? (
              <span className="pill green" style={{ marginLeft: 8 }}>Muestra {it.muestraCodigo}</span>
            ) : editable && puede("muestra.crear") ? (
              <div style={{ marginTop: 6 }}>
                <SelectorPanel catElementoId={it.catElementoId} valor={metodos[it.id] ?? []} onChange={(ids) => setMetodos((m) => ({ ...m, [it.id]: ids }))} />
                <button
                  type="button"
                  className="btn primary sm"
                  style={{ marginTop: 6 }}
                  disabled={!(metodos[it.id] ?? []).length}
                  onClick={() => accion("POST", "/lotes", { items: [{ id: it.id, metodoIds: metodos[it.id] }] }, "Lote registrado como muestra con sus ensayos.")}
                >
                  Registrar lote como muestra ({(metodos[it.id] ?? []).length} ensayos)
                </button>
                <small style={{ display: "block", color: "var(--muted)", marginTop: 4 }}>Guarde antes la identificación y los tamaños del lote. Otros ensayos se agregan desde la pestaña «Muestras» del expediente de la OT.</small>
              </div>
            ) : (
              <small style={{ marginLeft: 8, color: "var(--muted)" }}>Pendiente de registrar</small>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

/* ---------------------------------------------------------------------- Tasa --- */
function Tasa({ d, config, puede, accion }: { d: any; config: ConfigBpch | null; puede: Puede; accion: Accion }) {
  const [doc, setDoc] = useState({ fecha: hoy(), detalle: "", facturaComercial: "", cifUsd: "", tipoCambio: "", ivaInternacion: "", otrosDocumentos: "" });
  // El CIF y el tipo de cambio registrados con la documentación se proponen en el cálculo (EP-06 6.8; D06-03).
  const [t, setT] = useState({
    cifUsd: d.documentacion?.cifUsd != null ? String(d.documentacion.cifUsd).replace(".", ",") : "",
    paridad: d.documentacion?.tipoCambio != null ? String(d.documentacion.tipoCambio).replace(".", ",") : "",
    pctAfecto: "100",
  });
  if (!d.sujetaTasa) return <div className="alert info">Esta internación no está sujeta a la tasa: no hay documentación administrativa ni cobro.</div>;
  const tasaPct = config?.parametros.tasaPct;
  const ivaPct = config?.parametros.ivaPct;
  const num = (v: string) => Number(v.replace(",", "."));
  const prev =
    t.cifUsd && t.paridad && tasaPct != null && ivaPct != null
      ? (() => {
          const tasa = Math.round(num(t.cifUsd) * num(t.paridad) * (num(t.pctAfecto) / 100) * (tasaPct / 100));
          const iva = Math.round(tasa * (ivaPct / 100));
          return { tasa, iva, total: tasa + iva };
        })()
      : null;
  const docEstado = d.documentacion.estado;
  const acciones: { a: string; l: string }[] =
    docEstado === "pendiente" || docEstado === "no_conforme" ? [{ a: "solicitar", l: "Solicitar documentación al importador" }]
    : docEstado === "solicitada" ? [{ a: "recibir", l: "Registrar recepción" }, { a: "solicitar", l: "Reiterar solicitud" }]
    : docEstado === "recibida" ? [{ a: "conforme", l: "Conforme" }, { a: "no_conforme", l: "No conforme" }]
    : [];
  const final = d.estadoOt?.condicion === "no_cumple" ? d.estadoOt?.incumplimiento : d.estadoOt?.certificado;

  return (
    <>
      <div className="card">
        <h2>Documentación administrativa <span className="right">rama de la tasa · IDIC-PG 24</span></h2>
        <p>Estado: <span className={`pill ${docEstado === "conforme" ? "green" : docEstado === "no_conforme" ? "red" : "amber"}`}>{DOC_ADM[docEstado] ?? docEstado}</span>
          {d.documentacion.solicitadaAt && <> · solicitada {fecha(d.documentacion.solicitadaAt)}</>}
          {d.documentacion.recibidaAt && <> · recibida {fecha(d.documentacion.recibidaAt)}</>}
          {d.documentacion.facturaComercial && <> · factura comercial {d.documentacion.facturaComercial}</>}
          {d.documentacion.cifUsd != null && <> · CIF US$ {Number(d.documentacion.cifUsd).toLocaleString("es-CL")}</>}
          {d.documentacion.tipoCambio != null && <> · tipo de cambio {Number(d.documentacion.tipoCambio).toLocaleString("es-CL")}</>}
          {d.documentacion.ivaInternacion != null && <> · IVA de internación {clp(d.documentacion.ivaInternacion)}</>}
        </p>
        {d.documentacion.otrosDocumentos && <p style={{ fontSize: 12.5 }}>Otros documentos: {d.documentacion.otrosDocumentos}</p>}
        {d.documentacion.detalle && <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, background: "#f6f9fb", padding: 8, borderRadius: 6 }}>{d.documentacion.detalle}</pre>}
        {acciones.length > 0 && puede("bpch.internacion.gestionar") && (
          <div className="form-grid">
            <div className="field"><label htmlFor="dfe">Fecha</label><input id="dfe" type="date" value={doc.fecha} onChange={(e) => setDoc({ ...doc, fecha: e.target.value })} /></div>
            <div className="field span-2"><label htmlFor="ddt">Detalle (documentos pedidos u observación)</label><input id="ddt" value={doc.detalle} onChange={(e) => setDoc({ ...doc, detalle: e.target.value })} /></div>
            {docEstado === "solicitada" && (
              <>
                <div className="field"><label htmlFor="dfc">Nº factura comercial</label><input id="dfc" value={doc.facturaComercial} onChange={(e) => setDoc({ ...doc, facturaComercial: e.target.value })} /></div>
                <div className="field"><label htmlFor="dcif">Monto CIF (US$)</label><input id="dcif" inputMode="decimal" value={doc.cifUsd} onChange={(e) => setDoc({ ...doc, cifUsd: e.target.value })} /></div>
                <div className="field"><label htmlFor="dtc">Tipo de cambio US$ → $</label><input id="dtc" inputMode="decimal" value={doc.tipoCambio} onChange={(e) => setDoc({ ...doc, tipoCambio: e.target.value })} /></div>
                <div className="field"><label htmlFor="div">IVA de internación ($)</label><input id="div" inputMode="decimal" value={doc.ivaInternacion} onChange={(e) => setDoc({ ...doc, ivaInternacion: e.target.value })} /></div>
                <div className="field span-2"><label htmlFor="dotr">Otros documentos recibidos</label><input id="dotr" maxLength={2000} placeholder="Facturas de transporte, Declaración de Ingreso…" value={doc.otrosDocumentos} onChange={(e) => setDoc({ ...doc, otrosDocumentos: e.target.value })} /></div>
              </>
            )}
            <div className="toolbar" style={{ gridColumn: "1 / -1", marginBottom: 0 }}>
              {acciones.map((x) => (
                <button key={x.a} type="button" className={`btn ${x.a === "no_conforme" ? "ghost-danger" : "primary"} sm`} onClick={async () => {
                  // «184.500,5» o «945,2» (coma decimal chilena) o «945.2».
                  const n = (v: string) => (v.trim() ? Number(v.includes(",") ? v.replace(/\./g, "").replace(",", ".") : v) : null);
                  const montos = x.a === "recibir"
                    ? { cifUsd: n(doc.cifUsd), tipoCambio: n(doc.tipoCambio), ivaInternacion: n(doc.ivaInternacion), otrosDocumentos: doc.otrosDocumentos || null }
                    : {};
                  if (await accion("POST", "/documentacion", { accion: x.a, fecha: doc.fecha, detalle: doc.detalle || null, facturaComercial: doc.facturaComercial || null, ...montos }, "Documentación actualizada.")) {
                    setDoc({ ...doc, detalle: "" });
                    if (x.a === "recibir") setT((p) => ({ ...p, cifUsd: doc.cifUsd || p.cifUsd, paridad: doc.tipoCambio || p.paridad }));
                  }
                }}>{x.l}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Cálculo de la tasa <span className="right">CIF US$ × paridad × % afecto × {tasaPct ?? "?"} % (+ IVA {ivaPct ?? "?"} %)</span></h2>
        {d.tasa && (
          <table className="data" style={{ marginBottom: 10 }}>
            <tbody>
              <tr><th>CIF US$</th><td className="num">{d.tasa.cifUsd.toLocaleString("es-CL")}</td><th>Paridad</th><td className="num">{d.tasa.paridad.toLocaleString("es-CL")}</td><th>% afecto</th><td className="num">{d.tasa.pctAfecto}</td></tr>
              <tr><th>Tasa ({d.tasa.tasaPct} %)</th><td className="num">{clp(d.tasa.tasa)}</td><th>IVA ({d.tasa.ivaPct} %)</th><td className="num">{clp(d.tasa.iva)}</td><th>Total</th><td className="num"><b>{clp(d.tasa.total)}</b></td></tr>
            </tbody>
          </table>
        )}
        {d.tasa && <small style={{ color: "var(--muted)" }}>Calculada el {fechaHora(d.tasa.calculadoAt)} por {d.tasa.calculadoPorNombre ?? "—"}.</small>}
        {!d.remitidaAt && puede("bpch.tasa.gestionar") && (
          docEstado !== "conforme" ? (
            <div className="alert info" style={{ marginTop: 8 }}>La tasa se calcula con la documentación administrativa conforme.</div>
          ) : (
            <form className="form-grid" style={{ marginTop: 10 }} onSubmit={(e) => { e.preventDefault(); accion("POST", "/tasa", { cifUsd: num(t.cifUsd), paridad: num(t.paridad), pctAfecto: num(t.pctAfecto) }, "Tasa calculada."); }}>
              <div className="field"><label htmlFor="cif">Valor CIF (US$) *</label><input id="cif" inputMode="decimal" value={t.cifUsd} onChange={(e) => setT({ ...t, cifUsd: e.target.value })} /></div>
              <div className="field"><label htmlFor="par">Paridad US$ → $ *</label><input id="par" inputMode="decimal" value={t.paridad} onChange={(e) => setT({ ...t, paridad: e.target.value })} /></div>
              <div className="field"><label htmlFor="afe">% afecto</label><input id="afe" inputMode="decimal" value={t.pctAfecto} onChange={(e) => setT({ ...t, pctAfecto: e.target.value })} /></div>
              <div className="field readonly"><label>Vista previa</label><input readOnly value={prev ? `Tasa ${clp(prev.tasa)} + IVA ${clp(prev.iva)} = ${clp(prev.total)}` : "—"} /></div>
              <div><button type="submit" className="btn primary sm">{d.tasa ? "Recalcular" : "Calcular y guardar"}</button></div>
            </form>
          )
        )}
      </div>

      <div className="card">
        <h2>Remisión a facturación</h2>
        {d.remitidaAt ? (
          d.factura && d.factura.estado !== "pendiente" ? (
            // Folio y estado de cobro de la factura de la tasa (D06-17).
            <div className={`alert ${d.factura.estado === "pagada" ? "success" : "info"}`}>
              Remitida el {fechaHora(d.remitidaAt)}. Factura <b>{d.factura.numero}</b> · {ESTADO_FACTURA[d.factura.estado]?.texto ?? d.factura.estado}
              {d.factura.estado !== "pagada" && d.factura.saldo != null && <> · saldo {clp(d.factura.saldo)}</>}
              {" "}· <Link href={`/facturas` as any}>ver en Facturas</Link>.
            </div>
          ) : (
            <div className="alert success">Remitida el {fechaHora(d.remitidaAt)}. Factura pendiente de emitir en Finanzas: <Link href={`/facturas?estado=pendiente` as any}>ver facturas pendientes</Link>.</div>
          )
        ) : (
          <>
            <p className="subtitle" style={{ marginTop: 0 }}>Se une la rama de la tasa (documentación conforme y tasa calculada) con la del certificado: hace falta el documento final oficial ({final ? `${final.numero} · ${final.estado}` : "aún no emitido"}). Crea la factura pendiente de la OT con la línea de la tasa.</p>
            {puede("bpch.tasa.gestionar") && (
              <button type="button" className="btn primary sm" disabled={!d.tasa} onClick={async () => {
                if (await confirmar({ titulo: "¿Remitir la tasa a facturación?", mensaje: `Se crea la factura pendiente por ${d.tasa ? clp(d.tasa.total) : ""}.` })) await accion("POST", "/remitir-facturacion", {}, "Tasa remitida a facturación.");
              }}>Remitir a facturación</button>
            )}
          </>
        )}
      </div>
    </>
  );
}

/* -------------------------------------------------------------- Codificación --- */
function Codificacion({ d, puede, accion }: { d: any; puede: Puede; accion: Accion }) {
  const [listados, setListados] = useState<Record<string, string>>({});
  const cert = d.estadoOt?.certificado;
  const oficial = cert && ["oficial", "emitido"].includes(cert.estado);
  return (
    <div className="card">
      <h2>Codificación Única <span className="right">tras el Certificado de Conformidad</span></h2>
      {d.estadoOt?.condicion === "no_cumple" && <div className="alert info">La inspección no cumple: no se inscribe ni actualiza la Codificación Única.</div>}
      {!oficial && d.estadoOt?.condicion !== "no_cumple" && <div className="alert info">Se actualiza cuando el Certificado de Conformidad esté oficial (firmado).</div>}
      <table className="data">
        <thead><tr><th>Elemento</th><th>CNC-DGMN</th><th>Codificación</th><th>Certificado asociado</th>{oficial && <th>Listado (alta)</th>}</tr></thead>
        <tbody>
          {d.items.map((it: any) => (
            <tr key={it.id}>
              <td>{it.orden}. {it.elementoEspecifico}</td>
              <td className="codigo">{it.cnc ?? "—"}</td>
              <td>{it.codificacionId ? <><span className={`pill ${ESTADO_COD[it.codificacionEstado]?.c ?? "gray"}`}>{ESTADO_COD[it.codificacionEstado]?.l ?? it.codificacionEstado}</span> {LISTADOS[it.codificacionListado] ?? ""}</> : <span className="pill gray">No inscrito</span>}</td>
              <td>{it.codificacionCertificadoId && cert && it.codificacionCertificadoId === cert.id ? cert.numero : "—"}</td>
              {oficial && (
                <td>
                  {!it.codificacionId && (
                    <select aria-label="Listado de la inscripción" value={listados[it.id] ?? ""} onChange={(e) => setListados((l) => ({ ...l, [it.id]: e.target.value }))}>
                      <option value="">Elija…</option>
                      {Object.entries(LISTADOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {oficial && puede("bpch.codificacion.gestionar") && (
        <button
          type="button"
          className="btn primary sm"
          style={{ marginTop: 10 }}
          onClick={() => accion("POST", "/codificacion", { items: d.items.map((it: any) => ({ id: it.id, ...(listados[it.id] ? { listado: listados[it.id] } : {}) })) }, "Codificación Única actualizada.")}
        >
          Inscribir / actualizar en la Codificación Única
        </button>
      )}
      <p className="subtitle" style={{ margin: "8px 0 0" }}>Ver el listado completo en <Link href={"/bpch/codificacion" as any}>Codificación Única</Link>.</p>
    </div>
  );
}
