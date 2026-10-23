"use client";
// =============================================================================
// refresco.ts · Patrón común de refresco tras una acción (B-041)
// -----------------------------------------------------------------------------
// La ficha de la OT tiene varios bloques que cargan sus datos por separado
// (ruta, cierre, documentos y envíos, instrumentos, notificación a la DGMN…).
// Antes, una acción en un bloque solo recargaba ese bloque y los demás seguían
// diciendo «Sin entregar» o «Para cerrar la OT falta…» hasta recargar la página.
//
// Regla: tras cada mutación sobre una OT, el bloque llama a avisarCambioOt(otId)
// y todo bloque que muestre datos de esa OT se suscribe con useCambiosOt().
// Los suscriptores SOLO recargan sus datos (nunca vuelven a avisar), así no hay
// bucles.
// =============================================================================
import { useEffect, useRef } from "react";

const EVENTO = "lims:ot-cambio";

/** Avisa que la OT cambió: los bloques suscritos recargan sus datos. */
export function avisarCambioOt(otId: string | null | undefined): void {
  if (!otId || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENTO, { detail: { otId } }));
}

/** Recarga `recargar` cuando otro bloque avisa un cambio en la OT `otId`. */
export function useCambiosOt(otId: string | null | undefined, recargar: () => unknown): void {
  const ref = useRef(recargar);
  ref.current = recargar;
  useEffect(() => {
    if (!otId) return;
    let pendiente: ReturnType<typeof setTimeout> | null = null;
    const h = (e: Event) => {
      if ((e as CustomEvent).detail?.otId !== otId) return;
      // Varios avisos seguidos (p. ej. guardar y cerrar) se agrupan en una recarga.
      if (pendiente) clearTimeout(pendiente);
      pendiente = setTimeout(() => { pendiente = null; ref.current(); }, 50);
    };
    window.addEventListener(EVENTO, h);
    return () => {
      window.removeEventListener(EVENTO, h);
      if (pendiente) clearTimeout(pendiente);
    };
  }, [otId]);
}
