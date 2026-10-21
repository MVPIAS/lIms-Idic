"use client";

/**
 * Pestaña «Órdenes internas» de la OT (EP-01 2.2 y 3.7): las derivaciones de
 * esta OT a otros laboratorios con su estado, informe de respuesta y costo
 * directo, y el botón para emitir una nueva (permiso orden_interna.emitir y la
 * OT en el alcance de quien la emite). Cada orden se trabaja en su ficha.
 */
import { useCallback, useEffect, useState } from "react";
import { llamar } from "@/lib/laboratorio";
import { usePermisos } from "@/lib/permisos";
import FormOrdenInterna from "@/components/ordenes-internas/FormOrdenInterna";
import TablaOrdenesInternas from "@/components/ordenes-internas/TablaOrdenesInternas";
import type { OrdenInterna } from "@/components/ordenes-internas/ordenesInternas";

export default function OrdenesInternasOt({
  otId,
  otCodigo,
  otEstado,
  destinoSugerido,
  onSugerenciaUsada,
  onCambio,
}: {
  otId: string;
  otCodigo?: string | null;
  otEstado?: string | null;
  /** Laboratorio (unidad) que pidió la recepción de una muestra y aún no tiene orden interna. */
  destinoSugerido?: string | null;
  onSugerenciaUsada?: () => void;
  onCambio?: () => void;
}) {
  const { puede } = usePermisos();
  const [filas, setFilas] = useState<OrdenInterna[] | null>(null);
  const [error, setError] = useState("");
  const [nueva, setNueva] = useState(false);

  const cargar = useCallback(async () => {
    setError("");
    try {
      setFilas(await llamar<OrdenInterna[]>("GET", `/ordenes-internas/ot/${otId}`));
    } catch (e: any) {
      setError(e.message);
      setFilas([]);
    }
  }, [otId]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const abierta = !["cerrada", "anulada"].includes(String(otEstado ?? ""));
  const gestionar = puede("orden_interna.emitir");
  const costo = (filas ?? []).filter((o) => o.estado !== "anulada").reduce((t, o) => t + (o.costoDirecto ?? 0), 0);
  const porIntegrar = (filas ?? []).filter((o) => o.estado === "cerrada" && !o.aceptadaAt).length;

  useEffect(() => {
    if (destinoSugerido && gestionar && abierta) setNueva(true);
  }, [destinoSugerido, gestionar, abierta]);

  const cerrarForm = () => {
    setNueva(false);
    onSugerenciaUsada?.();
  };

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <p className="subtitle" style={{ margin: 0, maxWidth: 640 }}>
          Derivaciones de esta OT a otros laboratorios. El laboratorio de destino ve la OT y solo los ensayos que se le derivan;
          responde con su informe, horas y costo directo, que se imputa a esta OT.
          {costo > 0 && <> Costo directo de las órdenes internas: <b>$ {Math.round(costo).toLocaleString("es-CL")}</b>.</>}
        </p>
        {gestionar && abierta && (
          <button type="button" className="btn primary sm" onClick={() => setNueva(true)}>＋ Nueva orden interna</button>
        )}
      </div>
      {!gestionar && (
        <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>Las emiten el analista o la jefatura del laboratorio responsable de la OT.</p>
      )}
      {porIntegrar > 0 && (
        <div className="alert info" role="status">
          {porIntegrar === 1 ? "Una orden interna volvió" : `${porIntegrar} órdenes internas volvieron`} con su informe: ábrala y use «Dar por recibido → evaluación».
        </div>
      )}
      {error && <div className="alert warn" role="alert">{error}</div>}
      {filas === null ? (
        <p className="subtitle" style={{ margin: 0 }}>Cargando órdenes internas…</p>
      ) : (
        <TablaOrdenesInternas
          filas={filas}
          puedeEmitir={gestionar}
          puedeAnular={puede("orden_interna.anular")}
          onCambio={() => { cargar(); onCambio?.(); }}
          vacio={<p className="subtitle" style={{ margin: 0 }}>Esta OT no tiene órdenes internas.{gestionar && abierta ? " Use «＋ Nueva orden interna» si otro laboratorio debe hacer parte de los ensayos." : ""}</p>}
        />
      )}
      {nueva && (
        <FormOrdenInterna
          otId={otId}
          otCodigo={otCodigo}
          destinoUnidadSugerida={destinoSugerido}
          onCerrar={cerrarForm}
          onGuardada={() => { cerrarForm(); cargar(); onCambio?.(); }}
        />
      )}
    </div>
  );
}
