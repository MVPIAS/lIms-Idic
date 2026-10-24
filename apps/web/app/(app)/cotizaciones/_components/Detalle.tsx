"use client";

/**
 * Piezas compartidas de la cotización: qué puede hacer el usuario (accionesDe),
 * el chip de estado y el detalle de solo lectura. Las usan la lista
 * (/cotizaciones) y la ficha (/cotizaciones/[id]).
 */
import Link from "next/link";
import { monto, fecha, fechaDia, rut as fmtRut } from "@/lib/format";
import { ESTADO_PILL, ESTADO_LABEL, ACEPTACION_LABEL, ORIGEN_LABEL, ESTADOS_VIGENTES, etiquetaDe, fueraDeValidez, type Opcion } from "./comercial";
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
    aceptar: (c.estado === "abierta" || c.estado === "enviada") && !vencida && !sinFirma && puede("cotizacion.aceptar"),
    anular: (c.estado === "abierta" || c.estado === "expirada") && puede("cotizacion.anular"),
    motivoNoAceptar: vencida
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
export function DetalleCotizacion({ cot, params, acciones, onEditar, onAceptar, onAnular }: { cot: any; params: Record<string, Opcion[]>; acciones: Acciones; onEditar: () => void; onAceptar: () => void; onAnular: () => void }) {
  // Frente f5: la moneda guardada se muestra tal cual (una histórica, p. ej. UF, sin convertir).
  const mon: string = cot.moneda || "CLP";
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
        <div className="alert warn">{acciones.motivoNoAceptar}{cot.vencidaAt ? ` (marcada vencida el ${fecha(cot.vencidaAt)})` : ""}</div>
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
        <Campo l="Moneda" v={mon === "USD" ? `US$ · dólar ${cot.dolarValor} (${fechaDia(cot.dolarFecha)})` : mon === "CLP" ? "CLP" : `${mon} · moneda histórica (dato migrado, sin convertir)`} />
        {cot.dolarMotivo && <Campo l="Motivo cambio de dólar" v={cot.dolarMotivo} full />}
        <Campo l="Forma de pago" v={etiquetaDe(params.forma_pago, cot.formaPago)} />
        <Campo l="Medio de envío" v={etiquetaDe(params.medio_envio, cot.medioEnvio)} />
        <Campo l="Referencia" v={cot.referencia} />
        <Campo l="Plazo de entrega" v={cot.plazoEntregaDias ? `${cot.plazoEntregaDias} días corridos` : "Sin plazo"} />
        <Campo l="Ejecutivo" v={cot.ejecutivo?.nombreCompleto ?? "—"} />
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
              <td className="num">{monto(l.precioUnitario, mon)}</td>
              <td className="num">{monto(l.subtotal, mon)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td colSpan={4} className="num" style={{ fontWeight: 700 }}>Total (IVA exento)</td><td className="num" style={{ fontWeight: 800 }}>{monto(cot.total, mon)}</td></tr></tfoot>
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

