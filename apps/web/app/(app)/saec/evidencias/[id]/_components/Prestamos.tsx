"use client";

/**
 * EP-11 11.33 · Préstamo y devolución de una evidencia: solicitud con plazo,
 * aprobación (o rechazo con motivo), entrega con acta de salida y reingreso con
 * estado y nueva ubicación. Alerta cuando el plazo de devolución venció.
 * Estados: solicitado → aprobado/rechazado → entregado → devuelto.
 */
import { useState } from "react";
import { fechaDia, fechaHora } from "@/lib/format";
import { usePermisos } from "@/lib/permisos";
import { toast } from "@/components/ui/feedback";
import { abrirDocumento } from "@/lib/bpchProcesos";
import { hoyChile, pedir } from "@/lib/d11";

const ESTADO: Record<string, { texto: string; pill: string }> = {
  solicitado: { texto: "Solicitado · espera aprobación", pill: "amber" },
  aprobado: { texto: "Aprobado · espera entrega", pill: "blue" },
  rechazado: { texto: "Rechazado", pill: "red" },
  entregado: { texto: "Entregado · fuera de bodega", pill: "red" },
  devuelto: { texto: "Devuelto", pill: "green" },
};
const VACIO = { organismoSolicitante: "", solicitanteNombre: "", solicitanteDocumento: "", motivo: "", fechaDevolucionPrevista: "" };

export default function Prestamos({ evidencia, onCambio }: { evidencia: any; onCambio: () => void }) {
  const { puede } = usePermisos();
  const [abierto, setAbierto] = useState(false);
  const [f, setF] = useState({ ...VACIO });
  const [error, setError] = useState("");
  const [entrada, setEntrada] = useState<Record<string, Record<string, string>>>({});
  const prestamos: any[] = evidencia.prestamos ?? [];
  const valor = (id: string, k: string) => entrada[id]?.[k] ?? "";
  const poner = (id: string, k: string, v: string) => setEntrada((x) => ({ ...x, [id]: { ...(x[id] ?? {}), [k]: v } }));
  const puedeSolicitar = puede("evidencia.prestar") && evidencia.estado !== "prestada" && !prestamos.some((p) => ["solicitado", "aprobado", "entregado"].includes(p.estado));

  async function accion(ruta: string, cuerpo: unknown, ok: string) {
    try {
      await pedir("POST", ruta, cuerpo);
      toast.ok(ok);
      onCambio();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function solicitar(ev: React.FormEvent) {
    ev.preventDefault();
    setError("");
    const faltan = [
      !f.organismoSolicitante.trim() && "el organismo",
      !f.solicitanteNombre.trim() && "el solicitante",
      !f.motivo.trim() && "el motivo",
      !f.fechaDevolucionPrevista && "el plazo de devolución",
    ].filter(Boolean);
    if (faltan.length) return setError(`Indique ${faltan.join(", ")}.`);
    try {
      await pedir("POST", `/evidencias/${evidencia.id}/prestamos`, { tipo: "entrega", ...f, solicitanteDocumento: f.solicitanteDocumento || null });
      toast.ok("Solicitud registrada: queda a la espera de aprobación.");
      setF({ ...VACIO });
      setAbierto(false);
      onCambio();
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div className="card card--table" style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h3 style={{ margin: 0, flex: 1 }}>Préstamos y devoluciones</h3>
        {puedeSolicitar && (
          <button type="button" className="btn sm primary" onClick={() => setAbierto((x) => !x)} aria-expanded={abierto}>
            {abierto ? "Cerrar" : "＋ Solicitud de préstamo"}
          </button>
        )}
      </div>
      {prestamos.some((p) => p.vencido) && (
        <div className="alert warn" role="alert" style={{ marginTop: 8 }}>
          El plazo de devolución venció: la evidencia sigue fuera de la bodega. Gestione su devolución con el organismo.
        </div>
      )}
      {abierto && (
        <form onSubmit={solicitar} style={{ margin: "10px 0 14px" }} aria-label="Solicitud de préstamo">
          {error && <div className="alert warn" role="alert">{error}</div>}
          <div className="form-grid">
            <div className="field"><label htmlFor="pr-org">Organismo solicitante <span className="req">*</span></label>
              <input id="pr-org" placeholder="Fiscalía, PDI, Carabineros, tribunal" value={f.organismoSolicitante} onChange={(e) => setF({ ...f, organismoSolicitante: e.target.value })} /></div>
            <div className="field"><label htmlFor="pr-sol">Solicitante <span className="req">*</span></label>
              <input id="pr-sol" placeholder="Nombre o cargo" value={f.solicitanteNombre} onChange={(e) => setF({ ...f, solicitanteNombre: e.target.value })} /></div>
            <div className="field"><label htmlFor="pr-doc">Documento (oficio, NUE o RUC)</label>
              <input id="pr-doc" maxLength={40} value={f.solicitanteDocumento} onChange={(e) => setF({ ...f, solicitanteDocumento: e.target.value })} /></div>
            <div className="field"><label htmlFor="pr-plazo">Plazo de devolución <span className="req">*</span></label>
              <input id="pr-plazo" type="date" min={hoyChile()} value={f.fechaDevolucionPrevista} onChange={(e) => setF({ ...f, fechaDevolucionPrevista: e.target.value })} /></div>
            <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="pr-mot">Motivo <span className="req">*</span></label>
              <textarea id="pr-mot" rows={2} value={f.motivo} onChange={(e) => setF({ ...f, motivo: e.target.value })} /></div>
          </div>
          <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
            <button className="btn primary sm">Solicitar préstamo → aprobación</button>
          </div>
        </form>
      )}
      <table className="data" style={{ marginTop: 8 }}>
        <thead>
          <tr><th>Código</th><th>Organismo · solicitante</th><th>Plazo</th><th>Estado</th><th>Siguiente paso</th></tr>
        </thead>
        <tbody>
          {prestamos.map((p) => (
            <tr key={p.id}>
              <td className="codigo">{p.codigo}<small style={{ display: "block" }}>{fechaHora(p.fecha_solicitud)}</small></td>
              <td>{p.organismo_solicitante}<small style={{ display: "block" }}>{p.solicitante_nombre}{p.solicitante_documento ? ` · ${p.solicitante_documento}` : ""}</small></td>
              <td>{p.fecha_devolucion_prevista ? fechaDia(p.fecha_devolucion_prevista) : "—"}{p.vencido && <span className="pill red" style={{ marginLeft: 4 }}>Vencido</span>}</td>
              <td>
                <span className={`pill ${ESTADO[p.estado]?.pill ?? "gray"}`}>{ESTADO[p.estado]?.texto ?? p.estado}</span>
                {p.motivo_rechazo && <small style={{ display: "block" }}>Motivo: {p.motivo_rechazo}</small>}
                {p.receptor_nombre && <small style={{ display: "block" }}>Recibió: {p.receptor_nombre}</small>}
                {p.estado_reingreso && <small style={{ display: "block" }}>Reingreso: {p.estado_reingreso} · {p.ubicacion_retorno}</small>}
              </td>
              <td style={{ minWidth: 260 }}>
                {p.estado === "solicitado" && (puede("evidencia.aprobar") ? (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button type="button" className="btn sm success" onClick={() => accion(`/prestamos-evidencia/${p.id}/aprobar`, {}, "Préstamo aprobado: el custodio puede entregar.")}>Aprobar → entregar</button>
                    <input aria-label="Motivo del rechazo" placeholder="Motivo del rechazo" value={valor(p.id, "rechazo")} onChange={(e) => poner(p.id, "rechazo", e.target.value)} style={{ flex: 1, minWidth: 120 }} />
                    <button type="button" className="btn sm ghost-danger" disabled={!valor(p.id, "rechazo").trim()}
                      onClick={() => accion(`/prestamos-evidencia/${p.id}/rechazar`, { motivoRechazo: valor(p.id, "rechazo") }, "Solicitud rechazada.")}>Rechazar</button>
                  </div>
                ) : <small>Le toca aprobar a la jefatura de la D11.</small>)}
                {p.estado === "aprobado" && (puede("evidencia.custodiar") ? (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <input aria-label="Quién recibe" placeholder="Quién recibe (acta de salida)" value={valor(p.id, "receptor")} onChange={(e) => poner(p.id, "receptor", e.target.value)} style={{ flex: 1, minWidth: 140 }} />
                    <button type="button" className="btn sm primary" disabled={valor(p.id, "receptor").trim().length < 3}
                      onClick={() => accion(`/prestamos-evidencia/${p.id}/entregar`, { receptorNombre: valor(p.id, "receptor") }, "Entrega registrada: la evidencia sale de la bodega.")}>Registrar entrega</button>
                  </div>
                ) : <small>Le toca entregar al custodio.</small>)}
                {p.estado === "entregado" && (puede("evidencia.custodiar") ? (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <input aria-label="Estado en que vuelve" placeholder="Estado (sellos, integridad)" value={valor(p.id, "estado")} onChange={(e) => poner(p.id, "estado", e.target.value)} style={{ flex: 1, minWidth: 120 }} />
                    <input aria-label="Nueva ubicación" placeholder="Nueva ubicación" value={valor(p.id, "ubicacion")} onChange={(e) => poner(p.id, "ubicacion", e.target.value)} style={{ flex: 1, minWidth: 110 }} />
                    <button type="button" className="btn sm success" disabled={valor(p.id, "estado").trim().length < 2 || valor(p.id, "ubicacion").trim().length < 2}
                      onClick={() => accion(`/prestamos-evidencia/${p.id}/devolver`, { estadoReingreso: valor(p.id, "estado"), ubicacionRetorno: valor(p.id, "ubicacion") }, "Devolución registrada: la evidencia vuelve a la bodega.")}>Registrar devolución</button>
                  </div>
                ) : <small>Le toca recibir la devolución al custodio.</small>)}
                {["entregado", "devuelto"].includes(p.estado) && (
                  <button type="button" className="btn sm ghost" style={{ marginTop: 4 }} onClick={() => abrirDocumento(`/prestamos-evidencia/${p.id}/acta`).catch((e) => toast.error(e.message))}>Acta de salida</button>
                )}
                {p.estado === "rechazado" && "—"}
              </td>
            </tr>
          ))}
          {prestamos.length === 0 && (
            <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--muted)", padding: 14 }}>Sin solicitudes.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
