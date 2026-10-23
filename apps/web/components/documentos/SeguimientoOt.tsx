"use client";

/**
 * SeguimientoOt · «Seguimiento y envío» en la pestaña «Informe y cierre» de la OT
 * (frente r4c · docs/FLUJO_AVISOS_DESPACHO_OFICIO.md):
 *   1. Plazo al cliente (EP-00 4.3): «Notificar plazo al cliente →».
 *   2. Recepción en DCO (EP-00 6.3): fecha, días de atraso o a favor y estado
 *      «Terminado dentro/fuera de plazo». «Registrar recepción → enviar al cliente».
 *   3. Documentos y envío (EP-00 6.4, EP-06 6.18): documentos no-informe (cartas,
 *      oficios, copias) con versión y archivo, y el envío conjunto de documentos y
 *      factura (por correo adjunta los PDF). «Registrar envío».
 * API: GET /ot/:id/seguimiento, POST notificar-plazo, recepcion-dco, documentos-registro, envios.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { llamar } from "@/lib/laboratorio";
import { fechaDia, fechaHora, hoyISO } from "@/lib/format";
import { toast } from "@/components/ui/feedback";
import Modal from "./Modal";
import { subirFormulario } from "@/lib/d11";

const MEDIOS_ENVIO = [
  { valor: "correo", texto: "Correo electrónico (adjunta los PDF)" },
  { valor: "mano", texto: "Entrega en mano" },
  { valor: "oficio", texto: "Oficio" },
  { valor: "oficina_partes", texto: "Oficina de partes" },
  { valor: "courier", texto: "Courier" },
  { valor: "libro", texto: "Libro de entrega" },
  { valor: "plataforma", texto: "Plataforma" },
  { valor: "otro", texto: "Otro" },
];
const TIPOS_REGISTRO = ["CARTA", "OFICIO", "CERTIFICADO", "INFORME", "IVC", "PLANILLA", "ACTA", "OTRO"];
const CORREO: Record<string, string> = {
  enviado: "Correo enviado",
  error: "El correo falló",
  sin_configurar: "El correo del LIMS no está configurado",
  sin_correo: "Sin correo de destino",
  no_aplica: "",
};


type Dialogo = null | "plazo" | "recepcion" | "registro" | "envio";

export default function SeguimientoOt({ otId, onCambio }: { otId: string; onCambio?: () => void }) {
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState("");
  const [dialogo, setDialogo] = useState<Dialogo>(null);
  const [ocupado, setOcupado] = useState(false);
  const [plazo, setPlazo] = useState({ medio: "correo", destinatarios: "", mensaje: "" });
  const [recepcion, setRecepcion] = useState("");
  const [registro, setRegistro] = useState<{ tipo: string; numero: string; copias: string; fecha: string; descripcion: string; archivo: File | null }>({
    tipo: "CARTA", numero: "", copias: "1", fecha: "", descripcion: "", archivo: null,
  });
  const [envio, setEnvio] = useState<{ medio: string; fecha: string; destinatario: string; correos: string; mensaje: string; guia: string; observacion: string; docs: string[]; registros: string[]; oficios: string[]; factura: boolean }>({
    medio: "", fecha: "", destinatario: "", correos: "", mensaje: "", guia: "", observacion: "", docs: [], registros: [], oficios: [], factura: false,
  });

  const cargar = useCallback(async () => {
    try {
      setD(await llamar("GET", `/ot/${otId}/seguimiento`));
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }, [otId]);
  useEffect(() => {
    cargar();
  }, [cargar]);

  async function enviar(fn: () => Promise<any>, ok: (r: any) => string) {
    setOcupado(true);
    try {
      const r = await fn();
      if (r?.error) toast.error(`${CORREO[r.correo] ?? "El correo falló"}: ${r.error}`);
      else toast.ok(ok(r));
      setD(r);
      setDialogo(null);
      onCambio?.();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  }

  if (error && !d) return null;
  if (!d) return null;
  const oficiales = d.documentos.filter((x: any) => ["oficial", "emitido"].includes(x.estado));
  const cerrada = ["cerrada", "anulada"].includes(d.ot.estado);
  const alternar = (k: "docs" | "registros" | "oficios", id: string) =>
    setEnvio((e) => ({ ...e, [k]: e[k].includes(id) ? e[k].filter((x) => x !== id) : [...e[k], id] }));

  return (
    <section style={{ display: "grid", gap: 14, marginBottom: 14 }} aria-labelledby="tit-seguimiento">
      <h2 id="tit-seguimiento" style={{ fontSize: 13, margin: 0 }}>Seguimiento y envío al cliente</h2>

      <div className="form-grid cols-2" style={{ gap: 10 }}>
        {/* 1 · Plazo */}
        <div className="card" style={{ margin: 0, padding: 10 }}>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", fontWeight: 600 }}>Plazo informado al cliente</div>
          {d.plazo.notificadoAt ? (
            <div style={{ fontSize: 12.5 }}>
              <span className="pill green">Informado</span> el {fechaHora(d.plazo.notificadoAt)} · {d.plazo.medio}
              <div style={{ color: "var(--muted)" }}>Entrega comprometida: {fechaDia(d.plazo.fechaCompromiso)}</div>
            </div>
          ) : (
            <div style={{ fontSize: 12.5 }}>
              {d.plazo.fechaCompromiso ? <>Entrega comprometida: <b>{fechaDia(d.plazo.fechaCompromiso)}</b> · aún no se informa al cliente.</> : <>Sin fecha de compromiso: el laboratorio debe asignar el plazo (arriba, «Fijar fecha»).</>}
            </div>
          )}
          {d.puedo.seguimiento && !cerrada && d.plazo.fechaCompromiso && (
            <button type="button" className="btn outline sm" style={{ marginTop: 6 }} onClick={() => { setPlazo({ medio: "correo", destinatarios: d.ot.emailCliente ?? "", mensaje: "" }); setDialogo("plazo"); }}>
              {d.plazo.notificadoAt ? "Volver a informar el plazo" : "Notificar plazo al cliente →"}
            </button>
          )}
        </div>

        {/* 2 · Recepción DCO */}
        <div className="card" style={{ margin: 0, padding: 10 }}>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", fontWeight: 600 }}>Recepción del informe en DCO</div>
          {d.recepcionDco ? (
            <div style={{ fontSize: 12.5 }}>
              Recibido el <b>{fechaDia(d.recepcionDco.fecha)}</b>{" "}
              <span className={`pill ${d.recepcionDco.dias > 0 ? "red" : "green"}`}>{d.recepcionDco.estado}</span>
              <div style={{ color: "var(--muted)" }}>{d.recepcionDco.texto}{d.envio.estado === "Enviado al cliente" ? ` · enviado al cliente el ${fechaDia(d.envio.fechaEntregaCliente)}` : ""}</div>
            </div>
          ) : (
            <div style={{ fontSize: 12.5 }}>{oficiales.length ? "El informe está oficial: registre cuándo llegó a DCO." : "Se registra cuando la OT tenga un documento oficial."}</div>
          )}
          {d.puedo.recepcionDco && !d.recepcionDco && (
            <button type="button" className="btn outline sm" style={{ marginTop: 6 }} onClick={() => { setRecepcion(hoyISO()); setDialogo("recepcion"); }}>
              Registrar recepción → enviar al cliente
            </button>
          )}
        </div>
      </div>

      {/* 3 · Documentos y envío */}
      <div>
        <h3 style={{ fontSize: 12.5, margin: "0 0 6px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          Documentos y envío
          <span style={{ fontWeight: 400, color: "var(--muted)" }}>· estado del envío: {d.envio.estado ?? "No enviado"}</span>
          <span style={{ flex: 1 }} />
          {d.puedo.carpeta && (
            <button type="button" className="btn outline sm" onClick={() => { setRegistro({ tipo: "CARTA", numero: "", copias: "1", fecha: hoyISO(), descripcion: "", archivo: null }); setDialogo("registro"); }}>
              ＋ Documento (carta, oficio, copia…)
            </button>
          )}
          {d.puedo.seguimiento && (oficiales.length > 0 || d.registros.length > 0 || d.factura) && (
            <button type="button" className="btn primary sm" onClick={() => {
              setEnvio({
                medio: "", fecha: hoyISO(), destinatario: d.ot.cliente ?? "", correos: d.ot.emailCliente ?? "", mensaje: "", guia: "", observacion: "",
                docs: oficiales.filter((x: any) => !x.entregadoAt).map((x: any) => x.id), registros: [], oficios: [], factura: false,
              });
              setDialogo("envio");
            }}>Registrar envío</button>
          )}
          {d.puedo.oficio && <Link href={`/oficios/nuevo?ot=${otId}` as any} className="btn outline sm">Oficio conductor…</Link>}
        </h3>
        {d.registros.length || d.envios.length || d.oficios.length ? (
          <div style={{ overflowX: "auto" }}>
            <table className="data">
              <thead><tr><th>Tipo</th><th>Nº</th><th>Copias</th><th>Fecha</th><th>Archivo / detalle</th></tr></thead>
              <tbody>
                {d.oficios.map((o: any) => (
                  <tr key={o.id}>
                    <td>Oficio conductor</td>
                    <td><Link href={`/oficios/${o.id}` as any} style={{ color: "var(--accent)" }}>{o.numero ?? "(borrador)"}</Link></td>
                    <td>—</td>
                    <td>{fechaDia(o.fecha)}</td>
                    <td style={{ fontSize: 11.5 }}>{o.estado}{o.despachoNumero ? ` · despacho Nº ${o.despachoNumero}` : ""} · {o.materia}</td>
                  </tr>
                ))}
                {d.registros.map((r: any) => (
                  <tr key={r.id}>
                    <td>{r.tipo}</td>
                    <td>{r.numero}{r.version > 1 ? <small style={{ color: "var(--muted)" }}> · v{r.version}</small> : null}</td>
                    <td>{r.copias}</td>
                    <td>{fechaDia(r.fecha)}</td>
                    <td style={{ fontSize: 11.5 }}>
                      {r.archivoNombre ? (
                        <button type="button" className="btn ghost sm" onClick={() => descargar(otId, r.id, r.archivoNombre)}>⬇ {r.archivoNombre}</button>
                      ) : "—"}
                      {r.descripcion ? ` · ${r.descripcion}` : ""}
                    </td>
                  </tr>
                ))}
                {d.envios.map((e: any) => (
                  <tr key={e.id}>
                    <td>Envío</td>
                    <td>{e.guia ?? "—"}</td>
                    <td>—</td>
                    <td>{fechaDia(e.fecha)}</td>
                    <td style={{ fontSize: 11.5 }}>
                      {MEDIOS_ENVIO.find((m) => m.valor === e.medio)?.texto ?? e.medio} · a {e.destinatario}: {(e.documentos ?? []).map((x: any) => x.numero).join(", ")}
                      {e.factura ? ` · factura ${e.factura}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="subtitle" style={{ margin: 0 }}>Sin documentos adicionales ni envíos registrados.</p>
        )}
      </div>

      {dialogo === "plazo" && (
        <Modal
          titulo={`Notificar plazo de la OT ${d.ot.codigo}`}
          onCerrar={() => setDialogo(null)}
          acciones={
            <>
              <button className="btn outline" onClick={() => setDialogo(null)}>Cancelar</button>
              <button
                className="btn primary"
                disabled={ocupado || (plazo.medio === "correo" && !plazo.destinatarios.trim())}
                onClick={() =>
                  enviar(
                    () =>
                      llamar("POST", `/ot/${otId}/notificar-plazo`, {
                        medio: plazo.medio,
                        ...(plazo.medio === "correo" ? { destinatarios: plazo.destinatarios.split(/[,;\s]+/).filter(Boolean) } : {}),
                        ...(plazo.mensaje.trim() ? { mensaje: plazo.mensaje.trim() } : {}),
                      }),
                    (r) => (r.correo === "enviado" ? "Plazo informado al cliente por correo." : "Aviso del plazo registrado."),
                  )
                }
              >
                Notificar plazo →
              </button>
            </>
          }
        >
          <p style={{ marginTop: 0 }}>Se informa al cliente que la entrega será a más tardar el <b>{fechaDia(d.plazo.fechaCompromiso)}</b>. Queda en el historial de la OT.</p>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="seg-1">Medio <span className="req">*</span></label>
              <select id="seg-1" value={plazo.medio} onChange={(e) => setPlazo({ ...plazo, medio: e.target.value })}>
                <option value="correo">Correo electrónico</option>
                <option value="oficio">Oficio</option>
                <option value="telefono">Teléfono</option>
                <option value="otro">Otro</option>
              </select>
            </div>
            {plazo.medio === "correo" && (
              <div className="field"><label htmlFor="seg-2">Correo del cliente <span className="req">*</span></label><input id="seg-2" value={plazo.destinatarios} onChange={(e) => setPlazo({ ...plazo, destinatarios: e.target.value })} /></div>
            )}
            <div className="field span-2"><label htmlFor="seg-3">Mensaje adicional</label><textarea id="seg-3" rows={2} maxLength={2000} value={plazo.mensaje} onChange={(e) => setPlazo({ ...plazo, mensaje: e.target.value })} /></div>
          </div>
        </Modal>
      )}

      {dialogo === "recepcion" && (
        <Modal
          titulo="Recepción del informe en DCO"
          onCerrar={() => setDialogo(null)}
          acciones={
            <>
              <button className="btn outline" onClick={() => setDialogo(null)}>Cancelar</button>
              <button className="btn primary" disabled={ocupado || !recepcion} onClick={() => enviar(() => llamar("POST", `/ot/${otId}/recepcion-dco`, { fecha: recepcion }), (r) => `Recepción registrada: ${r.recepcionDco?.estado ?? ""}.`)}>
                Registrar recepción → enviar al cliente
              </button>
            </>
          }
        >
          <p style={{ marginTop: 0 }}>Los días de atraso se calculan contra la fecha de compromiso ({d.plazo.fechaCompromiso ? fechaDia(d.plazo.fechaCompromiso) : "sin fecha"}).</p>
          <div className="field"><label htmlFor="seg-4">Fecha de recepción en DCO <span className="req">*</span></label><input id="seg-4" type="date" value={recepcion} max={hoyISO()} onChange={(e) => setRecepcion(e.target.value)} /></div>
        </Modal>
      )}

      {dialogo === "registro" && (
        <Modal
          titulo="Registrar documento de la OT"
          onCerrar={() => setDialogo(null)}
          acciones={
            <>
              <button className="btn outline" onClick={() => setDialogo(null)}>Cancelar</button>
              <button
                className="btn primary"
                disabled={ocupado || !registro.numero.trim()}
                onClick={() => {
                  if (registro.archivo && registro.archivo.size > 5_000_000) return toast.error("El archivo debe pesar como máximo 5 MB.");
                  const f = new FormData();
                  f.append("tipo", registro.tipo);
                  f.append("numero", registro.numero.trim());
                  f.append("copias", String(Number(registro.copias || 0)));
                  if (registro.fecha) f.append("fecha", registro.fecha);
                  if (registro.descripcion.trim()) f.append("descripcion", registro.descripcion.trim());
                  if (registro.archivo) f.append("archivo", registro.archivo, registro.archivo.name);
                  enviar(() => subirFormulario(`/ot/${otId}/documentos-registro`, f), () => "Documento registrado.");
                }}
              >
                Registrar documento
              </button>
            </>
          }
        >
          <p style={{ marginTop: 0 }}>Cartas, oficios en papel, copias o planillas que acompañan a la OT. Si ya existe uno con el mismo tipo y número, queda como nueva versión.</p>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="seg-5">Tipo <span className="req">*</span></label>
              <select id="seg-5" value={registro.tipo} onChange={(e) => setRegistro({ ...registro, tipo: e.target.value })}>
                {TIPOS_REGISTRO.map((t) => <option key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</option>)}
              </select>
            </div>
            <div className="field"><label htmlFor="seg-6">Nº <span className="req">*</span></label><input id="seg-6" value={registro.numero} maxLength={80} onChange={(e) => setRegistro({ ...registro, numero: e.target.value })} /></div>
            <div className="field"><label htmlFor="seg-7">Copias</label><input id="seg-7" type="number" min={0} max={50} value={registro.copias} onChange={(e) => setRegistro({ ...registro, copias: e.target.value })} /></div>
            <div className="field"><label htmlFor="seg-8">Fecha</label><input id="seg-8" type="date" value={registro.fecha} max={hoyISO()} onChange={(e) => setRegistro({ ...registro, fecha: e.target.value })} /></div>
            <div className="field span-2"><label htmlFor="seg-9">Descripción</label><input id="seg-9" value={registro.descripcion} maxLength={500} onChange={(e) => setRegistro({ ...registro, descripcion: e.target.value })} /></div>
            <div className="field span-2">
              <label htmlFor="seg-10">Archivo (PDF, imagen, Word o Excel; máx. 5 MB)</label>
              <input id="seg-10" type="file" accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx" onChange={(e) => setRegistro({ ...registro, archivo: e.target.files?.[0] ?? null })} />
            </div>
          </div>
        </Modal>
      )}

      {dialogo === "envio" && (
        <Modal
          titulo={`Registrar envío al cliente · OT ${d.ot.codigo}`}
          ancho={720}
          onCerrar={() => setDialogo(null)}
          acciones={
            <>
              <button className="btn outline" onClick={() => setDialogo(null)}>Cancelar</button>
              <button
                className="btn primary"
                disabled={ocupado || !envio.medio || envio.destinatario.trim().length < 2 || (!envio.docs.length && !envio.registros.length && !envio.oficios.length && !envio.factura) || (envio.medio === "correo" && !envio.correos.trim())}
                onClick={() =>
                  enviar(
                    () =>
                      llamar("POST", `/ot/${otId}/envios`, {
                        medio: envio.medio,
                        fecha: envio.fecha,
                        destinatario: envio.destinatario.trim(),
                        certificadoIds: envio.docs,
                        registroIds: envio.registros,
                        oficioIds: envio.oficios,
                        ...(envio.factura && d.factura ? { facturaId: d.factura.id } : {}),
                        ...(envio.guia.trim() ? { guia: envio.guia.trim() } : {}),
                        ...(envio.observacion.trim() ? { observacion: envio.observacion.trim() } : {}),
                        ...(envio.medio === "correo"
                          ? { correo: { destinatarios: envio.correos.split(/[,;\s]+/).filter(Boolean), ...(envio.mensaje.trim() ? { mensaje: envio.mensaje.trim() } : {}) } }
                          : {}),
                      }),
                    (r) => (r.correo === "enviado" ? "Enviado por correo y registrado." : "Envío registrado."),
                  )
                }
              >
                Registrar envío
              </button>
            </>
          }
        >
          <p style={{ marginTop: 0 }}>Los documentos oficiales que aún no tenían entrega quedan entregados con este envío. La OT pasa a «Enviado al cliente».</p>
          <fieldset style={{ border: "1px solid var(--line)", borderRadius: 6, padding: 8, marginBottom: 10 }}>
            <legend style={{ fontSize: 12, fontWeight: 600 }}>Qué se envía</legend>
            {oficiales.map((x: any) => (
              <label key={x.id} style={{ display: "block", fontSize: 12.5 }}>
                <input type="checkbox" checked={envio.docs.includes(x.id)} onChange={() => alternar("docs", x.id)} /> {x.numero} · {x.plantilla ?? x.tipoDocumento ?? "documento"}{x.entregadoAt ? " (ya entregado)" : ""}
              </label>
            ))}
            {d.oficios.filter((o: any) => ["firmado", "despachado"].includes(o.estado)).map((o: any) => (
              <label key={o.id} style={{ display: "block", fontSize: 12.5 }}>
                <input type="checkbox" checked={envio.oficios.includes(o.id)} onChange={() => alternar("oficios", o.id)} /> Oficio {o.numero}
              </label>
            ))}
            {d.registros.map((r: any) => (
              <label key={r.id} style={{ display: "block", fontSize: 12.5 }}>
                <input type="checkbox" checked={envio.registros.includes(r.id)} onChange={() => alternar("registros", r.id)} /> {r.tipo} {r.numero}{r.version > 1 ? ` v${r.version}` : ""}
              </label>
            ))}
            {d.factura && (
              <label style={{ display: "block", fontSize: 12.5 }}>
                <input type="checkbox" checked={envio.factura} disabled={d.factura.estado === "pendiente"} onChange={() => setEnvio({ ...envio, factura: !envio.factura })} /> Factura {d.factura.numero}
                {d.factura.estado === "pendiente" ? " (aún no emitida por Finanzas)" : ""}
              </label>
            )}
          </fieldset>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="seg-11">Medio <span className="req">*</span></label>
              <select id="seg-11" value={envio.medio} onChange={(e) => setEnvio({ ...envio, medio: e.target.value })}>
                <option value="">— Seleccione —</option>
                {MEDIOS_ENVIO.map((m) => <option key={m.valor} value={m.valor}>{m.texto}</option>)}
              </select>
            </div>
            <div className="field"><label htmlFor="seg-12">Fecha <span className="req">*</span></label><input id="seg-12" type="date" value={envio.fecha} max={hoyISO()} onChange={(e) => setEnvio({ ...envio, fecha: e.target.value })} /></div>
            <div className="field span-2"><label htmlFor="seg-13">Destinatario <span className="req">*</span></label><input id="seg-13" value={envio.destinatario} maxLength={300} onChange={(e) => setEnvio({ ...envio, destinatario: e.target.value })} /></div>
            {envio.medio === "correo" && (
              <>
                <div className="field span-2"><label htmlFor="seg-14">Correos <span className="req">*</span></label><input id="seg-14" value={envio.correos} onChange={(e) => setEnvio({ ...envio, correos: e.target.value })} /></div>
                <div className="field span-2"><label htmlFor="seg-15">Mensaje</label><textarea id="seg-15" rows={2} maxLength={2000} value={envio.mensaje} onChange={(e) => setEnvio({ ...envio, mensaje: e.target.value })} /></div>
              </>
            )}
            <div className="field"><label htmlFor="seg-16">Nº de guía</label><input id="seg-16" value={envio.guia} maxLength={60} onChange={(e) => setEnvio({ ...envio, guia: e.target.value })} /></div>
            <div className="field"><label htmlFor="seg-17">Observación</label><input id="seg-17" value={envio.observacion} maxLength={1000} onChange={(e) => setEnvio({ ...envio, observacion: e.target.value })} /></div>
          </div>
        </Modal>
      )}
    </section>
  );
}

async function descargar(otId: string, registroId: string, nombre: string) {
  const API = process.env.NEXT_PUBLIC_API_URL ?? "/api";
  const r = await fetch(`${API}/ot/${otId}/documentos-registro/${registroId}/archivo`, {
    headers: { Authorization: `Bearer ${localStorage.getItem("lims_token")}` },
  });
  if (!r.ok) return toast.error(`No se pudo descargar (${r.status}).`);
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
