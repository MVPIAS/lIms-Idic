"use client";

/**
 * /flujos · Diseñador de flujos (Administración), contratos 4.1.5, 4.3.1 y 4.5.1.
 * Módulo de diseño y simulación, visible siempre para quien tiene flujo.ver
 * (en el menú, para quien diseña: flujo.editar). No depende de
 * NEXT_PUBLIC_MOTOR_FLUJOS_VISIBLE, que solo sigue ocultando la pestaña «Flujo»
 * del expediente de la OT (lib/motorFlujos.ts).
 */
import RequierePermiso from "@/components/RequierePermiso";
import DisenadorFlujos from "./_components/DisenadorFlujos";

export default function FlujosPage() {
  return (
    <RequierePermiso perm="flujo.ver" titulo="Diseñador de flujos">
      <DisenadorFlujos />
    </RequierePermiso>
  );
}
