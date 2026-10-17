/**
 * Factor de la fórmula de un ensayo · LIMS IDIC (Depto. Químico, 15-10-2026:
 * «las fórmulas deben tener un factor modificable, p. ej. multiplicar o dividir»).
 * Reglas PURAS (sin BD): factor.spec.ts.
 *
 *  · El método (cat_metodo) trae el factor por defecto; al generar los ensayos de
 *    una OT se copia al resultado (origen «metodo»).
 *  · En la OT se ajusta por ensayo (origen «orden») con motivo; lo hace quien
 *    tiene `resultado.factor` (por defecto la jefatura; el IDIC puede dárselo al
 *    analista asignando el permiso a su rol, sin cambiar código).
 *  · Se aplica al valor CALCULADO (lecturas con fórmula o réplicas). Un valor
 *    final ingresado directamente no se toca: ya es el resultado.
 *  · Si cambia después de capturar, el valor se recalcula desde el valor sin
 *    factor guardado en la captura y se vuelve a evaluar el veredicto.
 */

export type OperacionFactor = "multiplicar" | "dividir";

export interface Factor {
  valor: number;
  operacion: OperacionFactor;
  descripcion?: string | null;
}

/** Factor a partir de las columnas (NULL / inválido → sin factor). */
export function factorDe(valor: unknown, operacion: unknown, descripcion?: string | null): Factor | null {
  if (valor == null || operacion == null) return null;
  const v = Number(valor);
  if (!Number.isFinite(v) || v <= 0) return null;
  if (operacion !== "multiplicar" && operacion !== "dividir") return null;
  return { valor: v, operacion, descripcion: descripcion ?? null };
}

/** Errores de un factor pedido (lista vacía = válido). */
export function erroresFactor(f: { valor?: number | null; operacion?: string | null }): string[] {
  const e: string[] = [];
  if (f.valor == null && f.operacion == null) return e; // quitar el factor
  if (f.valor == null || !Number.isFinite(f.valor) || f.valor <= 0) e.push("El factor debe ser un número mayor que 0.");
  if (f.operacion !== "multiplicar" && f.operacion !== "dividir") e.push("Indique si el factor multiplica o divide el resultado.");
  if (f.valor === 1) e.push("Un factor 1 no cambia el resultado: déjelo vacío si el ensayo no lleva factor.");
  return e;
}

/** Valor tras aplicar el factor. Sin factor, el mismo valor. */
export function aplicarFactor(valor: number, f: Factor | null): number {
  if (!f) return valor;
  return f.operacion === "multiplicar" ? valor * f.valor : valor / f.valor;
}

/** Expresión legible con el factor aplicado: «(C1 - C2) * 10», «PROMEDIO(RN) / 2». */
export function expresionConFactor(expr: string, f: Factor | null): string {
  if (!f) return expr;
  const simple = /^[A-Za-z0-9_.]+(\([^()]*\))?$/.test(expr.trim());
  const base = simple ? expr.trim() : `(${expr.trim()})`;
  return `${base} ${f.operacion === "multiplicar" ? "*" : "/"} ${formatoNumero(f.valor)}`;
}

/** Texto para personas: «× 10», «÷ 2,5». */
export function textoFactor(f: Factor | null): string {
  if (!f) return "sin factor";
  return `${f.operacion === "multiplicar" ? "×" : "÷"} ${formatoNumero(f.valor).replace(".", ",")}`;
}

function formatoNumero(n: number): string {
  return String(Number(n.toPrecision(12)));
}

/**
 * ¿Puede esta persona ajustar el factor? Quien tenga `resultado.factor`
 * (SUPERADMIN siempre). Se deja como función para que la pantalla y el
 * servidor usen la misma regla.
 */
export function puedeAjustarFactor(user: { roles?: string[]; permisos?: string[] } | undefined): boolean {
  if (!user) return false;
  if ((user.roles ?? []).includes("SUPERADMIN")) return true;
  return (user.permisos ?? []).includes("resultado.factor");
}
