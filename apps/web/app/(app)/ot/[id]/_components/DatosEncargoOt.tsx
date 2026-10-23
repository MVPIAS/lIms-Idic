"use client";

/**
 * Datos del encargo de la OT y su recepción en el laboratorio (frente r4d · T15).
 *
 *  · «Datos del encargo» (EP-00 5.1, EP-03 0.1/0.3, EP-05 0.1/0.3): lo heredado
 *    de la cotización (moneda, forma de pago, referencia, descripción técnica,
 *    valor inicial), la clasificación (tipo de trabajo → IE o IVC, nivel
 *    tecnológico, ¿requiere muestreo?), el oficio de la OT institucional, el
 *    contrato o lote (precarga la portada del IVC) y el carril DSA. Lo completan
 *    Comercial o Planificación (ot.crear) → «Guardar datos del encargo».
 *  · «Recepción en el laboratorio» (EP-05 1.2): el Jefe de Laboratorio
 *    (ot.planificar) confirma el alcance y fija las fechas internas
 *    («Recepcionar → planificar») o devuelve la OT a Ventas con motivo.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { llamar } from "@/lib/laboratorio";
import { fechaDia, fechaHora, monto } from "@/lib/format";
import { toast } from "@/components/ui/feedback";
import RecepcionDcoOt from "./RecepcionDcoOt";

type Opcion = { codigo: string; etiqueta: string };
interface Vista {
  ot: { id: string; codigo: string; estado: string; origen: string | null; laboratorio: string | null; fechaCompromiso: string | null };
  tipoTrabajo: string | null;
  documentoPropuesto: "IE" | "IVC" | null;
  encargo: Record<string, any> | null;
  listas: { tipoTrabajo: Opcion[]; nivelTecnologico: Opcion[]; carrilDsa: Opcion[]; lugarEjecucion: Opcion[]; clasificacionVehiculo: Opcion[] };
  puede: { editar: boolean; validar: boolean };
}

const CAMPOS_TEXTO: [string, string, number][] = [
  ["mandante", "Mandante", 160],
  ["contrato", "Contrato", 160],
  ["proyecto", "Proyecto (PICM)", 200],
  ["proveedor", "Proveedor adjudicado", 200],
  ["fabricante", "Fabricante", 200],
  ["paisOrigen", "País de origen", 80],
  ["item", "Ítem e identificación", 300],
  ["unidadCantidad", "Unidad de la cantidad", 30],
  ["etTexto", "E.T. y versión", 200],
  ["lugarMuestreo", "Lugar de muestreo", 300],
];
const CAMPOS_FECHA: [string, string][] = [
  ["contratoFecha", "Fecha del contrato"],
  ["fechaMuestreo", "Fecha prevista de muestreo"],
];

const vacio = (v: unknown) => v == null || v === "";
const etiqueta = (xs: Opcion[], v: string | null | undefined) => (v ? xs.find((x) => x.codigo === v)?.etiqueta ?? v : "—");
const sn = (v: boolean | null | undefined) => (v == null ? "—" : v ? "Sí" : "No");

export default function DatosEncargoOt({ otId, onCambio }: { otId: string; onCambio?: () => void }) {
  const [v, setV] = useState<Vista | null>(null);
  const [error, setError] = useState("");
  const [editando, setEditando] = useState(false);
  const [f, setF] = useState<Record<string, any>>({});
  const [validando, setValidando] = useState<"" | "conforme" | "devolver">("");
  const [val, setVal] = useState<Record<string, any>>({});
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setV(await llamar<Vista>("GET", `/ot/${otId}/encargo`));
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }, [otId]);
  useEffect(() => void cargar(), [cargar]);

  if (error) return <div className="alert warn">Datos del encargo: {error}</div>;
  if (!v) return null;
  const e = v.encargo ?? {};
  const institucional = v.ot.origen === "INSTITUCIONAL";

  function abrirEdicion() {
    const base: Record<string, any> = { tipoTrabajo: v!.tipoTrabajo ?? "" };
    for (const k of ["nivelTecnologico", "mandante", "oficioNumero", "oficioFecha", "contrato", "contratoFecha", "proyecto", "proveedor", "fabricante", "paisOrigen", "item", "unidadCantidad", "etTexto", "lugarMuestreo", "fechaMuestreo", "paga", "carrilDsa", "lugarEjecucion", "paisEjecucion", "otOrigenCodigo"])
      base[k] = e[k] ?? "";
    base.cantidad = e.cantidad != null ? String(e.cantidad).replace(".", ",") : "";
    base.requiereMuestreo = e.requiereMuestreo == null ? "" : e.requiereMuestreo ? "si" : "no";
    base.muestreoCliente = e.muestreoCliente == null ? "" : e.muestreoCliente ? "si" : "no";
    setF(base);
    setEditando(true);
  }

  async function guardar() {
    setOcupado(true);
    try {
      // OT de origen por su código (reinspección): se busca en las OT del alcance.
      let otOrigenId: string | null = null;
      if (String(f.otOrigenCodigo ?? "").trim()) {
        const r = await llamar<any>("GET", `/ot?q=${encodeURIComponent(f.otOrigenCodigo.trim())}&limit=5`);
        const lista = Array.isArray(r) ? r : r?.data ?? [];
        const o = lista.find((x: any) => String(x.codigo).toUpperCase() === f.otOrigenCodigo.trim().toUpperCase());
        if (!o) throw new Error(`No se encontró la OT de origen ${f.otOrigenCodigo.trim()} en su alcance.`);
        otOrigenId = o.id;
      }
      const cuerpo: Record<string, any> = {};
      for (const k of ["tipoTrabajo", "nivelTecnologico", "mandante", "oficioNumero", "oficioFecha", "contrato", "contratoFecha", "proyecto", "proveedor", "fabricante", "paisOrigen", "item", "unidadCantidad", "etTexto", "lugarMuestreo", "fechaMuestreo", "paga", "carrilDsa", "lugarEjecucion", "paisEjecucion"])
        cuerpo[k] = String(f[k] ?? "").trim() === "" ? null : String(f[k]).trim();
      cuerpo.cantidad = String(f.cantidad ?? "").trim() === "" ? null : Number(String(f.cantidad).replace(/\./g, "").replace(",", "."));
      cuerpo.requiereMuestreo = f.requiereMuestreo === "" ? null : f.requiereMuestreo === "si";
      cuerpo.muestreoCliente = f.muestreoCliente === "" ? null : f.muestreoCliente === "si";
      cuerpo.otOrigenId = otOrigenId;
      setV(await llamar<Vista>("PUT", `/ot/${otId}/encargo`, cuerpo));
      setEditando(false);
      toast.ok("Datos del encargo guardados.");
      onCambio?.();
    } catch (x: any) {
      toast.error(x.message);
    } finally {
      setOcupado(false);
    }
  }

  async function validar(conforme: boolean) {
    setOcupado(true);
    try {
      const r = await llamar<any>("POST", `/ot/${otId}/encargo/validacion-laboratorio`, {
        alcanceConforme: conforme,
        observacion: val.observacion?.trim() || null,
        ...(conforme
          ? {
              clasificacionVehiculo: val.clasificacionVehiculo || null,
              subtipoVehiculo: val.subtipoVehiculo?.trim() || null,
              fechaInspeccion: val.fechaInspeccion || null,
              fechaInicio: val.fechaInicio || null,
              fechaTermino: val.fechaTermino || null,
              fechaInforme: val.fechaInforme || null,
              escalarJefeSeccion: !!val.escalarJefeSeccion,
            }
          : {}),
      });
      setV(r);
      setValidando("");
      toast.ok(r.mensaje);
      for (const a of r.avisos ?? []) toast.info(a);
      onCambio?.();
    } catch (x: any) {
      toast.error(x.message);
    } finally {
      setOcupado(false);
    }
  }

  const Dato = ({ l, x }: { l: string; x: React.ReactNode }) => (
    <div className="field readonly"><label>{l}</label><div style={{ padding: "4px 0", whiteSpace: "pre-wrap" }}>{vacio(x) ? "—" : x}</div></div>
  );
  const campo = (k: string, l: string, extra: Record<string, any> = {}) => (
    <div className="field" key={k}>
      <label htmlFor={`enc-${k}`}>{l}</label>
      <input id={`enc-${k}`} value={f[k] ?? ""} onChange={(x) => setF({ ...f, [k]: x.target.value })} {...extra} />
    </div>
  );
  const select = (k: string, l: string, ops: Opcion[], req = false) => (
    <div className="field" key={k}>
      <label htmlFor={`enc-${k}`}>{l}{req && <span className="req"> *</span>}</label>
      <select id={`enc-${k}`} value={f[k] ?? ""} onChange={(x) => setF({ ...f, [k]: x.target.value })}>
        <option value="">—</option>
        {ops.map((o) => <option key={o.codigo} value={o.codigo}>{o.etiqueta}</option>)}
      </select>
    </div>
  );
  const siNo = (k: string, l: string) => (
    <div className="field" key={k}>
      <label htmlFor={`enc-${k}`}>{l}</label>
      <select id={`enc-${k}`} value={f[k] ?? ""} onChange={(x) => setF({ ...f, [k]: x.target.value })}>
        <option value="">—</option><option value="si">Sí</option><option value="no">No</option>
      </select>
    </div>
  );

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <section className="card" style={{ padding: 12, margin: 0 }} aria-labelledby="enc-titulo">
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <h3 id="enc-titulo" style={{ margin: 0, fontSize: 14, flex: 1 }}>Datos del encargo</h3>
          {v.documentoPropuesto && <span className="pill teal" title="Documento que propone el tipo de trabajo">Emite {v.documentoPropuesto}</span>}
          {v.puede.editar && !editando && <button className="btn outline sm" onClick={abrirEdicion}>Completar o corregir</button>}
        </div>
        {!editando ? (
          <div className="form-grid cols-4">
            <Dato l="Tipo de trabajo" x={etiqueta(v.listas.tipoTrabajo, v.tipoTrabajo)} />
            <Dato l="Nivel tecnológico" x={e.nivelTecnologico} />
            <Dato l="¿Requiere muestreo?" x={sn(e.requiereMuestreo)} />
            <Dato l="Mandante" x={e.mandante} />
            <Dato l="Moneda · forma de pago" x={[e.moneda, e.formaPago].filter(Boolean).join(" · ")} />
            <Dato l="Valor inicial (cotizado)" x={e.valorInicial != null ? monto(e.valorInicial, e.moneda ?? "CLP") : null} />
            <Dato l="Referencia" x={e.referencia} />
            {institucional && <Dato l="Oficio" x={e.oficioNumero ? `${e.oficioNumero}${e.oficioFecha ? ` · ${fechaDia(e.oficioFecha)}` : ""}` : null} />}
            {(e.laboratoriosDetalle ?? []).length > 0 && <Dato l="Laboratorios que intervienen" x={e.laboratoriosDetalle.map((u: any) => u.codigo).join(", ")} />}
            {e.descripcionTecnica && <div style={{ gridColumn: "1 / -1" }}><Dato l="Descripción técnica (de la cotización)" x={e.descripcionTecnica} /></div>}
            <Dato l="Contrato" x={e.contrato ? `${e.contrato}${e.contratoFecha ? ` · ${fechaDia(e.contratoFecha)}` : ""}` : null} />
            <Dato l="Proyecto (PICM)" x={e.proyecto} />
            <Dato l="Proveedor" x={e.proveedor} />
            <Dato l="Fabricante · país" x={[e.fabricante, e.paisOrigen].filter(Boolean).join(" · ")} />
            <Dato l="Ítem · cantidad" x={[e.item, e.cantidad != null ? `${String(e.cantidad).replace(".", ",")}${e.unidadCantidad ? ` ${e.unidadCantidad}` : ""}` : null].filter(Boolean).join(" · ")} />
            <Dato l="E.T. y versión" x={e.etTexto} />
            <Dato l="Muestreo previsto" x={[e.lugarMuestreo, e.fechaMuestreo ? fechaDia(e.fechaMuestreo) : null].filter(Boolean).join(" · ")} />
            <Dato l="OT de origen · paga" x={e.otOrigenId ? <><Link href={`/ot/${e.otOrigenId}` as any} className="codigo">{e.otOrigenCodigo}</Link>{e.paga ? ` · paga el ${e.paga}` : ""}</> : null} />
            <Dato l="Carril DSA" x={etiqueta(v.listas.carrilDsa, e.carrilDsa)} />
            <Dato l="Lugar de ejecución" x={[etiqueta(v.listas.lugarEjecucion, e.lugarEjecucion), e.paisEjecucion].filter((x) => x && x !== "—").join(" · ")} />
            <Dato l="Muestreo en instalaciones del cliente" x={sn(e.muestreoCliente)} />
            {e.actualizadoAt && e.actualizadoPor && <p style={{ gridColumn: "1 / -1", margin: 0, fontSize: 11.5, color: "var(--muted)" }}>Última actualización: {fechaHora(e.actualizadoAt)} · {e.actualizadoPor}. Los datos de contrato y lote precargan la portada del IVC.</p>}
          </div>
        ) : (
          <div>
            <div className="form-grid cols-4">
              {select("tipoTrabajo", "Tipo de trabajo", v.listas.tipoTrabajo)}
              {select("nivelTecnologico", "Nivel tecnológico", v.listas.nivelTecnologico)}
              {siNo("requiereMuestreo", "¿Requiere muestreo?")}
              {institucional && campo("oficioNumero", "Nº de oficio", { maxLength: 80 })}
              {institucional && campo("oficioFecha", "Fecha del oficio", { type: "date" })}
              {CAMPOS_TEXTO.map(([k, l, m]) => campo(k, l, { maxLength: m }))}
              {campo("cantidad", "Cantidad del lote", { inputMode: "decimal" })}
              {CAMPOS_FECHA.map(([k, l]) => campo(k, l, { type: "date" }))}
              {campo("otOrigenCodigo", "OT de origen (código)", { maxLength: 30, placeholder: "Solo en reinspección" })}
              <div className="field">
                <label htmlFor="enc-paga">Quién paga la reinspección</label>
                <select id="enc-paga" value={f.paga ?? ""} onChange={(x) => setF({ ...f, paga: x.target.value })}>
                  <option value="">—</option><option value="proveedor">Proveedor</option><option value="mandante">Mandante</option>
                </select>
              </div>
              {select("carrilDsa", "Carril DSA", v.listas.carrilDsa)}
              {select("lugarEjecucion", "Lugar de ejecución", v.listas.lugarEjecucion)}
              {campo("paisEjecucion", "País de ejecución", { maxLength: 80 })}
              {siNo("muestreoCliente", "¿Muestreo en instalaciones del cliente?")}
            </div>
            <div className="toolbar" style={{ marginTop: 10 }}>
              <button className="btn outline sm" onClick={() => setEditando(false)}>Cancelar</button>
              <div className="spacer" />
              <button className="btn primary sm" disabled={ocupado} onClick={guardar}>{ocupado ? "Guardando…" : "Guardar datos del encargo"}</button>
            </div>
          </div>
        )}
      </section>

      <RecepcionDcoOt otId={otId} />

      <section className="card" style={{ padding: 12, margin: 0 }} aria-labelledby="val-titulo">
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <h3 id="val-titulo" style={{ margin: 0, fontSize: 14, flex: 1 }}>Recepción en el laboratorio</h3>
          {e.validadaAt && <span className="pill green">Recepcionada</span>}
          {e.devueltaVentasAt && <span className="pill red">Devuelta a Ventas</span>}
          {v.puede.validar && !validando && (
            <>
              <button className="btn primary sm" onClick={() => { setVal({ fechaInicio: e.fechaInicio ?? "", fechaTermino: e.fechaTermino ?? "", fechaInforme: e.fechaInforme ?? "", fechaInspeccion: e.fechaInspeccion ?? "", clasificacionVehiculo: e.clasificacionVehiculo ?? "", subtipoVehiculo: e.subtipoVehiculo ?? "", observacion: "" }); setValidando("conforme"); }}>
                {e.validadaAt ? "Cambiar fechas internas" : "Recepcionar → planificar"}
              </button>
              <button className="btn outline sm" onClick={() => { setVal({ observacion: "" }); setValidando("devolver"); }}>Alcance no conforme → Ventas</button>
            </>
          )}
        </div>
        {e.devueltaVentasAt && !validando && (
          <div className="alert warn" style={{ margin: "4px 0" }}>Devuelta a Ventas el {fechaHora(e.devueltaVentasAt)}{e.devueltaVentasPor ? ` por ${e.devueltaVentasPor}` : ""}: {e.devueltaVentasMotivo}</div>
        )}
        {!validando ? (
          e.validadaAt ? (
            <div className="form-grid cols-4">
              <Dato l="Inicio del ensayo" x={e.fechaInicio ? fechaDia(e.fechaInicio) : null} />
              <Dato l="Término" x={e.fechaTermino ? fechaDia(e.fechaTermino) : null} />
              <Dato l="Informe comprometido (interno)" x={e.fechaInforme ? fechaDia(e.fechaInforme) : null} />
              <Dato l="Muestreo o inspección" x={e.fechaInspeccion ? fechaDia(e.fechaInspeccion) : null} />
              {e.clasificacionVehiculo && <Dato l="Clasificación del vehículo" x={[etiqueta(v.listas.clasificacionVehiculo, e.clasificacionVehiculo), e.subtipoVehiculo].filter(Boolean).join(" · ")} />}
              {e.escalarJefeSeccion && <Dato l="Escalada al Jefe de Sección" x="Sí" />}
              {e.alcanceObservacion && <Dato l="Observación" x={e.alcanceObservacion} />}
              <p style={{ gridColumn: "1 / -1", margin: 0, fontSize: 11.5, color: "var(--muted)" }}>
                Recepcionada el {fechaHora(e.validadaAt)}{e.validadaPor ? ` por ${e.validadaPor}` : ""}. Las fechas internas no cambian el plazo comprometido con el cliente{v.ot.fechaCompromiso ? ` (${fechaDia(v.ot.fechaCompromiso)})` : ""}.
              </p>
            </div>
          ) : (
            <p className="subtitle" style={{ margin: 0 }}>El laboratorio aún no confirma el alcance ni fija sus fechas internas.</p>
          )
        ) : validando === "devolver" ? (
          <div>
            <div className="field">
              <label htmlFor="val-motivo">Motivo (alcance no conforme) <span className="req">*</span></label>
              <textarea id="val-motivo" rows={2} maxLength={2000} value={val.observacion ?? ""} onChange={(x) => setVal({ ...val, observacion: x.target.value })} />
            </div>
            <div className="toolbar" style={{ marginTop: 8 }}>
              <button className="btn outline sm" onClick={() => setValidando("")}>Cancelar</button>
              <div className="spacer" />
              <button className="btn sm" style={{ background: "var(--red)", color: "#fff" }} disabled={ocupado} onClick={() => validar(false)}>Devolver a Ventas</button>
            </div>
          </div>
        ) : (
          <div>
            <div className="form-grid cols-4">
              <div className="field"><label htmlFor="val-ini">Inicio del ensayo <span className="req">*</span></label><input id="val-ini" type="date" value={val.fechaInicio ?? ""} onChange={(x) => setVal({ ...val, fechaInicio: x.target.value })} /></div>
              <div className="field"><label htmlFor="val-fin">Término</label><input id="val-fin" type="date" value={val.fechaTermino ?? ""} onChange={(x) => setVal({ ...val, fechaTermino: x.target.value })} /></div>
              <div className="field"><label htmlFor="val-inf">Informe comprometido <span className="req">*</span></label><input id="val-inf" type="date" value={val.fechaInforme ?? ""} onChange={(x) => setVal({ ...val, fechaInforme: x.target.value })} /></div>
              <div className="field"><label htmlFor="val-insp">Fecha de muestreo o inspección</label><input id="val-insp" type="date" value={val.fechaInspeccion ?? ""} onChange={(x) => setVal({ ...val, fechaInspeccion: x.target.value })} /></div>
              {v.ot.laboratorio === "SVM" && (
                <>
                  <div className="field">
                    <label htmlFor="val-clas">Clasificación del vehículo <span className="req">*</span></label>
                    <select id="val-clas" value={val.clasificacionVehiculo ?? ""} onChange={(x) => setVal({ ...val, clasificacionVehiculo: x.target.value })}>
                      <option value="">—</option>
                      {v.listas.clasificacionVehiculo.map((o) => <option key={o.codigo} value={o.codigo}>{o.etiqueta}</option>)}
                    </select>
                  </div>
                  <div className="field"><label htmlFor="val-sub">Subtipo o tonelaje</label><input id="val-sub" maxLength={80} value={val.subtipoVehiculo ?? ""} onChange={(x) => setVal({ ...val, subtipoVehiculo: x.target.value })} /></div>
                </>
              )}
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 400 }}>
                <input type="checkbox" style={{ width: "auto" }} checked={!!val.escalarJefeSeccion} onChange={(x) => setVal({ ...val, escalarJefeSeccion: x.target.checked })} /> Escalar al Jefe de Sección
              </label>
              <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="val-obs">Observación</label><input id="val-obs" maxLength={2000} value={val.observacion ?? ""} onChange={(x) => setVal({ ...val, observacion: x.target.value })} /></div>
            </div>
            <p className="hint" style={{ margin: "6px 0 0", fontSize: 11.5, color: "var(--muted)" }}>Plazo comprometido con el cliente: {v.ot.fechaCompromiso ? fechaDia(v.ot.fechaCompromiso) : "sin fecha"}. Las fechas internas no lo cambian.</p>
            <div className="toolbar" style={{ marginTop: 8 }}>
              <button className="btn outline sm" onClick={() => setValidando("")}>Cancelar</button>
              <div className="spacer" />
              <button className="btn primary sm" disabled={ocupado} onClick={() => validar(true)}>{ocupado ? "Guardando…" : "Recepcionar → planificar"}</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
