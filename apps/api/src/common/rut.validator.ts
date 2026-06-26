/**
 * Validador de RUT chileno con dígito verificador (módulo 11).
 * Acepta formato con o sin puntos / guión.
 * Ejemplo: "12.345.678-K" o "12345678K" o "12345678-K"
 */
export function validaRut(rut: string | null | undefined): boolean {
  if (!rut) return false;
  const cleaned = rut.replace(/[^0-9Kk]/g, "").toUpperCase();
  if (cleaned.length < 2) return false;

  const numbers = cleaned.slice(0, -1);
  const dv = cleaned.slice(-1);

  let s = 0;
  let m = 2;
  for (let i = numbers.length - 1; i >= 0; i--) {
    s += parseInt(numbers[i], 10) * m;
    m = m === 7 ? 2 : m + 1;
  }

  const resto = 11 - (s % 11);
  const expected = resto === 11 ? "0" : resto === 10 ? "K" : String(resto);
  return dv === expected;
}

export function formatRut(rut: string): string {
  if (!validaRut(rut)) return rut;
  const cleaned = rut.replace(/[^0-9Kk]/g, "").toUpperCase();
  const numbers = cleaned.slice(0, -1);
  const dv = cleaned.slice(-1);
  // 12345678 → 12.345.678
  const formatted = numbers.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${formatted}-${dv}`;
}
