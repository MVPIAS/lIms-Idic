/**
 * Bloqueo de clientes con facturas impagas (Comercial, reunión 2 · 28-10-2026).
 *
 * El bloqueo es atribución del JEFE DEL DEPARTAMENTO COMERCIAL: el sistema
 * propone los clientes morosos (facturas vencidas con saldo), pero no los
 * bloquea solo. Un cliente bloqueado no recibe cotizaciones nuevas (tampoco
 * pre-cotizaciones) ni se le registra la aceptación de una abierta, hasta que
 * el Jefe DCO lo desbloquee con motivo.
 *
 * Funciones PURAS: bloqueo-cliente.spec.ts.
 */

/** Estados de factura que aún esperan pago (facturacion.module.ts). */
export const ESTADOS_FACTURA_IMPAGA = ["emitida", "parcial", "aviso_1", "aviso_2", "aviso_3", "prejudicial"] as const;

export interface ClienteBloqueable {
  razonSocial?: string | null;
  bloqueado?: boolean | null;
  motivoBloqueo?: string | null;
}

/** Mensaje de rechazo si el cliente está bloqueado (null = puede seguir). */
export function motivoClienteBloqueado(c: ClienteBloqueable | null | undefined, accion: "cotizar" | "aceptar"): string | null {
  if (!c?.bloqueado) return null;
  const quien = c.razonSocial ? `El cliente ${c.razonSocial}` : "El cliente";
  const que = accion === "cotizar" ? "no se le pueden emitir cotizaciones" : "no se puede registrar la aceptación de su cotización";
  const motivo = c.motivoBloqueo?.trim() ? ` Motivo: ${c.motivoBloqueo.trim()}.` : "";
  return `${quien} está bloqueado por el Jefe del Departamento Comercial: ${que}.${motivo} Solo el Jefe DCO puede desbloquearlo.`;
}

/** Quien puede bloquear o desbloquear: SUPERADMIN, o quien tiene el permiso y es jefatura del Depto. Comercial. */
export function puedeBloquearClientes(u: { superadmin: boolean; tienePermiso: boolean; esJefeDco: boolean }): boolean {
  return u.superadmin || (u.tienePermiso && u.esJefeDco);
}

export interface FacturaImpaga {
  fechaVencimiento: string | null; // AAAA-MM-DD
  saldo: number;
  estado: string;
}

export interface Morosidad {
  facturasVencidas: number;
  montoVencido: number;
  diasMoraMax: number;
  /** El sistema propone bloquearlo (lo decide el Jefe DCO). */
  sugiereBloqueo: boolean;
}

const diasEntre = (desde: string, hasta: string) => Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000);

/**
 * Morosidad de un cliente a la fecha `hoy` (AAAA-MM-DD, Chile). Cuenta las
 * facturas impagas con saldo cuyo vencimiento pasó hace más de `diasGracia`.
 */
export function evaluarMorosidad(facturas: FacturaImpaga[], hoy: string, diasGracia = 0): Morosidad {
  let n = 0;
  let monto = 0;
  let max = 0;
  for (const f of facturas) {
    if (!(ESTADOS_FACTURA_IMPAGA as readonly string[]).includes(f.estado)) continue;
    if (!(Number(f.saldo) > 0) || !f.fechaVencimiento) continue;
    const mora = diasEntre(f.fechaVencimiento.slice(0, 10), hoy);
    if (mora <= Math.max(0, diasGracia)) continue;
    n++;
    monto += Number(f.saldo);
    max = Math.max(max, mora);
  }
  return { facturasVencidas: n, montoVencido: Math.round(monto * 100) / 100, diasMoraMax: max, sugiereBloqueo: n > 0 };
}
