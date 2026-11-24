import { Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { RequierePermiso } from "../auth/permisos.decorator";
import { AmbitoUnidad } from "../rbac/ambito-unidad.guard";
import { PrismaService } from "../common/prisma.service";
import {
  PersonaNaturalEditarSchema,
  PersonaNaturalSchema,
  TIPO_PERSONA_NATURAL,
  conflictoRut,
  razonSocialPersona,
  rutNormal,
} from "./persona-natural";

const PERMISO = "cliente.persona_natural.gestionar";
const COLUMNAS = `id, rut, nombres, apellidos, razon_social AS "razonSocial", email::text AS email, telefono, direccion AS domicilio, comuna, region,
                  created_at AS "creada", updated_at AS "actualizada"`;

/**
 * Personas naturales (armas usadas) · las mantiene la Delegación Nº 11:
 *   GET   /clientes/personas-naturales?q=     buscar por RUT o nombre
 *   GET   /clientes/personas-naturales/:id
 *   POST  /clientes/personas-naturales        crear
 *   PATCH /clientes/personas-naturales/:id    editar (el RUT no se cambia)
 * Solo fichas con es_persona_natural = true; una empresa no se toca desde aquí.
 */
@ApiTags("clientes")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"))
@AmbitoUnidad("D11")
@Controller("clientes/personas-naturales")
export class PersonaNaturalController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequierePermiso(PERMISO)
  @ApiOperation({ summary: "Buscar personas naturales (Delegación Nº 11) por RUT o nombre" })
  async listar(@Query("q") q: string | undefined, @Req() req: any) {
    const texto = (q ?? "").trim();
    return this.prisma.$queryRawUnsafe<any[]>(
      `SELECT ${COLUMNAS} FROM cliente
        WHERE tenant_id = $1::uuid AND es_persona_natural AND deleted_at IS NULL
          AND ($2 = '' OR razon_social ILIKE '%' || $2 || '%' OR REPLACE(REPLACE(rut, '.', ''), ' ', '') ILIKE '%' || REPLACE($2, '.', '') || '%')
        ORDER BY apellidos, nombres LIMIT 100`,
      req.user.tenantId,
      texto,
    );
  }

  @Get(":id")
  @RequierePermiso(PERMISO)
  @ApiOperation({ summary: "Ficha de una persona natural" })
  async detalle(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.ficha(req.user.tenantId, id);
  }

  @Post()
  @RequierePermiso(PERMISO)
  @ApiOperation({ summary: "Crear una persona natural { rut, nombres, apellidos, email, telefono, domicilio, comuna, region }" })
  async crear(@Body() body: unknown, @Req() req: any) {
    const d = PersonaNaturalSchema.parse(body ?? {});
    const rut = rutNormal(d.rut);
    const [existe] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, es_persona_natural FROM cliente
        WHERE tenant_id = $1::uuid AND deleted_at IS NULL AND UPPER(REPLACE(REPLACE(rut, '.', ''), ' ', '')) = $2 LIMIT 1`,
      req.user.tenantId,
      rut,
    );
    const conflicto = conflictoRut(existe ?? null);
    if (conflicto) throw new ConflictException(conflicto);
    const [f] = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO cliente (tenant_id, rut, razon_social, tipo, es_persona_natural, nombres, apellidos, email, telefono, direccion, comuna, region)
       VALUES ($1::uuid, $2, $3, $4, TRUE, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      req.user.tenantId,
      rut,
      razonSocialPersona(d.nombres, d.apellidos),
      TIPO_PERSONA_NATURAL,
      d.nombres,
      d.apellidos,
      d.email ?? null,
      d.telefono ?? null,
      d.domicilio ?? null,
      d.comuna ?? null,
      d.region ?? null,
    );
    return this.ficha(req.user.tenantId, f.id);
  }

  @Patch(":id")
  @RequierePermiso(PERMISO)
  @ApiOperation({ summary: "Editar una persona natural (el RUT no se cambia)" })
  async editar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const actual = await this.ficha(req.user.tenantId, id);
    const d = PersonaNaturalEditarSchema.parse(body ?? {});
    const nombres = d.nombres ?? actual.nombres ?? "";
    const apellidos = d.apellidos ?? actual.apellidos ?? "";
    await this.prisma.$executeRawUnsafe(
      `UPDATE cliente SET nombres = $2, apellidos = $3, razon_social = $4,
              email = CASE WHEN $5::boolean THEN $6 ELSE email END,
              telefono = CASE WHEN $7::boolean THEN $8 ELSE telefono END,
              direccion = CASE WHEN $9::boolean THEN $10 ELSE direccion END,
              comuna = CASE WHEN $11::boolean THEN $12 ELSE comuna END,
              region = CASE WHEN $13::boolean THEN $14 ELSE region END,
              updated_at = now()
        WHERE id = $1::uuid AND es_persona_natural`,
      id,
      nombres,
      apellidos,
      razonSocialPersona(nombres, apellidos),
      "email" in (body as any),
      d.email ?? null,
      "telefono" in (body as any),
      d.telefono ?? null,
      "domicilio" in (body as any),
      d.domicilio ?? null,
      "comuna" in (body as any),
      d.comuna ?? null,
      "region" in (body as any),
      d.region ?? null,
    );
    return this.ficha(req.user.tenantId, id);
  }

  private async ficha(tenantId: string, id: string) {
    const [f] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT ${COLUMNAS} FROM cliente WHERE id = $1::uuid AND tenant_id = $2::uuid AND es_persona_natural AND deleted_at IS NULL`,
      id,
      tenantId,
    );
    if (!f) throw new NotFoundException("Persona natural no encontrada.");
    return f;
  }
}
