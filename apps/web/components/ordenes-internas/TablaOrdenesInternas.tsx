"use client";

/**
 * Tabla de órdenes internas. La usan la pestaña «Órdenes internas» de la OT y la
 * pantalla Laboratorio › Órdenes internas (bandeja de entrada y emitidas).
 * Cada orden se trabaja en su ficha (/ordenes-internas/[id]); aquí solo se
 * abre, se edita mientras está abierta, se anula con motivo y, en la bandeja de
 * entrada, se recibe («Recibir OT interna → recepción», EP-01 0.6).
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Modal from "@/components/documentos/Modal";
import { llamar } from "@/lib/laboratorio";
import { fechaHora } from "@/lib/format";
import { toast } from "@/components/ui/feedback";
import FormOrdenInterna from "./FormOrdenInterna";
import { destinoTexto, estadoOi, fechaDia, type OrdenInterna } from "./ordenesInternas";

export default function TablaOrdenesInternas({
  filas,
  mostrarOt,
  bandeja,
  puedeEmitir,
  puedeAnular,
  puedeResponder,
  onCambio,
  vacio,
}: {
  filas: OrdenInterna[];
  mostrarOt?: boolean;
  /** Bandeja de entrada del laboratorio de destino: muestra el origen y el botón «Recibir». */
  bandeja?: boolean;
  /** orden_interna.emitir (la API exige además la OT de origen en su alcance). */
  puedeEmitir: boolean;
  /** orden_interna.anular. */
  puedeAnular: boolean;
  /** orden_interna.responder (la API exige además el laboratorio de destino en su alcance). */
  puedeResponder?: boolean;
  onCambio: () => void;
  vacio?: React.ReactNode;
}) {
  const router = useRouter();
  const [editar, setEditar] = useState<OrdenInterna | null>(null);
  const [anular, setAnular] = useState<OrdenInterna | null>(null);
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);

  async function recibir(o: OrdenInterna) {
    setOcupado(true);
    try {
      await llamar("POST", `/ordenes-internas/${o.id}/recibir`);
      toast.ok(`Orden interna ${o.numero} recibida: sus ensayos ya están en la muestra ${o.muestraCodigo ?? ""}.`);
      router.push(`/ordenes-internas/${o.id}` as any);
    } catch (e: any) {
      toast.error(e.message);
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
              <th scope="col">Nº interno</th>
              {mostrarOt && <th scope="col">OT y muestra de origen</th>}
              {!mostrarOt && <th scope="col">Muestra</th>}
              <th scope="col">{bandeja ? "Laboratorio solicitante" : "Laboratorio de destino"}</th>
              <th scope="col">Ensayos pedidos · requisito</th>
              <th scope="col">Estado</th>
              <th scope="col">Envío</th>
              <th scope="col"><span className="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            {filas.map((o) => {
              const est = estadoOi(o);
              return (
                <tr key={o.id} style={o.estado === "anulada" ? { opacity: 0.6 } : undefined}>
                  <td>
                    <Link href={`/ordenes-internas/${o.id}` as any} className="codigo" style={{ textDecoration: "underline" }}>{o.numero}</Link>
                    {o.respuestaNumero && <small style={{ display: "block", color: "var(--muted)" }}>Resp.: {o.respuestaNumero}</small>}
                  </td>
                  {mostrarOt ? (
                    <td>
                      <span className="codigo">{o.otCodigo}</span>{o.muestraCodigo ? <> · <span className="codigo">{o.muestraCodigo}</span></> : null}
                      {o.origenBpch && <small style={{ display: "block", color: "var(--muted)" }}>{o.origenBpch}</small>}
                    </td>
                  ) : (
                    <td>{o.muestraCodigo ? <span className="codigo">{o.muestraCodigo}</span> : <span style={{ color: "var(--muted)" }}>—</span>}</td>
                  )}
                  <td>{bandeja ? `${o.otUnidadCodigo ?? "—"}${o.otUnidadNombre ? ` · ${o.otUnidadNombre}` : ""}` : destinoTexto(o)}</td>
                  <td style={{ maxWidth: 340 }}>
                    {(o.ensayosDetalle ?? []).slice(0, 3).map((e) => e.nombre).join(", ")}
                    {o.nEnsayos > 3 ? ` y ${o.nEnsayos - 3} más` : ""}
                    {o.requisito && <small style={{ display: "block", color: "var(--muted)" }}>{o.requisito}</small>}
                  </td>
                  <td><span className={`pill ${est.pill}`} title={o.motivoAnulacion ?? undefined}>{est.texto}</span></td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {o.fechaEnvio ? fechaDia(o.fechaEnvio) : fechaHora(o.createdAt)}
                    {o.creadaPor && <small style={{ display: "block", color: "var(--muted)" }}>{o.creadaPor}</small>}
                  </td>
                  <td>
                    <span style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      {bandeja && puedeResponder && o.estado === "abierta" && (
                        <button type="button" className="btn primary sm" disabled={ocupado} onClick={() => recibir(o)}
                          aria-label={`Recibir la orden interna ${o.numero}`}>Recibir →</button>
                      )}
                      <Link href={`/ordenes-internas/${o.id}` as any} className="btn outline sm" aria-label={`Abrir la orden interna ${o.numero}`}>Abrir</Link>
                      {puedeEmitir && !bandeja && o.estado === "abierta" && (
                        <button type="button" className="btn outline sm" onClick={() => setEditar(o)} aria-label={`Editar la orden interna ${o.numero}`}>Editar</button>
                      )}
                      {puedeAnular && !bandeja && (o.estado === "abierta" || o.estado === "recibida") && (
                        <button type="button" className="btn ghost-danger sm" onClick={() => { setMotivo(""); setAnular(o); }} aria-label={`Anular la orden interna ${o.numero}`}>Anular</button>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

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
