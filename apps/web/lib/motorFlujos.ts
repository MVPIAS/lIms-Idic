/**
 * Motor de flujos (BPM) genérico · visibilidad en la interfaz.
 *
 * El recorrido de una OT lo imponen las reglas del servidor (permisos, alcance,
 * matriz de firmas, condiciones de emisión y de cierre) y se ve en la «Ruta de
 * la OT» del expediente (docs/FLUJO_LABORATORIO.md §«Ruta de la OT»). El motor
 * de flujos configurables (`flujo_def`, `/api/flujos`) era un recorrido paralelo
 * que no movía nada de la OT, así que su uso SOBRE LA OT queda oculto:
 *   · sin pestaña «Flujo» ni «Iniciar flujo» en el expediente de la OT;
 *   · sin columna «Flujo» en la lista de OT;
 *   · sin acceso al diseñador en el panel de inicio.
 * El «Diseñador de flujos» (/flujos) es desde nov-2026 un módulo aparte, siempre
 * visible en «Administración» (decisión del usuario, contratos 4.1.5, 4.3.1 y
 * 4.5.1): diseño, versiones, publicación y simulación con datos PRUEBA, sin
 * tocar los circuitos programados (Matriz de firmas y pasos por método).
 *
 * Reactivación (si el IDIC decide configurar sus propios procesos): construir la
 * web con `NEXT_PUBLIC_MOTOR_FLUJOS_VISIBLE=true`. Es una variable de COMPILACIÓN
 * de Next.js (se fija en `next build`), no de ejecución.
 */
export const MOTOR_FLUJOS_VISIBLE = process.env.NEXT_PUBLIC_MOTOR_FLUJOS_VISIBLE === "true";
