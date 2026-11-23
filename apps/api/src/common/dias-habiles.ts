/**
 * Días hábiles = lunes a viernes. Los feriados NO se descuentan (no hay
 * calendario de feriados en el LIMS: POR CONFIRMAR con el IDIC). Fechas en
 * texto AAAA-MM-DD, sin horas ni zona. Probado en dias-habiles.spec.ts.
 */

const diaSemana = (d: Date) => d.getUTCDay(); // 0 domingo … 6 sábado
const esHabil = (d: Date) => diaSemana(d) !== 0 && diaSemana(d) !== 6;

/** Suma días hábiles (lunes a viernes) a una fecha AAAA-MM-DD. */
export function sumarDiasHabiles(desde: string, dias: number): string {
  const d = new Date(`${desde}T12:00:00Z`);
  let n = 0;
  while (n < dias) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (esHabil(d)) n++;
  }
  return d.toISOString().slice(0, 10);
}

/**
 * Días hábiles transcurridos DESPUÉS de `desde` hasta `hasta` inclusive (0 si
 * `hasta` ≤ `desde`). Es la inversa de sumarDiasHabiles:
 * diasHabilesEntre(a, sumarDiasHabiles(a, n)) === n.
 */
export function diasHabilesEntre(desde: string, hasta: string): number {
  if (hasta <= desde) return 0;
  const d = new Date(`${desde}T12:00:00Z`);
  const fin = new Date(`${hasta}T12:00:00Z`).getTime();
  let n = 0;
  while (d.getTime() < fin) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (esHabil(d)) n++;
  }
  return n;
}
