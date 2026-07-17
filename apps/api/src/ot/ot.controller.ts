import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
  ParseUUIDPipe,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { DEV_TENANT } from "../common/base-crud.service";
import { FlujoService } from "../flujo/flujo.service";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { estadosValidos, validarTransicion } from "../common/estados";
import { generarCodigoOt } from "../common/codigo";

const PrioridadEnum = z.enum(["baja", "normal", "alta", "urgente"]);

/**
 * Referencia a un flujo: o bien una instancia YA existente (`flujoInstanciaId`),
 * o bien una definición/versión que el backend instancia por nosotros
 * (`flujoDefId` → su versión publicada, o `flujoVersionId` directo).
 * Son mutuamente excluyentes para no dejar instancias huérfanas.
 */
const FlujoRef = {
  flujoInstanciaId: z.string().uuid().optional(),
  flujoDefId: z.string().uuid().optional(),
  flujoVersionId: z.string().uuid().optional(),
};
const unSoloFlujo = (d: {
  flujoInstanciaId?: string;
  flujoDefId?: string;
  flujoVersionId?: string;
}) => [d.flujoInstanciaId, d.flujoDefId, d.flujoVersionId].filter(Boolean).length <= 1;
const MSG_UN_SOLO_FLUJO =
  "Use solo uno de: flujoInstanciaId, flujoDefId o flujoVersionId";

/**
 * Crear OT directamente (con o sin cotización de respaldo).
 * `fechaIngreso` se persiste en la columna real `fecha_recepcion`.
 * Flujo (opcional): `flujoInstanciaId` adjunta una instancia existente;
 * `flujoDefId`/`flujoVersionId` hacen que el backend INSTANCIE el flujo y lo asocie.
 */
const OtCreate = z
  .object({
    clienteId: z.string().uuid(),
    cotizacionId: z.string().uuid().optional(),
    prioridad: PrioridadEnum.optional(),
    notas: z.string().optional(),
    fechaIngreso: z.coerce.date().optional(),
    ...FlujoRef,
  })
  .refine(unSoloFlujo, { message: MSG_UN_SOLO_FLUJO });

// `estado` deja de ser texto libre: solo los estados reales de la OT
// (common/estados.ts). La transición la valida `actualizar()`.
const OtUpdate = z
  .object({
    estado: z.enum(estadosValidos("ot") as [string, ...string[]]).optional(),
    prioridad: PrioridadEnum.optional(),
    notas: z.string().optional(),
    ...FlujoRef,
  })
  .refine(unSoloFlujo, { message: MSG_UN_SOLO_FLUJO });

/** Body de POST /ot/:id/flujo · adjunta/instancia un flujo en una OT existente. */
const OtAdjuntarFlujo = z
  .object({
    flujoDefId: z.string().uuid().optional(),
    flujoVersionId: z.string().uuid().optional(),
  })
  .refine((d) => Boolean(d.flujoDefId) !== Boolean(d.flujoVersionId), {
    message: "Se requiere exactamente uno de: flujoDefId o flujoVersionId",
  });

@ApiTags("ot")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("ot")
export class OtController {
  private prisma = new PrismaClient();

  // FlujoService llega vía OtModule → imports: [FlujoModule] (que lo exporta).
  constructor(private readonly flujos: FlujoService) {}

  @Get()
  @RequierePermiso("ot.ver")
  async listar(@Req() req: any) {
    const tenantId = req?.user?.tenantId;
    const ots = await this.prisma.ordenTrabajo.findMany({
      // OrdenTrabajo tiene tenant_id: solo se listan las OT del tenant del usuario.
      where: { ...(tenantId ? { tenantId } : {}) },
      take: 50,
      orderBy: { createdAt: "desc" },
      include: { cliente: true },
    });

    // Resumen del flujo activo por OT (estado + paso actual) para pintarlo en la
    // lista sin una llamada por fila. `flujo_instancia_id` es una columna suelta
    // (no hay relación Prisma), así que se resuelve en una segunda consulta,
    // acotada al tenant para no filtrar instancias ajenas.
    const instanciaIds = ots
      .map((o) => o.flujoInstanciaId)
      .filter((x): x is string => Boolean(x));
    if (!instanciaIds.length) return ots;

    const instancias = await this.prisma.flujoInstancia.findMany({
      where: { id: { in: instanciaIds }, ...(tenantId ? { tenantId } : {}) },
      select: {
        id: true,
        estado: true,
        pasoActual: { select: { numero: true, actividad: true, tipo: true } },
      },
    });
    const porId = new Map(instancias.map((i) => [i.id, i]));
    return ots.map((o) => ({
      ...o,
      flujo: o.flujoInstanciaId ? porId.get(o.flujoInstanciaId) ?? null : null,
    }));
  }

  /**
   * Estado del flujo de una OT: la instancia (con historial y paso actual) y sus
   * tareas actuales. Reutiliza el motor (`estadoInstancia` + `bandejaDeInstancia`),
   * no lo duplica. Devuelve `{ instancia: null, tareas: [] }` si la OT no tiene
   * flujo, para que la UI ofrezca iniciar uno.
   */
  @Get(":id/flujo")
  @RequierePermiso("ot.ver")
  async flujoDeOt(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId;
    const ot = await this.prisma.ordenTrabajo.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
      select: { id: true, flujoInstanciaId: true },
    });
    if (!ot) throw new NotFoundException(`OT ${id} no encontrada`);
    if (!ot.flujoInstanciaId) return { instancia: null, tareas: [] };
    const [instancia, tareas] = await Promise.all([
      this.flujos.estadoInstancia(ot.flujoInstanciaId, tenantId),
      this.flujos.bandejaDeInstancia(ot.flujoInstanciaId, tenantId),
    ]);
    return { instancia, tareas };
  }

  @Get(":id")
  @RequierePermiso("ot.ver")
  async detalle(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    // findFirst con tenant compuesto: si la OT es de otro tenant, no se revela (null).
    return this.prisma.ordenTrabajo.findFirst({
      where: { id, ...(req?.user?.tenantId ? { tenantId: req.user.tenantId } : {}) },
      include: { cliente: true },
    });
  }

  @Post()
  @RequierePermiso("ot.crear")
  async crear(@Body() body: unknown, @Req() req: any) {
    const dto = OtCreate.parse(body);
    const tenantId = req.user?.tenantId ?? DEV_TENANT;

    // El cliente debe pertenecer al tenant del solicitante (evita adjuntar clientes de otro tenant).
    const cliente = await this.prisma.cliente.findFirst({
      where: { id: dto.clienteId, tenantId },
      select: { id: true },
    });
    if (!cliente) throw new BadRequestException("clienteId no existe o no pertenece al tenant");

    // Si viene cotización, debe ser del mismo tenant.
    if (dto.cotizacionId) {
      const cot = await this.prisma.cotizacion.findFirst({
        where: { id: dto.cotizacionId, tenantId },
        select: { id: true },
      });
      if (!cot) throw new BadRequestException("cotizacionId no existe o no pertenece al tenant");
    }

    // Si se adjunta una instancia YA existente, debe ser del mismo tenant
    // (si no, se estaría enganchando el flujo de otro tenant a esta OT).
    if (dto.flujoInstanciaId) await this.validarInstancia(dto.flujoInstanciaId, tenantId);

    // Toda la validación del flujo (tenant, def existe, versión publicada) se
    // resuelve ANTES de crear la OT: si algo falla, no queda una OT a medias.
    const versionId =
      dto.flujoDefId || dto.flujoVersionId
        ? await this.flujos.resolverVersionId(dto, tenantId)
        : null;

    const codigo = await this.generarCodigo(tenantId);

    const ot = await this.prisma.ordenTrabajo.create({
      data: {
        tenantId,
        codigo,
        clienteId: dto.clienteId,
        cotizacionId: dto.cotizacionId ?? null,
        flujoInstanciaId: dto.flujoInstanciaId ?? null,
        prioridad: dto.prioridad ?? "normal",
        estado: "recepcionada",
        fechaRecepcion: dto.fechaIngreso ?? new Date(),
        notas: dto.notas ?? null,
      },
      include: { cliente: true },
    });

    if (!versionId) return ot;

    // La OT ya existe → se instancia el flujo con su otId y se cierra el enlace
    // inverso (orden_trabajo.flujo_instancia_id). Ambos extremos quedan ligados.
    return this.instanciarYEnlazar(ot.id, versionId, tenantId, req);
  }

  /**
   * Adjunta un flujo a una OT existente: instancia la versión (publicada, del
   * mismo tenant) y la asocia a la OT.
   */
  @Post(":id/flujo")
  @RequierePermiso("ot.crear")
  async adjuntarFlujo(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: any,
  ) {
    const dto = OtAdjuntarFlujo.parse(body);
    const tenantId = req.user?.tenantId ?? DEV_TENANT;

    const ot = await this.prisma.ordenTrabajo.findFirst({
      where: { id, tenantId },
      select: { id: true, flujoInstanciaId: true },
    });
    if (!ot) throw new NotFoundException(`OT ${id} no encontrada`);
    // No se pisa un flujo en curso: dejaría la instancia anterior huérfana.
    if (ot.flujoInstanciaId)
      throw new BadRequestException("La OT ya tiene un flujo asociado");

    const versionId = await this.flujos.resolverVersionId(dto, tenantId);
    return this.instanciarYEnlazar(ot.id, versionId, tenantId, req);
  }

  /** Instancia `versionId` para `otId` y enlaza la instancia en la OT. */
  private async instanciarYEnlazar(otId: string, versionId: string, tenantId: string, req: any) {
    const instancia = await this.flujos.instanciar(
      versionId,
      { otId, usuarioId: req.user?.sub },
      tenantId,
    );
    return this.prisma.ordenTrabajo.update({
      where: { id: otId },
      data: { flujoInstanciaId: instancia.id },
      include: { cliente: true },
    });
  }

  /** La instancia debe existir y pertenecer al tenant del solicitante. */
  private async validarInstancia(instanciaId: string, tenantId: string) {
    const ins = await this.prisma.flujoInstancia.findFirst({
      where: { id: instanciaId, tenantId },
      select: { id: true },
    });
    if (!ins)
      throw new BadRequestException("flujoInstanciaId no existe o no pertenece al tenant");
  }

  /**
   * `ot.crear` cubre la edición. El cierre de la OT es un acto distinto y más
   * restrictivo: si el PATCH lleva `estado: 'cerrada'` se exige además
   * `ot.cerrar` (SUPERADMIN, ADMIN, DIRECTOR). Es la separación de deberes que
   * pide la 17025 y la razón de que ese permiso exista en el RBAC sembrado.
   */
  @Patch(":id")
  @RequierePermiso("ot.crear")
  async actualizar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const dto = OtUpdate.parse(body);
    const tenantId = req.user?.tenantId;
    // Verifica existencia + pertenencia al tenant antes de actualizar.
    const actual = await this.prisma.ordenTrabajo.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
      select: { id: true, flujoInstanciaId: true, estado: true },
    });
    if (!actual) throw new NotFoundException(`OT ${id} no encontrada`);

    if (dto.estado !== undefined) {
      if (dto.estado === "cerrada") this.exigeCerrar(req);
      validarTransicion("ot", actual.estado, dto.estado);
    }

    // Los campos de flujo no son columnas: se separan de los datos escalares.
    const { flujoInstanciaId, flujoDefId, flujoVersionId, ...campos } = dto;
    const pideFlujo = Boolean(flujoDefId || flujoVersionId);

    if (pideFlujo && actual.flujoInstanciaId)
      throw new BadRequestException("La OT ya tiene un flujo asociado");
    if (flujoInstanciaId) await this.validarInstancia(flujoInstanciaId, tenantId ?? DEV_TENANT);

    // Se valida el flujo antes de tocar la OT (mismo criterio que en crear).
    const versionId = pideFlujo
      ? await this.flujos.resolverVersionId({ flujoDefId, flujoVersionId }, tenantId)
      : null;

    const ot = await this.prisma.ordenTrabajo.update({
      where: { id },
      data: { ...campos, ...(flujoInstanciaId ? { flujoInstanciaId } : {}) },
      include: { cliente: true },
    });

    if (!versionId) return ot;
    return this.instanciarYEnlazar(id, versionId, tenantId ?? DEV_TENANT, req);
  }

  /**
   * Cerrar una OT exige `ot.cerrar` además del `ot.crear` de la ruta.
   * SUPERADMIN mantiene el bypass, igual que en PermisoGuard.
   */
  private exigeCerrar(req: any) {
    const roles: string[] = req.user?.roles ?? [];
    if (roles.includes("SUPERADMIN")) return;
    const permisos: string[] = req.user?.permisos ?? [];
    if (!permisos.includes("ot.cerrar")) {
      throw new ForbiddenException("Permiso insuficiente. Requiere: ot.cerrar");
    }
  }

  /**
   * Genera 'OT-2026-NNNN' con secuencia por tenant y año (UNIQUE(tenant_id, codigo)).
   * La lógica vive ahora en `common/codigo.ts` para que `POST /cotizaciones/:id/aceptar`
   * cree la OT con el mismo correlativo. Se conserva el método como envoltorio.
   */
  private async generarCodigo(tenantId: string): Promise<string> {
    return generarCodigoOt(this.prisma, tenantId);
  }
}
