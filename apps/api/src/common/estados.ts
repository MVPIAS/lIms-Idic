import { BadRequestException } from "@nestjs/common";

/**
 * Máquina de estados de los dominios con ciclo de vida.
 *
 * PROCEDENCIA DE LOS ESTADOS (no se ha inventado ninguno). La BD no tiene
 * CHECK ni ENUM sobre estas columnas: son VARCHAR libres. El vocabulario se ha
 * tomado, por este orden, de los comentarios de `packages/db/schema.sql`, de los
 * datos sembrados y de los enums Zod ya existentes en la API:
 *
 * · cotizacion  · schema.sql:680 → 'borrador, enviada, aceptada, rechazada, expirada'
 *                 + 'anulada', que usa `CotizacionService.anular()`.
 * · orden_trabajo · schema.sql:738 no lleva lista de estados (la columna es un
 *                 denormalizado de flujo_instancia). El vocabulario sale de
 *                 `seed_operacion_demo.sql:95-112` ('recibida', 'en_analisis',
 *                 'validacion', 'finalizada', 'cerrada'), del default del modelo
 *                 ('recepcionada') y de la vista BI `v_ot_sla` (schema.sql:1303),
 *                 que trata 'informada' como estado de OT.
 * · resultado   · schema.sql:873 → 'capturado, revisado_n1, aprobado, rechazado, devuelto'.
 *                 OJO: el estado intermedio real es `revisado_n1`, NO `revisado`.
 *                 ⚠️ DEFINIDO PERO NO APLICADO: el modelo Prisma `Resultado` no
 *                 declara la columna `estado` (el modelo Prisma y la tabla
 *                 `resultado` de schema.sql son dos diseños distintos: la API
 *                 escribe contra el de Prisma). No hay dónde guardar el estado,
 *                 así que no hay transición que validar. El mapa se deja listo
 *                 para cuando se migre la columna y se añadan los endpoints
 *                 revisar/aprobar/devolver (RF-E01).
 * · certificado · enum Zod de `catalogo.module.ts:76` → 'emitido, anulado', que es
 *                 lo que escriben `plantilla-render.service.ts` y el modelo Prisma
 *                 (`@default("emitido")`). El comentario de schema.sql:956 dice
 *                 'vigente, revocado' y contradice al resto: DERIVA DOCUMENTADA,
 *                 se sigue el vocabulario que la aplicación escribe de verdad.
 */
export type DominioEstado = "cotizacion" | "ot" | "resultado" | "certificado";

/** estado actual → estados a los que puede transitar. */
const TRANSICIONES: Record<DominioEstado, Record<string, readonly string[]>> = {
  // borrador → enviada → aceptada | rechazada; anulable casi siempre.
  cotizacion: {
    borrador: ["enviada", "anulada"],
    enviada: ["aceptada", "rechazada", "expirada", "anulada"],
    aceptada: ["anulada"],
    rechazada: ["anulada"],
    expirada: ["anulada"],
    anulada: [],
  },
  // recepcionada → en_analisis → validacion → finalizada → (informada) → cerrada.
  // 'recibida' es el sinónimo de 'recepcionada' que aparece en los datos sembrados.
  ot: {
    recepcionada: ["en_analisis", "anulada"],
    recibida: ["en_analisis", "anulada"],
    en_analisis: ["validacion", "anulada"],
    validacion: ["finalizada", "en_analisis", "anulada"],
    finalizada: ["informada", "cerrada", "anulada"],
    informada: ["cerrada"],
    cerrada: [],
    anulada: [],
  },
  // capturado → revisado_n1 → aprobado, con rechazo/devolución que reabren la captura.
  resultado: {
    capturado: ["revisado_n1", "rechazado"],
    revisado_n1: ["aprobado", "rechazado", "devuelto"],
    aprobado: [],
    rechazado: ["capturado"],
    devuelto: ["capturado"],
  },
  certificado: {
    emitido: ["anulado"],
    anulado: [],
  },
};

/** Estados admitidos de un dominio (para construir enums de validación). */
export function estadosValidos(dominio: DominioEstado): string[] {
  return Object.keys(TRANSICIONES[dominio]);
}

export function esEstadoValido(dominio: DominioEstado, estado: string): boolean {
  return estado in TRANSICIONES[dominio];
}

/**
 * Valida el paso `actual → nuevo`. Lanza 400 con mensaje explícito si la
 * transición no está permitida o el estado no existe en el dominio.
 * Repetir el estado actual (no-op) se admite: no altera el ciclo de vida.
 */
export function validarTransicion(dominio: DominioEstado, actual: string, nuevo: string): void {
  if (!esEstadoValido(dominio, nuevo)) {
    throw new BadRequestException(
      `Estado '${nuevo}' no válido para ${dominio}. Estados: ${estadosValidos(dominio).join(", ")}`,
    );
  }
  if (actual === nuevo) return;

  // Un estado actual desconocido (dato heredado/migrado) no debe dejar la fila
  // bloqueada para siempre, pero tampoco puede validarse contra el mapa: se
  // rechaza pidiendo intervención en vez de permitir un salto arbitrario.
  if (!esEstadoValido(dominio, actual)) {
    throw new BadRequestException(
      `El ${dominio} está en un estado no reconocido ('${actual}'); no se puede transitar automáticamente.`,
    );
  }

  const permitidos = TRANSICIONES[dominio][actual];
  if (!permitidos.includes(nuevo)) {
    throw new BadRequestException(
      `Transición inválida de ${dominio}: '${actual}' → '${nuevo}'. ` +
        (permitidos.length
          ? `Desde '${actual}' solo se permite: ${permitidos.join(", ")}.`
          : `'${actual}' es un estado final.`),
    );
  }
}
