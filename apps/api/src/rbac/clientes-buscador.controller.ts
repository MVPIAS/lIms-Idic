import { Controller, ForbiddenException, Get, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PermisoGuard } from "../auth/permiso.guard";
import { PrismaService } from "../common/prisma.service";
import { DEV_TENANT } from "../common/base-crud.service";

/**
 * B-014 (recorrido MP-09 D09-01, MP-11 D11-04) · buscador ACOTADO del maestro
 * de clientes para los perfiles que necesitan ELEGIR un cliente sin gestionar
 * el maestro: la Delegación Nº 11 (cliente de la OT automática de una
 * evidencia, EP-11 11.31) y el Jefe de Sucursal (empresa de destino de un
 * traspaso, EP-09). Solo devuelve id, razón social, nombre de fantasía y RUT:
 * nada de contactos, condiciones comerciales ni bloqueos (eso sigue en
 * /clientes con cliente.ver).
 */
export const PERMISOS_ELEGIR_CLIENTE = [
  "cliente.ver",
  "evidencia.crear",
  "bpch.reinspeccion.gestionar",
  "bpch.internacion.gestionar",
  "muestra.crear",
] as const;

export function puedeElegirCliente(user: { roles?: string[]; permisos?: string[] } | undefined): boolean {
  if ((user?.roles ?? []).includes("SUPERADMIN")) return true;
  const tiene = user?.permisos ?? [];
  return PERMISOS_ELEGIR_CLIENTE.some((p) => tiene.includes(p));
}

@ApiTags("rbac")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("clientes-buscador")
export class ClientesBuscadorController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: "Buscador acotado de clientes (id, razón social, RUT) para elegir un cliente" })
  async buscar(@Query("search") search: string | undefined, @Query("limit") limit: string | undefined, @Req() req: any) {
    if (!puedeElegirCliente(req?.user))
      throw new ForbiddenException(`Permiso insuficiente. Requiere uno de: ${PERMISOS_ELEGIR_CLIENTE.join(", ")}`);
    const q = (search ?? "").trim().slice(0, 60);
    const n = Math.min(Math.max(Number.parseInt(limit ?? "20", 10) || 20, 1), 200);
    const data = await this.prisma.$queryRawUnsafe<{ id: string; razonSocial: string; nombreFantasia: string | null; rut: string | null }[]>(
      `SELECT id, razon_social AS "razonSocial", nombre_fantasia AS "nombreFantasia", rut
         FROM cliente
        WHERE tenant_id = $1::uuid AND deleted_at IS NULL
          AND ($2 = '' OR razon_social ILIKE '%' || $2 || '%' OR nombre_fantasia ILIKE '%' || $2 || '%' OR rut ILIKE $2 || '%')
        ORDER BY razon_social
        LIMIT $3`,
      req?.user?.tenantId ?? DEV_TENANT,
      q,
      n,
    );
    return { data };
  }
}
