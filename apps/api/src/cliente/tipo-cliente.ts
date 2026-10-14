/**
 * Tipo de cliente · lista parametrizable (Comercial R2 · SVT5 / SPC2.2).
 *
 * La lista vigente vive en `parametro_sistema` (categoría `tipo_cliente`) y se
 * administra en Parámetros del sistema: no se fija en el código. Reglas:
 *   · Alta: el tipo debe ser un código ACTIVO de la lista.
 *   · Edición: se acepta un código activo, o el MISMO tipo que ya tenía el
 *     cliente aunque esté desactivado (p. ej. 'institucional' de antes de R2):
 *     así se puede editar la ficha de un cliente antiguo sin obligar a
 *     reclasificarlo en ese momento. Cambiarlo a otro valor inactivo, no.
 *   · Si la base no tiene la lista sembrada (instalación sin
 *     align_comercial_r2.sql), se usa la lista de respaldo de abajo para no
 *     bloquear el alta.
 *
 * Función PURA (sin BD): el servicio le pasa la lista leída de la base.
 */

export interface OpcionTipoCliente {
  codigo: string;
  etiqueta?: string | null;
  activo: boolean;
}

/** Respaldo = lista sembrada por align_comercial_r2.sql (docs/COMERCIAL_RONDA2.md §3). */
export const TIPOS_CLIENTE_RESPALDO: readonly string[] = [
  "ley_17798",
  "ejercito",
  "carabineros",
  "fuerza_aerea",
  "armada",
  "pdi",
  "gendarmeria",
  "dgmn",
  "particulares",
  "prov_ejercito",
  "prov_carabineros",
  "prov_fuerza_aerea",
  "prov_armada",
  "interlaboratorio",
];

export type ResultadoTipo = { ok: true } | { ok: false; mensaje: string };

export function validarTipoCliente(
  tipo: string | null | undefined,
  lista: OpcionTipoCliente[],
  tipoActual?: string | null,
): ResultadoTipo {
  if (tipo === undefined) return { ok: true }; // edición que no toca el tipo
  if (tipo === null || tipo === "") return { ok: false, mensaje: "Indique el tipo de cliente." };
  if (tipoActual && tipo === tipoActual) return { ok: true }; // sin cambio: se conserva aunque esté inactivo

  const activos = lista.length
    ? lista.filter((o) => o.activo).map((o) => o.codigo)
    : [...TIPOS_CLIENTE_RESPALDO];
  if (activos.includes(tipo)) return { ok: true };

  const inactivo = lista.find((o) => o.codigo === tipo && !o.activo);
  if (inactivo) {
    return {
      ok: false,
      mensaje: `El tipo de cliente «${inactivo.etiqueta ?? tipo}» ya no está vigente. Elija uno de la lista actual.`,
    };
  }
  return {
    ok: false,
    mensaje: `Tipo de cliente «${tipo}» desconocido. Valores vigentes: ${activos.join(", ")}.`,
  };
}
