/**
 * Cabecera de inspección de una OT del BPCH (EP-10 10.3, EP-07 7.8). Tabla
 * bpch_cabecera_ot y vista v_bpch_cabecera_ot (align_r1b_bpch_cabecera.sql).
 * Reglas puras: reglas-cabecera.ts. Contrato: docs/FLUJO_BPCH_CABECERA_OT.md.
 *
 * Rutas:
 *   GET /bpch/cabecera-ot/:otId · la cabecera propia, la que imprimen los documentos, qué falta y el historial (ot.ver, OT en alcance)
 *   PUT /bpch/cabecera-ot/:otId · «Guardar cabecera → muestrear lotes» (bpch.cabecera.gestionar, OT en alcance)
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
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PrismaService } from "../../common/prisma.service";
import { PermisoGuard } from "../../auth/permiso.guard";
import { RequierePermiso } from "../../auth/permisos.decorator";
import { AlcanceService } from "../../rbac/alcance.service";
import {
  PROCEDIMIENTOS_CONTROL,
  PROCESOS_CON_EXPEDIENTE,
  diferencias,
  erroresCabecera,
  faltantesParaEmitirInspeccion,
  heredarCabecera,
  iniciales,
  type CabeceraDto,
  type FuenteCabecera,
} from "./reglas-cabecera";

const tenantDe = (req: any): string => req?.user?.tenantId;

/** Campo del DTO → columna y tipo (t texto, d fecha, i entero). */
const COLUMNAS: [keyof CabeceraDto, string, "t" | "d" | "i"][] = [
  ["lugarInspeccion", "lugar_inspeccion", "t"],
  ["direccion", "direccion", "t"],
  ["comuna", "comuna", "t"],
  ["contacto", "contacto", "t"],
  ["fechaInspeccion", "fecha_inspeccion", "d"],
  ["inspectores", "inspectores", "t"],
  ["procedimiento", "procedimiento", "t"],
  ["documentoOrigen", "documento_origen", "t"],
  ["fechaDocumento", "fecha_documento", "d"],
  ["esquema", "esquema", "t"],
  ["elementoGenerico", "elemento_generico", "t"],
  ["elementoEspecifico", "elemento_especifico", "t"],
  ["cncDgmn", "cnc_dgmn", "t"],
  ["claseDivisionUn", "clase_division_un", "t"],
  ["numeroUn", "numero_un", "t"],
  ["identificacionLote", "identificacion_lote", "t"],
  ["tamanoLote", "tamano_lote", "i"],
  ["tamanoMuestra", "tamano_muestra", "i"],
  ["fechaVencimientoProducto", "fecha_vencimiento_producto", "d"],
  ["vigenciaInforme", "vigencia_informe", "d"],
  ["observaciones", "observaciones", "t"],
];

const texto = (max: number) => z.string().trim().max(max).nullable().optional();
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD").nullable().optional();
const entero = z.number().int().positive().nullable().optional();
export const CabeceraSchema = z
  .object({
    lugarInspeccion: texto(240),
    direccion: texto(240),
    comuna: texto(120),
    contacto: texto(200),
    fechaInspeccion: fecha,
    inspectores: texto(300),
    procedimiento: texto(120),
    documentoOrigen: texto(200),
    fechaDocumento: fecha,
    esquema: z.enum(["LOTES", "TIPO"]).nullable().optional(),
    elementoGenerico: texto(240),
    elementoEspecifico: texto(240),
    cncDgmn: texto(60),
    claseDivisionUn: texto(40),
    numeroUn: texto(20),
    identificacionLote: texto(200),
    tamanoLote: entero,
    tamanoMuestra: entero,
    fechaVencimientoProducto: fecha,
    vigenciaInforme: fecha,
    observaciones: texto(4000),
  })
  .strict();

/** ¿La OT es de una unidad del BPCH (sucursales, SCC…) y no de la Delegación Nº 11 (proceso propio, EP-11)? */
export async function otEsBpch(prisma: PrismaService | any, unidadId: string | null): Promise<boolean> {
  return (await ramaDeUnidad(prisma, unidadId)) === "bpch";
}

/** Rama BPCH de una unidad: «bpch» (sin la D11), «d11» (la Delegación Nº 11 y lo que cuelga) o null. */
export async function ramaDeUnidad(prisma: PrismaService | any, unidadId: string | null): Promise<"bpch" | "d11" | null> {
  if (!unidadId) return null;
  const filas = (await prisma.$queryRawUnsafe(
    `WITH RECURSIVE cadena AS (
       SELECT id, padre_id, codigo, 0 AS nivel FROM unidad WHERE id = $1::uuid
       UNION ALL
       SELECT u.id, u.padre_id, u.codigo, c.nivel + 1 FROM unidad u JOIN cadena c ON u.id = c.padre_id WHERE c.nivel < 20)
     SELECT codigo FROM cadena`,
    unidadId,
  )) as { codigo: string }[];
  const codigos = filas.map((f) => f.codigo);
  if (!codigos.includes("BPCH")) return null;
  return codigos.includes("D11") ? "d11" : "bpch";
}

/** Fila de v_bpch_cabecera_ot de la OT (lo que imprimen los documentos), o null. */
export async function vistaCabecera(prisma: PrismaService | any, otId: string): Promise<Record<string, string | null> | null> {
  try {
    const f = (await prisma.$queryRawUnsafe(`SELECT * FROM v_bpch_cabecera_ot WHERE ot_id = $1::uuid LIMIT 1`, otId)) as any[];
    return f[0] ?? null;
  } catch {
    return null;
  }
}

@Injectable()
export class CabeceraOtService {
  constructor(private readonly prisma: PrismaService) {}

  private async ot(otId: string, tenantId: string) {
    const ot = await this.prisma.ordenTrabajo.findFirst({
      where: { id: otId, tenantId },
      select: { id: true, codigo: true, estado: true, unidadPrincipal: true, origenTrabajo: true, unidad: { select: { codigo: true, nombre: true } } },
    });
    if (!ot) throw new NotFoundException(`Orden de trabajo ${otId} no encontrada`);
    return ot;
  }

  /** Proceso BPCH de la OT y enlace a su expediente. */
  private async proceso(otId: string): Promise<{ proceso: string; enlace: string | null }> {
    const f = await this.prisma.$queryRawUnsafe<{ proceso: string; id: string | null }[]>(
      `SELECT 'INTERNACION' AS proceso, id FROM bpch_internacion WHERE ot_id = $1::uuid
       UNION ALL SELECT 'REINSPECCION', id FROM bpch_reinspeccion WHERE ot_id = $1::uuid
       UNION ALL SELECT 'PRODUCCION_NACIONAL', oc_id FROM bpch_pn_inspeccion WHERE ot_id = $1::uuid AND NOT anulada
       LIMIT 1`,
      otId,
    );
    const p = f[0];
    if (!p) return { proceso: "DIRECTA", enlace: null };
    const enlace =
      p.proceso === "INTERNACION" ? `/bpch/internaciones/${p.id}` : p.proceso === "REINSPECCION" ? `/bpch/reinspecciones/${p.id}` : `/bpch/produccion-nacional/${p.id}`;
    return { proceso: p.proceso, enlace };
  }

  private async propia(otId: string): Promise<(CabeceraDto & { updatedAt?: string }) | null> {
    const f = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT ${COLUMNAS.map(([k, c, t]) => (t === "d" ? `to_char(${c}, 'YYYY-MM-DD') AS "${k}"` : `${c} AS "${k}"`)).join(", ")},
              updated_at AS "updatedAt"
         FROM bpch_cabecera_ot WHERE ot_id = $1::uuid`,
      otId,
    );
    return f[0] ?? null;
  }

  /**
   * B-019: datos ya conocidos de la OT de Producción Nacional (producto de la O/C,
   * su clasificación, la RAF y el lote programado) o de la OT de prototipo.
   */
  private async fuente(otId: string): Promise<FuenteCabecera | null> {
    const pn = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT r.numero AS raf, to_char(r.fecha, 'YYYY-MM-DD') AS raf_fecha, p.producto, e.nombre AS elemento,
              c.clase_division, c.grupo_compatibilidad, c.numero_onu, l.lote, l.lugar, to_char(l.fecha_programada, 'YYYY-MM-DD') AS fecha
         FROM bpch_pn_inspeccion l
         JOIN bpch_oc_operativa o ON o.id = l.oc_id
         JOIN bpch_raf r ON r.id = o.raf_id
         JOIN bpch_oc_producto p ON p.id = l.oc_producto_id
         LEFT JOIN cat_elemento e ON e.id = p.cat_elemento_id
         LEFT JOIN bpch_clasificacion c ON c.id = p.clasificacion_id
        WHERE l.ot_id = $1::uuid AND NOT l.anulada
        LIMIT 1`,
      otId,
    );
    if (pn[0])
      return {
        documentoOrigen: `RAF DGMN ${pn[0].raf}`, fechaDocumento: pn[0].raf_fecha, esquema: "LOTES", elemento: pn[0].elemento ?? pn[0].producto,
        claseDivision: pn[0].clase_division, grupoCompatibilidad: pn[0].grupo_compatibilidad, numeroOnu: pn[0].numero_onu,
        lote: pn[0].lote, lugar: pn[0].lugar, fechaInspeccion: pn[0].fecha,
      };
    const pr = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT p.solicitud_dgmn, to_char(p.fecha_solicitud, 'YYYY-MM-DD') AS fecha, p.esquema, p.elemento, p.codigo_cnc, p.sac_tamano_muestra,
              c.clase_division, c.grupo_compatibilidad, c.numero_onu
         FROM bpch_prototipo p LEFT JOIN bpch_clasificacion c ON c.id = p.clasificacion_id
        WHERE p.ot_id = $1::uuid LIMIT 1`,
      otId,
    );
    if (pr[0])
      return {
        documentoOrigen: pr[0].solicitud_dgmn, fechaDocumento: pr[0].fecha, esquema: pr[0].esquema === "LOTES" ? "LOTES" : "TIPO",
        elemento: pr[0].elemento, cnc: pr[0].codigo_cnc, claseDivision: pr[0].clase_division, grupoCompatibilidad: pr[0].grupo_compatibilidad,
        numeroOnu: pr[0].numero_onu, tamanoMuestra: pr[0].sac_tamano_muestra ?? null,
      };
    return null;
  }

  async ficha(otId: string, tenantId: string, puedeEditar: boolean) {
    const ot = await this.ot(otId, tenantId);
    const esBpch = await otEsBpch(this.prisma, ot.unidadPrincipal);
    if (!esBpch) return { ot, esBpch: false };
    const [{ proceso, enlace }, cabecera, vista, asignados, historial] = await Promise.all([
      this.proceso(otId),
      this.propia(otId),
      vistaCabecera(this.prisma, otId),
      this.prisma.$queryRawUnsafe<{ nombre: string }[]>(
        `SELECT DISTINCT u.nombre_completo AS nombre FROM usuario u
          WHERE u.id IN (SELECT oa.usuario_id FROM ot_analista oa WHERE oa.ot_id = $1::uuid
                         UNION SELECT r.asignado_a FROM resultado r WHERE r.ot_id = $1::uuid AND r.deleted_at IS NULL AND r.asignado_a IS NOT NULL)
          ORDER BY 1`,
        otId,
      ),
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT h.id, h.cambios, h.created_at AS "createdAt", u.nombre_completo AS "usuarioNombre"
           FROM bpch_cabecera_ot_historial h LEFT JOIN usuario u ON u.id = h.usuario_id
          WHERE h.ot_id = $1::uuid ORDER BY h.created_at DESC LIMIT 50`,
        otId,
      ),
    ]);
    const soloComplemento = (PROCESOS_CON_EXPEDIENTE as readonly string[]).includes(proceso);
    const abierta = !["cerrada", "anulada"].includes(ot.estado);
    return {
      ot,
      esBpch: true,
      proceso,
      enlaceExpediente: enlace,
      soloComplemento,
      editable: puedeEditar && abierta,
      cabecera,
      vista,
      faltantesEmision: faltantesParaEmitirInspeccion(vista),
      sugeridos: { inspectores: asignados.map((a) => iniciales(a.nombre)).join(" · "), procedimientos: PROCEDIMIENTOS_CONTROL },
      // B-019: lo que se conoce del producto o del prototipo, para los campos aún vacíos.
      heredados: soloComplemento ? {} : heredarCabecera(await this.fuente(otId), cabecera),
      historial,
    };
  }

  async guardar(otId: string, tenantId: string, usuarioId: string | null, dto: CabeceraDto) {
    const ot = await this.ot(otId, tenantId);
    if (!(await otEsBpch(this.prisma, ot.unidadPrincipal)))
      throw new BadRequestException(`La OT ${ot.codigo} no es de una unidad del Banco de Pruebas: no lleva cabecera de inspección.`);
    if (["cerrada", "anulada"].includes(ot.estado)) throw new ConflictException(`La OT ${ot.codigo} está ${ot.estado}: la cabecera ya no se cambia.`);
    const { proceso } = await this.proceso(otId);
    const soloComplemento = (PROCESOS_CON_EXPEDIENTE as readonly string[]).includes(proceso);
    const antes = await this.propia(otId);
    const nueva: Record<string, unknown> = {};
    for (const [k] of COLUMNAS) nueva[k] = dto[k] !== undefined ? dto[k] : antes?.[k] ?? null;
    const errores = soloComplemento ? erroresCabecera(dto, { soloComplemento: true }) : erroresCabecera(nueva as CabeceraDto);
    if (errores.length) throw new BadRequestException(errores.join(" "));
    const cambios = diferencias(antes as any, nueva);
    if (!Object.keys(cambios).length) return this.ficha(otId, tenantId, true);
    const valores = COLUMNAS.map(([k, , t]) => {
      const v = nueva[k];
      if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) return null;
      return t === "t" ? String(v).trim() : v;
    });
    const cols = COLUMNAS.map(([, c]) => c);
    const casts = COLUMNAS.map(([, , t], i) => `$${i + 5}${t === "d" ? "::date" : t === "i" ? "::int" : ""}`);
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO bpch_cabecera_ot (tenant_id, ot_id, created_by, updated_by, ${cols.join(", ")})
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, ${casts.join(", ")})
         ON CONFLICT (ot_id) DO UPDATE SET ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(", ")},
                updated_by = EXCLUDED.updated_by, updated_at = now()`,
        tenantId,
        otId,
        usuarioId,
        usuarioId,
        ...valores,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO bpch_cabecera_ot_historial (tenant_id, ot_id, cambios, usuario_id) VALUES ($1::uuid, $2::uuid, $3::jsonb, $4::uuid)`,
        tenantId,
        otId,
        JSON.stringify(cambios),
        usuarioId,
      );
    });
    return this.ficha(otId, tenantId, true);
  }
}

@ApiTags("bpch")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("bpch/cabecera-ot")
export class CabeceraOtController {
  constructor(
    private readonly svc: CabeceraOtService,
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
  ) {}

  private async exigirAlcance(otId: string, req: any) {
    const ot = await this.prisma.ordenTrabajo.findFirst({ where: { id: otId, tenantId: tenantDe(req) }, select: { codigo: true, unidadPrincipal: true } });
    if (!ot) throw new NotFoundException(`Orden de trabajo ${otId} no encontrada`);
    await this.alcance.exigirUnidad(req, ot.unidadPrincipal, `la OT ${ot.codigo}`);
    return ot;
  }

  @Get(":otId")
  @RequierePermiso("ot.ver")
  @ApiOperation({ summary: "Cabecera de inspección de la OT: la propia, la que imprimen los documentos, qué falta para emitir y el historial" })
  async ficha(@Param("otId", ParseUUIDPipe) otId: string, @Req() req: any) {
    const ot = await this.exigirAlcance(otId, req);
    const tiene = (req?.user?.roles ?? []).includes("SUPERADMIN") || (req?.user?.permisos ?? []).includes("bpch.cabecera.gestionar");
    const puede = tiene && (await this.alcance.puedeVerUnidad(req, ot.unidadPrincipal, "bpch.cabecera.gestionar"));
    return this.svc.ficha(otId, tenantDe(req), puede);
  }

  @Put(":otId")
  @RequierePermiso("bpch.cabecera.gestionar")
  @ApiOperation({ summary: "«Guardar cabecera → muestrear lotes» (EP-10 10.3): queda en el historial" })
  async guardar(@Param("otId", ParseUUIDPipe) otId: string, @Body() body: unknown, @Req() req: any) {
    const dto = CabeceraSchema.parse(body);
    await this.exigirAlcance(otId, req);
    return this.svc.guardar(otId, tenantDe(req), req?.user?.sub ?? null, dto);
  }
}
