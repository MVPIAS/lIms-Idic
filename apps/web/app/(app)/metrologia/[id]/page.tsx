"use client";

/**
 * Ficha de calibración (EP-04 §4.0, maqueta de Metrología): cabecera con chip de
 * estado, barra de 6 pasos, pestañas numeradas (Hoja de control, Toma de datos,
 * Tabla de resultados, Balance, Certificado, Error normalizado), circuito de
 * firmas a la vista con sus botones «Verbo → siguiente», certificado renderizado,
 * entrega y bitácora. Todo lo decide el servidor (acciones, barra, circuito).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { fechaDia, fechaHora } from "@/lib/format";
import { fmtG } from "@/lib/metrologia";
import { llamar } from "@/lib/laboratorio";
import { usePermisos } from "@/lib/permisos";
import { MEDIOS_ENTREGA, textoMedio } from "@/lib/documentos";
import { ORIGEN_OT } from "@/lib/metrologiaOt";
import { confirmar, toast } from "@/components/ui/feedback";
import Modal from "@/components/documentos/Modal";
import PresentacionCertificado from "@/components/metrologia/PresentacionCertificado";
import BalanceIncertidumbre from "@/components/metrologia/BalanceIncertidumbre";
import s from "@/components/metrologia/ficha.module.css";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
type Pestana = "control" | "toma" | "resultados" | "balance" | "certificado" | "en";
const PESTANAS: [Pestana, string][] = [
  ["control", "Hoja de control"], ["toma", "Toma de datos"], ["resultados", "Tabla de resultados"],
  ["balance", "Balance de incertidumbre"], ["certificado", "Certificado"], ["en", "Error normalizado"],
];
const ACCION_EVENTO: Record<string, string> = {
  CREADA: "Creada", EDITADA: "Editada", ENVIADA: "Firmada y enviada a revisión", DEVUELTA: "Devuelta al metrólogo", FIRMADA: "Revisión técnica aprobada",
  EMITIDA: "Firmada y emitida", REEMISION: "Reemisión", REEMPLAZADA: "Reemplazada", ENTREGADA: "Certificado entregado",
  CERTIFICADO: "Presentación del certificado", NOTIFICADA: "Aviso al solicitante", CORREO: "Enviado por correo",
  EQUIPO_ACTUALIZADO: "Equipo del laboratorio dueño actualizado", PATRON_ACTUALIZADO: "Maestro de patrones actualizado",
  PATRON_NO_ACTUALIZADO: "Maestro de patrones sin actualizar",
};

function chip(c: any): { texto: string; clase: string } {
  if (c.estado === "borrador" && c.devuelto_motivo) return { texto: "Devuelto al metrólogo", clase: s.chipDevuelto };
  switch (c.estado) {
    case "en_revision": return { texto: "En revisión técnica", clase: s.chipRevision };
    case "en_firma": return { texto: "Pendiente de firma", clase: s.chipFirma };
    case "emitida": return c.entregado_at ? { texto: "Entregado", clase: s.chipEmitido } : { texto: "Emitido", clase: s.chipEmitido };
    case "reemplazada": return { texto: "Reemplazado", clase: s.chipReemplazado };
    default: return { texto: "Borrador", clase: s.chipBorrador };
  }
}

export default function FichaCalibracionPage() {
  const { id } = useParams<{ id: string }>();
  const { puede } = usePermisos();
  const [c, setC] = useState<any>(null);
  const [circ, setCirc] = useState<any>(null);
  const [doc, setDoc] = useState<string>("");
  const [docError, setDocError] = useState("");
  const [anterior, setAnterior] = useState<any>(null);
  const [tab, setTab] = useState<Pestana | null>(null);
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [dialogo, setDialogo] = useState<null | "devolver" | "reemitir" | "entregar" | "correo">(null);

  const cargar = useCallback(async () => {
    try {
      const [d, ci] = await Promise.all([
        llamar("GET", `/metrologia/calibraciones/${id}`),
        llamar("GET", `/metrologia/calibraciones/${id}/circuito`).catch(() => null),
      ]);
      setC(d); setCirc(ci?.data ?? null); setError("");
      setDoc("");
      setTab((t) => t ?? (["en_revision", "en_firma", "emitida", "reemplazada"].includes(d.estado) ? "certificado" : "control"));
    } catch (e: any) { setError(e.message); }
  }, [id]);
  useEffect(() => { cargar(); }, [cargar]);
  // Certificado en pantalla: el documento completo (mismo cuerpo, sello y pie que el PDF), aislado en un iframe sin scripts.
  useEffect(() => {
    if (tab !== "certificado" || doc || !c) return;
    let vivo = true;
    llamar("GET", `/metrologia/calibraciones/${id}/html?completo=1`)
      .then((r) => { if (vivo) { setDoc(r?.data?.html ?? ""); setDocError(""); } })
      .catch((e) => vivo && setDocError(e.message));
    return () => { vivo = false; };
  }, [tab, doc, c, id]);
  useEffect(() => {
    if (tab === "en" && !anterior) llamar("GET", `/metrologia/calibraciones/${id}/anterior`).then(setAnterior).catch((e) => setAnterior({ data: null, motivo: e.message }));
  }, [tab, id, anterior]);

  async function accion(que: "enviar" | "firmar" | "devolver" | "reemitir", body?: any, okTexto?: string) {
    setOcupado(true);
    try {
      const r = await llamar("POST", `/metrologia/calibraciones/${id}/${que}`, body);
      toast.ok(okTexto ?? (r?.data?.numero ? `Certificado ${r.data.numero} emitido.` : "Hecho."));
      const av = r?.data?.aviso;
      if (av && av.ok) toast.ok(`Aviso enviado por correo a ${av.destinatarios.join(", ")}.`);
      else if (av && !av.ok) toast.error(`El certificado quedó emitido, pero no salió el aviso por correo: ${av.motivo ?? "sin destinatario"}. Puede enviarlo desde «Enviar por correo».`);
      setDialogo(null);
      if (que === "reemitir" && r?.data?.id) { window.location.href = `/metrologia/nueva?id=${r.data.id}`; return; }
      await cargar();
    } catch (e: any) { toast.error(e.message); }
    finally { setOcupado(false); }
  }
  async function firmar(emite: boolean) {
    const ok = await confirmar({
      titulo: emite ? `¿Firmar y emitir el certificado de ${c.codigo}?` : `¿Aprobar la revisión técnica de ${c.codigo}?`,
      mensaje: emite
        ? "Al emitirlo recibe su número, queda sellado con su código de verificación y la fecha de emisión se congela. Ya no se modifica: solo se reemite."
        : "Con su firma la calibración pasa a la firma y emisión del certificado.",
      confirmarTexto: emite ? "Firmar y emitir" : "Aprobar revisión técnica",
    });
    if (ok) accion("firmar", undefined, emite ? undefined : "Revisión técnica aprobada: pasa a firma y emisión.");
  }
  async function enviar() {
    const ok = await confirmar({
      titulo: `¿Firmar y enviar ${c.codigo} a revisión?`,
      mensaje: "Con el envío firma lo elaborado como metrólogo. El Jefe del Laboratorio (o su subrogante) la revisa y la aprueba o se la devuelve con observaciones.",
      confirmarTexto: "Firmar y enviar",
    });
    if (ok) accion("enviar", undefined, `${c.codigo} enviada a revisión técnica.`);
  }
  async function verPdf() {
    try {
      const res = await fetch(`${API}/metrologia/calibraciones/${id}/pdf`, { headers: { Authorization: `Bearer ${localStorage.getItem("lims_token")}` } });
      if (!res.ok) throw new Error(`No se pudo generar el certificado (${res.status})`);
      window.open(URL.createObjectURL(await res.blob()), "_blank");
    } catch (e: any) { toast.error(e.message); }
  }

  const resultados = useMemo<any[]>(() => {
    if (!c) return [];
    if (c.resumen?.puntos?.length) return c.resumen.puntos as any[];
    return (c.puntos ?? []).map((p: any) => ({ nominal: p.nominal, error: p.error, uc: p.uc, U: p.u_exp, Ucert: null, uCertificado: null, cmc: null }));
  }, [c]);

  if (error && !c) return <div className="alert warn" role="alert">{error}</div>;
  if (!c || !tab) return <div className="card" style={{ padding: 24, color: "var(--muted)" }}>Cargando la calibración…</div>;

  const ch = chip(c);
  const a: string[] = c.acciones ?? [];
  const ins = c.instrumento ?? {};
  const unidadU = c.motor === "PUNTOS" ? "" : c.resumen?.unidadU ?? c.unidad ?? "";
  const nombre = c.numero_certificado ?? c.codigo;
  const firmaElabora = (c.firmas ?? []).find((f: any) => f.accion === "ELABORA");
  const pasosJefe = (circ?.pasos ?? []).filter((p: any) => p.accion !== "ELABORA");
  const devuelta = c.estado === "borrador" && c.devuelto_motivo;
  const puedeEntregar = c.estado === "emitida" && !c.entregado_at && c.ot_id && puede(["certificado.entregar", "metrologia.crear"]);
  const dato = (k: string, v: React.ReactNode) => <div key={k}><dt>{k}</dt><dd>{v ?? "—"}</dd></div>;

  return (
    <div>
      <Link href={"/metrologia" as any} className="subtitle" style={{ display: "inline-block", color: "var(--accent)", textDecoration: "none" }}>← Calibraciones</Link>
      <div className={s.cabecera}>
        <div className={s.crece}>
          <h1>Calibración <span className="codigo">{nombre}</span> · {ins.item ?? "Instrumento"}</h1>
          <div className={s.sub}>
            {c.proceso_nombre} · <span className="codigo">{c.proceso}</span>{c.revision ? ` ${c.revision}` : ""}{c.norma ? ` · ${c.norma}` : ""}
            {" · "}{c.acreditacion ? `Acreditado ${c.acreditacion}` : "Proceso no acreditado"}
            {c.ot_id ? <> · OT <Link href={`/ot/${c.ot_id}` as any} className="codigo" style={{ color: "var(--accent)" }}>{c.ot_codigo}</Link>{c.instrumento_numero ? ` · ítem ${c.instrumento_numero}` : ""}</> : ins.ot ? <> · OT {ins.ot} (texto, calibración anterior a la OT ligada)</> : null}
          </div>
        </div>
        <span className={`${s.chip} ${ch.clase}`} role="status">{ch.texto}</span>
      </div>

      <ol className={s.barra} aria-label="Pasos de la calibración">
        {(c.barra ?? []).map((p: any, i: number) => (
          <li key={p.paso} className={`${s.paso} ${p.estado === "hecho" ? s.pasoHecho : p.estado === "actual" ? s.pasoActual : ""}`} aria-current={p.estado === "actual" ? "step" : undefined}>
            <div className="n">Paso {i + 1}</div><div className="t">{p.paso}</div>
          </li>
        ))}
      </ol>

      {devuelta && <div className="alert warn"><b>Devuelta al metrólogo:</b> {c.devuelto_motivo}. La calibración vuelve a «Toma de datos».</div>}
      {c.reemplaza_numero && <div className="alert info">Reemisión: este certificado reemplaza al N° <b>{c.reemplaza_numero}</b> al emitirse.</div>}
      {c.estado === "reemplazada" && <div className="alert warn">Este certificado fue reemplazado por el N° <b>{c.reemplazada_por ?? "(en emisión)"}</b>.</div>}
      {(c.avisos ?? []).map((t: string) => <div key={t} className="alert info">{t}</div>)}

      <div className={s.pestanas} role="tablist" aria-label="Secciones de la ficha">
        {PESTANAS.map(([k, l], i) => (
          <button key={k} id={`tab-${k}`} role="tab" aria-selected={tab === k} aria-controls="panel-ficha" tabIndex={tab === k ? 0 : -1}
            className={`${s.pestana} ${tab === k ? s.pestanaActiva : ""}`} onClick={() => setTab(k)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              const sig = PESTANAS[(i + (e.key === "ArrowRight" ? 1 : PESTANAS.length - 1)) % PESTANAS.length][0];
              setTab(sig); document.getElementById(`tab-${sig}`)?.focus();
            }}>
            <span className="num">{i + 1}</span>{l}
          </button>
        ))}
      </div>

      <div id="panel-ficha" role="tabpanel" aria-labelledby={`tab-${tab}`}>
      {tab === "control" && (
        <div>
          <section className={s.bloque}><h2>Identificación de la orden</h2><dl className={s.datos}>
            {dato("Orden de trabajo", c.ot_id ? <Link href={`/ot/${c.ot_id}` as any} style={{ color: "var(--accent)" }}>{c.ot_codigo}</Link> : ins.ot)}
            {dato("N° de certificado", c.numero_certificado ?? "Se asigna al emitir")}
            {dato("Cliente", ins.cliente)}{dato("Solicitante", ins.solicitante)}{dato("Contacto", ins.contacto)}{dato("Dirección", ins.direccion)}
          </dl></section>
          <section className={s.bloque}><h2>Instrumento</h2><dl className={s.datos}>
            {dato("Descripción", ins.item)}{dato("Marca", ins.marca)}{dato("Modelo", ins.modelo)}{dato("N° de serie", ins.serie)}
            {dato("Identificación especial", ins.idEspecial)}{dato("Capacidad", ins.cap)}{dato("Resolución", ins.res)}{dato("Rango calibrado", ins.rango)}{dato("Clase", ins.clase)}
            {c.instrumento_etiqueta && dato("Etiqueta de custodia", <span className="codigo">{c.instrumento_etiqueta}</span>)}
            {c.instrumento_ubicacion && dato("Ubicación", c.instrumento_ubicacion)}
          </dl></section>
          <section className={s.bloque}><h2>Método, responsables y fechas de control</h2><dl className={s.datos}>
            {dato("IT", `${c.proceso}${c.revision ? ` · ${c.revision}` : ""}`)}{dato("Norma base", c.norma)}{dato("Desviaciones del método", ins.desviacion || "No")}
            {dato("Metrólogo", c.autor_nombre)}{dato("Laboratorio", c.laboratorio_nombre ?? c.laboratorio)}
            {dato("Solicitud del cliente", c.fecha_solicitud ? fechaDia(c.fecha_solicitud) : "—")}
            {dato("Orden de compra", c.oc_numero ? `${c.oc_numero}${c.oc_fecha ? ` · ${fechaDia(c.oc_fecha)}` : ""}` : "No tiene")}
            {dato("Fecha OT", ins.fechaOt ? fechaDia(ins.fechaOt) : "—")}
            {dato("Recepción del instrumento", ins.fechaRecepcion ? fechaDia(ins.fechaRecepcion) : "—")}
            {dato("Calibración", c.fecha_calibracion ? fechaDia(c.fecha_calibracion) : "—")}
            {dato("Entrega a revisión", c.enviado_at ? fechaHora(c.enviado_at) : "Al enviar")}
            {dato("Emisión", c.emitido_at ? fechaHora(c.emitido_at) : "Se fija al firmar")}
            {dato("Término previsto", c.termino_previsto ? fechaDia(c.termino_previsto) : "—")}
            {dato("Término real", c.termino_real ? fechaHora(c.termino_real) : "Se fija al cerrar la OT")}
            {dato("Intervalo de calibración", c.intervalo_meses ? `${c.intervalo_meses} meses` : "Según el cliente")}
            {dato("Lugar", ins.lugar === "cliente" ? "Instalaciones del cliente" : "Instalaciones del IDIC")}
          </dl></section>
          <section className={s.bloque}><h2>Patrones utilizados</h2>
            {(c.patrones ?? []).length ? (
              <table className="data"><thead><tr><th>Patrón</th><th>Serie</th><th>Clase</th><th>Certificado</th><th>Emisor</th><th>Próxima calibración</th></tr></thead>
                <tbody>{c.patrones.map((p: any) => <tr key={p.id}><td>{p.codigo} · {p.nombre}</td><td>{p.serie ?? "—"}</td><td>{p.clase ?? "—"}</td><td>{p.n_certificado ?? "—"}</td><td>{p.emisor ?? "—"}</td><td>{p.vence ? fechaDia(p.vence) : "—"}</td></tr>)}</tbody>
              </table>
            ) : <p className="subtitle" style={{ margin: 0 }}>Sin patrones declarados.</p>}
          </section>
          <section className={s.bloque}><h2>Condiciones ambientales</h2><dl className={s.datos}>
            {dato("Temperatura", c.ambiente?.temp ? `${c.ambiente.temp} ± ${c.ambiente.tempU ?? "—"} °C` : "—")}
            {dato("Humedad relativa", c.ambiente?.hum ? `${c.ambiente.hum} ± ${c.ambiente.humU ?? "—"} %` : "—")}
            {dato("Presión", c.ambiente?.pres ? `${c.ambiente.pres} ± ${c.ambiente.presU ?? "—"} hPa` : "—")}
            {c.auxiliares?.termohigrometro && dato("Termohigrómetro", `${c.auxiliares.termohigrometro.codigo}${c.auxiliares.termohigrometro.n_certificado ? ` · cert. ${c.auxiliares.termohigrometro.n_certificado}` : ""}`)}
            {c.auxiliares?.barometro && dato("Barómetro", `${c.auxiliares.barometro.codigo}${c.auxiliares.barometro.n_certificado ? ` · cert. ${c.auxiliares.barometro.n_certificado}` : ""}`)}
          </dl>
          {c.auxiliares && (
            <p style={{ fontSize: 12, color: "var(--muted)", margin: "8px 0 0" }}>
              Valores corregidos: promedio de las lecturas menos el error del certificado del equipo auxiliar
              {(["temp", "hum", "pres"] as const).map((k) => {
                const x = c.auxiliares.corregidas?.[k];
                return x ? ` · ${k === "temp" ? "T" : k === "hum" ? "HR" : "P"}: ${fmtG(x.promedio)} − (${fmtG(x.error)}) = ${fmtG(x.corregido)}` : "";
              }).join("")}.
            </p>
          )}
          </section>
        </div>
      )}

      {tab === "toma" && (
        <section className={s.bloque}>
          <h2>Toma de datos</h2>
          <p style={{ marginTop: 0, fontSize: 12.5 }}>
            Las lecturas se registran en el formulario {c.motor ? <>del motor <b>{c.motor}</b> (validado contra la planilla del laboratorio)</> : "por puntos"}: esta pantalla
            reemplaza la planilla de registro en papel. El servidor recalcula todo al guardar.
          </p>
          {(c.puntos ?? []).some((p: any) => (p.lecturas ?? []).length) && (
            <table className="data"><thead><tr><th>Nominal</th><th>Lecturas</th></tr></thead>
              <tbody>{c.puntos.map((p: any) => <tr key={p.id}><td className="num">{fmtG(p.nominal)}</td><td className="num">{(p.lecturas ?? []).map((x: number) => fmtG(x)).join(" · ") || "—"}</td></tr>)}</tbody>
            </table>
          )}
          <div className={s.acciones}>
            {a.includes("EDITAR")
              ? <Link className="btn primary sm" href={`/metrologia/nueva?id=${c.id}` as any}>{devuelta ? "Corregir la toma de datos →" : "Editar la toma de datos →"}</Link>
              : <span className={s.espera}>{c.estado === "borrador" ? "Solo quien elaboró la calibración edita el borrador." : "La toma de datos ya se envió: solo se corrige si el revisor la devuelve."}</span>}
          </div>
        </section>
      )}

      {tab === "resultados" && (
        <section className={s.bloque}>
          <h2>Tabla de resultados</h2>
          {resultados.length ? (
            <div style={{ overflowX: "auto" }}>
              <table className="data">
                <thead><tr><th>Nominal</th><th>Error</th><th>u<sub>c</sub></th><th>U calculada (k=2)</th><th>CMC</th><th>U certificada</th>{resultados.some((p: any) => p.clase) && <th>Clase</th>}</tr></thead>
                <tbody>
                  {resultados.map((p: any, i: number) => (
                    <tr key={i}>
                      <td className="num">{fmtG(p.nominal)}{p.unidad ? ` ${p.unidad}` : ""}{p.fueraAlcance ? " *" : ""}</td>
                      {[p.error, p.uc, p.U, p.cmc, p.uCertificado ?? p.Ucert].map((v, j) => <td key={j} className={`num ${s.calc}`}>{v == null ? "—" : fmtG(v)}</td>)}
                      {resultados.some((x: any) => x.clase) && <td>{p.clase ?? "—"}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{ fontSize: 12, color: "var(--muted)" }}>U certificada = máx(U calculada, CMC) con dos cifras significativas{unidadU ? ` (${unidadU})` : ""}. «*» = fuera del alcance acreditado. Sin veredicto de conformidad: el laboratorio no la evalúa.</p>
            </div>
          ) : <p className="subtitle" style={{ margin: 0 }}>Aún sin resultados calculados.</p>}
        </section>
      )}

      {tab === "balance" && (
        <section className={s.bloque}>
          <h2>Balance de incertidumbre por punto</h2>
          <BalanceIncertidumbre balance={c.balance ?? null} puntos={c.puntos ?? []} unidadNominal={c.unidad ?? undefined} />
        </section>
      )}

      {tab === "certificado" && (
        <div>
          <section className={s.bloque}>
            <h2>Revisión y firma</h2>
            <div className={s.circuito}>
              <div className={`${s.nodo} ${firmaElabora ? s.nodoOk : devuelta ? s.nodoDevuelto : s.nodoActual}`}>
                <div className="estado">{firmaElabora ? "Cargado ✓" : devuelta ? "Devuelto" : "Cargado · en curso"}</div>
                <div className="quien">{firmaElabora?.nombre ?? c.autor_nombre ?? "—"}</div>
                <div className="rol">Metrólogo (elabora)</div>
                {firmaElabora?.firmado_at && <div className="cuando">{fechaHora(firmaElabora.firmado_at)}</div>}
              </div>
              {(pasosJefe.length ? pasosJefe : [{ orden: 1, rol: { nombre: "Jefe de Laboratorio de Metrología" } }, { orden: 2, rol: { nombre: "Jefe de Departamento" } }]).map((p: any, i: number) => (
                <div key={`${p.orden}-${i}`} className={`${s.nodo} ${p.firma ? s.nodoOk : p.pendiente ? s.nodoActual : ""}`}>
                  <div className="estado">{p.firma ? `${i === 0 ? "Revisión técnica" : "Firma y emisión"} ✓` : p.pendiente ? `${i === 0 ? "Revisión técnica" : "Firma"} · le toca` : i === 0 ? "Revisión técnica" : "Firma"}</div>
                  <div className="quien">{p.firma?.nombre ?? ((p.responsables ?? []).map((r: any) => r.nombre).join(" / ") || "—")}</div>
                  <div className="rol">{p.descripcion ?? p.rol?.nombre}{p.firma?.via === "alternativo" ? " · metrólogo habilitado (emite)" : p.firma?.via === "subrogante" ? " · subrogante" : ""}</div>
                  {p.firma?.firmado_at && <div className="cuando">{fechaHora(p.firma.firmado_at)}</div>}
                </div>
              ))}
            </div>
            {circ?.errorMatriz && <div className="alert warn">{circ.errorMatriz}</div>}
            <div className={s.acciones}>
              {a.includes("ENVIAR") && <button className="btn primary" disabled={ocupado} onClick={enviar}>Firmar y enviar → Revisión Jefe Lab.</button>}
              {a.includes("FIRMAR") && <button className="btn primary" disabled={ocupado} onClick={() => firmar(false)}>Aprobar revisión técnica → Firma</button>}
              {a.includes("EMITIR") && <button className="btn primary" disabled={ocupado} onClick={() => firmar(true)}>Firmar y emitir → Entrega</button>}
              {a.includes("DEVOLVER") && <button className="btn outline" disabled={ocupado} onClick={() => setDialogo("devolver")}>Devolver al metrólogo…</button>}
              {puedeEntregar && <button className="btn primary" disabled={ocupado} onClick={() => setDialogo("entregar")}>Registrar entrega → Cierre de OT</button>}
              {c.estado === "emitida" && c.ot_id && puede(["certificado.entregar", "metrologia.crear"]) && (
                <button className="btn outline" disabled={ocupado} onClick={() => setDialogo("correo")}>Enviar por correo…</button>
              )}
              {a.includes("REEMITIR") && <button className="btn outline" disabled={ocupado} onClick={() => setDialogo("reemitir")}>Reemitir…</button>}
              <button className="btn outline" onClick={verPdf}>{c.estado === "emitida" ? "Certificado (PDF)" : "Borrador (PDF)"}</button>
              {!a.some((x) => ["ENVIAR", "FIRMAR", "EMITIR"].includes(x)) && c.paso_pendiente && (
                <span className={s.espera}>Esperando a {c.paso_pendiente.rol}{c.paso_pendiente.responsables?.length ? ` (${c.paso_pendiente.responsables.join(" / ")})` : ""}.</span>
              )}
            </div>
            {c.estado === "emitida" && (
              <div className={`alert ${c.entregado_at ? "success" : "info"}`} style={{ margin: 0 }}>
                {c.entregado_at
                  ? <>Entregado el {fechaDia(c.entregado_at)} · {textoMedio(c.entrega_medio)} · a {c.entrega_destinatario}{c.entregado_por_nombre ? ` · registró ${c.entregado_por_nombre}` : ""}.</>
                  : <>Certificado emitido: fecha congelada y solo lectura. Falta registrar su entrega{c.ot_id ? "" : " (calibración sin OT ligada: se entrega fuera del LIMS)"}.</>}
              </div>
            )}
          </section>
          {!["emitida", "reemplazada"].includes(c.estado) && (
            <section className={s.bloque}>
              <h2>Presentación del certificado</h2>
              <PresentacionCertificado id={id} magnitud={c.magnitud_nombre ?? c.magnitud ?? ""} onGuardado={() => { setDoc(""); cargar(); }} />
            </section>
          )}
          <section className={s.bloque}>
            <h2>{c.estado === "emitida" || c.estado === "reemplazada" ? "Certificado emitido (sellado)" : "Certificado en borrador · la fecha de emisión se fija al firmar"}</h2>
            {doc
              ? <iframe title={`Certificado ${nombre}`} className={s.certificado} sandbox="" srcDoc={doc} />
              : docError ? <div className="alert warn" style={{ margin: 0 }}>{docError}</div>
              : <p className="subtitle" style={{ margin: 0 }}>Preparando el certificado…</p>}
          </section>
        </div>
      )}

      {tab === "en" && (
        <section className={s.bloque}>
          <h2>Error normalizado frente a la calibración anterior (informativo)</h2>
          {!anterior ? <p className="subtitle" style={{ margin: 0 }}>Buscando la calibración anterior…</p>
            : anterior.data ? (
              <>
                <p style={{ margin: "0 0 8px", fontSize: 12.5 }}>
                  Calibración anterior en el LIMS: <Link href={`/metrologia/${anterior.data.id}` as any} className="codigo" style={{ color: "var(--accent)" }}>{anterior.data.numero_certificado}</Link>
                  {anterior.data.emitido_at ? ` · emitida el ${fechaDia(anterior.data.emitido_at)}` : ""}. E<sub>n</sub> = |E − E<sub>ant</sub>| / √(U² + U<sub>ant</sub>²),
                  con la U informada en cada certificado. Es de uso interno y no bloquea el envío. Criterio vigente: E<sub>n</sub> {anterior.criterio === "<1" ? "<" : "≤"} 1
                  (Administración › Parámetros del sistema; por confirmar con el IDIC).
                </p>
                {anterior.motivo && <div className="alert info" style={{ margin: "0 0 8px" }}>{anterior.motivo}</div>}
                {(anterior.filas ?? []).length > 0 && (
                  <div style={{ overflowX: "auto" }}>
                    <table className="data">
                      <thead><tr><th scope="col">Nominal</th><th scope="col">Error actual</th><th scope="col">U actual</th><th scope="col">Error anterior</th><th scope="col">U anterior</th><th scope="col">E<sub>n</sub></th><th scope="col">Criterio</th></tr></thead>
                      <tbody>{anterior.filas.map((f: any, i: number) => (
                        <tr key={i}>
                          <td className="num">{fmtG(f.nominal)}{f.unidad ? ` ${f.unidad}` : ""}</td>
                          {[f.error, f.U, f.errorAnterior, f.Uanterior].map((v: any, j: number) => <td key={j} className={`num ${s.calc}`}>{v == null ? "—" : fmtG(v)}</td>)}
                          <td className={`num ${s.calc}`}>{f.en == null ? "—" : f.en.toLocaleString("es-CL", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}</td>
                          <td>{f.criterio === "compatible" ? <span className="pill green">Compatible</span>
                            : f.criterio === "revisar" ? <span className="pill amber">Revisar (informativo)</span>
                            : <span style={{ color: "var(--muted)", fontSize: 12 }}>{f.criterio === "sin_punto_anterior" ? "Sin el mismo punto en la anterior" : "Faltan error o U"}</span>}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
              </>
            ) : <p style={{ margin: 0, fontSize: 12.5 }}>{anterior.motivo ?? "Sin calibración anterior en el LIMS."} Eₙ no se calcula.</p>}
        </section>
      )}

      </div>

      <section className={s.bloque}>
        <h2>Bitácora</h2>
        {(c.eventos ?? []).length ? (
          <table className="data">
            <thead><tr><th>Fecha</th><th>Usuario</th><th>Evento</th><th>Comentario</th></tr></thead>
            <tbody>{c.eventos.map((e: any, i: number) => (
              <tr key={i}><td style={{ whiteSpace: "nowrap" }}>{fechaHora(e.created_at)}</td><td>{e.usuario ?? "—"}</td><td>{ACCION_EVENTO[e.accion] ?? e.accion}</td><td>{e.comentario ?? ""}</td></tr>
            ))}</tbody>
          </table>
        ) : <p className="subtitle" style={{ margin: 0 }}>Sin eventos.</p>}
        {c.ot_id && <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "8px 0 0" }}>Origen de la OT: {ORIGEN_OT[c.origen] ?? "—"}.</p>}
      </section>

      {(dialogo === "devolver" || dialogo === "reemitir") && (
        <MotivoDialogo
          titulo={dialogo === "devolver" ? `Devolver ${c.codigo} al metrólogo` : `Reemitir el certificado ${c.numero_certificado}`}
          texto={dialogo === "devolver"
            ? "Indique qué debe corregir. El motivo queda en la bitácora; la calibración vuelve a «Toma de datos» y las firmas hechas se anulan."
            : "Se crea un borrador con los mismos datos. Al emitirse, dirá que reemplaza a este certificado, que quedará «reemplazado»."}
          boton={dialogo === "devolver" ? "Devolver al metrólogo" : "Crear reemisión"}
          ocupado={ocupado} onCerrar={() => setDialogo(null)}
          onGuardar={(motivo) => accion(dialogo, { motivo }, dialogo === "devolver" ? `${c.codigo} devuelta al metrólogo.` : "Reemisión creada.")} />
      )}
      {dialogo === "correo" && (
        <CorreoDialogo numero={nombre} entregado={!!c.entregado_at} ocupado={ocupado} onCerrar={() => setDialogo(null)} onEnviar={async (b) => {
          setOcupado(true);
          try {
            const r = await llamar("POST", `/ot/${c.ot_id}/calibraciones/${c.id}/enviar-correo`, b);
            if (r?.data?.ok) { toast.ok(`Certificado ${nombre} enviado a ${r.data.destinatarios.join(", ")}${r.data.entregado && !c.entregado_at ? " · entrega registrada" : ""}.`); setDialogo(null); }
            else toast.error(r?.data?.error ?? "No se pudo enviar el correo.");
            await cargar();
          } catch (e: any) { toast.error(e.message); }
          finally { setOcupado(false); }
        }} />
      )}
      {dialogo === "entregar" && (
        <EntregaDialogo numero={nombre} ocupado={ocupado} onCerrar={() => setDialogo(null)} onGuardar={async (b) => {
          setOcupado(true);
          try { await llamar("POST", `/ot/${c.ot_id}/calibraciones/${c.id}/entregar`, b); toast.ok(`Entrega de ${nombre} registrada.`); setDialogo(null); await cargar(); }
          catch (e: any) { toast.error(e.message); }
          finally { setOcupado(false); }
        }} />
      )}
    </div>
  );
}

function MotivoDialogo({ titulo, texto, boton, ocupado, onCerrar, onGuardar }: { titulo: string; texto: string; boton: string; ocupado: boolean; onCerrar: () => void; onGuardar: (m: string) => void }) {
  const [m, setM] = useState("");
  return (
    <Modal titulo={titulo} onCerrar={onCerrar} acciones={<>
      <button className="btn outline" onClick={onCerrar}>Cancelar</button>
      <button className="btn primary" disabled={ocupado || m.trim().length < 5} onClick={() => onGuardar(m.trim())}>{boton}</button>
    </>}>
      <p style={{ marginTop: 0, color: "var(--muted)" }}>{texto}</p>
      <div className="field"><label htmlFor="mf-m">Motivo <span className="req">*</span></label><textarea id="mf-m" rows={4} value={m} onChange={(e) => setM(e.target.value)} /></div>
      <small style={{ color: "var(--muted)" }}>Mínimo 5 caracteres.</small>
    </Modal>
  );
}

function CorreoDialogo({ numero, entregado, ocupado, onCerrar, onEnviar }: { numero: string; entregado: boolean; ocupado: boolean; onCerrar: () => void; onEnviar: (b: any) => void }) {
  const [para, setPara] = useState("");
  const [mensaje, setMensaje] = useState("");
  const lista = para.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
  const malos = lista.filter((x) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
  return (
    <Modal titulo={`Enviar por correo el certificado ${numero}`} onCerrar={onCerrar} acciones={<>
      <button className="btn outline" onClick={onCerrar}>Cancelar</button>
      <button className="btn primary" disabled={ocupado || !lista.length || malos.length > 0} onClick={() => onEnviar({ destinatarios: lista, mensaje: mensaje.trim() || null })}>Enviar → registrar entrega</button>
    </>}>
      <p style={{ marginTop: 0, color: "var(--muted)" }}>Se adjunta el PDF sellado con su código de verificación.{entregado ? " La entrega ya está registrada: el envío queda en la bitácora." : " Si el correo sale, la entrega queda registrada con el medio «correo»."}</p>
      <div className="field"><label htmlFor="cf-p">Para <span className="req">*</span></label>
        <input id="cf-p" type="text" inputMode="email" autoComplete="off" value={para} onChange={(e) => setPara(e.target.value)} aria-describedby="cf-p-ayuda" />
        <small id="cf-p-ayuda" style={{ color: malos.length ? "var(--danger, #b42318)" : "var(--muted)" }}>{malos.length ? `Revise: ${malos.join(", ")}` : "Uno o más correos separados por coma."}</small></div>
      <div className="field"><label htmlFor="cf-m">Mensaje (opcional)</label><textarea id="cf-m" rows={3} maxLength={1000} value={mensaje} onChange={(e) => setMensaje(e.target.value)} /></div>
    </Modal>
  );
}

function EntregaDialogo({ numero, ocupado, onCerrar, onGuardar }: { numero: string; ocupado: boolean; onCerrar: () => void; onGuardar: (b: any) => void }) {
  const [f, setF] = useState({ fecha: new Date().toLocaleDateString("sv-SE", { timeZone: "America/Santiago" }), medio: "", destinatario: "", observacion: "" });
  const ok = f.fecha && f.medio && f.destinatario.trim().length >= 2;
  return (
    <Modal titulo={`Registrar la entrega del certificado ${numero}`} onCerrar={onCerrar} acciones={<>
      <button className="btn outline" onClick={onCerrar}>Cancelar</button>
      <button className="btn primary" disabled={ocupado || !ok} onClick={() => onGuardar({ fecha: f.fecha, medio: f.medio, destinatario: f.destinatario.trim(), observacion: f.observacion.trim() || null })}>Registrar entrega → Cierre de OT</button>
    </>}>
      <div className="form-grid cols-2">
        <div className="field"><label htmlFor="ef-f">Fecha de entrega <span className="req">*</span></label><input id="ef-f" type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></div>
        <div className="field"><label htmlFor="ef-m">Medio <span className="req">*</span></label>
          <select id="ef-m" value={f.medio} onChange={(e) => setF({ ...f, medio: e.target.value })}>
            <option value="">Seleccione…</option>{MEDIOS_ENTREGA.map((m) => <option key={m.valor} value={m.valor}>{m.texto}</option>)}
          </select></div>
        <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="ef-d">Destinatario <span className="req">*</span></label><input id="ef-d" maxLength={160} value={f.destinatario} onChange={(e) => setF({ ...f, destinatario: e.target.value })} /></div>
        <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="ef-o">Observación</label><input id="ef-o" maxLength={1000} value={f.observacion} onChange={(e) => setF({ ...f, observacion: e.target.value })} /></div>
      </div>
    </Modal>
  );
}
