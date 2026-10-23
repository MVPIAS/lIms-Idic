"use client";

/**
 * PanelCierreOt · pestaña «Informe y cierre» del expediente de la OT:
 *   · fecha de compromiso (origen, semáforo; Planificación/jefatura la fija);
 *   · documentos emitidos con su estado de firma y entrega;
 *   · qué falta para cerrar y el botón «Cerrar OT» (crea la factura en borrador
 *     si la OT es con cobro).
 * Reglas: docs/FLUJO_FIRMA_CIERRE.md.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { fecha, fechaDia, fechaHora, monto } from "@/lib/format";
import { toast, confirmar } from "@/components/ui/feedback";
import { ESTADO_DOC, ESTADO_FACTURA, SEMAFORO, textoDias, textoMedio } from "@/lib/documentos";
import PanelDocumento from "./PanelDocumento";
import Modal from "./Modal";

const API = process.env.NEXT_PUBLIC_API_URL ?? "/api";

async function pedir(path: string, method = "GET", body?: unknown) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${localStorage.getItem("lims_token")}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.message ?? `Error ${r.status}`);
  return j;
}

export default function PanelCierreOt({ otId, onCambio }: { otId: string; onCambio?: () => void }) {
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [editFecha, setEditFecha] = useState(false);
  const [nuevaFecha, setNuevaFecha] = useState("");
  const [motivo, setMotivo] = useState("");

  const cargar = useCallback(async () => {
    try {
      setD(await pedir(`/ot/${otId}/cierre`));
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }, [otId]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function guardarFecha() {
    setOcupado(true);
    try {
      setD(await pedir(`/ot/${otId}/fecha-compromiso`, "PUT", { fecha: nuevaFecha, ...(motivo.trim() ? { motivo: motivo.trim() } : {}) }));
      toast.ok("Fecha de compromiso guardada.");
      setEditFecha(false);
      onCambio?.();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  }

  async function cerrar() {
    const ok = await confirmar({
      titulo: `¿Cerrar la OT ${d.ot.codigo}?`,
      // El texto depende de si la factura ya existe (p. ej. la de la tasa de internación) (D06-16).
      mensaje: !d.ot.conCobro
        ? "La OT queda cerrada. Es una OT sin cobro: no se genera factura."
        : d.factura
          ? `La OT queda cerrada. Su factura ${d.factura.numero} ya existe: no se genera otra.`
          : d.ot.cotizacionId
            ? "La OT queda cerrada y se genera la factura en borrador para Finanzas con los importes de la cotización aceptada."
            : "La OT queda cerrada y se genera la factura en borrador para Finanzas.",
      confirmarTexto: "Cerrar OT",
    });
    if (!ok) return;
    setOcupado(true);
    try {
      const r = await pedir(`/ot/${otId}/cerrar`, "POST");
      setD(r);
      toast.ok(r.facturaCreada ? `OT cerrada. Factura ${r.facturaCreada.numero} pendiente de facturar.` : "OT cerrada.");
      onCambio?.();
    } catch (e: any) {
      toast.error(e.message);
      cargar();
    } finally {
      setOcupado(false);
    }
  }

  if (error && !d) return <div className="alert warn">{error}</div>;
  if (!d) return <p className="subtitle" style={{ margin: 0 }}>Cargando…</p>;

  const s = SEMAFORO[d.plazo.semaforo] ?? SEMAFORO.sin_fecha;
  const cerrada = d.ot.estado === "cerrada";

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* Plazo */}
      <div>
        <h2 style={{ fontSize: 13, margin: "0 0 6px" }}>Fecha de compromiso</h2>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 12.5 }}>
          <b style={{ fontSize: 14 }}>{d.plazo.fechaCompromiso ? fechaDia(d.plazo.fechaCompromiso) : "Sin fecha"}</b>
          {d.plazo.semaforo !== "terminada" && <span className={`pill ${s.pill}`}>{s.texto}</span>}
          {d.plazo.diasRestantes !== null && d.plazo.semaforo !== "terminada" && <span style={{ color: "var(--muted)" }}>{textoDias(d.plazo.diasRestantes)}</span>}
          {d.plazo.origen && (
            <span style={{ color: "var(--muted)" }}>
              · {d.plazo.origen === "cotizacion" ? `según el plazo de la cotización ${d.plazo.cotizacionCodigo ?? ""} (${d.plazo.plazoDiasCotizacion} días)` : "fijada a mano"}
              {d.plazo.fijadaPor ? ` por ${d.plazo.fijadaPor}` : ""}{d.plazo.fijadaAt ? ` el ${fechaHora(d.plazo.fijadaAt)}` : ""}
            </span>
          )}
          {d.puedo.planificar && !editFecha && (
            <button className="btn outline sm" onClick={() => { setNuevaFecha(d.plazo.fechaCompromiso ?? d.plazo.sugerida ?? ""); setMotivo(""); setEditFecha(true); }}>
              {d.plazo.fechaCompromiso ? "Cambiar fecha" : "Fijar fecha"}
            </button>
          )}
        </div>
        {editFecha && (
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginTop: 8 }}>
            <div className="field"><label>Nueva fecha <span className="req">*</span></label><input type="date" value={nuevaFecha} onChange={(e) => setNuevaFecha(e.target.value)} /></div>
            <div className="field" style={{ minWidth: 260 }}><label>Motivo del cambio</label><input value={motivo} maxLength={500} onChange={(e) => setMotivo(e.target.value)} /></div>
            {d.plazo.sugerida && d.plazo.sugerida !== nuevaFecha && (
              <button className="btn outline sm" onClick={() => setNuevaFecha(d.plazo.sugerida)}>Usar la de la cotización ({fechaDia(d.plazo.sugerida)})</button>
            )}
            <button className="btn primary sm" disabled={ocupado || !nuevaFecha} onClick={guardarFecha}>Guardar</button>
            <button className="btn outline sm" onClick={() => setEditFecha(false)}>Cancelar</button>
          </div>
        )}
      </div>

      {/* Documentos */}
      <div>
        <h2 style={{ fontSize: 13, margin: "0 0 6px", display: "flex", alignItems: "center", gap: 8 }}>
          Informes y certificados
          <span style={{ fontWeight: 400, color: "var(--muted)", fontSize: 12 }}>· resultados aprobados {d.resultados.aprobados} de {d.resultados.total}</span>
          <span style={{ flex: 1 }} />
          {d.puedo.emitir && !cerrada && <Link href={`/informes?otId=${otId}` as any} className="btn outline sm" aria-label="Emitir informe de esta OT">Emitir informe</Link>}
        </h2>
        {d.documentos.length ? (
          <table className="data">
            <thead><tr><th>Número</th><th>Documento</th><th>Firma</th><th>Entrega</th><th /></tr></thead>
            <tbody>
              {d.documentos.map((x: any) => {
                const e = ESTADO_DOC[x.estado] ?? { texto: x.estado, pill: "gray" };
                return (
                  <tr key={x.id}>
                    <td><span className="codigo">{x.numero}</span></td>
                    <td>{x.plantilla?.nombre ?? x.tipo ?? "—"}<small style={{ display: "block", color: "var(--muted)" }}>emitido {fecha(x.fecha)}</small></td>
                    <td>
                      <span className={`pill ${e.pill}`}>{e.texto}</span>
                      {x.firmasTotal ? <small style={{ marginLeft: 6, color: "var(--muted)" }}>{x.firmasHechas}/{x.firmasTotal}</small> : null}
                      {x.pendienteDe && <small style={{ display: "block", color: "var(--muted)" }}>Le toca: {x.pendienteDe}</small>}
                    </td>
                    <td style={{ fontSize: 11.5 }}>
                      {x.entregadoAt ? <>{fecha(x.entregadoAt)} · {textoMedio(x.entregaMedio)}<small style={{ display: "block", color: "var(--muted)" }}>{x.entregaDestinatario}</small></>
                        : x.oficial ? <span className="pill amber">Sin entregar</span> : "—"}
                    </td>
                    <td style={{ textAlign: "right" }}><button className="btn outline sm" onClick={() => setAbierto(x.id)}>Abrir</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="subtitle" style={{ margin: 0 }}>
            {d.calibraciones?.length
              ? "Sin informes del flujo general: los certificados de calibración de la OT se listan arriba y cuentan para el cierre."
              : "Todavía no se ha emitido ningún informe para esta OT."}
          </p>
        )}
      </div>

      {/* Cierre */}
      <div className={`alert ${cerrada ? "success" : d.puedeCerrar ? "success" : "warn"}`} style={{ margin: 0 }}>
        {cerrada ? (
          <>OT cerrada el {fechaHora(d.ot.fechaCierre)}.</>
        ) : d.puedeCerrar ? (
          <>Todos los documentos están oficiales y entregados: la OT se puede cerrar.</>
        ) : (
          <>
            <b>Para cerrar la OT falta:</b>
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{d.faltantes.map((f: string, i: number) => <li key={i}>{f}</li>)}</ul>
          </>
        )}
        {d.factura && (
          <div style={{ marginTop: 6 }}>
            Factura <span className="codigo">{d.factura.numero}</span>{" "}
            <span className={`pill ${ESTADO_FACTURA[d.factura.estado]?.pill ?? "gray"}`}>{ESTADO_FACTURA[d.factura.estado]?.texto ?? d.factura.estado}</span>{" "}
            {monto(d.factura.total, d.factura.moneda)} · <Link href={"/facturas" as any} style={{ color: "var(--accent)" }}>ver en Facturas</Link>
          </div>
        )}
        {!cerrada && !d.ot.conCobro && <div style={{ marginTop: 6, color: "var(--muted)" }}>OT sin cobro: al cerrarla no se genera factura.</div>}
      </div>
      {!cerrada && d.puedo.cerrar && (
        <div className="toolbar" style={{ margin: 0 }}>
          <button className="btn primary" disabled={ocupado || !d.puedeCerrar} onClick={cerrar}>Cerrar OT</button>
        </div>
      )}

      {abierto && (
        <Modal titulo="Documento" ancho={980} onCerrar={() => { setAbierto(null); cargar(); }}>
          <PanelDocumento documentoId={abierto} onCambio={cargar} />
        </Modal>
      )}
    </div>
  );
}
