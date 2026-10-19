"use client";

/**
 * Tabla de órdenes internas con sus acciones (ver, editar mientras está
 * abierta, avanzar el estado y anular con motivo). La usan la pestaña
 * «Órdenes internas» de la OT y la pantalla Laboratorio › Órdenes internas.
 */
import { useState } from "react";
import Link from "next/link";
import Modal from "@/components/documentos/Modal";
import { llamar } from "@/lib/laboratorio";
import { fechaHora } from "@/lib/format";
import { confirmar, toast } from "@/components/ui/feedback";
import FormOrdenInterna from "./FormOrdenInterna";
import { ACCION_HISTORIAL_OI, ESTADO_OI, SIGUIENTE_OI, TIPO_OI, destinoTexto, type OrdenInterna } from "./ordenesInternas";

export default function TablaOrdenesInternas({
  filas,
  mostrarOt,
  puedeGestionar,
  onCambio,
  vacio,
}: {
  filas: OrdenInterna[];
  mostrarOt?: boolean;
  /** Quien tiene ot.crear (la API exige además la OT de origen en su alcance). */
  puedeGestionar: boolean;
  onCambio: () => void;
  vacio?: React.ReactNode;
}) {
  const [ver, setVer] = useState<OrdenInterna | null>(null);
  const [editar, setEditar] = useState<OrdenInterna | null>(null);
  const [anular, setAnular] = useState<OrdenInterna | null>(null);
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);

  async function abrir(o: OrdenInterna) {
    try {
      setVer(await llamar<OrdenInterna>("GET", `/ordenes-internas/${o.id}`));
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function avanzar(o: OrdenInterna) {
    const sig = SIGUIENTE_OI[o.estado];
    if (!sig) return;
    const ok = await confirmar({
      titulo: `¿${sig.boton} la orden interna ${o.numero}?`,
      mensaje: sig.estado === "recibida"
        ? "Indica que el laboratorio de destino la recibió: desde entonces ya no se puede editar (solo cerrar o anular)."
        : "Indica que el laboratorio de destino terminó lo pedido.",
      confirmarTexto: sig.boton,
    });
    if (!ok) return;
    setOcupado(true);
    try {
      await llamar("PATCH", `/ordenes-internas/${o.id}`, { estado: sig.estado });
      toast.ok(`Orden interna ${o.numero}: ${ESTADO_OI[sig.estado].texto.toLowerCase()}.`);
      onCambio();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  }

  async function confirmarAnulacion() {
    if (!anular) return;
    setOcupado(true);
    try {
      await llamar("POST", `/ordenes-internas/${anular.id}/anular`, { motivo: motivo.trim() });
      toast.ok(`Orden interna ${anular.numero} anulada.`);
      setAnular(null);
      setMotivo("");
      onCambio();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  }

  if (!filas.length) return <>{vacio ?? <p className="subtitle" style={{ margin: 0 }}>No hay órdenes internas.</p>}</>;

  return (
    <>
      <div style={{ overflowX: "auto" }}>
        <table className="data">
          <thead>
            <tr>
              <th>Número</th>
              {mostrarOt && <th>OT</th>}
              <th>Laboratorio de destino</th>
              <th className="num">Ensayos</th>
              <th>Estado</th>
              <th>Emitida</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((o) => {
              const est = ESTADO_OI[o.estado] ?? { texto: o.estado, pill: "gray" };
              const sig = SIGUIENTE_OI[o.estado];
              return (
                <tr key={o.id} style={o.estado === "anulada" ? { opacity: 0.6 } : undefined}>
                  <td><span className="codigo">{o.numero}</span><small style={{ display: "block", color: "var(--muted)" }}>{TIPO_OI[o.tipo] ?? o.tipo}</small></td>
                  {mostrarOt && (
                    <td><Link href={`/ot/${o.otId}` as any} className="codigo" style={{ textDecoration: "underline" }}>{o.otCodigo}</Link>
                      {o.otUnidadCodigo && <small style={{ display: "block", color: "var(--muted)" }}>desde {o.otUnidadCodigo}</small>}</td>
                  )}
                  <td>{destinoTexto(o)}</td>
                  <td className="num">{o.nEnsayos}</td>
                  <td><span className={`pill ${est.pill}`} title={o.motivoAnulacion ?? undefined}>{est.texto}</span></td>
                  <td style={{ whiteSpace: "nowrap" }}>{fechaHora(o.createdAt)}{o.creadaPor && <small style={{ display: "block", color: "var(--muted)" }}>{o.creadaPor}</small>}</td>
                  <td>
                    <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      <button type="button" className="btn outline sm" onClick={() => abrir(o)}>Ver</button>
                      {puedeGestionar && o.estado === "abierta" && (
                        <button type="button" className="btn outline sm" onClick={() => setEditar(o)}>Editar</button>
                      )}
                      {puedeGestionar && sig && (
                        <button type="button" className="btn outline sm" disabled={ocupado} onClick={() => avanzar(o)}>{sig.boton}</button>
                      )}
                      {puedeGestionar && (o.estado === "abierta" || o.estado === "recibida") && (
                        <button type="button" className="btn ghost-danger sm" onClick={() => { setMotivo(""); setAnular(o); }}>Anular</button>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {ver && (
        <Modal titulo={`Orden interna ${ver.numero}`} onCerrar={() => setVer(null)} ancho={640}
          acciones={<button type="button" className="btn outline sm" onClick={() => setVer(null)}>Cerrar</button>}>
          <dl style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: "4px 10px", margin: "0 0 10px" }}>
            <dt>OT</dt><dd style={{ margin: 0 }}><Link href={`/ot/${ver.otId}` as any} style={{ color: "var(--accent)" }}>{ver.otCodigo}</Link>{ver.otUnidadCodigo ? ` (${ver.otUnidadCodigo})` : ""}</dd>
            <dt>Laboratorio de destino</dt><dd style={{ margin: 0 }}>{destinoTexto(ver)}</dd>
            <dt>Estado</dt><dd style={{ margin: 0 }}><span className={`pill ${ESTADO_OI[ver.estado]?.pill ?? "gray"}`}>{ESTADO_OI[ver.estado]?.texto ?? ver.estado}</span>
              {ver.motivoAnulacion && <> · motivo: {ver.motivoAnulacion}</>}</dd>
            <dt>Detalle</dt><dd style={{ margin: 0 }}>{ver.detalle || "—"}</dd>
          </dl>
          <h4 style={{ margin: "8px 0 4px", fontSize: 13 }}>Ensayos derivados ({ver.ensayosDetalle.length})</h4>
          {ver.ensayosDetalle.length ? (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {ver.ensayosDetalle.map((e) => <li key={e.id}><span className="codigo">{e.codigo}</span> {e.nombre}</li>)}
            </ul>
          ) : <p style={{ margin: 0, color: "var(--muted)" }}>Sin ensayos indicados (orden anterior a esta versión o solo con detalle).</p>}
          {!!ver.historial?.length && (
            <>
              <h4 style={{ margin: "12px 0 4px", fontSize: 13 }}>Historial</h4>
              <table className="data">
                <thead><tr><th>Fecha</th><th>Quién</th><th>Qué</th></tr></thead>
                <tbody>
                  {ver.historial.map((h) => (
                    <tr key={h.id}>
                      <td style={{ whiteSpace: "nowrap" }}>{fechaHora(h.createdAt)}</td>
                      <td>{h.usuarioNombre ?? "—"}</td>
                      <td>{ACCION_HISTORIAL_OI[h.accion] ?? h.accion}{h.accion === "estado" && h.detalle?.estado ? ` → ${ESTADO_OI[h.detalle.estado]?.texto ?? h.detalle.estado}` : ""}{h.detalle?.motivo ? ` · ${h.detalle.motivo}` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </Modal>
      )}

      {editar && (
        <FormOrdenInterna otId={editar.otId} otCodigo={editar.otCodigo} orden={editar}
          onCerrar={() => setEditar(null)} onGuardada={() => { setEditar(null); onCambio(); }} />
      )}

      {anular && (
        <Modal titulo={`Anular la orden interna ${anular.numero}`} onCerrar={() => setAnular(null)}
          acciones={
            <>
              <button type="button" className="btn outline sm" onClick={() => setAnular(null)}>Cancelar</button>
              <button type="button" className="btn danger sm" disabled={ocupado || motivo.trim().length < 5} onClick={confirmarAnulacion}>Anular</button>
            </>
          }>
          <p style={{ marginTop: 0 }}>
            {destinoTexto(anular)} dejará de ver la OT {anular.otCodigo} por esta orden. Queda en el historial con su motivo.
          </p>
          <div className="field">
            <label htmlFor="oi-motivo">Motivo <span className="req">*</span></label>
            <textarea id="oi-motivo" rows={3} maxLength={1000} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            <small style={{ color: "var(--muted)" }}>Mínimo 5 caracteres.</small>
          </div>
        </Modal>
      )}
    </>
  );
}
