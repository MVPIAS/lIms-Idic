/**
 * Control de versiones de los MÉTODOS del catálogo · contrato §4.3.3
 * («Creación/modificación de métodos con control de cambios: trazabilidad,
 * fecha de edición y responsable»).
 *
 * Cada alta o cambio de un método (Tablas maestras › Métodos, «Tipos y
 * criterios…» del QC y el margen de advertencia de Calidad) deja una REVISIÓN
 * numerada (1, 2, 3…) en `cat_metodo_version` con la fecha, el responsable, el
 * motivo y qué cambió (valor anterior → nuevo), más la foto completa del método
 * tras el cambio. Si el guardado no cambia nada, no hay revisión nueva.
 *
 * Por qué una tabla nueva y no `metodo_version`: la heredada cuelga del
 * catálogo antiguo (`metodo`, FK metodo_id), modela un ciclo borrador/aprobado
 * con vigencias y ~30 columnas que el catálogo v2 no tiene (LOD/LOQ, flujo,
 * destinatarios…), su `version` es un texto de 10 caracteres único por método y
 * la referencian tablas del flujo antiguo (corrida, analito, boletín). Atarla a
 * `cat_metodo` habría obligado a rellenar o ignorar casi todas sus columnas.
 *
 * El campo «Versión» del formulario sigue siendo el texto libre de la edición
 * de la norma o del procedimiento (p. ej. «2018», «v2»); la revisión numerada
 * la lleva el sistema.
 *
 * DDL y foto del método (fn_cat_metodo_foto): packages/db/align_brechas_2.sql.
 * Parámetro metodo_version.motivo (obligatorio | opcional).
 */
import { BadRequestException } from "@nestjs/common";

type Db = { $queryRawUnsafe: <T = unknown>(q: string, ...p: unknown[]) => Promise<T> };

/* ------------------------------------------------------------ reglas puras --- */

/** Campos de la foto del método, en el orden en que se muestran, con su nombre en pantalla. */
export const CAMPOS_VERSION: { campo: string; etiqueta: string }[] = [
  { campo: "codigo", etiqueta: "Código" },
  { campo: "nombre", etiqueta: "Nombre" },
  { campo: "ensayo", etiqueta: "Ensayo" },
  { campo: "norma", etiqueta: "Norma" },
  { campo: "instrumento", etiqueta: "Instrumento" },
  { campo: "version", etiqueta: "Versión (texto)" },
  { campo: "servgrp", etiqueta: "Serv. grupo" },
  { campo: "factorOperacion", etiqueta: "Factor de la fórmula · operación" },
  { campo: "factorValor", etiqueta: "Factor de la fórmula · valor" },
  { campo: "factorDescripcion", etiqueta: "Factor · qué representa" },
  { campo: "equipoRequerido", etiqueta: "Exige informar el equipo al capturar" },
  { campo: "qcRequerido", etiqueta: "QC requerido" },
  { campo: "qcTipos", etiqueta: "QC · tipos de control exigidos" },
  { campo: "qcCriterios", etiqueta: "QC · criterios de aceptación" },
  { campo: "margenAdvertenciaPct", etiqueta: "Margen de advertencia (%)" },
  { campo: "activo", etiqueta: "Activo" },
];

export interface CambioMetodo {
  campo: string;
  etiqueta: string;
  antes: string | null;
  despues: string | null;
}

/** Valor legible y comparable: vacío → null; Sí/No; números sin ceros de sobra; listas y criterios ordenados. */
export function valorLegible(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? "Sí" : "No";
  if (typeof v === "number") return Number.isFinite(v) ? String(v).replace(".", ",") : null;
  if (Array.isArray(v)) {
    const xs = v.map((x) => String(x).trim()).filter(Boolean).sort();
    return xs.length ? xs.join(", ") : null;
  }
  if (typeof v === "object") {
    const pares = Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== null && x !== undefined && String(x).trim() !== "")
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, x]) => `${k}: ${String(x).trim()}`);
    return pares.length ? pares.join("; ") : null;
  }
  const t = String(v).trim();
  if (!t) return null;
  // Los numéricos de la base llegan como texto («1.500000»): se comparan y muestran como número.
  if (/^-?\d+(\.\d+)?$/.test(t)) return String(Number(t)).replace(".", ",");
  return t;
}

/** Qué cambió entre dos fotos del método (vacío = nada). */
export function diferenciasMetodo(antes: Record<string, unknown> | null | undefined, despues: Record<string, unknown> | null | undefined): CambioMetodo[] {
  const a = antes ?? {};
  const d = despues ?? {};
  const out: CambioMetodo[] = [];
  for (const { campo, etiqueta } of CAMPOS_VERSION) {
    const va = valorLegible(a[campo]);
    const vd = valorLegible(d[campo]);
    if (va !== vd) out.push({ campo, etiqueta, antes: va, despues: vd });
  }
  return out;
}

export type ModoMotivoMetodo = "obligatorio" | "opcional";

export function modoMotivoMetodo(valor: string | null | undefined): ModoMotivoMetodo {
  return String(valor ?? "").trim().toLowerCase() === "opcional" ? "opcional" : "obligatorio";
}

/** Error del motivo del cambio (null = válido). Solo se exige si hay cambios. */
export function errorMotivoMetodo(modo: ModoMotivoMetodo, cambios: CambioMetodo[], motivo: string | null | undefined): string | null {
  if (!cambios.length || modo === "opcional") return null;
  if ((motivo ?? "").trim().length >= 5) return null;
  return (
    `Indique el motivo del cambio del método (mínimo 5 caracteres): queda en su historial de versiones. ` +
    `Cambia: ${cambios.map((c) => c.etiqueta).join(", ")}.`
  );
}

/** El motivo que se guarda: recortado a 500 caracteres; vacío → null. */
export function motivoMetodo(v: unknown): string | null {
  const t = typeof v === "string" ? v.trim() : "";
  return t ? t.slice(0, 500) : null;
}

/* ----------------------------------------------------------- acceso a BD --- */

export async function leerModoMotivoMetodo(db: Db, tenantId: string | null | undefined): Promise<ModoMotivoMetodo> {
  if (!tenantId) return "obligatorio";
  const f = await db
    .$queryRawUnsafe<{ valor: string | null }[]>(
      `SELECT valor FROM parametro_sistema WHERE tenant_id = $1::uuid AND categoria = 'metodo_version' AND codigo = 'motivo' AND activo`,
      tenantId,
    )
    .catch(() => [] as { valor: string | null }[]);
  return modoMotivoMetodo(f[0]?.valor);
}

async function foto(db: Db, metodoId: string): Promise<Record<string, unknown> | null> {
  const [f] = await db.$queryRawUnsafe<{ foto: Record<string, unknown> | null }[]>(`SELECT fn_cat_metodo_foto($1::uuid) AS foto`, metodoId);
  return f?.foto ?? null;
}

export interface OpcionesVersion {
  tenantId: string | null | undefined;
  metodoId: string;
  usuarioId: string | null | undefined;
  motivo: string | null | undefined;
  /** edicion | qc | margen (el alta usa insertarVersionMetodo) */
  origen: string;
  /** false: se registra la revisión aunque falte el motivo (pantallas que aún no lo piden). */
  exigirMotivo?: boolean;
}

type Tx = Db;
type ConTx = { $transaction: <T>(fn: (tx: any) => Promise<T>) => Promise<T> };

/**
 * Aplica `cambio` (el UPDATE del método) dentro de una transacción y, si cambió
 * algo de la foto, registra la revisión siguiente. Si el motivo es obligatorio
 * y falta, deshace el cambio con un 400. Devuelve lo que devuelve `cambio` y la
 * revisión creada (null si no cambió nada).
 */
export async function conVersionMetodo<T>(
  prisma: ConTx,
  o: OpcionesVersion,
  cambio: (tx: any) => Promise<T>,
): Promise<{ valor: T; revision: number | null; cambios: CambioMetodo[] }> {
  const modo = o.exigirMotivo === false ? "opcional" : await leerModoMotivoMetodo(prisma as unknown as Db, o.tenantId);
  return prisma.$transaction(async (tx: Tx & any) => {
    // Bloquea el método: dos guardados a la vez no se quedan con el mismo número.
    await tx.$queryRawUnsafe(`SELECT id FROM cat_metodo WHERE id = $1::uuid FOR UPDATE`, o.metodoId);
    const antes = await foto(tx, o.metodoId);
    const valor = await cambio(tx);
    const despues = await foto(tx, o.metodoId);
    const cambios = diferenciasMetodo(antes, despues);
    if (!cambios.length) return { valor, revision: null, cambios };
    const e = errorMotivoMetodo(modo, cambios, o.motivo);
    if (e) throw new BadRequestException(e);
    const revision = await insertarVersionMetodo(tx, { metodoId: o.metodoId, origen: o.origen, motivo: o.motivo, cambios, usuarioId: o.usuarioId });
    return { valor, revision, cambios };
  });
}

/**
 * Inserta la revisión siguiente del método con su foto ACTUAL (dentro de la
 * transacción del cambio). La usa también el alta (revisión 1, sin cambios).
 */
export async function insertarVersionMetodo(
  tx: Db,
  v: { metodoId: string; origen: string; motivo: string | null | undefined; cambios: CambioMetodo[]; usuarioId: string | null | undefined },
): Promise<number | null> {
  const [f] = await tx.$queryRawUnsafe<{ numero: number }[]>(
    `INSERT INTO cat_metodo_version (tenant_id, cat_metodo_id, numero, origen, motivo, cambios, foto, usuario_id)
     SELECT m.tenant_id, m.id,
            COALESCE((SELECT MAX(numero) FROM cat_metodo_version WHERE cat_metodo_id = m.id), 0) + 1,
            $2, $3, $4::jsonb, COALESCE(fn_cat_metodo_foto(m.id), '{}'::jsonb), $5::uuid
       FROM cat_metodo m WHERE m.id = $1::uuid
     RETURNING numero`,
    v.metodoId,
    v.origen,
    motivoMetodo(v.motivo),
    JSON.stringify(v.cambios),
    v.usuarioId ?? null,
  );
  return f?.numero ?? null;
}

/** Historial de revisiones de un método (la más reciente primero). */
export async function versionesDeMetodo(db: Db, metodoId: string) {
  return db.$queryRawUnsafe<any[]>(
    `SELECT v.id, v.numero, v.origen, v.motivo, v.cambios, v.foto, v.created_at AS fecha,
            v.usuario_id AS "usuarioId", u.nombre_completo AS responsable
       FROM cat_metodo_version v LEFT JOIN usuario u ON u.id = v.usuario_id
      WHERE v.cat_metodo_id = $1::uuid
      ORDER BY v.numero DESC`,
    metodoId,
  );
}

/** Revisión vigente (la última) de cada método, para la columna «Rev.» del listado. */
export async function revisionesActuales(db: Db, metodoIds: string[]): Promise<Map<string, number>> {
  if (!metodoIds.length) return new Map();
  const f = await db
    .$queryRawUnsafe<{ id: string; n: number }[]>(
      `SELECT cat_metodo_id AS id, MAX(numero)::int AS n FROM cat_metodo_version WHERE cat_metodo_id = ANY($1::uuid[]) GROUP BY cat_metodo_id`,
      metodoIds,
    )
    .catch(() => [] as { id: string; n: number }[]);
  return new Map(f.map((x) => [x.id, Number(x.n)]));
}
