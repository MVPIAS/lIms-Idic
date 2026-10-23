"use client";

/**
 * Ficha del oficio conductor: pasos 1 Elaborar · 2 V°B° · 3 Firma · 4 Despacho,
 * datos (editables en borrador o devuelto), documentos que conduce, circuito de
 * la matriz OFICIO con quién firmó y cuándo, y la bitácora en la OT.
 * Botones: «Generar oficio → firmas», «Dar V°B° → Dirección» / «Firmar», «Devolver»,
 * «Firmar y despachar» (Oficina de partes: Nº y fecha), «Anular», PDF.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import Modal from "@/components/documentos/Modal";
import { llamar } from "@/lib/laboratorio";
import { fechaDia, fechaHora, hoyISO } from "@/lib/format";
import { toast, confirmar } from "@/components/ui/feedback";
import { ACCION_OFICIO, ESTADO_OFICIO, leerDistribucion, textoDistribucion } from "@/lib/oficios";

const API = process.env.NEXT_PUBLIC_API_URL ?? "/api";

export default function OficioPage() {
  const { id } = useParams<{ id: string }>();
  const [o, setO] = useState<any>(null);
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [editar, setEditar] = useState(false);
  const [f, setF] = useState({ destinatario: "", materia: "", cuerpo: "", distribucion: "" });
  const [dialogo, setDialogo] = useState<null | "devolver" | "anular" | "despachar">(null);
  const [motivo, setMotivo] = useState("");
  const [despacho, setDespacho] = useState({ numero: "", fecha: "" });

  const cargar = useCallback(async () => {
    try {
      setO(await llamar("GET", `/oficios/${id}`));
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
      setO(await fn());
      toast.ok(ok);
      setDialogo(null);
      setEditar(false);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  }

  async function pdf() {
    const r = await fetch(`${API}/oficios/${id}/pdf`, { headers: { Authorization: `Bearer ${localStorage.getItem("lims_token")}` } });
    if (!r.ok) return toast.error(`No se pudo generar el PDF (${r.status}).`);
    window.open(URL.createObjectURL(await r.blob()), "_blank", "noopener");
  }

  if (error && !o) return <div className="alert warn" role="alert">{error}</div>;
  if (!o) return <p className="subtitle">Cargando oficio…</p>;
  const e = ESTADO_OFICIO[o.estado] ?? { texto: o.estado, pill: "gray" };
  const p = o.puedo ?? {};
  const vb = o.pasos.find((x: any) => x.accion === "VB");
  const firma = o.pasos.filter((x: any) => x.accion !== "VB").slice(-1)[0];
  const paso = (n: number, t: string, hecho: boolean, ahora: boolean) => (
    <div className={`step ${hecho ? "done" : ahora ? "now" : "locked"}`} aria-current={ahora ? "step" : undefined} style={{ cursor: "default" }}>
      <div className="dot" aria-hidden>{hecho ? "✓" : n}</div>
      <div className="txt">{t}</div>
    </div>
  );
  const vigentes = o.pasos.filter((x: any) => x.estado !== "anulado");
  const firmado = (x: any) => x?.estado === "firmado";
  const miPaso = o.pasos.find((x: any) => o.pasoActual.includes(x.id));

  return (
    <div>
      <PageHeader
        titulo={`Oficio ${o.numero ?? "(borrador)"}`}
        subtitulo={`${o.unidad.codigo} · ${o.materia}`}
        migas={[{ label: "Oficios conductores", href: "/oficios" }, { label: o.numero ?? "Borrador" }]}
        acciones={<button type="button" className="btn outline sm" onClick={pdf}>PDF</button>}
      />
      <nav className="stepper" aria-label="Avance del oficio">
        {paso(1, "Elaborar", o.estado !== "borrador", o.estado === "borrador" || o.estado === "devuelto")}
        {paso(2, "V°B° Jefe de Departamento", vb ? firmado(vigentes.find((x: any) => x.accion === "VB")) : o.estado === "firmado" || o.estado === "despachado", o.estado === "en_firma" && miPaso?.accion === "VB")}
        {paso(3, "Firma de la Dirección", o.estado === "firmado" || o.estado === "despachado", o.estado === "en_firma" && firma && miPaso?.id === firma.id)}
        {paso(4, "Despacho por Oficina de partes", o.estado === "despachado", o.estado === "firmado")}
      </nav>

      {o.estado === "devuelto" && <div className="alert warn">Devuelto: <b>{o.devueltoMotivo}</b>. Corríjalo y vuelva a enviarlo a firmas.</div>}
      {o.estado === "anulado" && <div className="alert warn">Anulado: <b>{o.anuladoMotivo}</b></div>}
      {o.estado === "en_firma" && p.motivoNoFirmar && !p.firmar && <div className="alert info">{p.motivoNoFirmar}</div>}

      <div className="card">
        <h2>
          Datos del oficio <span className={`pill ${e.pill}`} style={{ marginLeft: 8 }}>{e.texto}</span>
          <span className="right">
            {p.editar && !editar && (
              <button type="button" className="btn outline sm" onClick={() => { setF({ destinatario: o.destinatario, materia: o.materia, cuerpo: o.cuerpo ?? "", distribucion: textoDistribucion(o.distribucion) }); setEditar(true); }}>
                Corregir
              </button>
            )}
          </span>
        </h2>
        {editar ? (
          <div className="form-grid cols-2">
            <div className="field span-2"><label>Destinatario <span className="req">*</span></label><input value={f.destinatario} maxLength={300} onChange={(ev) => setF({ ...f, destinatario: ev.target.value })} /></div>
            <div className="field span-2"><label>Materia <span className="req">*</span></label><input value={f.materia} maxLength={500} onChange={(ev) => setF({ ...f, materia: ev.target.value })} /></div>
            <div className="field span-2"><label>Texto</label><textarea rows={5} maxLength={8000} value={f.cuerpo} onChange={(ev) => setF({ ...f, cuerpo: ev.target.value })} /></div>
            <div className="field span-2"><label>Distribución (una línea por destinatario, ejemplares al final)</label><textarea rows={3} maxLength={2000} value={f.distribucion} onChange={(ev) => setF({ ...f, distribucion: ev.target.value })} /></div>
            <div className="toolbar" style={{ gridColumn: "1 / -1", margin: 0 }}>
              <button type="button" className="btn outline" onClick={() => setEditar(false)}>Cancelar</button>
              <button
                type="button"
                className="btn primary"
                disabled={ocupado || f.destinatario.trim().length < 3 || f.materia.trim().length < 3}
                onClick={() =>
                  hacer(
                    () => llamar("PATCH", `/oficios/${id}`, { destinatario: f.destinatario.trim(), materia: f.materia.trim(), cuerpo: f.cuerpo, distribucion: leerDistribucion(f.distribucion) }),
                    "Oficio corregido.",
                  )
                }
              >
                Guardar
              </button>
            </div>
          </div>
        ) : (
          <div className="form-grid cols-2">
            <div className="field readonly"><label>Nº de oficio</label><input readOnly value={o.numero ?? "Se asigna al enviarlo a firmas"} /></div>
            <div className="field readonly"><label>Fecha</label><input readOnly value={fechaDia(o.fecha)} /></div>
            <div className="field readonly span-2"><label>Destinatario</label><input readOnly value={o.destinatario} /></div>
            <div className="field readonly"><label>Unidad que lo emite</label><input readOnly value={`${o.unidad.codigo} · ${o.unidad.nombre}`} /></div>
            <div className="field readonly"><label>Conduce</label><input readOnly value={o.cotizacion ? `Cotización ${o.cotizacion.codigo}` : o.ot ? `OT ${o.ot.codigo}` : "—"} /></div>
            <div className="field readonly span-2"><label>Distribución</label><input readOnly value={(o.distribucion ?? []).map((d: any) => `${d.destinatario} (${d.ejemplares})`).join(" · ") || "—"} /></div>
            {o.despacho && <div className="field readonly span-2"><label>Despacho</label><input readOnly value={`Nº ${o.despacho.numero} del ${fechaDia(o.despacho.fecha)}${o.despacho.por ? ` · ${o.despacho.por}` : ""}`} /></div>}
          </div>
        )}
        {o.documentos.length > 0 && (
          <p style={{ fontSize: 12.5, margin: "10px 0 0" }}>
            Documentos: {o.documentos.map((d: any) => `${d.numero} (${d.plantilla ?? d.tipoDocumento ?? "documento"})`).join(", ")}
            {o.ot && <> · <Link href={`/ot/${o.ot.id}?tab=informe` as any} style={{ color: "var(--accent)" }}>ver la OT</Link></>}
          </p>
        )}
      </div>

      <div className="card">
        <h2>Circuito de firmas (matriz OFICIO)</h2>
        {o.pasos.length === 0 ? (
          <p className="subtitle" style={{ margin: 0 }}>El circuito se resuelve con la matriz de firmas al enviar el oficio a firmas.</p>
        ) : (
          <table className="data">
            <thead><tr><th>#</th><th>Acción</th><th>Rol · unidad</th><th>Responsables</th><th>Estado</th></tr></thead>
            <tbody>
              {o.pasos.map((x: any) => (
                <tr key={x.id} style={o.pasoActual.includes(x.id) ? { background: "#fff8e8" } : undefined}>
                  <td>{x.orden}</td>
                  <td>{ACCION_OFICIO[x.accion] ?? x.accion}</td>
                  <td>{x.rolNombre ?? x.rolCodigo}{x.unidadCodigo ? ` · ${x.unidadCodigo}` : ""}</td>
                  <td style={{ fontSize: 11.5 }}>{(x.responsables ?? []).map((r: any) => r.nombre).join(" o ") || "—"}</td>
                  <td style={{ fontSize: 11.5 }}>
                    {x.estado === "firmado" ? <><span className="pill green">Firmado</span> {x.firmanteNombre}<div style={{ color: "var(--muted)" }}>{fechaHora(x.firmadoAt)}</div></>
                      : x.estado === "devuelto" ? <><span className="pill red">Devuelto</span><div style={{ color: "var(--muted)" }}>{x.comentario}</div></>
                        : x.estado === "anulado" ? <span className="pill gray">Sin efecto</span>
                          : o.pasoActual.includes(x.id) ? <span className="pill amber">Le toca</span> : <span className="pill gray">Pendiente</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="toolbar" style={{ marginTop: 12, marginBottom: 0, flexWrap: "wrap" }}>
          {p.generar && !editar && (
            <button type="button" className="btn primary" disabled={ocupado} onClick={() => hacer(() => llamar("POST", `/oficios/${id}/generar`), "Oficio enviado a firmas.")}>
              Generar oficio → firmas
            </button>
          )}
          {p.firmar && (
            <>
              <button type="button" className="btn success" disabled={ocupado} onClick={async () => {
                if (await confirmar({ titulo: miPaso?.accion === "VB" ? "¿Dar V°B° al oficio?" : "¿Firmar el oficio?", mensaje: "Queda registrado con fecha y hora.", confirmarTexto: miPaso?.accion === "VB" ? "Dar V°B°" : "Firmar" }))
                  hacer(() => llamar("POST", `/oficios/${id}/firmar`, {}), miPaso?.accion === "VB" ? "V°B° registrado: pasa a la Dirección." : "Oficio firmado.");
              }}>
                {miPaso?.accion === "VB" ? "Dar V°B° → Dirección" : "Firmar →"}
              </button>
              <button type="button" className="btn outline" disabled={ocupado} onClick={() => { setMotivo(""); setDialogo("devolver"); }}>Devolver</button>
            </>
          )}
          {p.despachar && (
            <button type="button" className="btn primary" disabled={ocupado} onClick={() => { setDespacho({ numero: "", fecha: hoyISO() }); setDialogo("despachar"); }}>
              Firmar y despachar
            </button>
          )}
          <span className="spacer" />
          {p.anular && <button type="button" className="btn ghost-danger" disabled={ocupado} onClick={() => { setMotivo(""); setDialogo("anular"); }}>Anular</button>}
        </div>
      </div>

      {(dialogo === "devolver" || dialogo === "anular") && (
        <Modal
          titulo={dialogo === "devolver" ? "Devolver el oficio" : "Anular el oficio"}
          onCerrar={() => setDialogo(null)}
          acciones={
            <>
              <button type="button" className="btn outline" onClick={() => setDialogo(null)}>Cancelar</button>
              <button type="button" className={dialogo === "anular" ? "btn danger" : "btn primary"} disabled={ocupado || motivo.trim().length < 5}
                onClick={() => hacer(() => llamar("POST", `/oficios/${id}/${dialogo}`, { motivo: motivo.trim() }), dialogo === "devolver" ? "Oficio devuelto a quien lo elaboró." : "Oficio anulado.")}>
                {dialogo === "devolver" ? "Devolver" : "Anular oficio"}
              </button>
            </>
          }
        >
          <div className="field"><label>Motivo <span className="req">*</span></label><textarea rows={3} maxLength={1000} value={motivo} onChange={(ev) => setMotivo(ev.target.value)} /></div>
        </Modal>
      )}
      {dialogo === "despachar" && (
        <Modal
          titulo={`Despachar el oficio ${o.numero}`}
          onCerrar={() => setDialogo(null)}
          acciones={
            <>
              <button type="button" className="btn outline" onClick={() => setDialogo(null)}>Cancelar</button>
              <button type="button" className="btn primary" disabled={ocupado || !despacho.numero.trim() || !despacho.fecha}
                onClick={() => hacer(() => llamar("POST", `/oficios/${id}/despachar`, { numero: despacho.numero.trim(), fecha: despacho.fecha }), "Oficio despachado.")}>
                Firmar y despachar
              </button>
            </>
          }
        >
          <p style={{ marginTop: 0 }}>Oficina de partes: registre el número y la fecha de despacho del oficio y de lo que conduce.</p>
          <div className="form-grid">
            <div className="field"><label>Nº de despacho <span className="req">*</span></label><input value={despacho.numero} maxLength={60} onChange={(ev) => setDespacho({ ...despacho, numero: ev.target.value })} /></div>
            <div className="field"><label>Fecha de despacho <span className="req">*</span></label><input type="date" max={hoyISO()} value={despacho.fecha} onChange={(ev) => setDespacho({ ...despacho, fecha: ev.target.value })} /></div>
          </div>
        </Modal>
      )}
    </div>
  );
}
