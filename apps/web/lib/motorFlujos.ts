/**
 * Motor de flujos (BPM) genérico · visibilidad en la interfaz.
 *
 * El recorrido de una OT lo imponen las reglas del servidor (permisos, alcance,
 * matriz de firmas, condiciones de emisión y de cierre) y se ve en la «Ruta de
 * la OT» del expediente (docs/FLUJO_LABORATORIO.md §«Ruta de la OT»). El motor
 * de flujos configurables (`flujo_def`, `/api/flujos`) era un recorrido paralelo
 * que no movía nada de la OT, así que queda OCULTO de la interfaz:
 *   · sin «Diseñador de flujos» en el menú ni en los accesos del panel;
 *   · sin pestaña «Flujo» ni «Iniciar flujo» en el expediente de la OT;
 *   · sin columna «Flujo» en la lista de OT;
 *   · /flujos muestra «no disponible».
 * El motor, sus tablas y su API se conservan intactos.
 *
 * Reactivación (si el IDIC decide configurar sus propios procesos): construir la
 * web con `NEXT_PUBLIC_MOTOR_FLUJOS_VISIBLE=true`. Es una variable de COMPILACIÓN
 * de Next.js (se fija en `next build`), no de ejecución.
 */
export const MOTOR_FLUJOS_VISIBLE = process.env.NEXT_PUBLIC_MOTOR_FLUJOS_VISIBLE === "true";
