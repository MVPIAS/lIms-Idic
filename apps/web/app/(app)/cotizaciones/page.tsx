"use client";

/**
 * Cotizaciones · Módulo Comercial LIMS IDIC (Comercial rondas 1 y 2, oct-2026)
 * -----------------------------------------------------------------------------
 * Estados vigentes: Abierta → Aceptada | Anulada. Una Abierta que supera su
 * validez pasa sola a Vencida (no se acepta; se puede anular o emitir otra).
 * Las cotizaciones anteriores (borrador/enviada/rechazada) se muestran como
 * HISTÓRICO de solo lectura.
 *  · Botones según permisos: editar/nueva (cotizacion.crear), registrar
 *    aceptación (cotizacion.aceptar, Sección Ventas), anular (cotizacion.anular).
 *  · Búsqueda, filtros y paginación en el servidor (GET /cotizaciones →
 *    { data, meta, conteos }); la dirección acepta ?estado=, ?porVencer=1,
 *    ?sinOt=1 (tarjetas de Mi bandeja) y ?abrir=<id>.
 *  · Detalle en panel lateral; si está Abierta se edita ahí mismo.
 *  · «Registrar aceptación»: documento OPI/Resolución, OC, correo, pago por
 *    adelantado o disposición del Director (+ con/sin cobro) → genera la OT.
 *    Con disposición del Director y cobro, la OT queda con OPI pendiente.
 *  · «Anular» con motivo obligatorio.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { money, fecha, fechaDia, rut as fmtRut } from "@/lib/format";
import Panel from "./_components/Panel";
import CotizacionForm from "./_components/CotizacionForm";
import SelectorLaboratorio from "@/components/SelectorLaboratorio";
import { usePermisos } from "@/lib/permisos";
import {
  pedir,
  hoyISO,
  ESTADO_PILL,
  ESTADO_LABEL,
  ACEPTACION_LABEL,
  ORIGEN_LABEL,
  ESTADOS_VIGENTES,
  etiquetaDe,
  fueraDeValidez,
  porVencer,
  type Opcion,
} from "./_components/comercial";

type Filtro = "todas" | "abierta" | "porVencer" | "aceptada" | "anulada" | "expirada" | "historico";
const FILTROS_URL: Filtro[] = ["abierta", "aceptada", "anulada", "expirada", "historico"];

/** Qué puede hacer el usuario con una cotización (permiso + estado + validez). */
interface Acciones { editar: boolean; aceptar: boolean; anular: boolean; motivoNoAceptar?: string }
function accionesDe(c: any, puede: (p: string) => boolean): Acciones {
  const vencida = c.estado === "expirada" || ((c.estado === "abierta" || c.estado === "enviada") && fueraDeValidez(c));
  return {
    editar: c.estado === "abierta" && !vencida && puede("cotizacion.crear"),
    aceptar: (c.estado === "abierta" || c.estado === "enviada") && !vencida && puede("cotizacion.aceptar"),
    anular: (c.estado === "abierta" || c.estado === "expirada") && puede("cotizacion.anular"),
    motivoNoAceptar: vencida ? `Venció el ${fechaDia(c.validaHasta ?? c.expiraAt)}: emita una nueva cotización.` : undefined,
  };
}

const esHistorico = (e: string) => !(ESTADOS_VIGENTES as readonly string[]).includes(e);

function EstadoChip({ estado }: { estado: string }) {
  return <span className={`pill ${ESTADO_PILL[estado] ?? "gray"}`}>{ESTADO_LABEL[estado] ?? estado}</span>;
}

export default function CotizacionesPage() {
  const { puede, listo: permisosListos } = usePermisos();
  const [cots, setCots] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [buscar, setBuscar] = useState("");
  // Búsqueda, filtro y paginación en el SERVIDOR (antes: 50 últimas filtradas aquí).
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState<{ page: number; total: number; totalPages: number; limit: number } | null>(null);
  const [conteos, setConteos] = useState<Record<string, number>>({});
  const [extra, setExtra] = useState<{ sinOt?: boolean }>({});
  const [listo, setListo] = useState(false);

  const [detalle, setDetalle] = useState<any | null>(null);
  const [editando, setEditando] = useState(false);
  const [aceptando, setAceptando] = useState<any | null>(null);
  const [anulando, setAnulando] = useState<any | null>(null);
  // Etiquetas de los combos (forma de pago, medio de envío, tipo de cliente).
  const [params, setParams] = useState<Record<string, Opcion[]>>({});
  useEffect(() => {
    pedir<any>("GET", "/cotizaciones/config").then((c) => setParams(c?.parametros ?? {})).catch(() => {});
  }, []);

  const cargar = useCallback(async () => {
    if (!listo) return;
    setCargando(true);
    try {
      const p = new URLSearchParams();
      if (q.trim()) p.set("q", q.trim());
      if (filtro === "porVencer") p.set("porVencer", "1");
      else if (filtro !== "todas") p.set("estado", filtro);
      if (extra.sinOt) p.set("sinOt", "1");
      p.set("page", String(page));
      p.set("limit", "50");
      const d = await pedir<any>("GET", `/cotizaciones?${p.toString()}`);
      setCots(Array.isArray(d) ? d : d?.data ?? []);
      setMeta(d?.meta ?? null);
      setConteos(d?.conteos ?? {});
      setError("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }, [listo, q, filtro, extra, page]);

  const abrir = useCallback(async (id: string) => {
    try {
      setDetalle(await pedir("GET", `/cotizaciones/${id}`));
      setEditando(false);
    } catch (e: any) {
      setMsg(e.message);
    }
  }, []);

  // Filtros de la dirección (tarjetas de Mi bandeja): ?estado=aceptada&sinOt=1, ?porVencer=1, ?estado=expirada.
  useEffect(() => {
    const u = new URLSearchParams(window.location.search);
    const e = u.get("estado") as Filtro | null;
    if (u.get("porVencer") === "1") setFiltro("porVencer");
    else if (e && FILTROS_URL.includes(e)) setFiltro(e);
    setExtra({ sinOt: u.get("sinOt") === "1" });
    setListo(true);
    // ?abrir=<id> (al volver de «Nueva cotización») abre directamente el detalle.
    const id = u.get("abrir");
    if (id) abrir(id);
  }, [abrir]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Búsqueda con espera breve (no consulta en cada tecla).
  useEffect(() => {
    const t = setTimeout(() => { setQ(buscar); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [buscar]);

  const conteo = (f: Filtro) => {
    // conteos = nº por estado + `porVencer` (no es un estado: no suma en «Todas» ni en «Histórico»).
    const todos = Object.entries(conteos).filter(([e]) => e !== "porVencer");
    if (f === "todas") return todos.reduce((a, [, n]) => a + n, 0);
    if (f === "historico") return todos.filter(([e]) => esHistorico(e)).reduce((a, [, n]) => a + n, 0);
    return conteos[f] ?? 0;
  };

  const vis = cots;

  const chips: { f: Filtro; l: string }[] = [
    { f: "todas", l: "Todas" },
    { f: "abierta", l: "Abiertas" },
    { f: "porVencer", l: "Por vencer (7 días)" },
    { f: "aceptada", l: "Aceptadas" },
    { f: "anulada", l: "Anuladas" },
    { f: "expirada", l: "Vencidas" },
    { f: "historico", l: "Histórico" },
  ];

  return (
    <div>
      <h1 className="page">Cotizaciones <span className="tag">≠ OT</span></h1>
      <p className="subtitle">
        Abierta → Aceptada (documento de aceptación, genera la OT) o Anulada. Si supera su validez pasa a Vencida y ya no se puede aceptar. Las cotizaciones anteriores al nuevo flujo quedan como histórico de solo lectura.
      </p>

      {error && <div className="alert warn">{error}</div>}
      {msg && <div className="alert info" style={{ marginBottom: 10 }}>{msg}</div>}

      <div className="toolbar" style={{ flexWrap: "wrap", gap: 6 }}>
        {chips.map(({ f, l }) => (
          <button key={f} className={`btn sm ${filtro === f ? "primary" : "outline"}`} onClick={() => { setFiltro(f); setPage(1); setExtra({}); }}>
            {l} <span style={{ opacity: 0.75, marginLeft: 4 }}>{conteo(f)}</span>
          </button>
        ))}
        <input placeholder="Buscar por N°, cliente o referencia…" style={{ flex: 1, minWidth: 200 }} value={buscar} onChange={(e) => setBuscar(e.target.value)} />
        {permisosListos && puede("cotizacion.crear") && <Link href={"/cotizaciones/nueva" as any} className="btn primary sm">＋ Nueva Cotización</Link>}
      </div>
      {extra.sinOt && (
        <div className="alert info" style={{ marginBottom: 10 }}>
          Filtro de la bandeja: aceptadas sin OT.{" "}
          <button className="btn outline sm" onClick={() => setExtra({})}>Quitar filtro</button>
        </div>
      )}

      <div className="card card--table">
        <table className="data">
          <thead>
            <tr>
              <th>N° Cotización</th>
              <th>Cliente</th>
              <th>Formato</th>
              <th>Estado</th>
              <th className="num">Total (IVA exento)</th>
              <th>Válida hasta</th>
              <th>OT</th>
              <th>Emisión</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {vis.map((c) => { const acc = accionesDe(c, puede); return (
              <tr key={c.id}>
                <td>
                  <button className="codigo" style={{ background: "none", border: 0, padding: 0, cursor: "pointer", textDecoration: "underline" }} onClick={() => abrir(c.id)}>
                    {c.codigo}
                  </button>
                </td>
                <td>{c.cliente?.razonSocial ?? "—"}</td>
                <td>{c.formato ?? "—"}</td>
                <td><EstadoChip estado={c.estado} /></td>
                <td className="num">{money(c.total, c.moneda === "USD" ? "USD" : "CLP")}</td>
                <td>
                  {fechaDia(c.validaHasta ?? c.expiraAt)}
                  {porVencer(c) && <span className="pill amber" style={{ marginLeft: 6 }}>por vencer</span>}
                </td>
                <td>
                  {c.ot ? (
                    <>
                      <Link href={`/ot/${c.ot.id}` as any} className="codigo" style={{ textDecoration: "underline" }}>{c.ot.codigo}</Link>
                      {c.ot.opiPendiente && <span className="pill amber" style={{ marginLeft: 6 }}>OPI pendiente</span>}
                    </>
                  ) : (
                    <span style={{ color: "var(--muted)" }}>—</span>
                  )}
                </td>
                <td style={{ color: "var(--muted)" }}>{fechaDia(c.fechaEmision ?? c.createdAt)}</td>
                <td>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button className="btn outline sm" onClick={() => abrir(c.id)}>{acc.editar ? "Ver / editar" : "Ver"}</button>
                    {acc.aceptar && (
                      <button className="btn primary sm" onClick={() => setAceptando(c)}>Registrar aceptación</button>
                    )}
                    {acc.anular && (
                      <button className="btn outline sm" onClick={() => setAnulando(c)}>Anular</button>
                    )}
                  </div>
                </td>
              </tr>
            ); })}
            {!cargando && vis.length === 0 && (
              <tr><td colSpan={9} style={{ textAlign: "center", padding: 24, color: "var(--muted)" }}>Sin cotizaciones para este filtro.</td></tr>
            )}
            {cargando && (
              <tr><td colSpan={9} style={{ textAlign: "center", padding: 24, color: "var(--muted)" }}>Cargando…</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {meta && meta.totalPages > 1 && (
        <div className="toolbar" style={{ marginTop: 8 }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            {(meta.page - 1) * meta.limit + 1}–{Math.min(meta.page * meta.limit, meta.total)} de {meta.total}
          </span>
          <div className="spacer" />
          <button className="btn outline sm" disabled={meta.page <= 1} onClick={() => setPage((n) => n - 1)}>← Anterior</button>
          <span style={{ fontSize: 12 }}>Página {meta.page} de {meta.totalPages}</span>
          <button className="btn outline sm" disabled={meta.page >= meta.totalPages} onClick={() => setPage((n) => n + 1)}>Siguiente →</button>
        </div>
      )}

      {/* ---------- Detalle / edición ---------- */}
      {detalle && (
        <Panel
          modo="drawer"
          titulo={<>Cotización <span className="codigo">{detalle.codigo}</span> <EstadoChip estado={detalle.estado} /></>}
          onCerrar={() => { setDetalle(null); setEditando(false); }}
        >
          {editando && accionesDe(detalle, puede).editar ? (
            <CotizacionForm
              modo="editar"
              inicial={detalle}
              onCancelar={() => setEditando(false)}
              onGuardado={async () => {
                setMsg(`Cotización ${detalle.codigo} actualizada.`);
                await cargar();
                await abrir(detalle.id);
              }}
            />
          ) : (
            <DetalleCotizacion
              cot={detalle}
              params={params}
              acciones={accionesDe(detalle, puede)}
              onEditar={() => setEditando(true)}
              onAceptar={() => setAceptando(detalle)}
              onAnular={() => setAnulando(detalle)}
            />
          )}
        </Panel>
      )}

      {aceptando && (
        <DialogoAceptacion
          cot={aceptando}
          onCerrar={() => setAceptando(null)}
          onHecho={async (r) => {
            setAceptando(null);
            setMsg(r?.mensaje ?? "Aceptación registrada.");
            await cargar();
            if (detalle?.id === aceptando.id) await abrir(aceptando.id);
          }}
        />
      )}

      {anulando && (
        <DialogoAnulacion
          cot={anulando}
          onCerrar={() => setAnulando(null)}
          onHecho={async () => {
            setAnulando(null);
            setMsg(`Cotización ${anulando.codigo} anulada.`);
            await cargar();
            if (detalle?.id === anulando.id) await abrir(anulando.id);
          }}
        />
      )}
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Detalle de solo lectura (aceptadas, anuladas, históricas o Abierta sin editar)
 * ------------------------------------------------------------------------ */
function DetalleCotizacion({ cot, params, acciones, onEditar, onAceptar, onAnular }: { cot: any; params: Record<string, Opcion[]>; acciones: Acciones; onEditar: () => void; onAceptar: () => void; onAnular: () => void }) {
  const mon = cot.moneda === "USD" ? "USD" : "CLP";
  const Campo = ({ l, v, full }: { l: string; v: React.ReactNode; full?: boolean }) => (
    <div className="field readonly" style={full ? { gridColumn: "1 / -1" } : undefined}>
      <label>{l}</label>
      <div style={{ whiteSpace: "pre-wrap", padding: "4px 0" }}>{v ?? "—"}</div>
    </div>
  );
  return (
    <div>
      {esHistorico(cot.estado) && (
        <div className="alert info">Cotización histórica (estado «{cot.estado}»): se conserva de solo lectura.</div>
      )}
      {cot.ot?.opiPendiente && (
        <div className="alert warn">La OT {cot.ot.codigo} está con <b>OPI pendiente</b> (disposición del Director con cobro). Registre la OPI en la OT.</div>
      )}
      {acciones.motivoNoAceptar && (
        <div className="alert warn">Cotización vencida. {acciones.motivoNoAceptar}{cot.vencidaAt ? ` (marcada vencida el ${fecha(cot.vencidaAt)})` : ""}</div>
      )}
      <div className="toolbar" style={{ marginBottom: 10, gap: 6 }}>
        {acciones.editar && <button className="btn primary sm" onClick={onEditar}>Editar</button>}
        {acciones.aceptar && <button className="btn success sm" onClick={onAceptar}>Registrar aceptación</button>}
        {acciones.anular && <button className="btn outline sm" onClick={onAnular}>Anular</button>}
        <div className="spacer" />
        {cot.ot && <Link href={`/ot/${cot.ot.id}` as any} className="btn outline sm">Ir a la OT {cot.ot.codigo}</Link>}
      </div>

      <div className="form-grid cols-3">
        <Campo l="Cliente" v={<>{cot.cliente?.razonSocial}{cot.cliente?.rut ? ` · ${fmtRut(cot.cliente.rut)}` : ""}</>} />
        <Campo l="Tipo de cliente (al emitir)" v={etiquetaDe(params.tipo_cliente, cot.tipoClienteCodigo)} />
        <Campo l="Formato" v={cot.formato} />
        <Campo l="Emisión" v={fechaDia(cot.fechaEmision)} />
        <Campo l="Válida hasta" v={fechaDia(cot.validaHasta ?? cot.expiraAt)} />
        <Campo l="Moneda" v={mon === "USD" ? `US$ · dólar ${cot.dolarValor} (${fechaDia(cot.dolarFecha)})` : "CLP"} />
        {cot.dolarMotivo && <Campo l="Motivo cambio de dólar" v={cot.dolarMotivo} full />}
        <Campo l="Forma de pago" v={etiquetaDe(params.forma_pago, cot.formaPago)} />
        <Campo l="Medio de envío" v={etiquetaDe(params.medio_envio, cot.medioEnvio)} />
        <Campo l="Referencia" v={cot.referencia} />
        <Campo l="Descripción técnica y alcance" v={cot.descripcionTecnica} full />
      </div>

      <table className="data" style={{ margin: "10px 0" }}>
        <thead><tr><th>Código</th><th>Descripción</th><th className="num">Cant.</th><th className="num">P. unitario</th><th className="num">Subtotal</th></tr></thead>
        <tbody>
          {(cot.lineas ?? []).map((l: any) => (
            <tr key={l.id}>
              <td><span className="codigo">{l.ensayoCodigo ?? l.tipo}</span></td>
              <td>{l.descripcion ?? "—"}</td>
              <td className="num">{l.cantidad}</td>
              <td className="num">{money(l.precioUnitario, mon)}</td>
              <td className="num">{money(l.subtotal, mon)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td colSpan={4} className="num" style={{ fontWeight: 700 }}>Total (IVA exento)</td><td className="num" style={{ fontWeight: 800 }}>{money(cot.total, mon)}</td></tr></tfoot>
      </table>

      <div className="form-grid cols-2">
        <Campo l="Condiciones adicionales (se imprimen)" v={cot.condicionesAdicionales} full />
        <Campo l="Observaciones internas (no se imprimen)" v={cot.observacionesInternas} full />
        {cot.aceptacionTipo && (
          <>
            <Campo l="Documento de aceptación" v={ACEPTACION_LABEL[cot.aceptacionTipo] ?? cot.aceptacionTipo} />
            <Campo l="Número / fecha" v={`${cot.aceptacionNumero ?? "s/n"} · ${fechaDia(cot.aceptacionFecha)}`} />
            <Campo l="Adjunto" v={cot.aceptacionAdjunto} />
            <Campo l="Cobro" v={cot.conCobro ? "Con cobro" : "Sin cobro"} />
          </>
        )}
        {cot.ot && <Campo l="OT generada" v={`${cot.ot.codigo} · ${ORIGEN_LABEL[cot.ot.origenTrabajo] ?? cot.ot.origenTrabajo ?? "—"}`} />}
        {cot.estado === "anulada" && (
          <Campo l="Anulación" v={`${cot.anulacionMotivo ?? "Sin motivo registrado"}${cot.anuladaAt ? ` · ${fecha(cot.anuladaAt)}` : ""}`} full />
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Registrar aceptación (SVT6 / SVT7)
 * ------------------------------------------------------------------------ */
function DialogoAceptacion({ cot, onCerrar, onHecho }: { cot: any; onCerrar: () => void; onHecho: (r: any) => void }) {
  const [tipo, setTipo] = useState<string>(cot.tipoClienteCodigo === "ejercito" ? "OPI_RESOLUCION" : "OC");
  const [numero, setNumero] = useState("");
  const [fechaDoc, setFechaDoc] = useState(hoyISO());
  const [adjunto, setAdjunto] = useState("");
  const [conCobro, setConCobro] = useState(true);
  const [labId, setLabId] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const requiereNumero = tipo === "OPI_RESOLUCION" || tipo === "OC";

  async function confirmar() {
    setError("");
    if (requiereNumero && !numero.trim()) return setError("Indique el número del documento.");
    if (!labId) return setError("Elija el laboratorio responsable de la OT que se generará.");
    setEnviando(true);
    try {
      const r = await pedir("POST", `/cotizaciones/${cot.id}/aceptar`, {
        tipo,
        numero: numero.trim() || undefined,
        fecha: fechaDoc,
        adjunto: adjunto.trim() || undefined,
        conCobro,
        unidadPrincipalId: labId,
      });
      onHecho(r);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Panel titulo={<>Registrar aceptación · <span className="codigo">{cot.codigo}</span></>} onCerrar={onCerrar}>
      {error && <div className="alert warn">{error}</div>}
      <div className="form-grid cols-2">
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label>Documento de aceptación <span className="req">*</span></label>
          <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
            {Object.entries(ACEPTACION_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Número {requiereNumero && <span className="req">*</span>}</label>
          <input value={numero} onChange={(e) => setNumero(e.target.value)} maxLength={60}
            placeholder={tipo === "DISPOSICION_DIRECTOR" ? "Ref. de la disposición" : tipo === "CORREO" ? "Opcional" : ""} />
        </div>
        <div className="field">
          <label>Fecha <span className="req">*</span></label>
          <input type="date" value={fechaDoc} onChange={(e) => setFechaDoc(e.target.value)} />
        </div>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label>Adjunto (referencia del archivo o ubicación)</label>
          <input value={adjunto} onChange={(e) => setAdjunto(e.target.value)} maxLength={300} placeholder="p. ej. ruta del PDF en el repositorio documental" />
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 400, gridColumn: "1 / -1" }}>
          <input type="checkbox" style={{ width: "auto" }} checked={conCobro} onChange={(e) => setConCobro(e.target.checked)} />
          Con cobro
        </label>
        <div style={{ gridColumn: "1 / -1" }}>
          <SelectorLaboratorio valor={labId} onCambio={setLabId} pistas={{ cotizacionId: cot.id }} etiqueta="Laboratorio responsable de la OT" />
        </div>
      </div>
      {tipo === "DISPOSICION_DIRECTOR" && (
        <div className="alert warn" style={{ marginTop: 10 }}>
          OT por disposición del Director (IDIC-PG03 6.4 g): {conCobro
            ? <>la OT quedará con <b>OPI pendiente</b> hasta que se registre la OPI en la OT.</>
            : <>sin cobro: no espera OPI, pero igual registra horas y costo.</>}
        </div>
      )}
      <p className="subtitle" style={{ margin: "10px 0 0" }}>Al confirmar, la cotización pasa a <b>Aceptada</b> y se genera la Orden de Trabajo.</p>
      <div className="toolbar" style={{ marginTop: 12 }}>
        <button className="btn outline sm" onClick={onCerrar}>Cancelar</button>
        <div className="spacer" />
        <button className="btn success sm" disabled={enviando} onClick={confirmar}>{enviando ? "Registrando…" : "Confirmar aceptación"}</button>
      </div>
    </Panel>
  );
}

/* --------------------------------------------------------------------------
 * Anular (motivo obligatorio)
 * ------------------------------------------------------------------------ */
function DialogoAnulacion({ cot, onCerrar, onHecho }: { cot: any; onCerrar: () => void; onHecho: () => void }) {
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  async function confirmar() {
    setError("");
    if (motivo.trim().length < 3) return setError("Indique el motivo de la anulación.");
    setEnviando(true);
    try {
      await pedir("POST", `/cotizaciones/${cot.id}/anular`, { motivo: motivo.trim() });
      onHecho();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setEnviando(false);
    }
  }
  return (
    <Panel titulo={<>Anular cotización · <span className="codigo">{cot.codigo}</span></>} onCerrar={onCerrar} ancho={480}>
      {error && <div className="alert warn">{error}</div>}
      <div className="field">
        <label>Motivo <span className="req">*</span></label>
        <textarea rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={1000} />
      </div>
      <p className="subtitle" style={{ margin: "8px 0 0" }}>La anulación no se puede deshacer. La cotización queda de solo lectura.</p>
      <div className="toolbar" style={{ marginTop: 12 }}>
        <button className="btn outline sm" onClick={onCerrar}>Cancelar</button>
        <div className="spacer" />
        <button className="btn sm" style={{ background: "var(--red)", color: "#fff" }} disabled={enviando} onClick={confirmar}>
          {enviando ? "Anulando…" : "Anular cotización"}
        </button>
      </div>
    </Panel>
  );
}
