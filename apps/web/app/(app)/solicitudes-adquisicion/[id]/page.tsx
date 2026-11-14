"use client";

/**
 * Ficha de la solicitud de adquisición (IDIC-PG06-IT02-FORM01): pasos
 * 1 Laboratorio · 2 V°B° jefatura · 3 Recepción SAB · 4 Orden de compra · 5 Bodega,
 * datos e ítems (editables en borrador o devuelta), orden de compra que anota
 * SAB, historial y PDF del formulario. Los botones dependen del estado y de
 * quién mira: el laboratorio envía, la jefatura visa o devuelve, SAB gestiona.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import Modal from "@/components/documentos/Modal";
import { llamar } from "@/lib/laboratorio";
import { fechaDia, fechaHora, hoyISO } from "@/lib/format";
import { toast, confirmar } from "@/components/ui/feedback";
import FormSolicitud, { desdeDetalle, type SolicitudPayload } from "@/components/adquisiciones/FormSolicitud";
import { ACCION_ADQUISICION, ESTADO_ADQUISICION, pesos } from "@/lib/adquisiciones";

const API = process.env.NEXT_PUBLIC_API_URL ?? "/api";
type Dialogo = null | "devolver" | "anular" | "recibir_sab" | "registrar_oc" | "recibir_bodega";
const ORDEN = ["borrador", "enviada", "visada", "recibida_sab", "en_compra", "recibida_bodega"];

export default function SolicitudAdquisicionPage() {
  const { id } = useParams<{ id: string }>();
  const [s, setS] = useState<any>(null);
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [editar, setEditar] = useState(false);
  const [dialogo, setDialogo] = useState<Dialogo>(null);
  const [motivo, setMotivo] = useState("");
  const [numeroSab, setNumeroSab] = useState("");
  const [oc, setOc] = useState({ numero: "", fecha: "", proveedor: "", estado: "" });
  const [bodega, setBodega] = useState({ fecha: "", observacion: "" });

  const cargar = useCallback(async () => {
    try {
      setS(await llamar("GET", `/solicitudes-adquisicion/${id}`));
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }, [id]);
  useEffect(() => {
    cargar();
  }, [cargar]);

  async function hacer(fn: () => Promise<any>, ok: string) {
    setOcupado(true);
    try {
      setS(await fn());
      toast.ok(ok);
      setDialogo(null);
      setEditar(false);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  }

  async function guardarEdicion(p: SolicitudPayload, enviar: boolean) {
    await hacer(async () => {
      const r = await llamar("PATCH", `/solicitudes-adquisicion/${id}`, p);
      return enviar ? llamar("POST", `/solicitudes-adquisicion/${id}/enviar`) : r;
    }, enviar ? "Solicitud corregida y enviada a la jefatura." : "Solicitud corregida.");
  }

  async function pdf() {
    const r = await fetch(`${API}/solicitudes-adquisicion/${id}/pdf`, { headers: { Authorization: `Bearer ${localStorage.getItem("lims_token")}` } });
    if (!r.ok) return toast.error(`No se pudo generar el PDF (${r.status}). Vuelva a intentarlo; si sigue, avise a Administración.`);
    const nombre = /filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") ?? "")?.[1] ?? `Solicitud_adquisicion_${s?.numero ?? "borrador"}.pdf`;
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if (error && !s) return <div className="alert warn" role="alert">{error}</div>;
  if (!s) return <p className="subtitle">Cargando solicitud…</p>;
  const e = ESTADO_ADQUISICION[s.estado] ?? { texto: s.estado, pill: "gray" };
  const acc: string[] = s.puedo?.acciones ?? [];
  const puede = (a: string) => acc.includes(a);
  const nivel = s.estado === "devuelta" ? 0 : ORDEN.indexOf(s.estado);
  const paso = (n: number, t: string, estadoMeta: string) => {
    const i = ORDEN.indexOf(estadoMeta);
    const hecho = s.estado !== "anulada" && nivel >= i;
    const ahora = s.estado !== "anulada" && nivel === i - 1;
    return (
      <div className={`step ${hecho ? "done" : ahora ? "now" : "locked"}`} aria-current={ahora ? "step" : undefined} style={{ cursor: "default" }}>
        <div className="dot" aria-hidden>{hecho ? "✓" : n}</div>
        <div className="txt">{t}</div>
      </div>
    );
  };

  return (
    <div>
      <PageHeader
        titulo={`Solicitud de adquisición ${s.numero ?? "(borrador)"}`}
        subtitulo={`${s.unidad.codigo} · ${s.objetivo}`}
        migas={[{ label: "Solicitudes de adquisición", href: "/solicitudes-adquisicion" }, { label: s.numero ?? "Borrador" }]}
        acciones={<button type="button" className="btn outline sm" onClick={pdf}>Descargar PDF del formulario</button>}
      />
      <nav className="stepper" aria-label="Avance de la solicitud">
        {paso(1, "Enviada por el laboratorio", "enviada")}
        {paso(2, "V°B° de la jefatura", "visada")}
        {paso(3, "Recibida por Abastecimiento", "recibida_sab")}
        {paso(4, "Orden de compra", "en_compra")}
        {paso(5, "Recibida en bodega", "recibida_bodega")}
      </nav>

      {s.estado === "devuelta" && <div className="alert warn">Devuelta: <b>{s.devueltaMotivo}</b>. Corríjala y vuelva a enviarla a la jefatura.</div>}
      {s.estado === "anulada" && <div className="alert warn">Anulada: <b>{s.anuladaMotivo}</b></div>}
      {s.puedo?.motivoNoVisar && <div className="alert info">{s.puedo.motivoNoVisar}</div>}

      {s.ingresoBodega?.length > 0 && (
        <div className="alert info">
          <b>¿Registrar el ingreso en Bodegas?</b> Estos ítems están ligados a un consumible del kardex. Puede registrar ahora el lote recibido (no es obligatorio):
          <ul style={{ margin: "6px 0 0 18px" }}>
            {s.ingresoBodega.map((i: any) => (
              <li key={i.itemId}>
                {i.consumible} · {String(i.cantidad).replace(".", ",")} {i.unidadMedida ?? ""}{" "}
                <Link
                  className="btn outline sm"
                  href={`/consumibles?consumible=${i.consumibleId}&nuevoLote=1&cantidad=${i.cantidad}${i.valorUnitario != null ? `&costo=${i.valorUnitario}` : ""}&ref=${encodeURIComponent(s.numero ?? "")}` as any}
                >
                  Registrar lote en Bodegas →
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {editar ? (
        <FormSolicitud
          inicial={desdeDetalle(s)}
          ocupado={ocupado}
          textoGuardar="Guardar corrección"
          textoEnviar="Guardar y enviar a la jefatura →"
          onGuardar={guardarEdicion}
          onCancelar={() => setEditar(false)}
        />
      ) : (
        <>
          <div className="card">
            <h2>
              Datos del solicitante <span className={`pill ${e.pill}`} style={{ marginLeft: 8 }}>{e.texto}</span>
              <span className="right">
                {s.puedo?.editar && <button type="button" className="btn outline sm" onClick={() => setEditar(true)}>Corregir</button>}
              </span>
            </h2>
            <div className="form-grid cols-2">
              <div className="field readonly"><label htmlFor="sad-1">Nº registro (centro de costo solicitante)</label><input id="sad-1" readOnly value={s.numero ?? "Se asigna al enviarla a la jefatura"} /></div>
              <div className="field readonly"><label htmlFor="sad-2">Fecha</label><input id="sad-2" readOnly value={fechaDia(s.fecha)} /></div>
              <div className="field readonly span-2"><label htmlFor="sad-3">Nombre y centro de costo del solicitante</label><input id="sad-3" readOnly value={s.centroCosto} /></div>
              <div className="field readonly"><label htmlFor="sad-4">Usuario solicitante</label><input id="sad-4" readOnly value={[s.solicitanteNombre, s.solicitanteCargo].filter(Boolean).join(" · ")} /></div>
              <div className="field readonly"><label htmlFor="sad-5">Laboratorio</label><input id="sad-5" readOnly value={`${s.unidad.codigo} · ${s.unidad.nombre}`} /></div>
              <div className="field readonly"><label htmlFor="sad-6">Compra con delegación de atribuciones</label><input id="sad-6" readOnly value={s.delegacionAtribuciones ? "Sí" : "No"} /></div>
              <div className="field readonly"><label htmlFor="sad-7">OT relacionada</label><input id="sad-7" readOnly value={s.ot?.codigo ?? "—"} /></div>
              <div className="field readonly span-2"><label htmlFor="sad-8">Objetivo de la adquisición</label><textarea id="sad-8" readOnly rows={2} value={s.objetivo} /></div>
            </div>
          </div>

          <div className="card">
            <h2>Bienes o servicios requeridos</h2>
            <div style={{ overflowX: "auto" }}>
              <table className="data">
                <thead><tr><th>ID</th><th className="num">Cantidad</th><th>Unidad</th><th>Características</th><th>Vínculo</th><th className="num">Valor unitario</th><th className="num">Total</th></tr></thead>
                <tbody>
                  {s.items.map((i: any, k: number) => (
                    <tr key={i.id}>
                      <td>{k + 1}</td>
                      <td className="num">{String(i.cantidad).replace(".", ",")}</td>
                      <td>{i.unidadMedida ?? "—"}</td>
                      <td style={{ whiteSpace: "pre-wrap" }}>{i.descripcion}</td>
                      <td style={{ fontSize: 12 }}>
                        {i.consumibleId ? `Consumible ${i.consumibleCodigo} · ${i.consumibleNombre}` : i.equipoId ? `Equipo ${i.equipoCodigo} · ${i.equipoNombre ?? ""}` : "—"}
                      </td>
                      <td className="num">{pesos(i.valorUnitario)}</td>
                      <td className="num">{pesos(i.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td colSpan={6} className="num">Sub-total</td><td className="num">{pesos(s.totales.subtotal)}</td></tr>
                  <tr><td colSpan={6} className="num">19 % IVA</td><td className="num">{s.aplicaIva ? pesos(s.totales.iva) : "No se suma (valores con impuesto o exentos)"}</td></tr>
                  <tr><td colSpan={6} className="num"><b>Total (valor referencial)</b></td><td className="num"><b>{pesos(s.totales.total)}</b></td></tr>
                </tfoot>
              </table>
            </div>
            {s.totales.sinValor && <p className="subtitle" style={{ fontSize: 12 }}>Hay ítems sin valor estimado: el total es parcial.</p>}
          </div>
        </>
      )}

      <div className="card">
        <h2>Revisión y compra</h2>
        <div className="form-grid cols-2">
          <div className="field readonly"><label htmlFor="sad-9">V°B° de la jefatura</label><input id="sad-9" readOnly value={s.vb ? `${s.vb.nombre} · ${fechaHora(s.vb.at)}` : "Pendiente"} /></div>
          <div className="field readonly"><label htmlFor="sad-10">Recepción en Abastecimiento (Nº registro interno SAB)</label><input id="sad-10" readOnly value={s.sab ? `${s.sab.numero ?? "sin Nº"} · ${s.sab.nombre} · ${fechaHora(s.sab.at)}` : "Pendiente"} /></div>
          <div className="field readonly"><label htmlFor="sad-11">Orden de compra</label><input id="sad-11" readOnly value={s.oc ? `Nº ${s.oc.numero} del ${fechaDia(s.oc.fecha)} · ${s.oc.proveedor}` : "Pendiente"} /></div>
          <div className="field readonly"><label htmlFor="sad-12">Estado de la O/C (según SAB)</label><input id="sad-12" readOnly value={s.oc?.estado ?? "—"} /></div>
          <div className="field readonly"><label htmlFor="sad-13">Recepción en bodega</label><input id="sad-13" readOnly value={s.bodega ? `${fechaDia(s.bodega.fecha)} · ${s.bodega.por ?? ""}` : "Pendiente"} /></div>
        </div>
        {!editar && (
          <div className="toolbar" style={{ marginTop: 12, marginBottom: 0, flexWrap: "wrap" }}>
            {puede("enviar") && (
              <button type="button" className="btn primary" disabled={ocupado} onClick={() => hacer(() => llamar("POST", `/solicitudes-adquisicion/${id}/enviar`), "Solicitud enviada a la jefatura para su V°B°.")}>
                Enviar a la jefatura →
              </button>
            )}
            {puede("visar") && (
              <button type="button" className="btn success" disabled={ocupado} onClick={async () => {
                if (await confirmar({ titulo: "¿Dar V°B° a la solicitud?", mensaje: "Pasa a Abastecimiento (SAB). Queda registrado con su nombre, fecha y hora.", confirmarTexto: "Dar V°B°" }))
                  hacer(() => llamar("POST", `/solicitudes-adquisicion/${id}/visar`), "V°B° registrado: la solicitud pasa a Abastecimiento.");
              }}>
                Dar V°B° → Abastecimiento
              </button>
            )}
            {puede("recibir_sab") && <button type="button" className="btn primary" disabled={ocupado} onClick={() => { setNumeroSab(""); setDialogo("recibir_sab"); }}>Recibir en Abastecimiento</button>}
            {puede("registrar_oc") && (
              <button type="button" className={s.estado === "en_compra" ? "btn outline" : "btn primary"} disabled={ocupado} onClick={() => {
                setOc({ numero: s.oc?.numero ?? "", fecha: s.oc?.fecha ?? hoyISO(), proveedor: s.oc?.proveedor ?? "", estado: s.oc?.estado ?? "" });
                setDialogo("registrar_oc");
              }}>
                {s.estado === "en_compra" ? "Actualizar orden de compra" : "Registrar orden de compra"}
              </button>
            )}
            {puede("recibir_bodega") && <button type="button" className="btn primary" disabled={ocupado} onClick={() => { setBodega({ fecha: hoyISO(), observacion: "" }); setDialogo("recibir_bodega"); }}>Marcar recibida en bodega</button>}
            {puede("devolver") && <button type="button" className="btn outline" disabled={ocupado} onClick={() => { setMotivo(""); setDialogo("devolver"); }}>Devolver con motivo</button>}
            <span className="spacer" />
            {puede("anular") && <button type="button" className="btn ghost-danger" disabled={ocupado} onClick={() => { setMotivo(""); setDialogo("anular"); }}>Anular solicitud</button>}
          </div>
        )}
      </div>

      <div className="card">
        <h2>Historial</h2>
        <table className="data">
          <thead><tr><th>Fecha y hora</th><th>Paso</th><th>Quién</th><th>Detalle</th></tr></thead>
          <tbody>
            {s.eventos.map((ev: any) => (
              <tr key={ev.id}>
                <td>{fechaHora(ev.createdAt)}</td>
                <td>{ACCION_ADQUISICION[ev.accion] ?? ev.accion}{ev.detalle?.correccion ? " (corrección)" : ""}</td>
                <td>{ev.usuario ?? "—"}{ev.detalle?.por ? ` · ${ev.detalle.por}` : ""}</td>
                <td style={{ fontSize: 12 }}>
                  {ev.motivo ?? ""}
                  {ev.detalle?.numero && ev.accion === "enviar" ? `Nº ${ev.detalle.numero}` : ""}
                  {ev.detalle?.numeroSab ? `Nº SAB ${ev.detalle.numeroSab}` : ""}
                  {ev.accion === "registrar_oc" && ev.detalle ? `O/C ${ev.detalle.numero} · ${ev.detalle.proveedor}${ev.detalle.estado ? ` · ${ev.detalle.estado}` : ""}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(dialogo === "devolver" || dialogo === "anular") && (
        <Modal
          titulo={dialogo === "devolver" ? "Devolver la solicitud" : "Anular la solicitud"}
          onCerrar={() => setDialogo(null)}
          acciones={
            <>
              <button type="button" className="btn outline" onClick={() => setDialogo(null)}>Cancelar</button>
              <button type="button" className={dialogo === "anular" ? "btn danger" : "btn primary"} disabled={ocupado || motivo.trim().length < 5}
                onClick={() => hacer(() => llamar("POST", `/solicitudes-adquisicion/${id}/${dialogo}`, { motivo: motivo.trim() }), dialogo === "devolver" ? "Solicitud devuelta a quien la creó." : "Solicitud anulada.")}>
                {dialogo === "devolver" ? "Devolver" : "Anular solicitud"}
              </button>
            </>
          }
        >
          <p style={{ marginTop: 0 }}>
            {dialogo === "devolver" ? "Quien creó la solicitud recibe el motivo, la corrige y la vuelve a enviar (pide un V°B° nuevo)." : "La solicitud queda anulada y no se puede retomar."}
          </p>
          <div className="field"><label htmlFor="sad-14">Motivo <span className="req">*</span></label><textarea id="sad-14" rows={3} maxLength={1000} value={motivo} onChange={(ev) => setMotivo(ev.target.value)} /></div>
        </Modal>
      )}
      {dialogo === "recibir_sab" && (
        <Modal
          titulo={`Recibir la solicitud ${s.numero}`}
          onCerrar={() => setDialogo(null)}
          acciones={
            <>
              <button type="button" className="btn outline" onClick={() => setDialogo(null)}>Cancelar</button>
              <button type="button" className="btn primary" disabled={ocupado}
                onClick={() => hacer(() => llamar("POST", `/solicitudes-adquisicion/${id}/recibir-sab`, { numeroSab: numeroSab.trim() || null }), "Solicitud recibida en Abastecimiento.")}>
                Recibir
              </button>
            </>
          }
        >
          <div className="field"><label htmlFor="sad-15">Nº de registro interno de la Sección Abastecimiento</label><input id="sad-15" value={numeroSab} maxLength={60} onChange={(ev) => setNumeroSab(ev.target.value)} placeholder="Opcional" /></div>
        </Modal>
      )}
      {dialogo === "registrar_oc" && (
        <Modal
          titulo={s.estado === "en_compra" ? "Actualizar la orden de compra" : "Registrar la orden de compra"}
          onCerrar={() => setDialogo(null)}
          acciones={
            <>
              <button type="button" className="btn outline" onClick={() => setDialogo(null)}>Cancelar</button>
              <button type="button" className="btn primary" disabled={ocupado || !oc.numero.trim() || !oc.fecha || oc.proveedor.trim().length < 2}
                onClick={() => hacer(() => llamar("POST", `/solicitudes-adquisicion/${id}/orden-compra`, { numero: oc.numero.trim(), fecha: oc.fecha, proveedor: oc.proveedor.trim(), estado: oc.estado.trim() || null }), "Orden de compra registrada.")}>
                Guardar orden de compra
              </button>
            </>
          }
        >
          <p style={{ marginTop: 0 }}>La O/C se emite en el sistema de compras de SAB; aquí se anota para que el laboratorio vea en qué va su solicitud.</p>
          <div className="form-grid">
            <div className="field"><label htmlFor="sad-16">Nº de la O/C <span className="req">*</span></label><input id="sad-16" value={oc.numero} maxLength={60} onChange={(ev) => setOc({ ...oc, numero: ev.target.value })} /></div>
            <div className="field"><label htmlFor="sad-17">Fecha de la O/C <span className="req">*</span></label><input id="sad-17" type="date" max={hoyISO()} value={oc.fecha} onChange={(ev) => setOc({ ...oc, fecha: ev.target.value })} /></div>
            <div className="field"><label htmlFor="sad-18">Proveedor <span className="req">*</span></label><input id="sad-18" value={oc.proveedor} maxLength={200} onChange={(ev) => setOc({ ...oc, proveedor: ev.target.value })} /></div>
            <div className="field">
              <label htmlFor="sad-19">Estado de la O/C</label>
              <input id="sad-19" list="sad-estados-oc" value={oc.estado} maxLength={120} onChange={(ev) => setOc({ ...oc, estado: ev.target.value })} placeholder="Emitida, enviada al proveedor, aceptada…" />
              <datalist id="sad-estados-oc">
                <option value="Emitida" />
                <option value="Enviada al proveedor" />
                <option value="Aceptada por el proveedor" />
                <option value="Recepción parcial" />
              </datalist>
            </div>
          </div>
        </Modal>
      )}
      {dialogo === "recibir_bodega" && (
        <Modal
          titulo="Marcar la solicitud como recibida en bodega"
          onCerrar={() => setDialogo(null)}
          acciones={
            <>
              <button type="button" className="btn outline" onClick={() => setDialogo(null)}>Cancelar</button>
              <button type="button" className="btn primary" disabled={ocupado || !bodega.fecha}
                onClick={() => hacer(() => llamar("POST", `/solicitudes-adquisicion/${id}/recibir-bodega`, { fecha: bodega.fecha, observacion: bodega.observacion.trim() || null }), "Solicitud recibida en bodega.")}>
                Marcar recibida
              </button>
            </>
          }
        >
          <p style={{ marginTop: 0 }}>Si los ítems están ligados a un consumible, después se le ofrecerá registrar el lote en Bodegas.</p>
          <div className="form-grid">
            <div className="field"><label htmlFor="sad-20">Fecha de recepción <span className="req">*</span></label><input id="sad-20" type="date" max={hoyISO()} value={bodega.fecha} onChange={(ev) => setBodega({ ...bodega, fecha: ev.target.value })} /></div>
            <div className="field"><label htmlFor="sad-21">Observación</label><input id="sad-21" value={bodega.observacion} maxLength={1000} onChange={(ev) => setBodega({ ...bodega, observacion: ev.target.value })} placeholder="Opcional (guía de despacho, recepción parcial…)" /></div>
          </div>
        </Modal>
      )}
    </div>
  );
}
