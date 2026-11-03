/**
 * Alcance del HISTORIAL DE CORREOS (`correo_enviado`) y de sus adjuntos.
 * Regla pura (arma el SQL), probada en alcance-correo.spec.ts.
 *
 * Quién ve un correo de la bitácora:
 *   · quien lo envió y las personas a cuyo correo se envió (siempre);
 *   · la COPIA POR CORREO de un mensaje interno, SOLO su remitente y sus
 *     destinatarios (ni siquiera un usuario global: es correspondencia privada,
 *     igual que el mensaje en «Mensajes internos»);
 *   · un correo ligado a una OT, si la OT es de una unidad de su alcance para
 *     `ot.ver`; ligado a una cotización, si la cotización está en su alcance
 *     para `cotizacion.ver` (alcance-cotizacion.ts: laboratorios de la
 *     cotización o el Departamento Comercial). Con OT y cotización basta una;
 *   · ligado solo a un cliente (sin OT ni cotización), quien ve clientes
 *     (`cliente.ver`: los clientes no tienen alcance por laboratorio);
 *   · el resto (sin vínculo), solo los usuarios globales;
 *   · los usuarios globales ven todo salvo las copias de mensajes internos ajenos.
 * El adjunto se descarga con la misma regla que su correo.
 */
import { SQL_UNIDADES_COTIZACION } from "../cotizacion/alcance-cotizacion";

/** Lo que el usuario puede ver, ya resuelto contra su alcance. null = todas. */
export interface AmbitoCorreo {
  usuarioId: string;
  /** Correo del usuario (minúsculas) para reconocerlo entre los destinatarios. */
  email: string | null;
  /** Alcance global (unión de sus asignaciones): ve todo menos copias de mensajes ajenos. */
  global: boolean;
  /** Unidades de sus OT visibles (`ot.ver`); null = todas. */
  otVisibles: string[] | null;
  /** Unidades de sus cotizaciones visibles (`cotizacion.ver`); null = todas (global o Comercial). */
  cotVisibles: string[] | null;
  /** Tiene `cliente.ver`. */
  verClientes: boolean;
}

/** Las unidades de la cotización de la columna `col` (SQL_UNIDADES_COTIZACION sobre una columna). */
export function sqlUnidadesCotizacionDe(col: string): string {
  return SQL_UNIDADES_COTIZACION.split("$1::uuid").join(col);
}

/**
 * Condición SQL «la cotización de `col` está en estas unidades» (parámetro
 * `$n::text[]`). Sin lista (null) no restringe. `col` no puede usar los alias
 * internos de SQL_UNIDADES_COTIZACION (c, o, cc, s, l, e, f, un, x): se
 * confundirían con los de la subconsulta.
 */
export function condCotizacionVisible(col: string, visibles: string[] | null, n: number): { sql: string; args: unknown[] } {
  if (visibles === null) return { sql: "TRUE", args: [] };
  return { sql: `EXISTS (SELECT 1 FROM (${sqlUnidadesCotizacionDe(col)}) uc WHERE uc.id = ANY($${n}::text[]))`, args: [visibles] };
}

/**
 * Condición SQL sobre el alias `ce` de `correo_enviado` con la regla de
 * arriba. Los parámetros empiezan en `$desde`.
 */
export function filtroAlcanceCorreo(a: AmbitoCorreo, desde: number): { sql: string; args: unknown[] } {
  const args: unknown[] = [];
  const p = (v: unknown) => {
    args.push(v);
    return `$${desde + args.length - 1}`;
  };
  const yo = p(a.usuarioId);
  const propio = [`ce.enviado_por = ${yo}::uuid`];
  if (a.email) {
    const mail = p(a.email.trim().toLowerCase());
    propio.push(`${mail} = ANY(string_to_array(lower(regexp_replace(COALESCE(ce.destinatarios, ''), '\\s', '', 'g')), ','))`);
  }
  // Copia de un mensaje interno: también sus destinatarios en el LIMS (aunque no tengan correo).
  propio.push(
    `(ce.tipo = 'mensaje' AND ce.mensaje_id IS NOT NULL AND EXISTS (SELECT 1 FROM mensaje_destinatario md WHERE md.mensaje_id = ce.mensaje_id AND md.usuario_id = ${yo}::uuid))`,
  );

  let entidad: string;
  if (a.global) entidad = "TRUE";
  else {
    const partes: string[] = [];
    if (a.otVisibles === null) partes.push("ce.ot_id IS NOT NULL");
    else if (a.otVisibles.length)
      partes.push(`EXISTS (SELECT 1 FROM orden_trabajo vo WHERE vo.id = ce.ot_id AND vo.unidad_principal = ANY(${p(a.otVisibles)}::uuid[]))`);
    if (a.cotVisibles === null) partes.push("ce.cotizacion_id IS NOT NULL");
    else if (a.cotVisibles.length) {
      const c = condCotizacionVisible("ce.cotizacion_id", a.cotVisibles, desde + args.length);
      args.push(...c.args);
      partes.push(`(ce.cotizacion_id IS NOT NULL AND ${c.sql})`);
    }
    if (a.verClientes) partes.push("(ce.ot_id IS NULL AND ce.cotizacion_id IS NULL AND ce.cliente_id IS NOT NULL)");
    entidad = partes.length ? `(${partes.join(" OR ")})` : "FALSE";
  }
  return { sql: `(${propio.join(" OR ")} OR (ce.tipo <> 'mensaje' AND ${entidad}))`, args };
}

/** Lo que se usa de AlcanceService (tipo estructural: este archivo no importa Nest). */
interface AlcanceLike {
  filtroUnidades(req: any, permiso?: string | readonly string[] | null): Promise<string[] | null>;
  alcancePermisos(req: any, permisos: readonly string[]): Promise<{ esGlobal: boolean }>;
  arbol(tenantId?: string): Promise<{ porCodigo: Map<string, { id: string }> }>;
}

/** Unidades de cotización visibles para el permiso; con el Departamento Comercial dentro, todas (null). */
export async function unidadesCotizacionVisibles(alcance: AlcanceLike, req: any, permiso: string): Promise<string[] | null> {
  const visibles = await alcance.filtroUnidades(req, permiso);
  if (!visibles?.length) return visibles;
  const dco = (await alcance.arbol(req?.user?.tenantId)).porCodigo.get("DCO")?.id ?? null;
  return dco && visibles.includes(dco) ? null : visibles;
}

/**
 * Ámbito del usuario del request para filtroAlcanceCorreo. `prisma` =
 * PrismaService o PrismaClient (lee el correo del usuario).
 */
export async function ambitoCorreoDe(prisma: any, alcance: AlcanceLike, req: any): Promise<AmbitoCorreo> {
  const usuarioId: string = req?.user?.sub ?? "00000000-0000-0000-0000-000000000000";
  const permisos: string[] = req?.user?.permisos ?? [];
  const superadmin = (req?.user?.roles ?? []).includes("SUPERADMIN");
  const filas: { email: string | null }[] = await prisma
    .$queryRawUnsafe(`SELECT email FROM usuario WHERE id = $1::uuid`, usuarioId)
    .catch(() => []);
  return {
    usuarioId,
    email: filas[0]?.email?.trim().toLowerCase() || null,
    global: (await alcance.alcancePermisos(req, [])).esGlobal,
    otVisibles: superadmin || permisos.includes("ot.ver") ? await alcance.filtroUnidades(req, "ot.ver") : [],
    cotVisibles: superadmin || permisos.includes("cotizacion.ver") ? await unidadesCotizacionVisibles(alcance, req, "cotizacion.ver") : [],
    verClientes: superadmin || permisos.includes("cliente.ver"),
  };
}

/** ¿Puede abrir el historial de correos? `correo.enviar` o `cotizacion.ver` (o SUPERADMIN). */
export function accedeACorreos(permisos: readonly string[], roles: readonly string[]): boolean {
  return roles.includes("SUPERADMIN") || permisos.includes("correo.enviar") || permisos.includes("cotizacion.ver");
}

/** Permisos con que se abre Mensajería · correo (menú, página y API). */
export const PERMISOS_CORREOS = ["correo.enviar", "cotizacion.ver"] as const;
