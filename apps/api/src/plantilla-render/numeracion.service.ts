/**
 * Numeración oficial de documentos por laboratorio y tipo (tabla
 * `numeracion_documento`, align_r1b_numeracion.sql). Reglas puras en
 * numeracion.ts; contrato en docs/FLUJO_NUMERACION_DOCUMENTOS.md.
 *
 * Rutas (Administración › Numeración de documentos, permiso documento.numeracion):
 *   GET    numeracion-documentos            · reglas, tokens y tipos
 *   POST   numeracion-documentos            · nueva regla
 *   PATCH  numeracion-documentos/:id        · cambiar formato, reinicio…
 *   POST   numeracion-documentos/:id/desactivar · deja de aplicarse (no se borra: el correlativo queda)
 *   POST   numeracion-documentos/probar     · número de ejemplo de un formato (no consume correlativo)
 */
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PrismaService } from "../common/prisma.service";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import {
  conSufijo,
  elegirRegla,
  erroresFormato,
  formatearNumero,
  NOMBRE_TIPO_NUMERABLE,
  periodoDe,
  TIPOS_NUMERABLES,
  TOKENS,
  usaCorrelativo,
  type Regla,
  type VariablesNumero,
} from "./numeracion";

const SIN_UNIDAD = "00000000-0000-0000-0000-000000000000";
const tenantDe = (req: any): string => req?.user?.tenantId;

export interface ReglaDb extends Regla {
  unidadCodigo: string | null;
  unidadNombre: string | null;
  porConfirmar: boolean;
  fuente: string | null;
  updatedAt: Date;
}

/** Datos del documento que el formato puede imprimir. */
export interface DatosNumero {
  tenantId: string;
  /** Unidad que emite (laboratorio responsable del documento). */
  unidadId: string | null;
  tipo: string;
  fecha: Date;
  ot?: string | null;
  muestra?: string | null;
  ni?: string | null;
  numInforme?: string | null;
}

export interface NumeroReservado {
  numero: string;
  regla: ReglaDb;
}

@Injectable()
export class NumeracionService {
  constructor(private readonly prisma: PrismaService) {}

  /** Reglas del tenant (activas e inactivas) con su unidad. */
  async reglas(tenantId: string, db: any = this.prisma): Promise<ReglaDb[]> {
    try {
      return await db.$queryRawUnsafe(
        `SELECT n.id, n.unidad_id AS "unidadId", n.tipo_documento AS "tipoDocumento", n.formato, n.reinicio,
                n.correlativo_por_unidad AS "correlativoPorUnidad", n.por_confirmar AS "porConfirmar", n.fuente,
                n.activo, n.updated_at AS "updatedAt", u.codigo AS "unidadCodigo", u.nombre AS "unidadNombre"
           FROM numeracion_documento n LEFT JOIN unidad u ON u.id = n.unidad_id
          WHERE n.tenant_id = $1::uuid
          ORDER BY n.activo DESC, u.codigo NULLS FIRST, n.tipo_documento NULLS LAST`,
        tenantId,
      );
    } catch {
      return []; // BD sin align_r1b_numeracion.sql: numeración general
    }
  }

  /** La unidad, su código StarLIMS y su linaje (ella primero, luego sus ancestros). */
  async unidad(unidadId: string | null, db: any = this.prisma): Promise<{ codigo: string | null; codsucdel: string | null; cadena: string[] }> {
    if (!unidadId) return { codigo: null, codsucdel: null, cadena: [] };
    const filas = await db.$queryRawUnsafe(
      `WITH RECURSIVE cadena AS (
         SELECT id, padre_id, codigo, codsucdel, 0 AS nivel FROM unidad WHERE id = $1::uuid
         UNION ALL
         SELECT u.id, u.padre_id, u.codigo, u.codsucdel, c.nivel + 1 FROM unidad u JOIN cadena c ON u.id = c.padre_id WHERE c.nivel < 20)
       SELECT id, codigo, codsucdel FROM cadena ORDER BY nivel`,
      unidadId,
    ) as { id: string; codigo: string; codsucdel: string | null }[];
    return { codigo: filas[0]?.codigo ?? null, codsucdel: filas[0]?.codsucdel ?? null, cadena: filas.map((f) => f.id) };
  }

  /** Regla aplicable a un documento de `tipo` emitido por `unidadId` (null = numeración general). */
  async resolver(tenantId: string, unidadId: string | null, tipo: string, db: any = this.prisma) {
    const [reglas, u] = await Promise.all([this.reglas(tenantId, db), this.unidad(unidadId, db)]);
    return { regla: elegirRegla(reglas, u.cadena, tipo), unidad: u };
  }

  private variables(d: DatosNumero, u: { codigo: string | null; codsucdel: string | null }, n: number | null): VariablesNumero {
    return { fecha: d.fecha, n, ot: d.ot, lab: u.codigo, codsucdel: u.codsucdel, muestra: d.muestra, ni: d.ni, numInforme: d.numInforme };
  }

  /**
   * Reserva el número oficial DENTRO de la transacción `tx`. Devuelve null si
   * no hay regla o si al formato le falta un dato (el llamador usa entonces la
   * numeración general CERT-AAAA-NNNN y lo avisa).
   *
   * {N} sale de `numeracion_documento_correlativo` con INSERT … ON CONFLICT DO
   * UPDATE … RETURNING: PostgreSQL serializa las emisiones simultáneas en el
   * lock de la fila del contador y nunca entrega dos veces el mismo valor. Si el
   * número ya existe (formato sin {N}, p. ej. «Nº = Nº de OT» con un segundo
   * documento, o un número importado), se toma el siguiente {N} o se añade «-2», «-3»…
   */
  async reservar(
    tx: any,
    d: DatosNumero,
    existe: (numero: string) => Promise<boolean>,
  ): Promise<(NumeroReservado & { faltan?: undefined }) | { numero: null; regla: ReglaDb | null; faltan: string[] }> {
    const { regla, unidad } = await this.resolver(d.tenantId, d.unidadId, d.tipo, tx);
    if (!regla) return { numero: null, regla: null, faltan: [] };
    const conN = usaCorrelativo(regla.formato);
    const unidadContador = regla.correlativoPorUnidad && d.unidadId ? d.unidadId : SIN_UNIDAD;
    const periodo = periodoDe(regla, d.fecha);
    for (let intento = 1; intento <= 50; intento++) {
      let n: number | null = null;
      if (conN) {
        const f = await tx.$queryRawUnsafe(
          `INSERT INTO numeracion_documento_correlativo (tenant_id, regla_id, unidad_id, periodo, ultimo, updated_at)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 1, now())
           ON CONFLICT (tenant_id, regla_id, unidad_id, periodo)
           DO UPDATE SET ultimo = numeracion_documento_correlativo.ultimo + 1, updated_at = now()
           RETURNING ultimo`,
          d.tenantId,
          regla.id,
          unidadContador,
          periodo,
        ) as { ultimo: number }[];
        n = Number(f[0]?.ultimo ?? 0);
        if (!n) throw new ConflictException("No se pudo reservar el correlativo del documento");
      }
      const r = formatearNumero(regla.formato, this.variables(d, unidad, n));
      if (!r.numero) return { numero: null, regla, faltan: r.faltan };
      const numero = conN ? r.numero : conSufijo(r.numero, intento);
      if (!(await existe(numero))) return { numero, regla };
    }
    throw new ConflictException(`No se encontró un número libre con el formato ${regla.formato}: revise la numeración del laboratorio.`);
  }

  /**
   * Número que tendrá el próximo documento, SIN reservar nada (para la pantalla
   * de emisión). Es orientativo: otra emisión simultánea puede tomarlo antes.
   */
  async proximo(d: DatosNumero): Promise<{ numero: string | null; formato: string | null; porConfirmar: boolean; faltan: string[]; unidad: string | null }> {
    const { regla, unidad } = await this.resolver(d.tenantId, d.unidadId, d.tipo);
    if (!regla) return { numero: null, formato: null, porConfirmar: false, faltan: [], unidad: unidad.codigo };
    let n: number | null = null;
    if (usaCorrelativo(regla.formato)) {
      const f = await this.prisma.$queryRawUnsafe<{ ultimo: number }[]>(
        `SELECT ultimo FROM numeracion_documento_correlativo
          WHERE tenant_id = $1::uuid AND regla_id = $2::uuid AND unidad_id = $3::uuid AND periodo = $4`,
        d.tenantId,
        regla.id,
        regla.correlativoPorUnidad && d.unidadId ? d.unidadId : SIN_UNIDAD,
        periodoDe(regla, d.fecha),
      );
      n = Number(f[0]?.ultimo ?? 0) + 1;
    }
    const r = formatearNumero(regla.formato, this.variables(d, unidad, n));
    return { numero: r.numero, formato: regla.formato, porConfirmar: regla.porConfirmar, faltan: r.faltan, unidad: unidad.codigo };
  }

  /* ----------------------------------------------------------- administración --- */

  async crear(tenantId: string, usuarioId: string | null, dto: z.infer<typeof ReglaCrear>) {
    const e = erroresFormato(dto.formato);
    if (e.length) throw new BadRequestException(e.join(" "));
    if (dto.unidadId) await this.exigirUnidad(tenantId, dto.unidadId);
    try {
      const f = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO numeracion_documento (tenant_id, unidad_id, tipo_documento, formato, reinicio, correlativo_por_unidad,
                                           por_confirmar, fuente, created_by, updated_by)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9::uuid, $9::uuid) RETURNING id`,
        tenantId,
        dto.unidadId ?? null,
        dto.tipoDocumento ?? null,
        dto.formato.trim(),
        dto.reinicio,
        dto.correlativoPorUnidad,
        dto.porConfirmar,
        dto.fuente?.trim() || null,
        usuarioId,
      );
      return this.ficha(tenantId, f[0].id);
    } catch (err: any) {
      const m = String(err?.message ?? "");
      if (m.includes("ux_numeracion_documento_regla") || m.includes("23505"))
        throw new ConflictException("Ya hay una regla activa para esa unidad y ese tipo de documento: edítela.");
      throw err;
    }
  }

  async actualizar(tenantId: string, id: string, usuarioId: string | null, dto: z.infer<typeof ReglaCambio>) {
    const actual = await this.ficha(tenantId, id);
    if (!actual.activo) throw new ConflictException("La regla está desactivada: cree una nueva.");
    if (dto.formato !== undefined) {
      const e = erroresFormato(dto.formato);
      if (e.length) throw new BadRequestException(e.join(" "));
    }
    await this.prisma.$executeRawUnsafe(
      `UPDATE numeracion_documento
          SET formato = COALESCE($3, formato), reinicio = COALESCE($4, reinicio),
              correlativo_por_unidad = COALESCE($5, correlativo_por_unidad), por_confirmar = COALESCE($6, por_confirmar),
              fuente = CASE WHEN $7::boolean THEN $8 ELSE fuente END, updated_by = $9::uuid, updated_at = now()
        WHERE id = $1::uuid AND tenant_id = $2::uuid`,
      id,
      tenantId,
      dto.formato?.trim() ?? null,
      dto.reinicio ?? null,
      dto.correlativoPorUnidad ?? null,
      dto.porConfirmar ?? null,
      dto.fuente !== undefined,
      dto.fuente?.trim() || null,
      usuarioId,
    );
    return this.ficha(tenantId, id);
  }

  async desactivar(tenantId: string, id: string, usuarioId: string | null) {
    await this.ficha(tenantId, id);
    await this.prisma.$executeRawUnsafe(
      `UPDATE numeracion_documento SET activo = FALSE, updated_by = $3::uuid, updated_at = now() WHERE id = $1::uuid AND tenant_id = $2::uuid`,
      id,
      tenantId,
      usuarioId,
    );
    return this.ficha(tenantId, id);
  }

  async ficha(tenantId: string, id: string): Promise<ReglaDb> {
    const r = (await this.reglas(tenantId)).find((x) => x.id === id);
    if (!r) throw new NotFoundException(`Regla de numeración ${id} no encontrada`);
    return r;
  }

  private async exigirUnidad(tenantId: string, unidadId: string) {
    const u = await this.prisma.unidad.findFirst({ where: { id: unidadId, tenantId }, select: { id: true } });
    if (!u) throw new BadRequestException("La unidad no existe.");
  }

  /** Número de ejemplo de un formato con datos de muestra (no consume correlativo). */
  async probar(tenantId: string, dto: z.infer<typeof Probar>) {
    const e = erroresFormato(dto.formato);
    if (e.length) return { numero: null, errores: e };
    if (dto.unidadId) await this.exigirUnidad(tenantId, dto.unidadId);
    const u = await this.unidad(dto.unidadId ?? null);
    const r = formatearNumero(dto.formato, {
      fecha: new Date(),
      n: 7,
      ot: "OT-2026-0012",
      lab: u.codigo ?? "LAB",
      codsucdel: u.codsucdel ?? "7000",
      muestra: "M-2026-0003",
      ni: "OI-2026-0004",
      numInforme: "3000/0001/00012/000003",
    });
    return { numero: r.numero, errores: r.faltan.length ? [`Faltan datos: ${r.faltan.join(", ")}`] : [] };
  }
}

const TipoNumerable = z.enum(TIPOS_NUMERABLES);
export const ReglaCrear = z
  .object({
    unidadId: z.string().uuid().nullable().optional(),
    tipoDocumento: TipoNumerable.nullable().optional(),
    formato: z.string().trim().min(1).max(120),
    reinicio: z.enum(["anual", "continuo"]).default("anual"),
    correlativoPorUnidad: z.boolean().default(false),
    porConfirmar: z.boolean().default(false),
    fuente: z.string().max(1000).nullable().optional(),
  })
  .strict();
export const ReglaCambio = z
  .object({
    formato: z.string().trim().min(1).max(120).optional(),
    reinicio: z.enum(["anual", "continuo"]).optional(),
    correlativoPorUnidad: z.boolean().optional(),
    porConfirmar: z.boolean().optional(),
    fuente: z.string().max(1000).nullable().optional(),
  })
  .strict();
export const Probar = z.object({ formato: z.string().max(200), unidadId: z.string().uuid().nullable().optional() }).strict();

@ApiTags("numeracion-documentos")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("numeracion-documentos")
export class NumeracionController {
  constructor(private readonly svc: NumeracionService) {}

  @Get()
  @RequierePermiso("documento.numeracion")
  async lista(@Req() req: any) {
    return {
      reglas: await this.svc.reglas(tenantDe(req)),
      tokens: Object.entries(TOKENS).map(([token, descripcion]) => ({ token: `{${token}}`, descripcion })),
      tipos: TIPOS_NUMERABLES.map((t) => ({ codigo: t, nombre: NOMBRE_TIPO_NUMERABLE[t] ?? t })),
    };
  }

  @Post("probar")
  @RequierePermiso("documento.numeracion")
  probar(@Body() body: unknown, @Req() req: any) {
    return this.svc.probar(tenantDe(req), Probar.parse(body));
  }

  @Post()
  @RequierePermiso("documento.numeracion")
  crear(@Body() body: unknown, @Req() req: any) {
    return this.svc.crear(tenantDe(req), req?.user?.sub ?? null, ReglaCrear.parse(body));
  }

  @Patch(":id")
  @RequierePermiso("documento.numeracion")
  actualizar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.actualizar(tenantDe(req), id, req?.user?.sub ?? null, ReglaCambio.parse(body));
  }

  @Post(":id/desactivar")
  @RequierePermiso("documento.numeracion")
  desactivar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.desactivar(tenantDe(req), id, req?.user?.sub ?? null);
  }
}
