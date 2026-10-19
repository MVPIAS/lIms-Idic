"use client";

/**
 * Pestaña «Órdenes internas» de la OT: las derivaciones de esta OT a otros
 * laboratorios y el botón para emitir una nueva (permiso ot.crear y la OT en
 * el alcance de quien la emite).
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
  const gestionar = puede("ot.crear");

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
          Derivaciones de esta OT a otros laboratorios. El laboratorio de destino ve la OT y solo los ensayos que se le derivan.
        </p>
        {gestionar && abierta && (
          <button type="button" className="btn primary sm" onClick={() => setNueva(true)}>＋ Nueva orden interna</button>
        )}
      </div>
      {!gestionar && (
        <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>Las emite Planificación o quien tenga permiso para registrar OT.</p>
      )}
      {error && <div className="alert warn" role="alert">{error}</div>}
      {filas === null ? (
        <p className="subtitle" style={{ margin: 0 }}>Cargando órdenes internas…</p>
      ) : (
        <TablaOrdenesInternas
          filas={filas}
          puedeGestionar={gestionar}
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
