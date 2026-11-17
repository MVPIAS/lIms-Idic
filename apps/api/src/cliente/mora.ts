/**
 * Bloqueo de clientes por mora · COM-05 (respuesta IDIC 17-11-2026):
 * «Se reactiva. 30 aviso, 60 bloqueo, 90 consejo. [Excepción:] Jefe DCO».
 *
 * Días de mora de una factura = hoy − vencimiento, donde vencimiento es su
 * fecha de vencimiento o, si no la tiene, la emisión + los días de crédito del
 * cliente. Cuentan las facturas emitidas o con pago parcial que aún tienen saldo.
 *   · ≥ dias_aviso   (30) → aviso a Comercial y Finanzas;
 *   · ≥ dias_bloqueo (60) → el cliente queda BLOQUEADO: no se le crean
 *                           cotizaciones ni OT;
 *   · ≥ dias_cde     (90) → alerta «derivar al Consejo de Defensa del Estado».
 * Los tramos son parámetros (Administración › Parámetros, categoría mora_cliente).
 * Excepción: el Jefe DCO (o su subrogante) desbloquea con motivo; queda en
 * cliente_desbloqueo con las facturas que cubre. Una factura distinta que
 * llegue al tramo de bloqueo vuelve a bloquear.
 *
 * Reglas PURAS (sin BD), probadas en mora.spec.ts.
 */

export type TramoMora = "al_dia" | "aviso" | "bloqueo" | "cde";

export interface ConfigMora {
  activo: boolean;
  diasAviso: number;
  diasBloqueo: number;
  diasCde: number;
}

export const CONFIG_MORA_DEFECTO: ConfigMora = { activo: true, diasAviso: 30, diasBloqueo: 60, diasCde: 90 };

const ent = (v: unknown, d: number) => {
  const n = Number.parseInt(String(v ?? ""), 10);
  return Number.isInteger(n) && n >= 1 && n <= 3650 ? n : d;
};

/** Lee la categoría mora_cliente de parametro_sistema (filas inactivas = valor por defecto). */
export function configMora(filas: { codigo: string; valor: string | null; activo?: boolean }[]): ConfigMora {
  const v = (c: string) => filas.find((f) => f.codigo === c && f.activo !== false)?.valor ?? null;
  const d = CONFIG_MORA_DEFECTO;
  const activo = String(v("activo") ?? "si").trim().toLowerCase();
  let diasAviso = ent(v("dias_aviso"), d.diasAviso);
  let diasBloqueo = ent(v("dias_bloqueo"), d.diasBloqueo);
  let diasCde = ent(v("dias_cde"), d.diasCde);
  // Tramos en orden: si alguien los cruza, se vuelve a los de por defecto.
  if (!(diasAviso <= diasBloqueo && diasBloqueo <= diasCde)) [diasAviso, diasBloqueo, diasCde] = [d.diasAviso, d.diasBloqueo, d.diasCde];
  return { activo: !["no", "false", "0"].includes(activo), diasAviso, diasBloqueo, diasCde };
}

const diaUtc = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
const dia = (v: Date | string | null | undefined): string | null => {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
};

/** Vencimiento de la factura (AAAA-MM-DD): el suyo o emisión + días de crédito. */
export function vencimientoFactura(f: { fechaVencimiento?: Date | string | null; fechaEmision?: Date | string | null; diasCredito?: number | null }): string | null {
  const propio = dia(f.fechaVencimiento ?? null);
  if (propio) return propio;
  const em = dia(f.fechaEmision ?? null);
  if (!em) return null;
  const dc = Number.isInteger(f.diasCredito) && (f.diasCredito as number) >= 0 ? (f.diasCredito as number) : 30;
  return new Date(diaUtc(em) + dc * 86_400_000).toISOString().slice(0, 10);
}

/** Días de mora (0 si aún no vence). */
export function diasMora(vencimiento: string | null, hoy: string): number {
  if (!vencimiento) return 0;
  return Math.max(0, Math.round((diaUtc(hoy) - diaUtc(vencimiento)) / 86_400_000));
}

export function tramoDe(dias: number, cfg: ConfigMora): TramoMora {
  if (dias >= cfg.diasCde) return "cde";
  if (dias >= cfg.diasBloqueo) return "bloqueo";
  if (dias >= cfg.diasAviso) return "aviso";
  return "al_dia";
}

const ORDEN: TramoMora[] = ["al_dia", "aviso", "bloqueo", "cde"];

export interface FacturaMora {
  id: string;
  numero: string;
  estado: string;
  saldo: number;
  fechaVencimiento?: Date | string | null;
  fechaEmision?: Date | string | null;
  diasCredito?: number | null;
}

export interface EstadoMora {
  tramo: TramoMora;
  diasMax: number;
  /** Facturas con saldo y al menos en el tramo de aviso (la más atrasada primero). */
  facturas: { id: string; numero: string; vencimiento: string | null; dias: number; saldo: number; tramo: TramoMora; exceptuada: boolean }[];
  /** ¿Corresponde el bloqueo automático? (tramo ≥ bloqueo sin excepción del Jefe DCO). */
  bloquear: boolean;
}

/**
 * Estado de mora de un cliente. `exceptuadas` = facturas cubiertas por un
 * desbloqueo del Jefe DCO: no bloquean (sí siguen avisando).
 */
export function estadoMoraCliente(facturas: FacturaMora[], hoy: string, cfg: ConfigMora, exceptuadas: Iterable<string> = []): EstadoMora {
  const exc = new Set(exceptuadas);
  const filas = facturas
    .filter((f) => (f.estado === "emitida" || f.estado === "parcial") && f.saldo > 0.005)
    .map((f) => {
      const vencimiento = vencimientoFactura(f);
      const dias = diasMora(vencimiento, hoy);
      return { id: f.id, numero: f.numero, vencimiento, dias, saldo: f.saldo, tramo: tramoDe(dias, cfg), exceptuada: exc.has(f.id) };
    })
    .filter((f) => f.tramo !== "al_dia")
    .sort((a, b) => b.dias - a.dias);
  if (!cfg.activo) return { tramo: "al_dia", diasMax: 0, facturas: filas, bloquear: false };
  const tramo = filas.reduce<TramoMora>((t, f) => (ORDEN.indexOf(f.tramo) > ORDEN.indexOf(t) ? f.tramo : t), "al_dia");
  const bloquear = filas.some((f) => !f.exceptuada && (f.tramo === "bloqueo" || f.tramo === "cde"));
  return { tramo, diasMax: filas[0]?.dias ?? 0, facturas: filas, bloquear };
}

/** Motivo que se guarda en la ficha del cliente al bloquearlo por mora. */
export function motivoBloqueoMora(e: EstadoMora): string {
  const f = e.facturas.find((x) => !x.exceptuada && (x.tramo === "bloqueo" || x.tramo === "cde")) ?? e.facturas[0];
  return `Bloqueo automático por mora: la factura ${f?.numero ?? "—"} lleva ${f?.dias ?? e.diasMax} días vencida.`;
}

/** Mensaje al intentar cotizar o abrir una OT para un cliente bloqueado. */
export function mensajeClienteBloqueado(razonSocial: string, motivo: string | null | undefined): string {
  const m = String(motivo ?? "").trim().replace(/[\s.]+$/, "");
  return `El cliente ${razonSocial} está bloqueado${m ? ` (${m})` : ""}: no se le pueden crear cotizaciones ni OT. Para una excepción, el Jefe DCO debe desbloquearlo registrando el motivo.`;
}
