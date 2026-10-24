"use client";

/**
 * BPCH · Expediente de reinspección: solicitud y antecedente original →
 * inspección y lote → resultados → Informe de Inspección (Jefe de Sucursal,
 * distribución interna) → trazabilidad (y cambio de titular) en la
 * Codificación Única → cierre. API: /bpch/reinspecciones/:id
 */
import { conPunto } from "@/lib/etiquetas";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PageHeader, Skeleton } from "@/components/ui/PageHeader";
import RequierePermiso from "@/components/RequierePermiso";
import { toast, confirmar } from "@/components/ui/feedback";
import { usePermisos } from "@/lib/permisos";
import { fecha } from "@/lib/format";
import { DocumentosYCierre, Fases } from "../../_components/Expediente";
import { SelectorPanel } from "../../_components/Buscadores";
import { type ConfigBpch, ESTADO_COD, dia, pedir } from "../../_components/bpch";

export default function ReinspeccionDetallePage() {
  return (
    <RequierePermiso perm="bpch.reinspeccion.ver" titulo="Reinspección BPCH">
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
  const [metodos, setMetodos] = useState<string[]>([]);
  const [f, setF] = useState<Record<string, string> | null>(null);
  const [titular, setTitular] = useState({ cambiar: false, motivo: "" });

  const cargar = useCallback(async () => {
    try {
      const r = await pedir<any>("GET", `/bpch/reinspecciones/${id}`);
      setD(r);
      setF((x) => x ?? {
        lugarInspeccion: r.inspeccion.lugar ?? "",
        fechaInspeccion: dia(r.inspeccion.fecha),
        inspectores: r.inspeccion.inspectores ?? "",
        fechaVencimientoProducto: dia(r.inspeccion.vencimientoProducto),
        vigenciaInforme: dia(r.inspeccion.vigenciaInforme),
        observaciones: r.inspeccion.observaciones ?? "",
        procedimiento: r.procedimiento ?? "",
        identificacionLote: r.lote.identificacion ?? "",
        tamanoLote: r.lote.tamanoLote != null ? String(r.lote.tamanoLote) : "",
        tamanoMuestra: r.lote.tamanoMuestra != null ? String(r.lote.tamanoMuestra) : "",
      });
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }, [id]);
  useEffect(() => {
    cargar();
    pedir<ConfigBpch>("GET", "/bpch/config").then(setConfig).catch(() => null);
  }, [cargar]);

  async function accion(metodo: "POST" | "PATCH", ruta: string, cuerpo: unknown, ok: string) {
    try {
      setD(await pedir<any>(metodo, `/bpch/reinspecciones/${id}${ruta}`, cuerpo));
      toast.ok(ok);
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  if (error) return <div className="alert warn" role="alert">{error}</div>;
  if (!d || !f) return <Skeleton h={220} />;
  const abierta = !["cerrada", "anulada"].includes(d.estadoOt?.ot?.estado);
  const editable = abierta && puede("resultado.crear");
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x!, [k]: e.target.value }));
  const informe = d.estadoOt?.informeInspeccion;
  const informeOficial = informe && ["oficial", "emitido"].includes(informe.estado);
  const destino = d.empresaDestino;

  return (
    <div>
      <PageHeader
        icono="↻"
        titulo={<>Reinspección <span className="codigo">{d.numero}</span></>}
        subtitulo={<>{d.motivoEtiqueta} · {d.producto.elementoEspecifico} · {d.cliente.razonSocial} · inspecciona <b>{d.unidad.codigo}</b></>}
        migas={[{ label: "BPCH" }, { label: "Reinspecciones", href: "/bpch/reinspecciones" }, { label: d.numero }]}
      />
      <div className="expgrid">
        <Fases fases={d.fases} />
        <div>
          <div className="card">
            <h2>Solicitud y antecedente original</h2>
            <div className="form-grid">
              {[
                ["Motivo", `${d.motivoEtiqueta}${d.motivoDetalle ? ` · ${d.motivoDetalle}` : ""}`],
                ["Solicitado por", `${d.solicitadoPor}${d.documentoSolicitud ? ` · ${d.documentoSolicitud}` : ""}`],
                ["Fecha de la solicitud", fecha(d.fechaSolicitud)],
                ["Titular", `${d.cliente.razonSocial} · ${d.cliente.rut ?? ""}`],
                ["Empresa de destino", destino],
                ["¿Con cobro?", d.conCobro ? "Sí" : "No"],
                ["Producto", `${d.producto.elementoEspecifico}${d.producto.elementoGenerico ? ` (${d.producto.elementoGenerico})` : ""}`],
                ["CNC-DGMN", d.producto.cnc],
                ["Clase/División UN · Nº UN", `${d.producto.claseDivisionUn ?? "—"} · ${d.producto.numeroUn ?? "—"}`],
                ["Esquema · procedimiento", `${d.esquema === "TIPO" ? "Tipo" : "Por lotes"} · ${d.procedimiento ?? "—"}`],
              ].map(([l, v]) => <div key={l} className="field readonly"><label>{l}</label><input readOnly value={v || "—"} /></div>)}
            </div>
            <p style={{ margin: "10px 0 0", fontSize: 12.5 }}>
              {d.origenOt && <>OT original <Link href={`/ot/${d.origenOt.id}` as any} className="codigo">{d.origenOt.codigo}</Link> · </>}
              {d.certificadoOrigen && <>documento original {d.certificadoOrigen.numero} · </>}
              {d.codificacion ? <>Codificación Única: <span className="codigo">{d.codificacion.cnc}</span> <span className={`pill ${ESTADO_COD[d.codificacion.estado]?.c}`}>{ESTADO_COD[d.codificacion.estado]?.l}</span> · titular {d.codificacion.fabricanteNombre}</> : "Sin producto en la Codificación Única."}
            </p>
          </div>

          <div className="card">
            <h2>Inspección y lote <span className="right">OT <Link href={`/ot/${d.otId}` as any} className="codigo">{d.estadoOt?.ot?.codigo}</Link></span></h2>
            <form onSubmit={(e) => {
              e.preventDefault();
              const n = (v: string) => (v.trim() ? Number(v) : null);
              accion("PATCH", "/inspeccion", { ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v || null])), tamanoLote: n(f.tamanoLote), tamanoMuestra: n(f.tamanoMuestra) }, "Inspección guardada.");
            }}>
              <fieldset disabled={!editable} style={{ border: "none", padding: 0, margin: 0 }}>
                <div className="form-grid">
                  <div className="field span-2"><label htmlFor="lu">Lugar de inspección</label><input id="lu" value={f.lugarInspeccion} onChange={set("lugarInspeccion")} /></div>
                  <div className="field"><label htmlFor="fi">Fecha de inspección</label><input id="fi" type="date" value={f.fechaInspeccion} onChange={set("fechaInspeccion")} /></div>
                  <div className="field span-2"><label htmlFor="in">Inspectores</label><input id="in" value={f.inspectores} onChange={set("inspectores")} placeholder="Iniciales" /></div>
                  <div className="field"><label htmlFor="pr">Procedimiento</label><input id="pr" value={f.procedimiento} onChange={set("procedimiento")} /></div>
                  <div className="field"><label htmlFor="il">Identificación del lote *</label><input id="il" value={f.identificacionLote} onChange={set("identificacionLote")} /></div>
                  <div className="field"><label htmlFor="tl">Tamaño lote (uu) *</label><input id="tl" type="number" min={1} value={f.tamanoLote} onChange={set("tamanoLote")} /></div>
                  <div className="field"><label htmlFor="tm">Tamaño muestra (uu) *</label><input id="tm" type="number" min={1} value={f.tamanoMuestra} onChange={set("tamanoMuestra")} /></div>
                  <div className="field"><label htmlFor="ve">Vencimiento del producto</label><input id="ve" type="date" value={f.fechaVencimientoProducto} onChange={set("fechaVencimientoProducto")} /></div>
                  <div className="field"><label htmlFor="vi">Vigencia del informe</label><input id="vi" type="date" value={f.vigenciaInforme} onChange={set("vigenciaInforme")} /></div>
                  <div className="field"><label htmlFor="ob">Observaciones</label><input id="ob" value={f.observaciones} onChange={set("observaciones")} /></div>
                </div>
                {editable && <button type="submit" className="btn primary sm" style={{ marginTop: 10 }}>Guardar inspección</button>}
              </fieldset>
            </form>
            <div style={{ borderTop: "1px solid var(--line)", marginTop: 10, paddingTop: 8 }}>
              {d.lote.muestraId ? (
                <span className="pill green">Lote registrado como muestra de la OT</span>
              ) : editable && puede("muestra.crear") ? (
                <>
                  <SelectorPanel catElementoId={d.producto.catElementoId} valor={metodos} onChange={setMetodos} />
                  <button type="button" className="btn primary sm" style={{ marginTop: 6 }} disabled={!metodos.length} onClick={() => accion("POST", "/lote", { metodoIds: metodos }, "Lote registrado como muestra.")}>
                    Registrar lote como muestra ({metodos.length} ensayos)
                  </button>
                </>
              ) : (
                <small style={{ color: "var(--muted)" }}>El lote aún no está registrado como muestra.</small>
              )}
            </div>
          </div>

          <DocumentosYCierre estadoOt={d.estadoOt} config={config} documentoFinal={false} puedeEmitir={puede("certificado.emitir")} onCambio={cargar} />

          <div className="card">
            <h2>Trazabilidad en la Codificación Única</h2>
            {d.trazabilidadAt ? (
              <div className="alert success">Registrada en el historial del producto. <Link href={"/bpch/codificacion" as any}>Ver Codificación Única</Link>.</div>
            ) : !d.codificacion ? (
              <div className="alert info">La reinspección no está ligada a un producto codificado: no hay historial que actualizar.</div>
            ) : !informeOficial ? (
              <div className="alert info">Se registra con el Informe de Inspección oficial (firmado).</div>
            ) : puede("bpch.reinspeccion.gestionar") ? (
              <>
                {destino && (
                  <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
                    <input type="checkbox" checked={titular.cambiar} disabled={!puede("bpch.codificacion.gestionar")} onChange={(e) => setTitular({ ...titular, cambiar: e.target.checked })} />
                    Cambiar el titular a <b>{destino}</b> {!puede("bpch.codificacion.gestionar") && <small>(requiere permiso de la Codificación Única)</small>}
                  </label>
                )}
                {titular.cambiar && (
                  <div className="field" style={{ marginTop: 6 }}>
                    <label htmlFor="tz-motivo">Motivo del cambio de titular</label>
                    <input id="tz-motivo" placeholder="Por qué cambia el titular" value={titular.motivo} onChange={(e) => setTitular({ ...titular, motivo: e.target.value })} style={{ width: "100%" }} />
                  </div>
                )}
                <button type="button" className="btn primary sm" style={{ marginTop: 8 }} onClick={async () => {
                  if (await confirmar({ titulo: "¿Registrar la trazabilidad?", mensaje: titular.cambiar ? conPunto(`Se dejará constancia y el titular pasará a ${destino}`) : "Se dejará constancia de la reinspección en el historial del producto." }))
                    await accion("POST", "/trazabilidad", { cambiarTitular: titular.cambiar, motivo: titular.motivo || null }, "Trazabilidad registrada.");
                }}>Registrar trazabilidad</button>
              </>
            ) : null}
            <p className="subtitle" style={{ margin: "8px 0 0" }}>Por confirmar con BPCH: si la reinspección emite certificado propio, si cambia siempre el titular y si aplica tasa (SAC-PG05 no entregado).</p>
          </div>
        </div>
      </div>
    </div>
  );
}
