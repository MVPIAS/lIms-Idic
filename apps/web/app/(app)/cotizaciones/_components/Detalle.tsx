"use client";

/**
 * Piezas compartidas de la cotización: qué puede hacer el usuario (accionesDe),
 * el chip de estado y el detalle de solo lectura. Las usan la lista
 * (/cotizaciones) y la ficha (/cotizaciones/[id]).
 */
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { monto, fecha, fechaDia, rut as fmtRut } from "@/lib/format";
import { ESTADO_PILL, ESTADO_LABEL, ACEPTACION_LABEL, ORIGEN_LABEL, ESTADOS_VIGENTES, etiquetaDe, fueraDeValidez, esPrecot, pedir, type Opcion } from "./comercial";
import { descargarAdjunto } from "@/lib/d11";
import { toast } from "@/components/ui/feedback";

export interface Acciones { editar: boolean; aceptar: boolean; anular: boolean; motivoNoAceptar?: string; motivoNoEditar?: string }

/**
 * Qué puede hacer el usuario (permiso + estado + validez + circuito de firma).
 * Circuito r1c: en firma o firmada no se edita; sin la firma del Jefe DCO no se
 * registra la aceptación (si `exigirFirma`, valor por defecto de la EP).
 */
export function accionesDe(c: any, puede: (p: string) => boolean, exigirFirma = true): Acciones {
  const vencida = c.estado === "expirada" || ((c.estado === "abierta" || c.estado === "enviada") && fueraDeValidez(c));
  const enFirma = c.firmaEstado === "pendiente" || c.firmaEstado === "firmada";
  const sinFirma = exigirFirma && c.circuito === "r1" && c.firmaEstado !== "firmada";
  return {
    editar: c.estado === "abierta" && !vencida && !enFirma && puede("cotizacion.crear"),
    // Reunión 10: la pre-cotización no se acepta ni genera OT.
    aceptar: !esPrecot(c) && (c.estado === "abierta" || c.estado === "enviada") && !vencida && !sinFirma && puede("cotizacion.aceptar"),
    anular: (c.estado === "abierta" || c.estado === "expirada") && puede("cotizacion.anular"),
    motivoNoAceptar: esPrecot(c)
      ? undefined
      : vencida
      ? `Venció el ${fechaDia(c.validaHasta ?? c.expiraAt)}: emita una nueva cotización.`
      : sinFirma && c.estado === "abierta"
        ? "Aún no está firmada por el Jefe DCO: envíela a firma y, una vez firmada, al cliente."
        : undefined,
    motivoNoEditar: c.firmaEstado === "pendiente" ? "Está en firma del Jefe DCO." : c.firmaEstado === "firmada" ? "Ya está firmada (emitida)." : undefined,
  };
}

/** Estado del circuito de firma y envío (columna de la lista y cabecera de la ficha). */
export function FirmaChip({ c }: { c: any }) {
  if (c.circuito !== "r1") return <span className="pill gray">Histórica</span>;
  // Anulada, vencida o aceptada sin firma: no hay circuito en curso que mostrar.
  if (c.firmaEstado !== "firmada" && c.estado !== "abierta") return <span style={{ color: "var(--muted)" }}>—</span>;
  const f: Record<string, [string, string]> = {
    pendiente: ["En firma", "amber"],
    firmada: ["Firmada", "green"],
    devuelta: ["Devuelta", "red"],
  };
  const [t, color] = f[c.firmaEstado] ?? ["En elaboración", "gray"];
  return (
    <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
      <span className={`pill ${color}`}>{t}</span>
      {c.enviadaAt && <span className="pill blue" title={`Enviada ${fechaDia(c.enviadaAt)}`}>Enviada {fechaDia(c.enviadaAt)}</span>}
    </span>
  );
}

export const esHistorico = (e: string) => !(ESTADOS_VIGENTES as readonly string[]).includes(e);

export function EstadoChip({ estado }: { estado: string }) {
  return <span className={`pill ${ESTADO_PILL[estado] ?? "gray"}`}>{ESTADO_LABEL[estado] ?? estado}</span>;
}

/* --------------------------------------------------------------------------
 * Detalle de solo lectura (aceptadas, anuladas, históricas o Abierta sin editar)
 * ------------------------------------------------------------------------ */
export function DetalleCotizacion({ cot, params, acciones, onEditar, onAceptar, onAnular, puede, onCambio }: { cot: any; params: Record<string, Opcion[]>; acciones: Acciones; onEditar: () => void; onAceptar: () => void; onAnular: () => void; puede?: (p: string) => boolean; onCambio?: (msg: string) => void }) {
  // Frente f5: la moneda guardada se muestra tal cual (una histórica, p. ej. UF, sin convertir).
  const mon: string = cot.moneda || "CLP";
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [sinOtAbierto, setSinOtAbierto] = useState(false);
  const [sinOtMotivo, setSinOtMotivo] = useState("");
  const precot = esPrecot(cot);
  const muestras: any[] = cot.muestras ?? [];
  /** Acción de la cotización (pre-cotización y excepción «sin OT»); con `ir`, abre la cotización resultante. */
  async function accion(ruta: string, cuerpo?: unknown, ir = false) {
    setOcupado(true);
    try {
      const r = await pedir<any>("POST", `/cotizaciones/${cot.id}/${ruta}`, cuerpo ?? {});
      toast.ok(r?.mensaje ?? "Hecho.");
      if (ir && r?.id) router.push(`/cotizaciones/${r.id}` as any);
      else onCambio?.(r?.mensaje ?? "Hecho.");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  }
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
      {precot && (
        <div className="alert info">
          <b>Pre-cotización</b>{cot.precotVersion ? ` · versión ${cot.precotVersion}` : ""}: valores referenciales, sin ensayos ni muestras; no se acepta ni genera OT.
          {cot.reemplazaCodigo && <> Reemplaza a <Link href={`/cotizaciones/${cot.reemplazaId}` as any} className="codigo" style={{ textDecoration: "underline" }}>{cot.reemplazaCodigo}</Link>.</>}
          {cot.reemplazadaPorCodigo && <> Reemplazada por <Link href={`/cotizaciones/${cot.reemplazadaPorId}` as any} className="codigo" style={{ textDecoration: "underline" }}>{cot.reemplazadaPorCodigo}</Link>.</>}
        </div>
      )}
      {cot.precotizacionCodigo && (
        <div className="alert info">Emitida desde la pre-cotización <Link href={`/cotizaciones/${cot.precotizacionId}` as any} className="codigo" style={{ textDecoration: "underline" }}>{cot.precotizacionCodigo}</Link>.</div>
      )}
      {cot.sinOtMotivo && (
        <div className="alert info">Aceptada sin OT por excepción: {cot.sinOtMotivo}. No aparece en el aviso «aceptadas sin OT».</div>
      )}
      {cot.ot?.opiPendiente && (
        <div className="alert warn">La OT {cot.ot.codigo} está con <b>OPI pendiente</b> (disposición del Director con cobro). Registre la OPI en la OT.</div>
      )}
      {acciones.motivoNoAceptar && (
        <div className="alert warn">{acciones.motivoNoAceptar}{cot.vencidaAt ? ` (marcada vencida el ${fecha(cot.vencidaAt)})` : ""}</div>
      )}
      <div className="toolbar" style={{ marginBottom: 10, gap: 6 }}>
        {acciones.editar && <button className="btn primary sm" onClick={onEditar}>Editar</button>}
        {acciones.aceptar && <button className="btn success sm" onClick={onAceptar}>Registrar aceptación</button>}
        {acciones.anular && <button className="btn outline sm" onClick={onAnular}>Anular</button>}
        {precot && !cot.reemplazadaPorId && cot.estado !== "anulada" && puede?.("cotizacion.crear") && (
          <>
            <button className="btn outline sm" disabled={ocupado} onClick={() => accion("nueva-version", undefined, true)} title="Copia los valores referenciales con el número siguiente; esta versión queda reemplazada">Nueva versión</button>
            <button className="btn primary sm" disabled={ocupado} onClick={() => accion("cotizacion-formal", undefined, true)} title="Crea la cotización con la misma cabecera; el laboratorio agrega los ensayos">Emitir cotización formal</button>
          </>
        )}
        {cot.estado === "aceptada" && !cot.ot && puede?.("cotizacion.aceptar") && (
          cot.sinOtMotivo
            ? <button className="btn outline sm" disabled={ocupado} onClick={() => accion("sin-ot", { motivo: null })}>Quitar excepción «sin OT»</button>
            : <button className="btn outline sm" disabled={ocupado} onClick={() => setSinOtAbierto((v) => !v)}>No tendrá OT (excepción)</button>
        )}
        <div className="spacer" />
        {cot.ot && <Link href={`/ot/${cot.ot.id}` as any} className="btn outline sm">Ir a la OT {cot.ot.codigo}</Link>}
      </div>

      {sinOtAbierto && (
        <div className="card" style={{ marginBottom: 10 }}>
          <label htmlFor="sinot-motivo">¿Por qué esta cotización aceptada no tendrá OT en el LIMS?</label>
          <textarea id="sinot-motivo" rows={2} maxLength={1000} value={sinOtMotivo} onChange={(e) => setSinOtMotivo(e.target.value)} placeholder="p. ej. el servicio se facturó directamente; la OT se registró en otra cotización…" />
          <div className="toolbar" style={{ marginTop: 6 }}>
            <button className="btn outline sm" onClick={() => setSinOtAbierto(false)}>Cancelar</button>
            <button className="btn primary sm" disabled={ocupado || sinOtMotivo.trim().length < 5} onClick={() => { setSinOtAbierto(false); accion("sin-ot", { motivo: sinOtMotivo.trim() }); }}>Registrar excepción</button>
          </div>
        </div>
      )}
      <div className="form-grid cols-3">
        <Campo l="Cliente" v={<>{cot.cliente?.razonSocial}{cot.cliente?.rut ? ` · ${fmtRut(cot.cliente.rut)}` : ""}</>} />
        <Campo l="Tipo de cliente (de esta cotización)" v={etiquetaDe(params.tipo_cliente, cot.tipoClienteCodigo)} />
        <Campo l="Centro de costo emisor" v={cot.emisor ? `${cot.emisor.nombre} (${cot.emisor.codigo})` : "Casa Matriz · Depto. Comercial"} />
        <Campo l="Costo de la OT" v={cot.conCobro === false ? "Sin costo (valorización estadística)" : "Con costo (se factura)"} />
        <Campo l="Formato" v={cot.formato} />
        <Campo l="Emisión" v={fechaDia(cot.fechaEmision)} />
        <Campo l="Válida hasta" v={fechaDia(cot.validaHasta ?? cot.expiraAt)} />
        <Campo l="Moneda" v={mon === "USD" ? `US$ · dólar ${cot.dolarValor} (${fechaDia(cot.dolarFecha)})` : mon === "CLP" ? "CLP" : `${mon} · moneda histórica (dato migrado, sin convertir)`} />
        {cot.dolarMotivo && <Campo l="Motivo cambio de dólar" v={cot.dolarMotivo} full />}
        <Campo l="Forma de pago" v={etiquetaDe(params.forma_pago, cot.formaPago)} />
        <Campo l="Medio de envío" v={etiquetaDe(params.medio_envio, cot.medioEnvio)} />
        <Campo l="Referencia" v={cot.referencia} />
        <Campo l="Plazo de entrega" v={cot.plazoEntregaDias ? `${cot.plazoEntregaDias} días corridos desde la llegada de la muestra` : "Sin plazo"} />
        <Campo l="Ejecutivo" v={cot.ejecutivo?.nombreCompleto ?? "—"} />
        <Campo l="Descripción técnica y alcance" v={cot.descripcionTecnica} full />
      </div>

      {muestras.length > 0 && (
        <table className="data" style={{ margin: "10px 0" }}>
          <thead><tr><th>Muestra</th><th>Producto</th><th className="num">Ensayos</th><th>Plazo propio</th></tr></thead>
          <tbody>
            {muestras.map((m) => (
              <tr key={m.n}>
                <td>Muestra {m.n}{m.descripcion && m.descripcion !== `Muestra ${m.n}` ? ` · ${m.descripcion}` : ""}</td>
                <td>{m.productoTexto ?? "—"}</td>
                <td className="num">{(cot.lineas ?? []).filter((l: any) => l.muestraN === m.n && l.catEnsayoId).length}</td>
                <td>{m.plazoDias ? `${m.plazoDias} días desde su llegada` : "El general"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <table className="data" style={{ margin: "10px 0" }}>
        <thead><tr><th>Código</th><th>Descripción</th><th className="num">Cant.</th><th className="num">P. unitario neto</th><th className="num">Subtotal neto</th></tr></thead>
        <tbody>
          {(cot.lineas ?? []).map((l: any) => (
            <tr key={l.id}>
              <td><span className="codigo">{l.ensayoCodigo ?? l.tipo}</span></td>
              <td>
                {l.muestraN ? <span className="pill blue" style={{ marginRight: 6 }}>Muestra {l.muestraN}</span> : null}
                {l.descripcion ?? "—"}
                {/* Contrato 4.1.3: de qué lista (o de la ficha) salió el precio. */}
                {l.precioOrigen && <small style={{ display: "block", color: "var(--muted)" }}>Precio: {l.precioOrigen}</small>}
              </td>
              <td className="num">{l.cantidad}</td>
              <td className="num">{monto(l.precioUnitario, mon)}</td>
              <td className="num">{monto(l.subtotal, mon)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td colSpan={4} className="num" style={{ fontWeight: 700 }}>Total neto{precot ? " referencial" : ""} (el IVA se agrega al final)</td><td className="num" style={{ fontWeight: 800 }}>{monto(cot.total, mon)}</td></tr></tfoot>
      </table>

      <div className="form-grid cols-2">
        <Campo l="Condiciones adicionales (se imprimen)" v={cot.condicionesAdicionales} full />
        <Campo l="Observaciones internas (no se imprimen)" v={cot.observacionesInternas} full />
        {cot.aceptacionTipo && (
          <>
            <Campo l="Documento de aceptación" v={ACEPTACION_LABEL[cot.aceptacionTipo] ?? cot.aceptacionTipo} />
            <Campo l="Número / fecha" v={`${cot.aceptacionNumero ?? "s/n"} · ${fechaDia(cot.aceptacionFecha)}`} />
            <Campo l="Adjunto" v={cot.aceptacionAdjunto} />
            <Campo l="Cobro" v={cot.conCobro ? "Con costo (se factura)" : "Sin costo (valorización estadística)"} />
          </>
        )}
        {cot.solicitud && (cot.solicitud.solicitudMedio || cot.solicitud.solicitanteContacto || cot.solicitud.solicitanteNombre) && (
          <Campo l="Solicitud del cliente" v={[
            cot.solicitud.solicitanteContacto ? `${cot.solicitud.solicitanteContacto}${cot.solicitud.solicitanteCargo ? ` (${cot.solicitud.solicitanteCargo})` : ""}` : cot.solicitud.solicitanteNombre,
            cot.solicitud.solicitudMedio === "oficio" ? `Oficio ${cot.solicitud.solicitudNumero ?? ""}` : cot.solicitud.solicitudMedio === "correo" ? "Correo" : null,
            cot.solicitud.solicitudFecha ? fechaDia(cot.solicitud.solicitudFecha) : null,
          ].filter(Boolean).join(" · ")} />
        )}
        {cot.solicitud?.oportunidadCodigo && <Campo l="Oportunidad (CRM)" v={cot.solicitud.oportunidadCodigo} />}
        {(cot.adjuntos ?? []).length > 0 && (
          <Campo l="Documentos adjuntos" full v={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {cot.adjuntos.map((a: any) => (
                <li key={a.id}>
                  <button type="button" className="btn-link" style={{ background: "none", border: 0, padding: 0, color: "var(--accent)", textDecoration: "underline", cursor: "pointer" }}
                    onClick={() => descargarAdjunto(`/cotizaciones/${cot.id}/adjuntos/${a.id}`, a.nombre).catch((e) => toast.error(e.message))}>
                    {a.nombre}
                  </button>{" "}
                  <small style={{ color: "var(--muted)" }}>{a.clase === "aceptacion" ? "aceptación" : "solicitud"} · {fecha(a.createdAt)}</small>
                </li>
              ))}
            </ul>
          } />
        )}
        {cot.ot && <Campo l="OT generada" v={<><Link href={`/ot/${cot.ot.id}` as any} className="codigo" style={{ textDecoration: "underline" }}>{cot.ot.codigo}</Link> · {ORIGEN_LABEL[cot.ot.origenTrabajo] ?? cot.ot.origenTrabajo ?? "—"}</>} />}
        {cot.estado === "anulada" && (
          <Campo l="Anulación" v={`${cot.anulacionMotivo ?? "Sin motivo registrado"}${cot.anuladaAt ? ` · ${fecha(cot.anuladaAt)}` : ""}`} full />
        )}
      </div>
    </div>
  );
}

