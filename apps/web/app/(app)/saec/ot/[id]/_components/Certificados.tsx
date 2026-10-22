"use client";

/**
 * Pasos 7–9 de la D11: revisión y aprobación por arma (flujo general, 11.21),
 * acuñación BPCH IT08 (11.22) y certificados por arma (11.23): emisión en
 * bloque con rango de numeración, firma del rango según la matriz de firmas
 * (11.42), vigencia y QR de verificación pública.
 */
import { useState } from "react";
import Link from "next/link";
import { toast } from "@/components/ui/feedback";
import { fecha, fechaHora } from "@/lib/format";
import { abrirDocumento } from "@/lib/bpchProcesos";
import { PILL_ETAPA, type Accion, type ExpedienteD11 } from "@/lib/d11";
import { estadoDocumento } from "@/lib/documentos";

const VEREDICTO: Record<string, string> = { cumple: "green", no_cumple: "red", pendiente: "gray" };

/* --------------------------------------------------------------- 11.21 --- */
export function Revision({ d }: { d: ExpedienteD11 }) {
  if (!d.armas.length) return <div className="alert info">Aún no hay armas registradas.</div>;
  const porRevisar = d.armas.filter((a) => a.clase && a.pendientes === 0 && a.aprobados < a.ensayos).length;
  return (
    <div className="card">
      <h2>7 · Revisión y aprobación por arma <span className="right">Jefe D11 · flujo general (cuatro ojos)</span></h2>
      <p className="subtitle">
        Cada arma cumple si todos sus defectos son 0 y los valores medidos están dentro de rango. Nada se aprueba solo: el Jefe revisa y aprueba en
        «Captura y revisión por OT» (quien capturó no revisa ni aprueba). El identificador IBIS de la evidencia balística es informativo: el revisor
        lo marca como tal.
      </p>
      <div className="toolbar" style={{ marginTop: 0 }}>
        <Link href={`/captura-ot?otId=${d.ot.id}` as any} className="btn primary sm">Revisar y aprobar en Captura y revisión por OT →</Link>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>{porRevisar} arma(s) con ensayos por revisar o aprobar.</span>
      </div>
      <table className="data">
        <thead><tr><th>Muestra</th><th>Arma</th><th>Camino</th><th className="num">Ensayos</th><th className="num">Por capturar</th><th className="num">Aprobados</th><th>Veredicto</th><th>Etapa</th></tr></thead>
        <tbody>
          {d.armas.map((a) => (
            <tr key={a.id}>
              <td className="codigo" style={{ whiteSpace: "nowrap" }}>{a.muestra}</td>
              <td>{a.tipoNombre} {a.marca} {a.modelo} · {a.serie ?? "sin serie"}</td>
              <td>{a.caminoNombre ?? (a.permisibilidad === "prohibida" ? "—" : "Por clasificar")}</td>
              <td className="num">{a.ensayos}</td>
              <td className="num">{a.pendientes}</td>
              <td className="num">{a.aprobados}</td>
              <td>{a.veredicto ? <span className={`pill ${VEREDICTO[a.veredicto] ?? "gray"}`}>{a.veredicto.replace("_", " ")}</span> : "—"}</td>
              <td><span className={`pill ${PILL_ETAPA[a.etapa] ?? "gray"}`}>{a.etapaNombre}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* --------------------------------------------------------------- 11.22 --- */
export function Acunacion({ d, accion }: { d: ExpedienteD11; accion: Accion }) {
  const porAcunar = d.armas.filter((a) => a.puedeAcunar);
  const acunadas = d.armas.filter((a) => a.acunacion);
  const [vals, setVals] = useState<Record<string, { numero: string; anio: string }>>({});
  const [desde, setDesde] = useState("");
  const [anio, setAnio] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const puede = d.puedo.registrar && d.ot.abierta;
  const elegidas = Object.entries(vals).filter(([, v]) => v.numero.trim() || v.anio.trim());
  const listo = elegidas.length > 0 && elegidas.every(([, v]) => v.numero.trim() && /^\d{4}$/.test(v.anio));

  function numerar() {
    const n0 = Number(desde);
    if (!Number.isInteger(n0) || n0 < 0 || !/^\d{4}$/.test(anio)) return toast.error("Indique el primer Nº de cuño (entero) y el año (4 cifras).");
    const n: Record<string, { numero: string; anio: string }> = {};
    porAcunar.forEach((a, i) => (n[a.id] = { numero: String(n0 + i), anio }));
    setVals(n);
  }
  async function enviar() {
    setOcupado(true);
    const r = await accion(
      "POST",
      `/d11/ot/${d.ot.id}/acunacion`,
      { items: elegidas.map(([armaOtId, v]) => ({ armaOtId, numero: v.numero.trim(), anio: Number(v.anio) })) },
      `${elegidas.length} arma(s) acuñadas. Siguiente paso: certificados.`,
    );
    if (r) setVals({});
    setOcupado(false);
  }

  return (
    <div className="card">
      <h2>8 · Acuñación BPCH (DTCG-PG03-IT08) <span className="right">Armero · EP-11 11.22</span></h2>
      <p className="subtitle">
        Solo las armas que cumplen y van por prueba completa{d.config.acunacionCip ? " (y, por configuración, las de cuño CIP)" : ""}. Anote el Nº y el año del cuño estampado.
      </p>
      {porAcunar.length === 0 ? (
        <p className="subtitle" style={{ margin: 0 }}>{acunadas.length ? "No quedan armas por acuñar." : "Aún no hay armas aprobadas que se acuñen."}</p>
      ) : (
        <>
          {puede && (
            <div className="toolbar" style={{ marginTop: 0 }}>
              <label htmlFor="ac-desde" style={{ fontSize: 12 }}>Numerar en orden desde el Nº</label>
              <input id="ac-desde" inputMode="numeric" value={desde} onChange={(e) => setDesde(e.target.value.replace(/\D/g, ""))} style={{ width: 90 }} />
              <label htmlFor="ac-anio" style={{ fontSize: 12 }}>año</label>
              <input id="ac-anio" inputMode="numeric" maxLength={4} value={anio} onChange={(e) => setAnio(e.target.value.replace(/\D/g, ""))} style={{ width: 70 }} />
              <button type="button" className="btn outline sm" onClick={numerar}>Numerar</button>
            </div>
          )}
          <table className="data">
            <thead><tr><th>Muestra</th><th>Arma</th><th>Serie</th><th>Nº de cuño</th><th>Año</th></tr></thead>
            <tbody>
              {porAcunar.map((a) => {
                const v = vals[a.id] ?? { numero: "", anio: "" };
                return (
                  <tr key={a.id}>
                    <td className="codigo" style={{ whiteSpace: "nowrap" }}>{a.muestra}</td>
                    <td>{a.tipoNombre} {a.marca} {a.modelo}</td>
                    <td>{a.serie ?? "sin serie"}</td>
                    <td><input aria-label={`Nº de cuño de ${a.muestra}`} disabled={!puede} value={v.numero} onChange={(e) => setVals((s) => ({ ...s, [a.id]: { ...v, numero: e.target.value } }))} maxLength={30} style={{ width: 110 }} /></td>
                    <td><input aria-label={`Año del cuño de ${a.muestra}`} disabled={!puede} inputMode="numeric" maxLength={4} value={v.anio} onChange={(e) => setVals((s) => ({ ...s, [a.id]: { ...v, anio: e.target.value.replace(/\D/g, "") } }))} style={{ width: 70 }} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {puede && (
            <div className="toolbar">
              <button type="button" className="btn primary" disabled={!listo || ocupado} onClick={enviar}>{ocupado ? "Guardando…" : "Acuñar → certificar"}</button>
            </div>
          )}
        </>
      )}
      {acunadas.length > 0 && (
        <p style={{ fontSize: 12, margin: "10px 0 0" }}>
          Acuñadas: {acunadas.map((a) => `${a.muestra} (Nº ${a.acunacion!.numero}/${a.acunacion!.anio})`).join(" · ")}
        </p>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- 11.23 --- */
export function Certificados({ d, accion }: { d: ExpedienteD11; accion: Accion }) {
  const certificables = d.armas.filter((a) => a.puedeCertificar);
  const conCert = d.armas.filter((a) => a.certificado);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [ocupado, setOcupado] = useState(false);
  const puede = d.puedo.emitir && d.ot.abierta;

  async function emitir() {
    setOcupado(true);
    const r = await accion("POST", `/d11/ot/${d.ot.id}/certificados`, { armaOtIds: [...marcadas] }, `Certificados emitidos: quedan en firma según la matriz de la D11.`);
    if (r) {
      setMarcadas(new Set());
      for (const f of r.fallos ?? []) toast.error(f);
    }
    setOcupado(false);
  }
  async function firmar(id: string) {
    const r = await accion("POST", `/d11/emisiones/${id}/firmar`, {}, "Rango firmado: los certificados quedan oficiales.");
    for (const f of r?.fallos ?? []) toast.error(f);
  }
  const ver = (id: string) => abrirDocumento(`/informes/${id}/html`).catch((e) => toast.error(e.message));

  return (
    <>
      <div className="card">
        <h2>9 · Certificados por arma <span className="right">Jefe D11 · DTCG-PG03-IT11 · EP-11 11.23</span></h2>
        <p className="subtitle">
          Un certificado por arma, con vigencia de <b>{d.config.vigenciaAnios} años</b> desde la emisión, código de verificación con QR y huella SHA-256.
          Se emiten en bloque: el sistema reserva un rango de números y los deja en firma según la matriz de firmas de la D11.
        </p>
        {certificables.length === 0 ? (
          <p className="subtitle" style={{ margin: 0 }}>No hay armas listas para certificar (aprobadas, que cumplen y acuñadas si corresponde).</p>
        ) : (
          <>
            <table className="data">
              <thead>
                <tr>
                  {puede && (
                    <th>
                      <input type="checkbox" aria-label="Marcar todas" checked={marcadas.size === certificables.length}
                        onChange={(e) => setMarcadas(e.target.checked ? new Set(certificables.map((a) => a.id)) : new Set())} />
                    </th>
                  )}
                  <th>Muestra</th><th>Arma</th><th>Serie</th><th>Calibre</th><th>Acuñación</th>
                </tr>
              </thead>
              <tbody>
                {certificables.map((a) => (
                  <tr key={a.id}>
                    {puede && (
                      <td>
                        <input type="checkbox" aria-label={`Certificar ${a.muestra}`} checked={marcadas.has(a.id)}
                          onChange={(e) => setMarcadas((m) => { const n = new Set(m); e.target.checked ? n.add(a.id) : n.delete(a.id); return n; })} />
                      </td>
                    )}
                    <td className="codigo" style={{ whiteSpace: "nowrap" }}>{a.muestra}</td>
                    <td>{a.tipoNombre} {a.marca} {a.modelo}</td>
                    <td>{a.serie ?? "sin serie"}</td>
                    <td>{a.calibre}</td>
                    <td>{a.acunacion ? `Nº ${a.acunacion.numero}/${a.acunacion.anio}` : "No corresponde"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {puede ? (
              <div className="toolbar">
                <button type="button" className="btn primary" disabled={!marcadas.size || ocupado} onClick={emitir}>
                  {ocupado ? "Emitiendo…" : `Emitir ${marcadas.size || ""} certificado(s) → firma`}
                </button>
              </div>
            ) : (
              <div className="alert info" style={{ marginTop: 8 }}>Los emite el Jefe de la Delegación Nº 11.</div>
            )}
          </>
        )}
        {d.armas.some((a) => !a.puedeCertificar && !a.certificado && a.motivoNoCertifica) && (
          <details style={{ marginTop: 8, fontSize: 12 }}>
            <summary>Por qué otras armas aún no se certifican</summary>
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {d.armas.filter((a) => !a.puedeCertificar && !a.certificado && a.motivoNoCertifica).map((a) => <li key={a.id}>{a.muestra}: {a.motivoNoCertifica}</li>)}
            </ul>
          </details>
        )}
      </div>

      <div className="card">
        <h2>Rangos de certificados de la OT {d.ot.codigo}</h2>
        {d.emisiones.length === 0 ? (
          <p className="subtitle" style={{ margin: 0 }}>Aún no se emiten certificados.</p>
        ) : (
          <table className="data">
            <thead><tr><th>Desde</th><th>Hasta</th><th className="num">Cantidad</th><th>Estado</th><th>Emitido</th><th></th></tr></thead>
            <tbody>
              {d.emisiones.map((e) => (
                <tr key={e.id}>
                  <td className="codigo" style={{ whiteSpace: "nowrap" }}>{e.desde}</td>
                  <td className="codigo" style={{ whiteSpace: "nowrap" }}>{e.hasta}</td>
                  <td className="num">{e.cantidad}</td>
                  <td>
                    {e.enFirma > 0 && <span className="pill amber">{e.enFirma} en firma</span>}{" "}
                    {e.oficiales > 0 && <span className="pill green">{e.oficiales} oficiales</span>}{" "}
                    {e.entregados > 0 && <span className="pill teal">{e.entregados} entregados</span>}{" "}
                    {e.anulados > 0 && <span className="pill gray">{e.anulados} devueltos o anulados</span>}
                  </td>
                  <td>{fechaHora(e.createdAt)}{e.emitidaPor ? ` · ${e.emitidaPor}` : ""}</td>
                  <td>{e.enFirma > 0 && d.ot.abierta && <button type="button" className="btn primary sm" onClick={() => firmar(e.id)}>Firmar el rango</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="subtitle" style={{ margin: "8px 0 0" }}>
          «Firmar el rango» firma todos sus certificados en firma si a usted le toca según la matriz (por confirmar con el IDIC: ¿firma cada
          certificado o cada OT? EP-11 P2). También se firman uno a uno en «Documentos por firmar».
        </p>
      </div>

      {conCert.length > 0 && (
        <div className="card">
          <h2>Certificados emitidos</h2>
          <table className="data">
            <thead><tr><th>Nº</th><th>Muestra</th><th>Arma</th><th>Vigencia</th><th>Estado</th><th>Entrega</th><th></th></tr></thead>
            <tbody>
              {conCert.map((a) => {
                const c = a.certificado!;
                const e = estadoDocumento(c.estado);
                return (
                  <tr key={a.id}>
                    <td className="codigo" style={{ whiteSpace: "nowrap" }}>{c.numero}</td>
                    <td>{a.muestra}</td>
                    <td>{a.marca} {a.modelo} · {a.serie ?? "sin serie"}</td>
                    <td>{c.vigenteDesde ? `${fecha(c.vigenteDesde)} → ${fecha(c.vigenteHasta)}` : "—"}</td>
                    <td><span className={`pill ${e.pill}`}>{e.texto}</span></td>
                    <td>{c.entregadoAt ? fecha(c.entregadoAt) : "—"}</td>
                    <td><button type="button" className="btn outline sm" onClick={() => ver(c.id)}>Ver certificado</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
