/**
 * Serialización de BigInt a JSON · LIMS IDIC.
 *
 * Prisma devuelve las columnas `bigint` (p. ej. `muestra.numero_interno`, los
 * correlativos, `count(*)` en SQL crudo) como BigInt de JavaScript, y
 * `JSON.stringify` no sabe serializarlos: lanza «Do not know how to serialize a
 * BigInt» y la API respondía 500 («Error interno del servidor») en cualquier
 * listado que los trajera (recorrido MP-02, diferencia D02-01: GET
 * /muestras?otId= tras asignar el Nº interno).
 *
 * Regla única para TODAS las respuestas (y para cualquier JSON.stringify del
 * servidor: bitácoras, auditoría, jsonb): un BigInt se escribe como TEXTO
 * decimal ("12"). Es exacto para cualquier tamaño (un número de JavaScript
 * pierde precisión sobre 2^53) y es lo que ya esperaban las pantallas
 * (`numeroInterno: string`) y las consultas que hacían `::text`.
 *
 * Se instala una vez al arrancar (main.ts). Es idempotente.
 */
export function bigIntAJson(this: bigint): string {
  return this.toString();
}

export function instalarSerializacionBigInt(): void {
  const proto = BigInt.prototype as unknown as { toJSON?: () => string };
  if (proto.toJSON === bigIntAJson) return;
  Object.defineProperty(BigInt.prototype, "toJSON", {
    value: bigIntAJson,
    writable: true,
    configurable: true,
    enumerable: false,
  });
}
