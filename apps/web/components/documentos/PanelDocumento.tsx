"use client";

/**
 * PanelDocumento · un informe/certificado y su circuito de firma: vista previa,
 * pasos de la matriz (quién firma, quién firmó y cuándo) y las acciones que el
 * servidor permite al usuario (`puedo`): firmar, devolver, anular, reemitir,
 * registrar la entrega y enviar por correo. Lo usan «Documentos por firmar»,
 * «Certificados» y el panel de cierre de la OT.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { fecha, fechaHora, hoyISO } from "@/lib/format";
import { textoModalidad } from "@/lib/informes";
import { toast, confirmar } from "@/components/ui/feedback";
import {
  ACCION_FIRMA,
  ESTADO_DOC,
  MEDIOS_ENTREGA,
  abrirPdf,
  htmlDocumento,
  nombresResponsables,
  textoMedio,
} from "@/lib/documentos";
import Modal from "./Modal";

type Dialogo = null | "devolver" | "anular" | "entregar" | "correo" | "despachar";

/** Destinos del despacho (EP-01 6.3, EP-05 8.1; «Remitir a DCO» del BPCH). */
const DESTINOS: { valor: string; texto: string }[] = [
  { valor: "DCO", texto: "Departamento Comercial (DCO)" },
  { valor: "LAB_SOLICITANTE", texto: "Laboratorio solicitante" },
  { valor: "BPCH", texto: "Banco de Pruebas (BPCH)" },
  { valor: "CLIENTE", texto: "Cliente (directo)" },
];
const textoDestino = (v?: string | null) => DESTINOS.find((d) => d.valor === v)?.texto ?? v ?? "—";

export default function PanelDocumento({
  documentoId,
  onCambio,
  vistaPreviaInicial = false,
}: {
  documentoId: string;
  onCambio?: () => void;
  vistaPreviaInicial?: boolean;
}) {
  const [doc, setDoc] = useState<any>(null);
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [html, setHtml] = useState<string | null>(null);
  const [verPrevia, setVerPrevia] = useState(vistaPreviaInicial);
  const [dialogo, setDialogo] = useState<Dialogo>(null);

  // formularios de los diálogos
  const [motivo, setMotivo] = useState("");
  const [entrega, setEntrega] = useState({ fecha: "", medio: "", destinatario: "", observacion: "", guia: "", ejemplares: "", copias: "", oficioId: "", devolucion: "" });
  const [despacho, setDespacho] = useState({
    destino: "DCO", unidadDestinoId: "", fecha: "", ejemplares: "1", distribucion: "", copiaArchivada: true,
    archivoUbicacion: "", retencionMeses: "", oficioId: "", observacion: "",
  });
  const [labs, setLabs] = useState<{ id: string; codigo: string; nombre: string }[]>([]);
  const [correo, setCorreo] = useState({ destinatarios: "", mensaje: "" });

  const cargar = useCallback(async () => {
    setError("");
    try {
      setDoc(await api.getRaw(`informes/${documentoId}/circuito`));
    } catch (e: any) {
      setError(e.message);
    }
  }, [documentoId]);

  useEffect(() => {
    setDoc(null);
    setHtml(null);
    setVerPrevia(vistaPreviaInicial);
    cargar();
  }, [cargar, vistaPreviaInicial]);

  useEffect(() => {
    if (!verPrevia || html !== null) return;
    htmlDocumento(documentoId).then(setHtml).catch((e) => setError(e.message));
  }, [verPrevia, html, documentoId]);

  const tras = async (texto: string, r: any) => {
    setDoc(r?.documento ?? r);
    setHtml(null);
    toast.ok(texto);
    onCambio?.();
  };

  async function accion(fn: () => Promise<any>, texto: string) {
    setOcupado(true);
    try {
      await tras(texto, await fn());
      setDialogo(null);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  }

  async function firmar() {
    const ok = await confirmar({
      titulo: `¿Firmar ${doc.numero}?`,
      mensaje: "Su firma queda registrada con fecha y hora y se estampa en el documento. Revise antes la vista previa.",
      confirmarTexto: "Firmar",
    });
    if (ok) accion(() => api.post(`/informes/${documentoId}/firmar`, {}), `Documento ${doc.numero} firmado.`);
  }

  async function reemitir() {
    const ok = await confirmar({
      titulo: `¿Reemitir ${doc.numero} como nueva versión?`,
      mensaje: "Se genera una nueva versión con los datos actuales de la OT y vuelve a pasar por todas las firmas.",
      confirmarTexto: "Reemitir",
    });
    if (!ok) return;
    setOcupado(true);
    try {
      const r: any = await api.post(`/informes/${documentoId}/reemitir`, {});
      toast.ok(`Nueva versión ${r.numero} emitida: queda en firma.`);
      onCambio?.();
      await cargar();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  }

  async function enviarCorreo() {
    setOcupado(true);
    try {
      const r: any = await api.post(`/informes/${documentoId}/enviar-correo`, {
        destinatarios: correo.destinatarios,
        ...(correo.mensaje.trim() ? { mensaje: correo.mensaje.trim() } : {}),
      });
      if (r.ok) {
        await tras(`Enviado a ${r.destinatarios.join(", ")}. Entrega registrada.`, r);
        setDialogo(null);
      } else {
        toast.error(r.error ?? "No se pudo enviar el correo.");
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  }

  async function despachar() {
    setOcupado(true);
    try {
      // Distribución: una línea por destinatario; un número al final son sus ejemplares.
      const distribucion = despacho.distribucion
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const m = l.match(/^(.*?)[\s:;,-]+(\d{1,2})$/);
          return m ? { destinatario: m[1].trim(), ejemplares: Number(m[2]) } : { destinatario: l, ejemplares: 1 };
        });
      await api.post(`/informes/${documentoId}/despachar`, {
        destino: despacho.destino,
        ...(despacho.destino === "LAB_SOLICITANTE" && despacho.unidadDestinoId ? { unidadDestinoId: despacho.unidadDestinoId } : {}),
        ...(despacho.fecha ? { fecha: despacho.fecha } : {}),
        ejemplares: Number(despacho.ejemplares),
        ...(distribucion.length ? { distribucion } : {}),
        copiaArchivada: despacho.copiaArchivada,
        ...(despacho.archivoUbicacion.trim() ? { archivoUbicacion: despacho.archivoUbicacion.trim() } : {}),
        ...(despacho.retencionMeses ? { retencionMeses: Number(despacho.retencionMeses) } : {}),
        ...(despacho.oficioId ? { oficioId: despacho.oficioId } : {}),
        ...(despacho.observacion.trim() ? { observacion: despacho.observacion.trim() } : {}),
      });
      toast.ok(`Documento ${doc.numero} despachado a ${textoDestino(despacho.destino)}.`);
      setDialogo(null);
      onCambio?.();
      await cargar();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  }

  async function recibirDespacho() {
    setOcupado(true);
    try {
      await api.post(`/informes/${documentoId}/despacho/recibir`, {});
      toast.ok("Despacho recibido.");
      onCambio?.();
      await cargar();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  }

  if (error && !doc) return <div className="alert warn">{error}</div>;
  if (!doc) return <p className="subtitle">Cargando documento…</p>;

  const est = ESTADO_DOC[doc.estado] ?? { texto: doc.estado, pill: "gray" };
  const p = doc.puedo ?? {};
  const seg = doc.seguimiento ?? { despacho: null, entrega: null, oficios: [] };
  const oficiosFirmados = (seg.oficios ?? []).filter((o: any) => o.estado === "firmado" || o.estado === "despachado");

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>
            <span className="codigo">{doc.numero}</span>{" "}
            <span className={`pill ${est.pill}`}>{est.texto}</span>
            {doc.version > 1 && <span className="tag" style={{ marginLeft: 6 }}>versión {doc.version}</span>}
            {textoModalidad(doc.modalidad, doc.tipoDocumento) && <span className="tag" style={{ marginLeft: 6 }}>{textoModalidad(doc.modalidad, doc.tipoDocumento)}</span>}
          </div>
          <div className="subtitle" style={{ margin: "4px 0 0" }}>
            {doc.plantilla?.nombre ?? doc.tipo} · OT{" "}
            {doc.ot ? <Link href={`/ot/${doc.ot.id}` as any} style={{ color: "var(--accent)" }}>{doc.ot.codigo}</Link> : "—"}
            {doc.ot?.cliente ? ` · ${doc.ot.cliente}` : ""} · emitido el {fecha(doc.fecha)}
            {doc.oficialAt ? ` · oficial el ${fechaHora(doc.oficialAt)}` : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button className="btn outline sm" onClick={() => setVerPrevia((v) => !v)}>
            {verPrevia ? "Ocultar vista previa" : "Vista previa"}
          </button>
          <button
            className="btn outline sm"
            disabled={ocupado}
            onClick={() => abrirPdf(documentoId, doc.numero).catch((e) => toast.error(e.message))}
          >
            PDF
          </button>
        </div>
      </div>

      {doc.estado === "devuelto" && (
        <div className="alert warn" style={{ marginTop: 10 }}>
          Devuelto el {fechaHora(doc.devueltoAt)}. Motivo: <b>{doc.devueltoMotivo}</b>. Corrija lo indicado y reemita el documento.
        </div>
      )}
      {doc.estado === "anulado" && (
        <div className="alert warn" style={{ marginTop: 10 }}>
          Anulado el {fechaHora(doc.anuladoAt)}. Motivo: <b>{doc.anuladoMotivo}</b>
          {doc.reemplazadoPor ? <> · Sustituido por <b>{doc.reemplazadoPor.numero}</b>.</> : null}
        </div>
      )}
      {doc.estado === "en_firma" && doc.puedo?.motivoNoFirmar && !p.firmar && (
        <div className="alert info" style={{ marginTop: 10 }}>{doc.puedo.motivoNoFirmar}</div>
      )}

      {/* Pasos de firma */}
      <table className="data" style={{ marginTop: 12 }}>
        <thead>
          <tr><th>#</th><th>Acción</th><th>Rol · unidad</th><th>Responsables</th><th>Estado</th></tr>
        </thead>
        <tbody>
          {doc.pasos.map((x: any) => {
            const actual = doc.pasoActual?.some((a: any) => a.id === x.id);
            return (
              <tr key={x.id} style={actual ? { background: "#fff8e8" } : undefined}>
                <td>{x.orden}</td>
                <td>{ACCION_FIRMA[x.accion] ?? x.accion}</td>
                <td>{x.rolNombre ?? x.rolCodigo}{x.unidadCodigo ? ` · ${x.unidadCodigo}` : ""}</td>
                <td style={{ fontSize: 11.5 }}>{nombresResponsables(x.responsables) || "—"}</td>
                <td style={{ fontSize: 11.5 }}>
                  {x.estado === "firmado" ? (
                    <>
                      <span className="pill green">Firmado</span> {x.firmanteNombre}
                      <div style={{ color: "var(--muted)" }}>{fechaHora(x.firmadoAt)}{x.via === "subrogante" ? " · como subrogante" : ""}</div>
                    </>
                  ) : x.estado === "devuelto" ? (
                    <><span className="pill red">Devuelto</span> <div style={{ color: "var(--muted)" }}>{x.motivo}</div></>
                  ) : x.estado === "anulado" ? (
                    <span className="pill gray">Sin efecto</span>
                  ) : actual ? (
                    <span className="pill amber">Le toca firmar</span>
                  ) : (
                    <span className="pill gray">Pendiente</span>
                  )}
                </td>
              </tr>
            );
          })}
          {!doc.pasos.length && (
            <tr><td colSpan={5} style={{ color: "var(--muted)" }}>Documento emitido antes del circuito de firma: sin pasos registrados.</td></tr>
          )}
        </tbody>
      </table>

      {/* Entrega */}
      {doc.oficial && (
        <div style={{ marginTop: 10, fontSize: 12 }}>
          {doc.entregadoAt ? (
            <span>
              <span className="pill green">Entregado</span> el {fecha(doc.entregadoAt)} · {textoMedio(doc.entregaMedio)} · a{" "}
              <b>{doc.entregaDestinatario}</b>{doc.entregaObservacion ? ` · ${doc.entregaObservacion}` : ""}
            </span>
          ) : (
            <span><span className="pill amber">Sin entregar</span> Registre la entrega al cliente para poder cerrar la OT.</span>
          )}
        </div>
      )}

      {/* Despacho y oficio conductor (EP-01 6.3, EP-05 7.2 y 8.1) */}
      {doc.oficial && (seg.despacho || (seg.oficios ?? []).length > 0 || seg.entrega?.guia) && (
        <div style={{ marginTop: 8, fontSize: 12, display: "grid", gap: 4 }}>
          {seg.despacho && (
            <span>
              <span className={`pill ${seg.despacho.recibidoAt ? "green" : "amber"}`}>{seg.despacho.recibidoAt ? "Despacho recibido" : "Despachado"}</span>{" "}
              a <b>{textoDestino(seg.despacho.destino)}{seg.despacho.unidadDestino ? ` · ${seg.despacho.unidadDestino}` : ""}</b> el {fecha(seg.despacho.fecha)} ·{" "}
              {seg.despacho.ejemplares} ejemplar{seg.despacho.ejemplares === 1 ? "" : "es"}
              {seg.despacho.copiaArchivada ? ` · copia archivada${seg.despacho.archivoUbicacion ? ` en ${seg.despacho.archivoUbicacion}` : ""}` : ""}
              {seg.despacho.oficioNumero ? ` · oficio ${seg.despacho.oficioNumero}` : ""}
              {seg.despacho.recibidoAt ? ` · recibido el ${fechaHora(seg.despacho.recibidoAt)}${seg.despacho.recibidoPor ? ` por ${seg.despacho.recibidoPor}` : ""}` : ""}
            </span>
          )}
          {seg.entrega?.guia && (
            <span>
              Guía Nº <b>{seg.entrega.guia}</b>{seg.entrega.ejemplares ? ` · ${seg.entrega.ejemplares} ejemplar(es)` : ""}{seg.entrega.copias ? ` · copias: ${seg.entrega.copias}` : ""}
            </span>
          )}
          {(seg.oficios ?? []).map((o: any) => (
            <span key={o.id}>
              Oficio conductor <Link href={`/oficios/${o.id}` as any} style={{ color: "var(--accent)" }}>{o.numero ?? "(borrador)"}</Link> · {String(o.estado).replace("_", " ")} · a {o.destinatario}
            </span>
          ))}
        </div>
      )}

      {/* Acciones */}
      <div className="toolbar" style={{ marginTop: 12, marginBottom: 0, flexWrap: "wrap" }}>
        {p.firmar && (
          <>
            <button className="btn success" disabled={ocupado} onClick={firmar}>Firmar</button>
            <button className="btn outline" disabled={ocupado} onClick={() => { setMotivo(""); setDialogo("devolver"); }}>Devolver</button>
          </>
        )}
        {p.entregar && (
          <>
            <button className="btn primary" disabled={ocupado} onClick={() => {
              setEntrega({ fecha: hoyISO(), medio: "", destinatario: "", observacion: "", guia: "", ejemplares: "", copias: "", oficioId: oficiosFirmados[0]?.id ?? "", devolucion: "" });
              setDialogo("entregar");
            }}>Registrar entrega</button>
            <button className="btn outline" disabled={ocupado} onClick={() => {
              setCorreo({ destinatarios: doc.ot?.emailCliente ?? "", mensaje: "" });
              setDialogo("correo");
            }}>Enviar por correo</button>
          </>
        )}
        {p.despachar && (
          <button className="btn outline" disabled={ocupado} onClick={() => {
            setDespacho({
              destino: "DCO", unidadDestinoId: "", fecha: hoyISO(), ejemplares: "1", distribucion: "", copiaArchivada: true,
              archivoUbicacion: "", retencionMeses: "", oficioId: oficiosFirmados[0]?.id ?? "", observacion: "",
            });
            if (!labs.length) api.getRaw("ot/laboratorios").then((r: any) => setLabs(Array.isArray(r) ? r : r?.data ?? [])).catch(() => undefined);
            setDialogo("despachar");
          }}>Despachar →</button>
        )}
        {p.recibirDespacho && <button className="btn outline" disabled={ocupado} onClick={recibirDespacho}>Dar por recibido el despacho</button>}
        {p.oficio && !(seg.oficios ?? []).length && (
          <Link href={`/oficios/nuevo?documento=${documentoId}${doc.ot?.id ? `&ot=${doc.ot.id}` : ""}` as any} className="btn outline">Oficio conductor…</Link>
        )}
        {p.reemitir && <button className="btn outline" disabled={ocupado} onClick={reemitir}>Reemitir nueva versión</button>}
        <span className="spacer" />
        {p.anular && <button className="btn ghost-danger" disabled={ocupado} onClick={() => { setMotivo(""); setDialogo("anular"); }}>Anular</button>}
      </div>

      {verPrevia && (
        <div style={{ marginTop: 12 }}>
          {html === null ? (
            <p className="subtitle">Generando vista previa…</p>
          ) : (
            // sandbox sin scripts (los datos ya van escapados en el servidor). «allow-same-origin»
            // solo para medir el alto y mostrar el documento completo, firmas incluidas (D02-20).
            <iframe
              title={`Vista previa de ${doc.numero}`}
              srcDoc={html}
              sandbox="allow-same-origin"
              onLoad={(e) => {
                const f = e.currentTarget;
                const alto = f.contentDocument?.documentElement?.scrollHeight ?? 0;
                if (alto > 0) f.style.height = `${Math.min(Math.max(alto + 24, 640), 6000)}px`;
              }}
              style={{ width: "100%", height: 640, border: "1px solid var(--line)", borderRadius: 6, background: "#fff" }}
            />
          )}
        </div>
      )}

      {(dialogo === "devolver" || dialogo === "anular") && (
        <Modal
          titulo={dialogo === "devolver" ? `Devolver ${doc.numero}` : `Anular ${doc.numero}`}
          onCerrar={() => setDialogo(null)}
          acciones={
            <>
              <button className="btn outline" onClick={() => setDialogo(null)}>Cancelar</button>
              <button
                className={dialogo === "anular" ? "btn danger" : "btn primary"}
                disabled={ocupado || motivo.trim().length < 5}
                onClick={() =>
                  accion(
                    () => api.post(`/informes/${documentoId}/${dialogo}`, { motivo: motivo.trim() }),
                    dialogo === "devolver" ? `Documento ${doc.numero} devuelto.` : `Documento ${doc.numero} anulado.`,
                  )
                }
              >
                {dialogo === "devolver" ? "Devolver" : "Anular documento"}
              </button>
            </>
          }
        >
          <p style={{ marginTop: 0 }}>
            {dialogo === "devolver"
              ? "El documento deja de estar en firma y vuelve a quien lo emitió para que lo corrija y lo reemita. Indique qué debe corregirse."
              : "El documento deja de tener validez (la verificación pública lo mostrará anulado). Podrá reemitirlo como nueva versión."}
          </p>
          <div className="field">
            <label>Motivo <span className="req">*</span></label>
            <textarea rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={1000} />
          </div>
        </Modal>
      )}

      {dialogo === "entregar" && (
        <Modal
          titulo={`Registrar entrega de ${doc.numero}`}
          onCerrar={() => setDialogo(null)}
          acciones={
            <>
              <button className="btn outline" onClick={() => setDialogo(null)}>Cancelar</button>
              <button
                className="btn primary"
                disabled={ocupado || !entrega.medio || entrega.destinatario.trim().length < 2}
                onClick={() =>
                  accion(
                    () =>
                      api.post(`/informes/${documentoId}/entregar`, {
                        medio: entrega.medio,
                        destinatario: entrega.destinatario.trim(),
                        ...(entrega.fecha ? { fecha: entrega.fecha } : {}),
                        ...(entrega.observacion.trim() ? { observacion: entrega.observacion.trim() } : {}),
                        ...(entrega.guia.trim() ? { guia: entrega.guia.trim() } : {}),
                        ...(entrega.ejemplares ? { ejemplares: Number(entrega.ejemplares) } : {}),
                        ...(entrega.copias.trim() ? { copias: entrega.copias.trim() } : {}),
                        ...(entrega.oficioId ? { oficioId: entrega.oficioId } : {}),
                        ...(entrega.devolucion ? { devolucionMuestras: entrega.devolucion === "si" } : {}),
                      }),
                    `Entrega de ${doc.numero} registrada.`,
                  )
                }
              >
                Registrar entrega
              </button>
            </>
          }
        >
          <div className="form-grid">
            <div className="field"><label>Fecha de entrega</label><input type="date" value={entrega.fecha} max={hoyISO()} onChange={(e) => setEntrega({ ...entrega, fecha: e.target.value })} /></div>
            <div className="field">
              <label>Medio <span className="req">*</span></label>
              <select value={entrega.medio} onChange={(e) => setEntrega({ ...entrega, medio: e.target.value })}>
                <option value="">— Seleccione —</option>
                {MEDIOS_ENTREGA.map((m) => <option key={m.valor} value={m.valor}>{m.texto}</option>)}
              </select>
            </div>
            <div className="field span-2"><label>Entregado a <span className="req">*</span></label><input value={entrega.destinatario} maxLength={200} onChange={(e) => setEntrega({ ...entrega, destinatario: e.target.value })} /></div>
            <div className="field"><label>Nº de guía (courier o despacho)</label><input value={entrega.guia} maxLength={60} onChange={(e) => setEntrega({ ...entrega, guia: e.target.value })} /></div>
            <div className="field"><label>Nº de ejemplares</label><input type="number" min={1} max={50} value={entrega.ejemplares} onChange={(e) => setEntrega({ ...entrega, ejemplares: e.target.value })} /></div>
            <div className="field"><label>Copias (laboratorio, DCO…)</label><input value={entrega.copias} maxLength={200} onChange={(e) => setEntrega({ ...entrega, copias: e.target.value })} /></div>
            <div className="field">
              <label>Oficio conductor</label>
              <select value={entrega.oficioId} onChange={(e) => setEntrega({ ...entrega, oficioId: e.target.value })}>
                <option value="">— Sin oficio —</option>
                {oficiosFirmados.map((o: any) => <option key={o.id} value={o.id}>{o.numero}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Devolución de muestras solicitada</label>
              <select value={entrega.devolucion} onChange={(e) => setEntrega({ ...entrega, devolucion: e.target.value })}>
                <option value="">— No indica —</option>
                <option value="si">Sí</option>
                <option value="no">No</option>
              </select>
            </div>
            <div className="field span-2"><label>Observación</label><input value={entrega.observacion} maxLength={1000} onChange={(e) => setEntrega({ ...entrega, observacion: e.target.value })} /></div>
          </div>
        </Modal>
      )}

      {dialogo === "despachar" && (
        <Modal
          titulo={`Despachar ${doc.numero}`}
          onCerrar={() => setDialogo(null)}
          acciones={
            <>
              <button className="btn outline" onClick={() => setDialogo(null)}>Cancelar</button>
              <button
                className="btn primary"
                disabled={ocupado || !despacho.ejemplares || !despacho.fecha || (despacho.destino === "LAB_SOLICITANTE" && !despacho.unidadDestinoId)}
                onClick={despachar}
              >
                Despachar →
              </button>
            </>
          }
        >
          <p style={{ marginTop: 0 }}>
            El documento oficial sale del laboratorio a su destino. El DCO (o el laboratorio solicitante) lo da por recibido y luego registra la entrega al cliente.
          </p>
          <div className="form-grid">
            <div className="field">
              <label>Destino <span className="req">*</span></label>
              <select value={despacho.destino} onChange={(e) => setDespacho({ ...despacho, destino: e.target.value })}>
                {DESTINOS.map((d) => <option key={d.valor} value={d.valor}>{d.texto}</option>)}
              </select>
            </div>
            {despacho.destino === "LAB_SOLICITANTE" ? (
              <div className="field">
                <label>Laboratorio solicitante <span className="req">*</span></label>
                <select value={despacho.unidadDestinoId} onChange={(e) => setDespacho({ ...despacho, unidadDestinoId: e.target.value })}>
                  <option value="">— Seleccione —</option>
                  {labs.map((u) => <option key={u.id} value={u.id}>{u.codigo} · {u.nombre}</option>)}
                </select>
              </div>
            ) : <div />}
            <div className="field"><label>Fecha de despacho <span className="req">*</span></label><input type="date" value={despacho.fecha} max={hoyISO()} onChange={(e) => setDespacho({ ...despacho, fecha: e.target.value })} /></div>
            <div className="field"><label>Nº de ejemplares <span className="req">*</span></label><input type="number" min={1} max={50} value={despacho.ejemplares} onChange={(e) => setDespacho({ ...despacho, ejemplares: e.target.value })} /></div>
            <div className="field span-2">
              <label>Distribución (una línea por destinatario, con sus ejemplares al final)</label>
              <textarea rows={2} value={despacho.distribucion} maxLength={2000} onChange={(e) => setDespacho({ ...despacho, distribucion: e.target.value })} />
            </div>
            <div className="field">
              <label><input type="checkbox" checked={despacho.copiaArchivada} onChange={(e) => setDespacho({ ...despacho, copiaArchivada: e.target.checked })} /> Copia archivada en el laboratorio</label>
            </div>
            <div className="field"><label>Ubicación de la copia</label><input value={despacho.archivoUbicacion} maxLength={200} onChange={(e) => setDespacho({ ...despacho, archivoUbicacion: e.target.value })} /></div>
            <div className="field"><label>Retención de la copia (meses)</label><input type="number" min={1} max={600} value={despacho.retencionMeses} onChange={(e) => setDespacho({ ...despacho, retencionMeses: e.target.value })} /></div>
            <div className="field">
              <label>Oficio conductor</label>
              <select value={despacho.oficioId} onChange={(e) => setDespacho({ ...despacho, oficioId: e.target.value })}>
                <option value="">— Sin oficio —</option>
                {(seg.oficios ?? []).map((o: any) => <option key={o.id} value={o.id}>{o.numero ?? "(borrador)"} · {o.estado}</option>)}
              </select>
            </div>
            <div className="field span-2"><label>Observación</label><input value={despacho.observacion} maxLength={1000} onChange={(e) => setDespacho({ ...despacho, observacion: e.target.value })} /></div>
          </div>
        </Modal>
      )}

      {dialogo === "correo" && (
        <Modal
          titulo={`Enviar ${doc.numero} por correo`}
          onCerrar={() => setDialogo(null)}
          acciones={
            <>
              <button className="btn outline" onClick={() => setDialogo(null)}>Cancelar</button>
              <button className="btn primary" disabled={ocupado || !correo.destinatarios.trim()} onClick={enviarCorreo}>
                {ocupado ? "Enviando…" : "Enviar"}
              </button>
            </>
          }
        >
          <p style={{ marginTop: 0 }}>
            Se envía el PDF oficial con la configuración de correo del LIMS. Si el envío sale bien, la entrega queda registrada
            (medio «correo»). Si el correo no está configurado, registre la entrega a mano.
          </p>
          <div className="field"><label>Destinatarios <span className="req">*</span></label><input value={correo.destinatarios} onChange={(e) => setCorreo({ ...correo, destinatarios: e.target.value })} placeholder="separados por coma" /></div>
          <div className="field"><label>Mensaje adicional</label><textarea rows={3} value={correo.mensaje} maxLength={2000} onChange={(e) => setCorreo({ ...correo, mensaje: e.target.value })} /></div>
        </Modal>
      )}
    </div>
  );
}
