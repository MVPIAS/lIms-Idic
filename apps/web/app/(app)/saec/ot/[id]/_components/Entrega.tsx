"use client";

/**
 * Paso 10 de la D11 · entrega de las armas y sus certificados al importador
 * (EP-11 11.27): se leen los códigos de barras de las etiquetas (lector en modo
 * teclado: cada lectura termina en Enter), se registra quién recibe y queda la
 * guía de entrega con el movimiento de salida de cada arma en la custodia.
 */
import { useRef, useState } from "react";
import { toast } from "@/components/ui/feedback";
import { fecha, fechaHora } from "@/lib/format";
import { abrirDocumento } from "@/lib/bpchProcesos";
import { hoyChile, type Accion, type ExpedienteD11 } from "@/lib/d11";

export default function Entrega({ d, accion }: { d: ExpedienteD11; accion: Accion }) {
  const [codigos, setCodigos] = useState<string[]>([]);
  const [lectura, setLectura] = useState("");
  const [f, setF] = useState({ receptorNombre: "", receptorDocumento: "", fecha: "", observaciones: "" });
  const [certs, setCerts] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);
  const puede = d.puedo.registrar && d.ot.abierta;
  const entregables = d.armas.filter((a) => !a.entregada && ["certificada", "no_cumple"].includes(a.etapa));
  const porCodigo = new Map(d.armas.map((a) => [a.codigoBarras.toUpperCase(), a]));

  function leer(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const c = lectura.trim().toUpperCase();
    setLectura("");
    if (!c) return;
    const a = porCodigo.get(c);
    if (!a) return toast.error(`El código ${c} no es un arma de esta OT.`);
    if (a.entregada) return toast.error(`${a.muestra} ya se entregó.`);
    if (!entregables.includes(a)) return toast.error(`${a.muestra} aún no se puede entregar (${a.etapaNombre.toLowerCase()}).`);
    setCodigos((xs) => (xs.includes(c) ? xs : [...xs, c]));
  }

  async function registrar() {
    setOcupado(true);
    const r = await accion(
      "POST",
      `/d11/ot/${d.ot.id}/entrega`,
      { ...f, receptorDocumento: f.receptorDocumento || null, observaciones: f.observaciones || null, codigos, entregarCertificados: certs },
      "Entrega registrada. Revise la guía y cierre la OT en su ficha.",
    );
    if (r) {
      for (const a of r.avisos ?? []) toast.error(a);
      setCodigos([]);
      setF({ receptorNombre: "", receptorDocumento: "", fecha: "", observaciones: "" });
      if (r.entrega?.id) abrirDocumento(`/d11/entregas/${r.entrega.id}/guia`).catch(() => null);
    }
    setOcupado(false);
  }

  const listo = codigos.length > 0 && f.receptorNombre.trim().length >= 2 && f.fecha;
  return (
    <>
      <div className="card">
        <h2>10 · Entrega al importador <span className="right">D11 / Comercial · EP-11 11.27</span></h2>
        <p className="subtitle">
          {entregables.length} arma(s) listas para entregar (certificadas, o que no cumplen y vuelven al importador). Las prohibidas no se entregan:
          su destino lo decide la DGMN.
        </p>
        {puede && entregables.length === 0 ? (
          <div className="alert info">
            {d.armas.length && d.armas.every((a) => a.entregada || a.permisibilidad === "prohibida")
              ? "Todas las armas están entregadas (o con su destino a cargo de la DGMN). Cierre la OT en su ficha › Informe y cierre."
              : "Aún no hay armas listas para entregar: deben estar certificadas (o no cumplir y volver al importador)."}
          </div>
        ) : puede ? (
          <>
            <div className="form-grid">
              <div className="field span-2">
                <label htmlFor="en-lect">Código de barras de la etiqueta</label>
                <input id="en-lect" ref={entrada} value={lectura} onChange={(e) => setLectura(e.target.value)} onKeyDown={leer} placeholder="Lea la etiqueta o escriba el código y pulse Enter" autoComplete="off" />
              </div>
              <div className="field">
                <label>Para entregar</label>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", paddingTop: 4 }}>
                  {codigos.length === 0 && <small style={{ color: "var(--muted)" }}>Ninguna leída</small>}
                  {codigos.map((c) => (
                    <span key={c} className="pill teal">
                      {c}{" "}
                      <button type="button" aria-label={`Quitar ${c}`} onClick={() => setCodigos((xs) => xs.filter((x) => x !== c))} style={{ border: 0, background: "transparent", cursor: "pointer" }}>✕</button>
                    </span>
                  ))}
                </div>
              </div>
              <div className="field span-2">
                <label htmlFor="en-rec">Recibe (nombre) <span className="req">*</span></label>
                <input id="en-rec" value={f.receptorNombre} onChange={(e) => setF({ ...f, receptorNombre: e.target.value })} maxLength={200} />
              </div>
              <div className="field">
                <label htmlFor="en-doc">Documento de quien recibe</label>
                <input id="en-doc" value={f.receptorDocumento} onChange={(e) => setF({ ...f, receptorDocumento: e.target.value })} maxLength={40} />
              </div>
              <div className="field">
                <label htmlFor="en-fecha">Fecha de entrega <span className="req">*</span></label>
                <input id="en-fecha" type="date" max={hoyChile()} value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} />
              </div>
              <div className="field span-2">
                <label htmlFor="en-obs">Observaciones</label>
                <input id="en-obs" value={f.observaciones} onChange={(e) => setF({ ...f, observaciones: e.target.value })} maxLength={2000} />
              </div>
            </div>
            {d.puedo.entregarCertificados && (
              <label style={{ display: "block", fontSize: 12.5, marginTop: 6 }}>
                <input type="checkbox" checked={certs} onChange={(e) => setCerts(e.target.checked)} /> Registrar también la entrega de los certificados oficiales de estas armas (cuenta para el cierre)
              </label>
            )}
            <div className="toolbar">
              <button type="button" className="btn primary" disabled={!listo || ocupado} onClick={registrar}>{ocupado ? "Registrando…" : "Registrar entrega → cierre"}</button>
              <button type="button" className="btn outline sm" disabled={!entregables.length} onClick={() => setCodigos(entregables.map((a) => a.codigoBarras.toUpperCase()))}>
                Agregar todas las listas ({entregables.length})
              </button>
            </div>
          </>
        ) : (
          <div className="alert info">La registra el personal de la Delegación Nº 11.</div>
        )}
      </div>

      <div className="card">
        <h2>Guías de entrega</h2>
        {d.entregas.length === 0 ? (
          <p className="subtitle" style={{ margin: 0 }}>Aún no hay entregas.</p>
        ) : (
          <table className="data">
            <thead><tr><th>Guía</th><th>Fecha</th><th>Recibe</th><th className="num">Armas</th><th>Registró</th><th></th></tr></thead>
            <tbody>
              {d.entregas.map((e) => (
                <tr key={e.id}>
                  <td className="codigo" style={{ whiteSpace: "nowrap" }}>{e.numero}</td>
                  <td>{fecha(e.fecha)}</td>
                  <td>{e.receptorNombre}{e.receptorDocumento ? ` · ${e.receptorDocumento}` : ""}</td>
                  <td className="num">{e.armas}</td>
                  <td>{e.registradaPor ?? "—"} · {fechaHora(e.createdAt)}</td>
                  <td><button type="button" className="btn outline sm" onClick={() => abrirDocumento(`/d11/entregas/${e.id}/guia`).catch((x) => toast.error(x.message))}>Ver guía</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
