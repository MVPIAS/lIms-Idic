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
  // F022: lugares (plantas del cliente y tabla del BPCH) y unidades de tamaño, como la cabecera de la OT.
  const [op, setOp] = useState<{ unidadesLote: Opcion[]; unidadesMuestra: Opcion[]; lugares: { origen: string; lugar: string; comuna: string | null }[] } | null>(null);

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
        unidadLote: r.lote.unidadLote ?? "",
        unidadMuestra: r.lote.unidadMuestra ?? "",
      });
      if (r.otId) pedir<any>("GET", `/bpch/cabecera-ot/${r.otId}`).then((c) => setOp(c?.opciones ?? null)).catch(() => setOp(null));
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
                  <div className="field span-2">
                    <label htmlFor="lu">Lugar de inspección</label>
                    <input id="lu" list="rei-lugares" value={f.lugarInspeccion} onChange={set("lugarInspeccion")} placeholder="Elija una planta o lugar de la tabla, o escríbalo si es en terreno" />
                    <datalist id="rei-lugares">
                      {(op?.lugares ?? []).map((l) => <option key={`${l.origen}-${l.lugar}`} value={l.lugar}>{l.origen === "planta" ? "Planta del cliente" : "Lugar"}{l.comuna ? ` · ${l.comuna}` : ""}</option>)}
                    </datalist>
                  </div>
                  <div className="field"><label htmlFor="fi">Fecha de inspección</label><input id="fi" type="date" value={f.fechaInspeccion} onChange={set("fechaInspeccion")} /></div>
                  <div className="field span-2"><label htmlFor="in">Inspectores</label><input id="in" value={f.inspectores} onChange={set("inspectores")} placeholder="Iniciales" /></div>
                  <div className="field"><label htmlFor="pr">Procedimiento</label><input id="pr" value={f.procedimiento} onChange={set("procedimiento")} /></div>
                  <div className="field"><label htmlFor="il">Identificación del lote *</label><input id="il" value={f.identificacionLote} onChange={set("identificacionLote")} /></div>
                  <div className="field">
                    <label htmlFor="tl">Tamaño del lote *</label>
                    <div style={{ display: "flex", gap: 4 }}>
                      <input id="tl" type="number" min={1} value={f.tamanoLote} onChange={set("tamanoLote")} style={{ minWidth: 0 }} />
                      <select aria-label="Unidad del tamaño del lote" value={f.unidadLote} onChange={(e) => setF((x) => ({ ...x!, unidadLote: e.target.value }))} style={{ width: "auto" }}>
                        <option value="">—</option>
                        {(op?.unidadesLote ?? []).map((u) => <option key={u.valor} value={u.valor}>{u.etiqueta}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="field">
                    <label htmlFor="tm">Tamaño de la muestra *</label>
                    <div style={{ display: "flex", gap: 4 }}>
                      <input id="tm" type="number" min={1} value={f.tamanoMuestra} onChange={set("tamanoMuestra")} style={{ minWidth: 0 }} />
                      <select aria-label="Unidad del tamaño de la muestra" value={f.unidadMuestra} onChange={(e) => setF((x) => ({ ...x!, unidadMuestra: e.target.value }))} style={{ width: "auto" }}>
                        <option value="">—</option>
                        {(op?.unidadesMuestra ?? []).map((u) => <option key={u.valor} value={u.valor}>{u.etiqueta}</option>)}
                      </select>
                    </div>
                  </div>
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
                  {d.producto.catElementoId ? (
                    <SelectorPanel catElementoId={d.producto.catElementoId} valor={metodos} onChange={setMetodos} />
                  ) : (
                    <EnsayosSinElemento propuestos={d.ensayosPropuestos} valor={metodos} onChange={setMetodos} />
                  )}
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

type Opcion = { valor: string; etiqueta: string };
type MetodoSimple = { id: string; codigo: string; nombre: string; analitos?: number };

/**
 * F012: producto sin elemento del catálogo (p. ej. inscrito en la Codificación
 * Única desde un prototipo). Se proponen los ensayos del prototipo o de la OT
 * original y se pueden agregar otros métodos del catálogo.
 */
function EnsayosSinElemento({ propuestos, valor, onChange }: { propuestos: { origen: string; metodos: MetodoSimple[] } | null; valor: string[]; onChange: (ids: string[]) => void }) {
  const [lista, setLista] = useState<MetodoSimple[]>([]);
  const [q, setQ] = useState("");
  const [res, setRes] = useState<MetodoSimple[]>([]);
  useEffect(() => {
    const ms = propuestos?.metodos ?? [];
    setLista(ms);
    if (ms.length && !valor.length) onChange(ms.filter((m) => (m.analitos ?? 1) > 0).map((m) => m.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propuestos]);
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) { setRes([]); return; }
    const h = setTimeout(() => {
      pedir<any>("GET", `/cat/metodos?search=${encodeURIComponent(t)}&limit=20`)
        .then((d) => setRes((Array.isArray(d) ? d : d?.data ?? []).map((m: any) => ({ id: m.id, codigo: m.codigo, nombre: m.nombre }))))
        .catch(() => setRes([]));
    }, 300);
    return () => clearTimeout(h);
  }, [q]);
  const marcar = (id: string, si: boolean) => onChange(si ? [...new Set([...valor, id])] : valor.filter((x) => x !== id));
  return (
    <fieldset style={{ border: "1px solid var(--line)", borderRadius: 6, padding: 8 }}>
      <legend style={{ fontSize: 11, color: "var(--muted)", padding: "0 4px" }}>Ensayos del lote ({valor.length} marcados)</legend>
      <p style={{ margin: "0 0 6px", fontSize: 12 }}>
        {propuestos
          ? <>El producto no tiene elemento del catálogo: se proponen los ensayos de la {propuestos.origen}.</>
          : "El producto no tiene elemento del catálogo ni ensayos de origen: busque los métodos en el catálogo."}
      </p>
      {lista.map((m) => (
        <label key={m.id} style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: 12.5, padding: "3px 0" }}>
          <input type="checkbox" checked={valor.includes(m.id)} onChange={(e) => marcar(m.id, e.target.checked)} />
          <span><span className="codigo">{m.codigo}</span> {m.nombre}</span>
        </label>
      ))}
      <div className="field" style={{ marginTop: 6, position: "relative" }}>
        <label htmlFor="rei-buscar-metodo">Agregar un método del catálogo</label>
        <input id="rei-buscar-metodo" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Código o nombre del método" autoComplete="off" />
        {res.length > 0 && (
          <div role="listbox" style={{ border: "1px solid var(--line)", borderRadius: 6, marginTop: 4, maxHeight: 200, overflowY: "auto", background: "#fff" }}>
            {res.map((m) => (
              <button key={m.id} type="button" role="option" aria-selected={false} style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 8px", border: "none", borderBottom: "1px solid #eef2f5", background: "none", cursor: "pointer", fontSize: 12.5 }}
                onClick={() => { setLista((xs) => (xs.some((x) => x.id === m.id) ? xs : [...xs, m])); marcar(m.id, true); setQ(""); setRes([]); }}>
                <span className="codigo">{m.codigo}</span> {m.nombre}
              </button>
            ))}
          </div>
        )}
      </div>
    </fieldset>
  );
}
