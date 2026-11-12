/**
 * Marca en cada fila del catálogo si el usuario puede modificarla (F061): la
 * pantalla no ofrece «Editar», «Eliminar» ni «Resultado y condiciones» en los
 * registros de laboratorios ajenos (la API los rechazaba con 403 igualmente).
 * `enAlcance` null = alcance global (todas). Función PURA: en-alcance.spec.ts.
 */
export function marcarEnAlcance<T extends { id: string }>(filas: T[], enAlcance: Set<string> | null): (T & { enAlcance: boolean })[] {
  return filas.map((f) => ({ ...f, enAlcance: enAlcance === null || enAlcance.has(String(f.id)) }));
}
