import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PrismaService } from "../common/prisma.service";
import { PermisoGuard } from "../auth/permiso.guard";
import { AlcanceService } from "./alcance.service";

/**
 * Búsqueda LIGERA de personas para selectores (cadena de custodia «Entrega /
 * Recibe», responsable de un equipo, firmas registradas, responsable de una no
 * conformidad…). A diferencia de /usuarios (que exige admin.usuarios) la puede
 * usar cualquier usuario autenticado, pero:
 *   · solo devuelve nombre, usuario, cargo, grado y unidades: nada de correo,
 *     estado de la cuenta, 2FA, último ingreso ni roles;
 *   · se acota al alcance de quien pregunta: un perfil global ve a todos; uno
 *     acotado ve a las personas de sus unidades visibles y a las de roles
 *     transversales (asignación sin unidad: recepción, calidad, dirección…), que
 *     también intervienen en su trabajo.
 * La lista solo trae cuentas activas; el detalle (/personas/:id) resuelve
 * también inactivas para poder mostrar el nombre en registros históricos.
 */
const BusquedaSchema = z.object({
  search: z.string().trim().max(80).optional(),
  q: z.string().trim().max(80).optional(),
  unidadId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(500).default(200),
  page: z.coerce.number().int().positive().default(1),
});

export interface PersonaDto {
  id: string;
  nombreCompleto: string;
  /** Alias para los selectores que leen `nombre`. */
  nombre: string;
  username: string;
  cargo: string | null;
  grado: string | null;
  activo: boolean;
  unidades: { codigo: string; nombre: string }[];
}

const VIGENTE = (alias: string) =>
  `(${alias}.vigente_desde IS NULL OR ${alias}.vigente_desde <= now()) AND (${alias}.vigente_hasta IS NULL OR ${alias}.vigente_hasta >= now())`;

@ApiTags("personas")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("personas")
export class PersonasController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
  ) {}

  @Get()
  async buscar(@Query() query: unknown, @Req() req: any) {
    const q = BusquedaSchema.parse(query ?? {});
    const texto = q.search || q.q || null;
    const unidades = await this.alcance.filtroUnidades(req); // null = global
    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT u.id, u.nombre_completo, u.username::text AS username, u.cargo, u.grado,
              (u.estado = 'activo') AS activo,
              COALESCE(json_agg(DISTINCT jsonb_build_object('codigo', un.codigo, 'nombre', un.nombre))
                         FILTER (WHERE un.id IS NOT NULL), '[]') AS unidades
         FROM usuario u
         LEFT JOIN usuario_rol ur ON ur.usuario_id = u.id AND ${VIGENTE("ur")}
         LEFT JOIN unidad un      ON un.id = ur.unidad_id
        WHERE u.tenant_id = COALESCE($1::uuid, u.tenant_id)
          AND u.deleted_at IS NULL
          AND u.estado = 'activo'
          AND ( $2::uuid[] IS NULL
                OR u.id = $3::uuid
                OR EXISTS (SELECT 1 FROM usuario_rol r2
                            WHERE r2.usuario_id = u.id AND ${VIGENTE("r2")}
                              AND (r2.unidad_id IS NULL OR r2.unidad_id = ANY($2::uuid[]))) )
          AND ( $4::text IS NULL
                OR u.nombre_completo ILIKE '%' || $4 || '%'
                OR u.username::text  ILIKE '%' || $4 || '%'
                OR COALESCE(u.cargo, '') ILIKE '%' || $4 || '%' )
          AND ( $5::uuid IS NULL
                OR EXISTS (SELECT 1 FROM usuario_rol r3
                            WHERE r3.usuario_id = u.id AND r3.unidad_id = $5::uuid AND ${VIGENTE("r3")}) )
        GROUP BY u.id
        ORDER BY u.nombre_completo
        LIMIT $6 OFFSET $7`,
      req?.user?.tenantId ?? null,
      unidades,
      req?.user?.sub ?? null,
      texto,
      q.unidadId ?? null,
      q.limit,
      (q.page - 1) * q.limit,
    );
    const data = filas.map(aPersona);
    return { data, meta: { page: q.page, limit: q.limit, total: data.length, totalPages: 1 } };
  }

  /** Nombre de una persona (también inactiva) para mostrar registros históricos. */
  @Get(":id")
  async detalle(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT u.id, u.nombre_completo, u.username::text AS username, u.cargo, u.grado,
              (u.estado = 'activo' AND u.deleted_at IS NULL) AS activo,
              COALESCE(json_agg(DISTINCT jsonb_build_object('codigo', un.codigo, 'nombre', un.nombre))
                         FILTER (WHERE un.id IS NOT NULL), '[]') AS unidades
         FROM usuario u
         LEFT JOIN usuario_rol ur ON ur.usuario_id = u.id AND ${VIGENTE("ur")}
         LEFT JOIN unidad un      ON un.id = ur.unidad_id
        WHERE u.id = $1::uuid AND u.tenant_id = COALESCE($2::uuid, u.tenant_id)
        GROUP BY u.id`,
      id,
      req?.user?.tenantId ?? null,
    );
    if (!filas.length) throw new NotFoundException("Persona no encontrada");
    return aPersona(filas[0]);
  }
}

function aPersona(f: any): PersonaDto {
  return {
    id: f.id,
    nombreCompleto: f.nombre_completo,
    nombre: f.nombre_completo,
    username: f.username,
    cargo: f.cargo ?? null,
    grado: f.grado ?? null,
    activo: f.activo === true,
    unidades: Array.isArray(f.unidades) ? f.unidades : [],
  };
}
