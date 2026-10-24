"use client";

/**
 * Ficha de la cotización · «Ruta de la cotización» (EP-00 F2–F4, frente r1c).
 * -----------------------------------------------------------------------------
 * Patrón de las maquetas y de la ficha de la OT: barra de seis etapas a la
 * izquierda (1 Elaboración · 2 Costeo del laboratorio · 3 V°B° · 4 Firma del
 * Jefe DCO · 5 Envío al cliente · 6 Aceptación y OT), recuadro «Siguiente paso ·
 * Le toca a» arriba y una pestaña por paso con su formulario y su botón
 * «Verbo → siguiente». El documento se ve renderizado con sus firmas.
 * Todo sale de GET /cotizaciones/:id/circuito: la barra y el siguiente paso los
 * deduce el servidor (circuito-cotizacion.ts) y nunca se contradicen.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { fechaDia, fechaHora, money, rut } from "@/lib/format";
import { usePermisos } from "@/lib/permisos";
import CotizacionForm from "../_components/CotizacionForm";
import { DetalleCotizacion, EstadoChip, FirmaChip, accionesDe } from "../_components/Detalle";
import { DialogoAceptacion, DialogoAnulacion } from "../_components/Dialogos";
import LaboratorioCotizacion from "../_components/LaboratorioCotizacion";
import Panel from "../_components/Panel";
import { ACEPTACION_LABEL, descargarPdfCotizacion, pedir, pedirTexto, type Opcion } from "../_components/comercial";
import { PESTANA_DE_ETAPA, TEXTO_EVENTO, TEXTO_MEDIO, type Circuito, type EstadoEtapa, type PestanaCot } from "../_components/circuito";
import { confirmar } from "@/components/ui/feedback";

const ICONO: Record<EstadoEtapa, string> = { hecho: "✓", en_curso: "", pendiente: "", no_aplica: "–", bloqueado: "!" };
const CLASE: Record<EstadoEtapa, string> = { hecho: "done", en_curso: "now", pendiente: "pend", no_aplica: "na", bloqueado: "bloq" };
const LEYENDA: Record<EstadoEtapa, string> = { hecho: "Hecho", en_curso: "Etapa actual", pendiente: "Pendiente", no_aplica: "No aplica", bloqueado: "Bloqueada" };
const PESTANAS: [PestanaCot, string][] = [
  ["datos", "1 · Datos"],
  ["laboratorio", "2–3 · Laboratorio y V°B°"],
  ["documento", "4 · Documento y firma"],
  ["envio", "5 · Envío"],
  ["aceptacion", "6 · Aceptación"],
  ["bitacora", "Bitácora"],
];

export default function FichaCotizacionPage() {
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const { puede } = usePermisos();
  const [c, setC] = useState<Circuito | null>(null);
  const [cot, setCot] = useState<any | null>(null);
  const [params, setParams] = useState<Record<string, Opcion[]>>({});
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [tab, setTab] = useState<PestanaCot>((sp.get("tab") as PestanaCot) || "datos");
  const [tabElegida, setTabElegida] = useState(Boolean(sp.get("tab")));
  const [editando, setEditando] = useState(false);
  const [aceptando, setAceptando] = useState(false);
  const [anulando, setAnulando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const [circ, det] = await Promise.all([pedir<Circuito>("GET", `/cotizaciones/${id}/circuito`), pedir<any>("GET", `/cotizaciones/${id}`)]);
      setC(circ);
      setCot(det);
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }, [id]);

  useEffect(() => {
    cargar();
    pedir<any>("GET", "/cotizaciones/config").then((x) => setParams(x?.parametros ?? {})).catch(() => {});
  }, [cargar]);

  // Al abrir, la pestaña es la de la etapa actual (salvo que se pida otra).
  useEffect(() => {
    if (!c || tabElegida) return;
    const p = c.ruta.etapaActual ? PESTANA_DE_ETAPA[c.ruta.etapaActual] : "datos";
    if (p) setTab(p);
  }, [c, tabElegida]);

  const irA = (p: PestanaCot) => { setTab(p); setTabElegida(true); };
  const avisar = (m: string) => { setMsg(m); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const hecho = async (m: string) => { avisar(m); await cargar(); };

  if (error && !c) return <div><Link href={"/cotizaciones" as any} className="subtitle">← Cotizaciones</Link><div className="alert warn" role="alert">{error}</div></div>;
  if (!c || !cot) return <p className="subtitle" aria-busy="true">Cargando la cotización…</p>;

  const k = c.cotizacion;
  const acc = accionesDe({ ...cot, ...k }, puede, c.config.exigirFirma);
  const etapaActual = c.ruta.etapas.find((e) => e.clave === c.ruta.etapaActual);
  const s = c.ruta.siguiente;
  const quien = s?.leToca ? `${s.leToca.rol}${s.leToca.unidad ? ` ${s.leToca.unidad}` : ""}${s.leToca.personas.length ? ` (${s.leToca.personas.join(", ")})` : ""}` : null;
  const bloqueada = c.ruta.etapas.some((e) => e.clave === c.ruta.etapaActual && e.estado === "bloqueado");

  return (
    <div>
      <Link href={"/cotizaciones" as any} className="subtitle" style={{ display: "inline-block", color: "var(--accent)", textDecoration: "none" }}>← Cotizaciones</Link>
      {msg && <div className="alert info" role="status" style={{ marginBottom: 10 }}>{msg} <button className="btn outline sm" style={{ marginLeft: 8 }} onClick={() => setMsg("")}>Cerrar</button></div>}
      {error && <div className="alert warn" role="alert">{error}</div>}

      <div className="exphead">
        <div className="id">💲 {k.codigo}</div>
        <div className="meta">
          Cliente: <b>{cot.cliente?.razonSocial ?? "—"}</b>{cot.cliente?.rut ? <> ({rut(cot.cliente.rut)})</> : null}
          {" · "}Estado: <b>{cot.estado === "expirada" ? "Vencida" : cot.estado}</b>
          {etapaActual && <> · Etapa: <b>{etapaActual.titulo}</b></>}
          {" · "}Total: <b>{money(cot.total, cot.moneda === "USD" ? "USD" : "CLP")}</b>
          {" · "}Válida hasta: <b>{fechaDia(cot.validaHasta ?? cot.expiraAt)}</b>
          {k.ejecutivoNombre ? <> · Ejecutivo: <b>{k.ejecutivoNombre}</b></> : null}
        </div>
      </div>

      <section className={`siguiente-paso${!s && cot.estado === "aceptada" ? " cerrada" : ""}${bloqueada ? " bloq" : ""}`} aria-label="Siguiente paso de la cotización">
        {s ? (
          <div className="sp-fila">
            <div className="sp-texto">
              <div><span className="sp-etq">Siguiente paso</span> {s.texto}</div>
              {quien && (
                <div className="sp-quien">
                  <span className="sp-etq">Le toca a</span> {quien}
                  {!s.puedoActuar && <span className="sp-espera"> · Esperando a que lo haga {s.leToca?.personas.length ? "la persona indicada" : "ese rol"}</span>}
                </div>
              )}
            </div>
            {s.accion && s.puedoActuar && <button type="button" className="btn primary sm" onClick={() => irA(s.accion!.pestana)}>{s.accion.texto}</button>}
          </div>
        ) : (
          <div className="sp-fila"><div className="sp-texto">
            {cot.estado === "aceptada" ? <>Cotización aceptada{k.otCodigo ? <> · generó la OT <b>{k.otCodigo}</b></> : null}. No quedan pasos pendientes.</> : "No quedan pasos pendientes."}
          </div></div>
        )}
        {c.ruta.avisos.length > 0 && <ul className="sp-avisos">{c.ruta.avisos.map((a) => <li key={a}>{a}</li>)}</ul>}
      </section>

      <div className="expgrid">
        <nav className="stepper ruta-ot" aria-label="Ruta de la cotización">
          <div className="ruta-tit">Ruta de la cotización</div>
          <ol>
            {(() => {
              let n = 0;
              return c.ruta.etapas.map((e) => {
                if (e.estado !== "no_aplica") n += 1;
                const actual = e.clave === c.ruta.etapaActual;
                return (
                  <li key={e.clave} className={`step ${CLASE[e.estado]}`} aria-current={actual ? "step" : undefined}>
                    <div className="dot" aria-hidden>{ICONO[e.estado] || n}</div>
                    <button type="button" className="txt" onClick={() => irA(PESTANA_DE_ETAPA[e.clave] ?? "datos")}
                      style={{ background: "none", border: 0, padding: 0, textAlign: "left", cursor: "pointer", color: "inherit", font: "inherit" }}>
                      {e.titulo}
                      <span className="sr-only"> · {LEYENDA[e.estado]}</span>
                      <small>{e.estado === "no_aplica" ? (e.detalle ? `No aplica · ${e.detalle}` : "No aplica") : e.detalle ?? LEYENDA[e.estado]}</small>
                    </button>
                  </li>
                );
              });
            })()}
          </ol>
        </nav>

        <div className="card" style={{ padding: 0 }}>
          <div className="tabs" role="tablist" style={{ padding: "0 8px", flexWrap: "wrap" }}>
            {PESTANAS.map(([p, l]) => (
              <button key={p} id={`tab-${p}`} role="tab" aria-selected={tab === p} aria-controls="panel-cotizacion" className={`tab${tab === p ? " active" : ""}`} onClick={() => irA(p)}>{l}</button>
            ))}
          </div>
          <div style={{ padding: 15 }} role="tabpanel" id="panel-cotizacion" aria-labelledby={`tab-${tab}`}>
            {tab === "datos" && (
              editando && acc.editar ? (
                <CotizacionForm modo="editar" inicial={cot} onCancelar={() => setEditando(false)} onGuardado={async () => { setEditando(false); await hecho(`Cotización ${k.codigo} actualizada.`); }} />
              ) : (
                <>
                  {acc.motivoNoEditar && cot.estado === "abierta" && <div className="alert info">No se edita: {acc.motivoNoEditar}</div>}
                  <DetalleCotizacion cot={cot} params={params} acciones={{ ...acc, aceptar: false, motivoNoAceptar: undefined }} onEditar={() => setEditando(true)} onAceptar={() => irA("aceptacion")} onAnular={() => setAnulando(true)} />
                  {c.puedo.solicitar && (
                    <div className="toolbar" style={{ marginTop: 8 }}>
                      <div className="spacer" />
                      <button className="btn outline sm" onClick={() => irA("laboratorio")}>Remitir a laboratorio →</button>
                      <button className="btn primary sm" onClick={() => irA("documento")}>Vista previa y firma →</button>
                    </div>
                  )}
                </>
              )
            )}
            {tab === "laboratorio" && <LaboratorioCotizacion c={c} onCambio={cargar} onMensaje={avisar} />}
            {tab === "documento" && <DocumentoYFirma c={c} onHecho={hecho} onError={avisar} />}
            {tab === "envio" && <Envio c={c} onHecho={hecho} />}
            {tab === "aceptacion" && (
              <Aceptacion cot={cot} c={c} acc={acc} onAceptar={() => setAceptando(true)} />
            )}
            {tab === "bitacora" && <Bitacora c={c} />}
          </div>
        </div>
      </div>

      {aceptando && (
        <DialogoAceptacion cot={cot} onCerrar={() => setAceptando(false)} onHecho={async (r) => { setAceptando(false); await hecho(r?.mensaje ?? "Aceptación registrada."); }} />
      )}
      {anulando && (
        <DialogoAnulacion cot={cot} onCerrar={() => setAnulando(false)} onHecho={async () => { setAnulando(false); await hecho(`Cotización ${k.codigo} anulada.`); }} />
      )}
    </div>
  );
}

/* --------------------------------------------------------- 4 · documento --- */
function DocumentoYFirma({ c, onHecho, onError }: { c: Circuito; onHecho: (m: string) => Promise<void>; onError: (m: string) => void }) {
  const k = c.cotizacion;
  const [html, setHtml] = useState<string | null>(null);
  const [errorDoc, setErrorDoc] = useState("");
  const [busy, setBusy] = useState(false);
  const [devolviendo, setDevolviendo] = useState(false);
  const [motivo, setMotivo] = useState("");

  useEffect(() => {
    setHtml(null);
    pedirTexto(`/cotizaciones/${k.id}/html`).then(setHtml).catch((e) => setErrorDoc(e.message));
  }, [k.id, k.firmaEstado]);

  const accion = async (ruta: string, cuerpo?: unknown) => {
    setBusy(true);
    try {
      const r = await pedir<any>("POST", ruta, cuerpo ?? {});
      await onHecho(r?.mensaje ?? "Listo.");
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const historica = k.circuito !== "r1";
  const pasoFirma = k.firmaEstado === "firmada"
    ? <>✓ {k.firmadaPorNombre} · {fechaHora(k.firmadaAt)}</>
    : k.firmaEstado === "pendiente" ? <>en firma · {c.firmantes.join(", ") || "sin Jefe DCO asignado"}</>
    : k.firmaEstado === "devuelta" ? <>devuelta: {k.firmaDevueltaMotivo}</>
    : <>pendiente de envío a firma</>;

  return (
    <div>
      {!historica && (
        <ol aria-label="Circuito de firmas (matriz COTIZACION)" style={{ listStyle: "none", padding: 0, margin: "0 0 10px", display: "flex", gap: 18, flexWrap: "wrap", fontSize: 13 }}>
          <li><b>1 · Elabora</b> (Ejecutivo de Ventas): ✓ {k.ejecutivoNombre ?? "—"}</li>
          <li><b>2 · Firma</b> (Jefe del Departamento Comercial): {pasoFirma}</li>
        </ol>
      )}
      {k.firmaEstado === "devuelta" && <div className="alert warn">Devuelta por el Jefe DCO: {k.firmaDevueltaMotivo}. Corrija en «Datos» y vuelva a enviarla a firma.</div>}
      {!historica && c.faltantesFirma.length > 0 && k.firmaEstado !== "pendiente" && k.firmaEstado !== "firmada" && (
        <div className="alert warn">
          Antes de enviar a firma:
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{c.faltantesFirma.map((f) => <li key={f}>{f}</li>)}</ul>
        </div>
      )}
      <div className="toolbar" style={{ gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        <button className="btn outline sm" onClick={() => descargarPdfCotizacion(k.id, k.codigo).catch((e) => onError(e.message))}>Descargar PDF</button>
        <div className="spacer" />
        {c.puedo.enviarAFirma && <button className="btn primary sm" disabled={busy} onClick={() => accion(`/cotizaciones/${k.id}/enviar-a-firma`)}>Enviar a firma → Jefe DCO</button>}
        {c.puedo.firmar && <button className="btn outline sm" disabled={busy} onClick={() => setDevolviendo(true)}>Devolver al ejecutivo</button>}
        {c.puedo.firmar && (
          <button className="btn success sm" disabled={busy}
            onClick={async () => {
              // Firmar emite la cotización y fija su validez: no se deshace (D02-23).
              const ok = await confirmar({
                titulo: `¿Firmar y emitir la cotización ${k.codigo}?`,
                mensaje: "Su firma queda registrada con fecha y hora y la validez corre desde hoy. Revise antes la vista previa.",
                confirmarTexto: "Firmar → emitir",
              });
              if (ok) await accion(`/cotizaciones/${k.id}/firmar`);
            }}>Firmar → emitir</button>
        )}
      </div>
      {errorDoc && <div className="alert warn" role="alert">{errorDoc}</div>}
      {html === null && !errorDoc && <p className="subtitle" aria-busy="true">Generando la vista previa…</p>}
      {html !== null && (
        <iframe
          title={`Vista previa de la cotización ${k.codigo}`}
          srcDoc={html}
          sandbox=""
          style={{ width: "100%", height: 720, border: "1px solid var(--line)", borderRadius: 8, background: "#fff" }}
        />
      )}
      <p className="subtitle" style={{ fontSize: 11.5 }}>Nunca se imprimen las observaciones internas ni el formulario de costeo.</p>
      {devolviendo && (
        <Panel titulo={`Devolver la cotización ${k.codigo} al ejecutivo`} onCerrar={() => setDevolviendo(false)} ancho={480}>
          <div className="field">
            <label htmlFor="dev-motivo">Motivo <span className="req">*</span></label>
            <textarea id="dev-motivo" rows={3} maxLength={1000} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </div>
          <div className="toolbar" style={{ marginTop: 12 }}>
            <button className="btn outline sm" onClick={() => setDevolviendo(false)}>Cancelar</button>
            <div className="spacer" />
            <button className="btn sm" style={{ background: "var(--red)", color: "#fff" }} disabled={busy || motivo.trim().length < 3}
              onClick={async () => { await accion(`/cotizaciones/${k.id}/devolver-firma`, { motivo: motivo.trim() }); setDevolviendo(false); }}>
              Devolver al ejecutivo
            </button>
          </div>
        </Panel>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- 5 · envío --- */
function Envio({ c, onHecho }: { c: Circuito; onHecho: (m: string) => Promise<void> }) {
  const k = c.cotizacion;
  const { puede } = usePermisos();
  const [medio, setMedio] = useState<"correo" | "mano" | "courier" | "oficio" | "oficina_partes">("correo");
  const [destinatarios, setDestinatarios] = useState(() => [...new Set(c.destinatarios.filter((d) => d.principal).map((d) => d.email))].join(", "));
  const [observacion, setObservacion] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function enviar() {
    setError("");
    const lista = destinatarios.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
    if (medio === "correo" && !lista.length) return setError("Indique al menos un destinatario.");
    if (medio !== "correo" && !observacion.trim())
      return setError(
        medio === "mano" ? "Indique a quién se entregó."
          : medio === "courier" ? "Indique la empresa de courier y el número de seguimiento."
          : "Indique el Nº del oficio o del registro de la Oficina de partes.",
      );
    setBusy(true);
    try {
      const r = await pedir<any>("POST", `/cotizaciones/${k.id}/enviar-cliente`, {
        medio,
        destinatarios: medio === "correo" ? lista : undefined,
        observacion: observacion.trim() || null,
      });
      if (r?.ok === false) setError(r.mensaje ?? "No se pudo enviar el correo.");
      else await onHecho(r?.mensaje ?? "Envío registrado.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      {k.enviadaAt ? (
        <div className="alert info" role="status">
          Enviada el {fechaHora(k.enviadaAt)} · {TEXTO_MEDIO[k.enviadaMedio ?? ""] ?? k.enviadaMedio}
          {k.enviadaDestinatarios ? <> · a {k.enviadaDestinatarios}</> : null}
          {k.envioObservacion ? <> · {k.envioObservacion}</> : null}
        </div>
      ) : null}
      {/* EP-00 3.1–3.3: a Ejército y FF.AA. la cotización sale con oficio conductor (V°B° Jefe DCO → Dirección → Oficina de partes). */}
      {puede("oficio.crear") && (
        <p style={{ fontSize: 12.5, margin: "0 0 8px" }}>
          Ejército y FF.AA.: <Link href={`/oficios/nuevo?cotizacion=${(k as any).id}` as any} className="btn outline sm">Generar oficio →</Link>{" "}
          <Link href={`/oficios?vista=todos` as any} style={{ color: "var(--accent)" }}>ver oficios</Link>
        </p>
      )}
      {!c.puedo.enviarCliente ? (
        <p className="subtitle">
          {k.circuito === "r1" && k.firmaEstado !== "firmada"
            ? "Solo se envía al cliente una cotización firmada por el Jefe DCO."
            : "Usted no puede enviar esta cotización, o su estado ya no lo permite."}
        </p>
      ) : (
        <section aria-labelledby="envio-tit">
          <h3 id="envio-tit" style={{ fontSize: 14, margin: "0 0 8px" }}>{k.enviadaAt ? "Reenviar o registrar otra entrega" : "Enviar al cliente"}</h3>
          {error && <div className="alert warn" role="alert">{error}</div>}
          <div className="form-grid cols-2">
            <div className="field">
              <label htmlFor="env-medio">Medio <span className="req">*</span></label>
              <select id="env-medio" value={medio} onChange={(e) => setMedio(e.target.value as any)}>
                <option value="correo">Correo electrónico (adjunta el PDF)</option>
                <option value="mano">Entrega en mano</option>
                <option value="courier">Courier</option>
                <option value="oficio">Oficio (generado fuera del LIMS)</option>
                <option value="oficina_partes">Oficina de partes</option>
              </select>
            </div>
            {medio === "correo" ? (
              <div className="field">
                <label htmlFor="env-dest">Destinatarios <span className="req">*</span></label>
                <input id="env-dest" value={destinatarios} onChange={(e) => setDestinatarios(e.target.value)} maxLength={1000} aria-describedby="env-dest-ayuda" />
                <small id="env-dest-ayuda" style={{ color: "var(--muted)" }}>Separados por coma.</small>
                {c.destinatarios.length > 0 && (
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                    {c.destinatarios.map((d) => (
                      <button key={`${d.email}-${d.nombre}`} type="button" className="btn outline sm"
                        onClick={() => setDestinatarios((v) => [...new Set([...v.split(/[,;\s]+/).filter(Boolean), d.email])].join(", "))}>
                        ＋ {d.cargo ?? d.nombre}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : <div />}
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label htmlFor="env-obs">{medio === "correo" ? "Observación" : medio === "mano" ? "Entregada a (nombre y cargo)" : medio === "courier" ? "Courier y número de seguimiento" : "Nº del oficio o del registro de la Oficina de partes"} {medio !== "correo" && <span className="req">*</span>}</label>
              <input id="env-obs" value={observacion} onChange={(e) => setObservacion(e.target.value)} maxLength={1000} />
            </div>
          </div>
          <div className="toolbar" style={{ marginTop: 10 }}>
            <div className="spacer" />
            <button className="btn primary sm" disabled={busy} onClick={enviar}>{busy ? "Enviando…" : medio === "correo" ? "Enviar al cliente →" : "Registrar entrega →"}</button>
          </div>
        </section>
      )}
    </div>
  );
}

/* --------------------------------------------------------- 6 · aceptación --- */
function Aceptacion({ cot, c, acc, onAceptar }: { cot: any; c: Circuito; acc: ReturnType<typeof accionesDe>; onAceptar: () => void }) {
  if (cot.estado === "aceptada")
    return (
      <div>
        <div className="form-grid cols-2">
          <div className="field readonly"><label>Documento de aceptación</label><div>{ACEPTACION_LABEL[cot.aceptacionTipo] ?? cot.aceptacionTipo ?? "—"}</div></div>
          <div className="field readonly"><label>Número / fecha</label><div>{cot.aceptacionNumero ?? "s/n"} · {fechaDia(cot.aceptacionFecha)}</div></div>
          <div className="field readonly"><label>Cobro</label><div>{cot.conCobro ? "Con cobro" : "Sin cobro"}</div></div>
          <div className="field readonly"><label>OT generada</label><div>{cot.ot ? <Link href={`/ot/${cot.ot.id}` as any} className="codigo" style={{ textDecoration: "underline" }}>{cot.ot.codigo}</Link> : "—"}</div></div>
        </div>
      </div>
    );
  return (
    <div>
      <p className="subtitle" style={{ marginTop: 0 }}>
        Con el documento con que el cliente acepta (OPI o Resolución, O/C, correo, pago por adelantado o disposición del Director) nace la Orden de Trabajo con su laboratorio responsable.
      </p>
      {acc.motivoNoAceptar && <div className="alert warn">{acc.motivoNoAceptar}</div>}
      {!c.cotizacion.enviadaAt && acc.aceptar && <div className="alert info">Aún no se registra el envío al cliente.</div>}
      <div className="toolbar">
        <div className="spacer" />
        {acc.aceptar ? <button className="btn success sm" onClick={onAceptar}>Registrar aceptación → crear OT</button> : null}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- bitácora --- */
function Bitacora({ c }: { c: Circuito }) {
  if (!c.eventos.length) return <p className="subtitle" style={{ margin: 0 }}>Sin movimientos del circuito todavía.</p>;
  return (
    <table className="data">
      <thead><tr><th>Fecha</th><th>Quién</th><th>Qué</th><th>Detalle</th></tr></thead>
      <tbody>
        {c.eventos.map((e) => (
          <tr key={e.id}>
            <td style={{ whiteSpace: "nowrap" }}>{fechaHora(e.createdAt)}</td>
            <td>{e.usuarioNombre ?? "—"}</td>
            <td>{TEXTO_EVENTO[e.accion] ?? e.accion}{e.unidadCodigo ? ` · ${e.unidadCodigo}` : ""}{e.solicitudNumero ? ` (${e.solicitudNumero})` : ""}</td>
            <td>
              {e.comentario ?? (e.detalle?.medio ? TEXTO_MEDIO[e.detalle.medio] ?? e.detalle.medio : "")}
              {e.detalle?.otId ? (
                <>{e.detalle?.numero ? `${e.detalle.numero} · ` : ""}OT <Link href={`/ot/${e.detalle.otId}` as any} className="codigo" style={{ textDecoration: "underline" }}>{e.detalle.otCodigo}</Link></>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
