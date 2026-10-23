/**
 * Eventos de negocio del LIMS (en el mismo proceso). Los módulos que ya hacen
 * su trabajo (aprobar un resultado, oficializar un documento) solo avisan de que
 * ocurrió; quien quiera reaccionar (p. ej. los avisos internos y por correo,
 * frente r4c) se suscribe. Un oyente que falla no afecta a quien emitió: el
 * evento se emite DESPUÉS de confirmar la transacción.
 */
import { EventEmitter } from "node:events";

export interface EventosLims {
  /** Un resultado pasó a «aprobado» (laboratorio.module › transitar). */
  "resultado.aprobado": { resultadoId: string; usuarioId: string | null };
  /** Un informe o certificado quedó oficial con la última firma (firma-documento.service). */
  "documento.oficial": { certificadoId: string; tenantId: string; usuarioId: string | null };
}

const bus = new EventEmitter();
bus.setMaxListeners(50);

export function emitirEvento<K extends keyof EventosLims>(nombre: K, datos: EventosLims[K]): void {
  // Asíncrono: el oyente nunca alarga ni rompe la petición que lo originó.
  setImmediate(() => {
    try {
      bus.emit(nombre, datos);
    } catch {
      /* un oyente que falla no se propaga */
    }
  });
}

export function alEvento<K extends keyof EventosLims>(nombre: K, oyente: (datos: EventosLims[K]) => unknown): () => void {
  const envuelto = (d: EventosLims[K]) => {
    Promise.resolve()
      .then(() => oyente(d))
      .catch(() => undefined);
  };
  bus.on(nombre, envuelto);
  return () => bus.off(nombre, envuelto);
}
