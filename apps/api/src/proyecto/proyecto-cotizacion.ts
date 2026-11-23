/**
 * Proyecto en la cotización y en la OT (quinto envío IDIC, lote 3) · lectura y
 * escritura con SQL parametrizado (las columnas `proyecto_id` no están en el
 * modelo Prisma, como el resto de extras de la cotización). `db` =
 * PrismaService o una transacción.
 *
 *   · La cotización lleva un proyecto opcional, que tiene que ser del MISMO
 *     cliente y estar activo (uno ya elegido se conserva aunque se desactive).
 *   · Al aceptarse, la OT toma el proyecto (enlace por id) y su texto del
 *     encargo (`ot_encargo.proyecto`, el «Nombre del proyecto» del IVC) se
 *     rellena con «PROY/001/2026 · Nombre» si estaba vacío.
 *   · Si el proyecto de la cotización cambia (Abierta o Reabierta), la OT que
 *     ya tenga lo sigue, y su texto del encargo también, salvo que alguien lo
 *     haya escrito a mano.
 */
import { BadRequestException } from "@nestjs/common";
import { textoProyecto } from "./numeracion-proyecto";

type Db = {
  $queryRawUnsafe<T = unknown>(sql: string, ...args: unknown[]): Promise<T>;
  $executeRawUnsafe(sql: string, ...args: unknown[]): Promise<number>;
};

export interface ProyectoBreve {
  id: string;
  codigo: string;
  nombre: string;
  activo: boolean;
  clienteId: string | null;
}

/** Texto del proyecto en SQL (mismo formato que `textoProyecto`). */
export const SQL_TEXTO_PROYECTO = (p: string) => `LEFT(${p}.codigo || ' · ' || ${p}.nombre, 200)`;

export async function leerProyecto(db: Db, tenantId: string, id: string): Promise<ProyectoBreve | null> {
  const f = await db.$queryRawUnsafe<ProyectoBreve[]>(
    `SELECT id::text AS id, codigo, nombre, COALESCE(activo, TRUE) AS activo, cliente_id::text AS "clienteId"
       FROM proyecto WHERE id = $1::uuid AND tenant_id = $2::uuid`,
    id,
    tenantId,
  );
  return f[0] ?? null;
}

/**
 * Valida el proyecto elegido para una cotización del cliente `clienteId`.
 * `actualId` = el que la cotización ya tiene (se acepta aunque esté inactivo).
 */
export async function exigirProyectoDelCliente(db: Db, tenantId: string, clienteId: string, proyectoId: string, actualId?: string | null): Promise<ProyectoBreve> {
  const p = await leerProyecto(db, tenantId, proyectoId);
  if (!p) throw new BadRequestException("El proyecto elegido no existe.");
  if (p.clienteId !== clienteId)
    throw new BadRequestException(`El proyecto ${p.codigo} es de otro cliente: un proyecto pertenece a un solo cliente y solo sus cotizaciones pueden llevarlo.`);
  if (!p.activo && p.id !== actualId) throw new BadRequestException(`El proyecto ${p.codigo} está inactivo: actívelo en Comercial › Proyectos o elija otro.`);
  return p;
}

/** Proyecto actual de la cotización (null si no tiene). */
export async function proyectoDeCotizacion(db: Db, cotizacionId: string): Promise<string | null> {
  const f = await db.$queryRawUnsafe<{ id: string | null }[]>(`SELECT proyecto_id::text AS id FROM cotizacion WHERE id = $1::uuid`, cotizacionId);
  return f[0]?.id ?? null;
}

/**
 * Fija (o quita, con null) el proyecto de la cotización y lo propaga a su OT,
 * si ya la tiene: enlace y texto del encargo (solo si estaba vacío o era el
 * texto automático del proyecto anterior).
 */
export async function fijarProyectoCotizacion(db: Db, tenantId: string, cotizacionId: string, proyectoId: string | null) {
  const antes = await proyectoDeCotizacion(db, cotizacionId);
  if ((antes ?? null) === (proyectoId ?? null)) return;
  const pAntes = antes ? await leerProyecto(db, tenantId, antes) : null;
  const pNuevo = proyectoId ? await leerProyecto(db, tenantId, proyectoId) : null;
  await db.$executeRawUnsafe(`UPDATE cotizacion SET proyecto_id = $2::uuid, updated_at = now() WHERE id = $1::uuid`, cotizacionId, proyectoId);
  await db.$executeRawUnsafe(`UPDATE orden_trabajo SET proyecto_id = $2::uuid WHERE cotizacion_id = $1::uuid`, cotizacionId, proyectoId);
  await db.$executeRawUnsafe(
    `UPDATE ot_encargo e SET proyecto = $2, actualizado_at = now()
       FROM orden_trabajo o
      WHERE o.id = e.ot_id AND o.cotizacion_id = $1::uuid
        AND (COALESCE(btrim(e.proyecto), '') = '' OR e.proyecto = $3)`,
    cotizacionId,
    pNuevo ? textoProyecto(pNuevo.codigo, pNuevo.nombre) : null,
    pAntes ? textoProyecto(pAntes.codigo, pAntes.nombre) : "",
  );
}

/** Copia el proyecto de una cotización a otra (nueva versión, pre-cotización → cotización formal). */
export async function copiarProyectoCotizacion(db: Db, desdeId: string, haciaId: string) {
  await db.$executeRawUnsafe(
    `UPDATE cotizacion h SET proyecto_id = d.proyecto_id FROM cotizacion d WHERE d.id = $1::uuid AND h.id = $2::uuid AND d.proyecto_id IS NOT NULL`,
    desdeId,
    haciaId,
  );
}

/**
 * Herencia a la OT que nace de la cotización: enlace por id y, si el encargo no
 * tiene texto de proyecto, «PROY/001/2026 · Nombre» (lo imprime el IVC).
 * Idempotente; la llama `heredarDeCotizacion` después de crear el encargo.
 */
export async function heredarProyectoOt(db: Db, otId: string, cotizacionId: string) {
  await db.$executeRawUnsafe(
    `UPDATE orden_trabajo o SET proyecto_id = c.proyecto_id
       FROM cotizacion c
      WHERE o.id = $1::uuid AND c.id = $2::uuid AND c.proyecto_id IS NOT NULL AND o.proyecto_id IS DISTINCT FROM c.proyecto_id`,
    otId,
    cotizacionId,
  );
  await db.$executeRawUnsafe(
    `UPDATE ot_encargo e SET proyecto = ${SQL_TEXTO_PROYECTO("p")}
       FROM orden_trabajo o JOIN proyecto p ON p.id = o.proyecto_id
      WHERE e.ot_id = $1::uuid AND o.id = e.ot_id AND COALESCE(btrim(e.proyecto), '') = ''`,
    otId,
  );
}

/** Proyecto de cada cotización (para la lista y la ficha). Sin la columna (SQL no aplicado): vacío. */
export async function leerProyectosDeCotizaciones(db: Db, ids: string[]): Promise<Map<string, { proyectoId: string; proyecto: ProyectoBreve }>> {
  if (!ids.length) return new Map();
  try {
    const f = await db.$queryRawUnsafe<(ProyectoBreve & { cotizacionId: string })[]>(
      `SELECT c.id::text AS "cotizacionId", p.id::text AS id, p.codigo, p.nombre, COALESCE(p.activo, TRUE) AS activo, p.cliente_id::text AS "clienteId"
         FROM cotizacion c JOIN proyecto p ON p.id = c.proyecto_id
        WHERE c.id = ANY($1::uuid[])`,
      ids,
    );
    return new Map(f.map(({ cotizacionId, ...p }) => [cotizacionId, { proyectoId: p.id, proyecto: p }]));
  } catch {
    return new Map();
  }
}

/** Ids de las cotizaciones de un proyecto (filtro de la lista de cotizaciones). */
export async function cotizacionesDelProyecto(db: Db, tenantId: string | null, proyectoId: string): Promise<string[]> {
  const f = await db.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id::text AS id FROM cotizacion WHERE proyecto_id = $1::uuid AND ($2::uuid IS NULL OR tenant_id = $2::uuid)`,
    proyectoId,
    tenantId,
  );
  return f.map((x) => x.id);
}
