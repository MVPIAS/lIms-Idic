/**
 * Datos de la cotización que no están en el modelo Prisma (align_r4d_comercial.sql)
 * y sus enlaces con la oportunidad del CRM · frente r4d.
 *
 *   · Solicitante y documento de solicitud (EP-01/02 0.1, BL-210).
 *   · Oportunidad: al guardar la cotización desde «Crear cotización →» queda
 *     enlazada y la oportunidad pasa a «propuesta»; al aceptarse, a «ganada» con
 *     su OT (EP-00 0.3, BL-173).
 */
import { BadRequestException } from "@nestjs/common";
import { etapaPorCotizacion } from "../crm/reglas-crm";

type Db = {
  $queryRawUnsafe<T = unknown>(sql: string, ...args: unknown[]): Promise<T>;
  $executeRawUnsafe(sql: string, ...args: unknown[]): Promise<number>;
};

export const MEDIOS_SOLICITUD = ["oficio", "correo"] as const;

export interface DatosSolicitud {
  solicitanteContactoId?: string | null;
  solicitanteNombre?: string | null;
  solicitudMedio?: (typeof MEDIOS_SOLICITUD)[number] | null;
  solicitudNumero?: string | null;
  solicitudFecha?: string | null;
}

const CAMPOS: Record<keyof DatosSolicitud, [string, string]> = {
  solicitanteContactoId: ["solicitante_contacto_id", "::uuid"],
  solicitanteNombre: ["solicitante_nombre", ""],
  solicitudMedio: ["solicitud_medio", ""],
  solicitudNumero: ["solicitud_numero", ""],
  solicitudFecha: ["solicitud_fecha", "::date"],
};

/**
 * Referencia de la cotización a partir de la solicitud (EP-00 1.1): «OF Nº …»
 * si llegó por oficio; «Correo de fecha dd-mm-aaaa» si llegó por correo.
 */
export function numeroOficioLimpio(numero: string | null | undefined): string {
  // B-086: «OF-PRUEBA-0001» daba «OF Nº -PRUEBA-0001». Se quita el prefijo con
  // cualquier separador (espacio, punto, guion, dos puntos).
  return String(numero ?? "").trim().replace(/^(of(icio)?(?![a-z])[\s.\-:]*)?(n[º°o](?![a-z])[\s.\-:]*)?/i, "").trim();
}

export function referenciaDesdeSolicitud(d: DatosSolicitud): string | null {
  const n = numeroOficioLimpio(d.solicitudNumero);
  if (d.solicitudMedio === "oficio" && n) return `OF Nº ${n}`;
  if (d.solicitudMedio === "correo" && d.solicitudFecha) {
    const [a, m, dd] = d.solicitudFecha.slice(0, 10).split("-");
    return `Correo de fecha ${dd}-${m}-${a}`;
  }
  return null;
}

/** Guarda los datos de la solicitud (solo los que vienen). El contacto debe ser del cliente de la cotización. */
export async function guardarDatosSolicitud(db: Db, cotizacionId: string, d: DatosSolicitud) {
  if (d.solicitanteContactoId) {
    const ok = await db.$queryRawUnsafe<{ ok: boolean }[]>(
      `SELECT EXISTS (SELECT 1 FROM contacto ct JOIN cotizacion c ON c.cliente_id = ct.cliente_id
                       WHERE ct.id = $1::uuid AND c.id = $2::uuid AND ct.deleted_at IS NULL) AS ok`,
      d.solicitanteContactoId,
      cotizacionId,
    );
    if (!ok[0]?.ok) throw new BadRequestException("El solicitante debe ser un contacto del cliente de la cotización.");
  }
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [k, [col, cast]] of Object.entries(CAMPOS) as [keyof DatosSolicitud, [string, string]][]) {
    if (d[k] === undefined) continue;
    const v = d[k];
    vals.push(typeof v === "string" && v.trim() === "" ? null : v);
    sets.push(`${col} = $${vals.length}${cast}`);
  }
  if (!sets.length) return;
  vals.push(cotizacionId);
  await db.$executeRawUnsafe(`UPDATE cotizacion SET ${sets.join(", ")} WHERE id = $${vals.length}::uuid`, ...vals);
}

/** Datos de la solicitud para la ficha de la cotización. */
export async function leerDatosSolicitud(db: Db, cotizacionId: string) {
  const f = await db.$queryRawUnsafe<any[]>(
    `SELECT c.solicitante_contacto_id AS "solicitanteContactoId", c.solicitante_nombre AS "solicitanteNombre",
            ct.nombre AS "solicitanteContacto", ct.cargo AS "solicitanteCargo",
            c.solicitud_medio AS "solicitudMedio", c.solicitud_numero AS "solicitudNumero",
            to_char(c.solicitud_fecha, 'YYYY-MM-DD') AS "solicitudFecha",
            c.oportunidad_id AS "oportunidadId", o.codigo AS "oportunidadCodigo"
       FROM cotizacion c
       LEFT JOIN contacto ct ON ct.id = c.solicitante_contacto_id
       LEFT JOIN oportunidad o ON o.id = c.oportunidad_id
      WHERE c.id = $1::uuid`,
    cotizacionId,
  );
  return f[0] ?? null;
}

/**
 * Enlaza la cotización recién creada con su oportunidad. La oportunidad tiene
 * que ser del mismo tenant y cliente, estar viva y no tener otra cotización vigente.
 */
export async function validarOportunidad(db: Db, tenantId: string, clienteId: string, oportunidadId: string) {
  const o = await db.$queryRawUnsafe<any[]>(
    `SELECT o.id, o.codigo, o.estado, o.cliente_id, co.estado AS cot_estado, co.codigo AS cot_codigo
       FROM oportunidad o LEFT JOIN cotizacion co ON co.id = o.cotizacion_id
      WHERE o.id = $1::uuid AND o.tenant_id = $2::uuid AND o.deleted_at IS NULL`,
    oportunidadId,
    tenantId,
  );
  const opp = o[0];
  if (!opp) throw new BadRequestException("La oportunidad indicada no existe.");
  if (opp.estado === "perdida") throw new BadRequestException(`La oportunidad ${opp.codigo} está perdida.`);
  if (opp.cliente_id && opp.cliente_id !== clienteId)
    throw new BadRequestException(`La oportunidad ${opp.codigo} es de otro cliente.`);
  if (opp.cot_codigo && opp.cot_estado !== "anulada")
    throw new BadRequestException(`La oportunidad ${opp.codigo} ya tiene la cotización ${opp.cot_codigo}.`);
}

export async function enlazarOportunidad(db: Db, tenantId: string, cotizacionId: string, clienteId: string, oportunidadId: string) {
  await validarOportunidad(db, tenantId, clienteId, oportunidadId);
  const e = etapaPorCotizacion("creada");
  await db.$executeRawUnsafe(`UPDATE cotizacion SET oportunidad_id = $1::uuid WHERE id = $2::uuid`, oportunidadId, cotizacionId);
  await db.$executeRawUnsafe(
    `UPDATE oportunidad SET cotizacion_id = $2::uuid, cliente_id = COALESCE(cliente_id, $3::uuid), etapa = $4, estado = $5 WHERE id = $1::uuid`,
    oportunidadId,
    cotizacionId,
    clienteId,
    e.etapa,
    e.estado,
  );
}

/** Al aceptarse la cotización: su oportunidad queda «ganada» con la OT. */
export async function ganarOportunidadDeCotizacion(db: Db, cotizacionId: string, otId: string) {
  const e = etapaPorCotizacion("aceptada");
  await db.$executeRawUnsafe(
    `UPDATE oportunidad SET etapa = $3, estado = $4, ot_id = $2::uuid
      WHERE cotizacion_id = $1::uuid AND deleted_at IS NULL`,
    cotizacionId,
    otId,
    e.etapa,
    e.estado,
  );
}
