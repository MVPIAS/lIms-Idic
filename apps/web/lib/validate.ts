/**
 * Validación de formularios · LIMS IDIC (Chile) · Aiuken
 *
 * Un solo lugar para las reglas de cada tipo de campo (email, teléfono chileno,
 * RUT con dígito verificador, número, entero, moneda, URL) y los obligatorios.
 * Lo usan los dos CrudTable y los formularios hechos a mano, para que la
 * validación sea coherente en todo el sistema.
 */

export type TipoCampo =
  | "text" | "textarea" | "password"
  | "email" | "telefono" | "rut" | "url"
  | "number" | "entero" | "moneda"
  | "date" | "select" | "ref";

// --- Reglas atómicas ---------------------------------------------------------

export function esEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
}

/** Teléfono chileno tolerante: +, espacios, guiones y paréntesis; 8–15 dígitos. */
export function esTelefono(v: string): boolean {
  const d = v.replace(/\D/g, "");
  return d.length >= 8 && d.length <= 15;
}

export function esUrl(v: string): boolean {
  try { new URL(v.trim()); return true; } catch { return false; }
}

export function esNumero(v: string | number): boolean {
  const s = String(v).trim().replace(/\./g, "").replace(",", ".");
  return s !== "" && !Number.isNaN(Number(s));
}

export function esEntero(v: string | number): boolean {
  return /^-?\d+$/.test(String(v).trim());
}

/** Monto ≥ 0. Acepta separadores de miles y decimales chilenos. */
export function esMoneda(v: string | number): boolean {
  const s = String(v).trim().replace(/\$/g, "").replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return s !== "" && !Number.isNaN(n) && n >= 0;
}

/** RUT chileno con dígito verificador mód-11 (ej. 12.345.678-5). */
export function esRut(v: string): boolean {
  const limpio = v.replace(/[.\s]/g, "").replace(/-/g, "").toUpperCase();
  if (limpio.length < 2) return false;
  const cuerpo = limpio.slice(0, -1);
  const dv = limpio.slice(-1);
  if (!/^\d+$/.test(cuerpo)) return false;
  let suma = 0, mul = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += parseInt(cuerpo[i], 10) * mul;
    mul = mul === 7 ? 2 : mul + 1;
  }
  const resto = 11 - (suma % 11);
  const dvCalc = resto === 11 ? "0" : resto === 10 ? "K" : String(resto);
  return dv === dvCalc;
}

// --- Validación de campo -----------------------------------------------------

/** Devuelve el mensaje de error del campo, o null si es válido. */
export function validarCampo(tipo: TipoCampo | undefined, valor: any, requerido?: boolean): string | null {
  const v = valor == null ? "" : String(valor).trim();
  if (!v) return requerido ? "Campo obligatorio" : null;
  switch (tipo) {
    case "email": return esEmail(v) ? null : "Email no válido (ej. nombre@dominio.cl)";
    case "telefono": return esTelefono(v) ? null : "Teléfono no válido (8 a 15 dígitos)";
    case "rut": return esRut(v) ? null : "RUT no válido · revise el dígito verificador";
    case "url": return esUrl(v) ? null : "URL no válida (debe incluir http/https)";
    case "number": return esNumero(v) ? null : "Debe ser un número";
    case "entero": return esEntero(v) ? null : "Debe ser un número entero";
    case "moneda": return esMoneda(v) ? null : "Debe ser un monto válido (≥ 0)";
    default: return null;
  }
}

export type CampoValidable = { campo: string; tipo?: TipoCampo; requerido?: boolean; label?: string };

/** Valida todos los campos; devuelve { campo: mensaje } de los inválidos. */
export function validarFormulario(campos: CampoValidable[], valores: Record<string, any>): Record<string, string> {
  const errores: Record<string, string> = {};
  for (const c of campos) {
    const e = validarCampo(c.tipo, valores[c.campo], c.requerido);
    if (e) errores[c.campo] = e;
  }
  return errores;
}

// --- Props HTML del <input> según el tipo -----------------------------------

/** Atributos del input (type, inputMode, step, pattern, placeholder) por tipo. */
export function propsInput(tipo?: TipoCampo): Record<string, any> {
  switch (tipo) {
    case "email": return { type: "email", inputMode: "email", autoComplete: "email", placeholder: "nombre@dominio.cl" };
    case "telefono": return { type: "tel", inputMode: "tel", placeholder: "+56 9 1234 5678" };
    case "rut": return { type: "text", inputMode: "text", placeholder: "12.345.678-9" };
    case "url": return { type: "url", inputMode: "url", placeholder: "https://…" };
    case "number": return { type: "number", inputMode: "decimal", step: "any" };
    case "entero": return { type: "number", inputMode: "numeric", step: "1" };
    case "moneda": return { type: "number", inputMode: "decimal", step: "0.01", min: "0", placeholder: "0" };
    case "date": return { type: "date" };
    case "password": return { type: "password" };
    default: return { type: "text" };
  }
}
