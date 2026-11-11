"use client";
/**
 * Sesión R12 (Delegación Nº 11): armas pendientes de una nueva resolución y
 * devoluciones técnicas en cualquier paso.
 *  · «Dejar pendiente»: el arma falló o su serie no coincide con la resolución;
 *    no se certifica ni se entrega hasta que llegue la nueva resolución.
 *  · «Liberar»: llegó la nueva resolución; el arma vuelve a su curso.
 *  · «Devolver»: por motivos técnicos se anula su certificado (si lo tiene) y
 *    sus resultados vuelven al inspector para rehacer las pruebas.
 * API: POST /d11/armas/:id/{pendiente,liberar,devolver}.
 */
import { useState } from "react";
import { fechaHora } from "@/lib/format";
import type { Accion, ExpedienteD11 } from "@/lib/d11";

type Modo = { armaId: string; tipo: "pendiente" | "liberar" | "devolver" } | null;

const MOTIVOS = [
  { valor: "falla", etiqueta: "Falló en las pruebas" },
  { valor: "serie_distinta", etiqueta: "La serie no coincide con la resolución" },
  { valor: "otro", etiqueta: "Otro motivo" },
];

export default function EsperaDevoluciones({ d, accion }: { d: ExpedienteD11; accion: Accion }) {
  const [modo, setModo] = useState<Modo>(null);
  const [motivo, setMotivo] = useState("falla");
  const [texto, setTexto] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const abierta = d.ot.abierta;
  const pendientes = d.armas.filter((a) => a.pendiente);
  const devoluciones = d.devoluciones ?? [];
  const puedeRegistrar = abierta && d.puedo.registrar;
  const puedeDevolver = abierta && !!d.puedo.devolver;
  if (!d.armas.length) return null;

  const abrir = (armaId: string, tipo: "pendiente" | "liberar" | "devolver") => {
    setModo({ armaId, tipo });
    setMotivo("falla");
    setTexto("");
  };

  const enviar = async () => {
    if (!modo) return;
    setOcupado(true);
    const ruta = `/d11/armas/${modo.armaId}/${modo.tipo}`;
    const cuerpo =
      modo.tipo === "pendiente" ? { motivo, detalle: texto.trim() || null } : modo.tipo === "liberar" ? { resolucion: texto.trim() } : { motivo: texto.trim() };
    const ok = modo.tipo === "pendiente" ? "Arma pendiente de nueva resolución." : modo.tipo === "liberar" ? "Arma liberada: sigue su curso." : "Arma devuelta para rehacer las pruebas.";
    const r = await accion("POST", ruta, cuerpo, ok);
    setOcupado(false);
    if (r) setModo(null);
  };

  const elegida = modo ? d.armas.find((a) => a.id === modo.armaId) : null;

  return (
    <section className="card" style={{ marginTop: 14 }} aria-labelledby="d11-espera">
      <h3 id="d11-espera" style={{ marginTop: 0 }}>Armas pendientes y devoluciones</h3>
      <p className="subtitle" style={{ marginTop: 0 }}>
        Si un arma falla o su serie no coincide con la resolución, déjela pendiente hasta la nueva resolución. En cualquier paso puede devolver un arma por
        motivos técnicos: se anula su certificado y sus resultados vuelven al inspector.
      </p>
      <table className="data" aria-label="Armas de la OT: pendientes y devoluciones">
        <thead>
          <tr><th>Arma</th><th>Serie</th><th>Estado</th><th>Acciones</th></tr>
        </thead>
        <tbody>
          {d.armas.map((a) => (
            <tr key={a.id}>
              <td className="codigo">{a.muestra}</td>
              <td>{a.serie ?? "Sin serie"}</td>
              <td>
                {a.pendiente ? (
                  <span className="pill amber" title={a.pendiente.detalle ?? undefined}>Pendiente · {a.pendiente.motivoNombre}</span>
                ) : (
                  <span className="pill gray">{a.etapaNombre}</span>
                )}
                {a.liberada && !a.pendiente && <span style={{ fontSize: 11.5, color: "var(--muted)" }}> · liberada con la resolución {a.liberada.resolucion}</span>}
              </td>
              <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {puedeRegistrar && !a.pendiente && !a.entregada && (
                  <button type="button" className="btn outline sm" onClick={() => abrir(a.id, "pendiente")}>Dejar pendiente</button>
                )}
                {puedeRegistrar && a.pendiente && (
                  <button type="button" className="btn outline sm" onClick={() => abrir(a.id, "liberar")}>Liberar</button>
                )}
                {puedeDevolver && !a.entregada && !a.certificado?.entregadoAt && (
                  <button type="button" className="btn ghost-danger sm" onClick={() => abrir(a.id, "devolver")}>Devolver</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {modo && elegida && (
        <div className="card" style={{ marginTop: 10, background: "var(--bg-soft, transparent)" }} role="group" aria-label={`Acción sobre ${elegida.muestra}`}>
          <b>
            {modo.tipo === "pendiente" ? "Dejar pendiente" : modo.tipo === "liberar" ? "Liberar con la nueva resolución" : "Devolver por motivo técnico"} · {elegida.muestra}
          </b>
          {modo.tipo === "pendiente" && (
            <div className="field" style={{ marginTop: 8 }}>
              <label htmlFor="d11-motivo">Motivo <span className="req">*</span></label>
              <select id="d11-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)}>
                {MOTIVOS.map((m) => <option key={m.valor} value={m.valor}>{m.etiqueta}</option>)}
              </select>
            </div>
          )}
          <div className="field" style={{ marginTop: 8 }}>
            <label htmlFor="d11-texto">
              {modo.tipo === "pendiente" ? "Detalle" : modo.tipo === "liberar" ? "Nº de la nueva resolución" : "Motivo técnico"}
              {(modo.tipo !== "pendiente" || motivo === "otro") && <span className="req"> *</span>}
            </label>
            {modo.tipo === "liberar" ? (
              <input id="d11-texto" value={texto} maxLength={60} onChange={(e) => setTexto(e.target.value)} />
            ) : (
              <textarea id="d11-texto" value={texto} maxLength={modo.tipo === "devolver" ? 2000 : 1000} rows={2} onChange={(e) => setTexto(e.target.value)} />
            )}
          </div>
          {modo.tipo === "devolver" && elegida.certificado && (
            <div className="alert warn" style={{ marginTop: 8 }}>Se anulará el certificado {elegida.certificado.numero}; se reemite al aprobar de nuevo.</div>
          )}
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <button type="button" className="btn primary sm" disabled={ocupado} onClick={enviar}>{ocupado ? "Guardando…" : "Confirmar"}</button>
            <button type="button" className="btn outline sm" disabled={ocupado} onClick={() => setModo(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {pendientes.length > 0 && (
        <p style={{ fontSize: 12.5, marginBottom: 0 }}>
          {pendientes.length} arma(s) esperan una nueva resolución: no se certifican ni se entregan al importador. Para cerrar la OT sus ensayos deben quedar aprobados (con el veredicto que corresponda).
        </p>
      )}

      {devoluciones.length > 0 && (
        <>
          <h4 style={{ marginBottom: 4 }}>Devoluciones registradas</h4>
          <table className="data" aria-label="Devoluciones técnicas">
            <thead><tr><th>Fecha</th><th>Arma</th><th>Paso</th><th>Motivo</th><th>Certificado anulado</th><th>Resultados devueltos</th><th>Por</th></tr></thead>
            <tbody>
              {devoluciones.map((x) => (
                <tr key={x.id}>
                  <td>{fechaHora(x.createdAt)}</td>
                  <td className="codigo">{x.muestra}</td>
                  <td>{x.etapa.replace(/_/g, " ")}</td>
                  <td>{x.motivo}</td>
                  <td>{x.certificado ?? "—"}</td>
                  <td>{x.resultados}</td>
                  <td>{x.devueltaPor ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
