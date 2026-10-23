import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post, Put, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PermisoGuard } from "../../auth/permiso.guard";
import { RequierePermiso } from "../../auth/permisos.decorator";
import { PrismaService } from "../../common/prisma.service";
import { AlcanceService } from "../../rbac/alcance.service";
import { sino, valoresCategoria } from "../../common/parametros-r4d";
import { RecepcionDcoController } from "./recepcion-dco";
import {
  CARRILES_DSA,
  CLASIFICACIONES_VEHICULO,
  LUGARES_EJECUCION,
  NIVELES_TECNOLOGICOS,
  TIPOS_TRABAJO,
  documentoPropuesto,
  erroresEncargo,
  revisarValidacionLab,
  type DatosEncargo,
} from "./reglas-encargo";

/**
 * Datos del encargo de la OT (tabla ot_encargo, align_r4d_comercial.sql) y
 * validación del laboratorio · frente r4d (T15: BL-159 a BL-163).
 *
 *   GET  /ot/:id/encargo                       · ot.ver      · datos, listas y qué puede hacer
 *   PUT  /ot/:id/encargo                       · ot.crear    · Comercial o Planificación completan el encargo
 *   POST /ot/:id/encargo/validacion-laboratorio · ot.planificar · el Jefe de Laboratorio valida o devuelve a Ventas
 * Todas exigen la OT en el alcance del usuario.
 */

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD");
const txt = (max: number) => z.preprocess((v) => (v === "" ? null : v), z.string().trim().max(max).nullable().optional());
const fechaOpc = z.preprocess((v) => (v === "" ? null : v), fecha.nullable().optional());
const opcion = <T extends readonly [string, ...string[]]>(xs: T) => z.preprocess((v) => (v === "" ? null : v), z.enum(xs).nullable().optional());

const EncargoSchema = z.object({
  tipoTrabajo: opcion(TIPOS_TRABAJO),
  nivelTecnologico: opcion(NIVELES_TECNOLOGICOS),
  requiereMuestreo: z.boolean().nullable().optional(),
  mandante: txt(160),
  moneda: z.preprocess((v) => (v === "" ? null : v), z.enum(["CLP", "USD"]).nullable().optional()),
  oficioNumero: txt(80),
  oficioFecha: fechaOpc,
  laboratorios: z.array(z.string().uuid()).max(20).optional(),
  contrato: txt(160),
  contratoFecha: fechaOpc,
  proyecto: txt(200),
  proveedor: txt(200),
  fabricante: txt(200),
  paisOrigen: txt(80),
  item: txt(300),
  cantidad: z.number().positive().max(1e9).nullable().optional(),
  unidadCantidad: txt(30),
  etTexto: txt(200),
  lugarMuestreo: txt(300),
  fechaMuestreo: fechaOpc,
  otOrigenId: z.preprocess((v) => (v === "" ? null : v), z.string().uuid().nullable().optional()),
  paga: z.preprocess((v) => (v === "" ? null : v), z.enum(["proveedor", "mandante"]).nullable().optional()),
  carrilDsa: opcion(CARRILES_DSA),
  lugarEjecucion: opcion(LUGARES_EJECUCION),
  paisEjecucion: txt(80),
  muestreoCliente: z.boolean().nullable().optional(),
});

const ValidacionSchema = z.object({
  alcanceConforme: z.boolean(),
  observacion: txt(2000),
  clasificacionVehiculo: opcion(CLASIFICACIONES_VEHICULO),
  subtipoVehiculo: txt(80),
  fechaInspeccion: fechaOpc,
  fechaInicio: fechaOpc,
  fechaTermino: fechaOpc,
  fechaInforme: fechaOpc,
  escalarJefeSeccion: z.boolean().nullable().optional(),
});

/** Campo (JSON) → columna de ot_encargo y su conversión. */
const COLS: Record<string, [string, string]> = {
  nivelTecnologico: ["nivel_tecnologico", ""],
  requiereMuestreo: ["requiere_muestreo", "::boolean"],
  mandante: ["mandante", ""],
  moneda: ["moneda", ""],
  oficioNumero: ["oficio_numero", ""],
  oficioFecha: ["oficio_fecha", "::date"],
  laboratorios: ["laboratorios", "::uuid[]"],
  contrato: ["contrato", ""],
  contratoFecha: ["contrato_fecha", "::date"],
  proyecto: ["proyecto", ""],
  proveedor: ["proveedor", ""],
  fabricante: ["fabricante", ""],
  paisOrigen: ["pais_origen", ""],
  item: ["item", ""],
  cantidad: ["cantidad", "::numeric"],
  unidadCantidad: ["unidad_cantidad", ""],
  etTexto: ["et_texto", ""],
  lugarMuestreo: ["lugar_muestreo", ""],
  fechaMuestreo: ["fecha_muestreo", "::date"],
  otOrigenId: ["ot_origen_id", "::uuid"],
  paga: ["paga", ""],
  carrilDsa: ["carril_dsa", ""],
  lugarEjecucion: ["lugar_ejecucion", ""],
  paisEjecucion: ["pais_ejecucion", ""],
  muestreoCliente: ["muestreo_cliente", "::boolean"],
};

const SELECT_ENCARGO = `
  SELECT e.moneda, e.forma_pago AS "formaPago", e.referencia, e.descripcion_tecnica AS "descripcionTecnica",
         e.valor_inicial::float8 AS "valorInicial", e.paridad::float8 AS paridad,
         e.nivel_tecnologico AS "nivelTecnologico", e.requiere_muestreo AS "requiereMuestreo", e.mandante,
         e.oficio_numero AS "oficioNumero", to_char(e.oficio_fecha, 'YYYY-MM-DD') AS "oficioFecha", e.laboratorios,
         e.contrato, to_char(e.contrato_fecha, 'YYYY-MM-DD') AS "contratoFecha", e.proyecto, e.proveedor, e.fabricante,
         e.pais_origen AS "paisOrigen", e.item, e.cantidad::float8 AS cantidad, e.unidad_cantidad AS "unidadCantidad",
         e.et_texto AS "etTexto", e.lugar_muestreo AS "lugarMuestreo", to_char(e.fecha_muestreo, 'YYYY-MM-DD') AS "fechaMuestreo",
         e.ot_origen_id AS "otOrigenId", oo.codigo AS "otOrigenCodigo", e.paga,
         e.carril_dsa AS "carrilDsa", e.lugar_ejecucion AS "lugarEjecucion", e.pais_ejecucion AS "paisEjecucion",
         e.muestreo_cliente AS "muestreoCliente",
         e.alcance_conforme AS "alcanceConforme", e.alcance_observacion AS "alcanceObservacion",
         e.clasificacion_vehiculo AS "clasificacionVehiculo", e.subtipo_vehiculo AS "subtipoVehiculo",
         to_char(e.fecha_inspeccion, 'YYYY-MM-DD') AS "fechaInspeccion",
         to_char(e.fecha_inicio_interna, 'YYYY-MM-DD') AS "fechaInicio", to_char(e.fecha_termino_interna, 'YYYY-MM-DD') AS "fechaTermino",
         to_char(e.fecha_informe_interna, 'YYYY-MM-DD') AS "fechaInforme", e.escalar_jefe_seccion AS "escalarJefeSeccion",
         e.validada_at AS "validadaAt", uv.nombre_completo AS "validadaPor",
         e.devuelta_ventas_at AS "devueltaVentasAt", ud.nombre_completo AS "devueltaVentasPor", e.devuelta_ventas_motivo AS "devueltaVentasMotivo",
         e.actualizado_at AS "actualizadoAt", ua.nombre_completo AS "actualizadoPor"
    FROM ot_encargo e
    LEFT JOIN orden_trabajo oo ON oo.id = e.ot_origen_id
    LEFT JOIN usuario uv ON uv.id = e.validada_por
    LEFT JOIN usuario ud ON ud.id = e.devuelta_ventas_por
    LEFT JOIN usuario ua ON ua.id = e.actualizado_por
   WHERE e.ot_id = $1::uuid`;

@Injectable()
export class EncargoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
  ) {}

  private async ot(req: any, otId: string) {
    const f = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT o.id, o.codigo, o.estado, o.tenant_id AS "tenantId", o.unidad_principal AS "unidadId", u.codigo AS "unidadCodigo",
              o.origen_trabajo AS origen, o.tipo_trabajo AS "tipoTrabajo", to_char(o.fecha_compromiso, 'YYYY-MM-DD') AS "fechaCompromiso"
         FROM orden_trabajo o LEFT JOIN unidad u ON u.id = o.unidad_principal
        WHERE o.id = $1::uuid AND o.tenant_id = $2::uuid`,
      otId,
      req?.user?.tenantId,
    );
    if (!f[0]) throw new NotFoundException("OT no encontrada.");
    await this.alcance.exigirUnidad(req, f[0].unidadId, `la OT ${f[0].codigo}`);
    return f[0] as { id: string; codigo: string; estado: string; tenantId: string; unidadId: string | null; unidadCodigo: string | null; origen: string | null; tipoTrabajo: string | null; fechaCompromiso: string | null };
  }

  private puede(req: any, p: string) {
    return (req?.user?.roles ?? []).includes("SUPERADMIN") || (req?.user?.permisos ?? []).includes(p);
  }

  async ver(req: any, otId: string) {
    const ot = await this.ot(req, otId);
    const e = (await this.prisma.$queryRawUnsafe<any[]>(SELECT_ENCARGO, otId))[0] ?? null;
    const labs = e?.laboratorios?.length
      ? await this.prisma.$queryRawUnsafe<any[]>(`SELECT id, codigo, nombre FROM unidad WHERE id = ANY($1::uuid[]) ORDER BY codigo`, e.laboratorios)
      : [];
    const listas = await this.prisma.$queryRawUnsafe<{ categoria: string; codigo: string; etiqueta: string }[]>(
      `SELECT categoria, codigo, etiqueta FROM parametro_sistema
        WHERE tenant_id = $1::uuid AND activo AND categoria IN ('tipo_trabajo','nivel_tecnologico','carril_dsa','lugar_ejecucion','clasificacion_vehiculo')
        ORDER BY categoria, orden`,
      ot.tenantId,
    );
    const porCat = (c: string) => listas.filter((l) => l.categoria === c).map(({ codigo, etiqueta }) => ({ codigo, etiqueta }));
    const cerrada = ["cerrada", "anulada"].includes(ot.estado);
    return {
      ot: { id: ot.id, codigo: ot.codigo, estado: ot.estado, origen: ot.origen, laboratorio: ot.unidadCodigo, fechaCompromiso: ot.fechaCompromiso },
      tipoTrabajo: ot.tipoTrabajo,
      documentoPropuesto: documentoPropuesto(ot.tipoTrabajo),
      encargo: e ? { ...e, laboratoriosDetalle: labs } : null,
      listas: {
        tipoTrabajo: porCat("tipo_trabajo"),
        nivelTecnologico: porCat("nivel_tecnologico"),
        carrilDsa: porCat("carril_dsa"),
        lugarEjecucion: porCat("lugar_ejecucion"),
        clasificacionVehiculo: porCat("clasificacion_vehiculo"),
      },
      puede: {
        editar: !cerrada && this.puede(req, "ot.crear"),
        validar: !cerrada && this.puede(req, "ot.planificar"),
      },
    };
  }

  /** Crea la fila si no existe (idempotente). */
  private async asegurar(db: any, otId: string, tenantId: string) {
    await db.$executeRawUnsafe(`INSERT INTO ot_encargo (ot_id, tenant_id) VALUES ($1::uuid, $2::uuid) ON CONFLICT (ot_id) DO NOTHING`, otId, tenantId);
  }

  async guardar(req: any, otId: string, body: unknown) {
    const ot = await this.ot(req, otId);
    if (["cerrada", "anulada"].includes(ot.estado)) throw new BadRequestException(`La OT ${ot.codigo} está ${ot.estado}: sus datos no se cambian.`);
    const d = EncargoSchema.parse(body ?? {}) as DatosEncargo;
    const exigeOficio = sino((await valoresCategoria(this.prisma, ot.tenantId, "ot_institucional")).exige_oficio, true);
    const actual = (await this.prisma.$queryRawUnsafe<any[]>(SELECT_ENCARGO, otId))[0] ?? {};
    const errores = erroresEncargo({ ...actual, ...stripUndefined(d) }, { origen: ot.origen, otId, exigeOficio });
    if (errores.length) throw new BadRequestException(errores.join(" "));
    if (d.otOrigenId) {
      const o = await this.prisma.$queryRawUnsafe<any[]>(`SELECT 1 FROM orden_trabajo WHERE id = $1::uuid AND tenant_id = $2::uuid`, d.otOrigenId, ot.tenantId);
      if (!o.length) throw new BadRequestException("La OT de origen no existe.");
    }
    if (d.laboratorios?.length) {
      const u = await this.prisma.$queryRawUnsafe<any[]>(`SELECT count(*)::int AS n FROM unidad WHERE id = ANY($1::uuid[]) AND tenant_id = $2::uuid`, d.laboratorios, ot.tenantId);
      if (Number(u[0]?.n) !== new Set(d.laboratorios).size) throw new BadRequestException("Algún laboratorio indicado no existe.");
    }
    await this.prisma.$transaction(async (tx) => {
      await this.asegurar(tx, otId, ot.tenantId);
      const sets: string[] = [];
      const vals: unknown[] = [];
      for (const [k, [col, cast]] of Object.entries(COLS)) {
        const v = (d as any)[k];
        if (v === undefined) continue;
        vals.push(v);
        sets.push(`${col} = $${vals.length}${cast}`);
      }
      vals.push(req?.user?.sub ?? null);
      sets.push(`actualizado_por = $${vals.length}::uuid`, "actualizado_at = now()");
      vals.push(otId);
      await tx.$executeRawUnsafe(`UPDATE ot_encargo SET ${sets.join(", ")} WHERE ot_id = $${vals.length}::uuid`, ...vals);
      if (d.tipoTrabajo !== undefined)
        await tx.$executeRawUnsafe(`UPDATE orden_trabajo SET tipo_trabajo = $2, updated_at = now() WHERE id = $1::uuid`, otId, d.tipoTrabajo);
      await tx.$executeRawUnsafe(
        `INSERT INTO ot_historial (tenant_id, ot_id, tipo, detalle, usuario_id) VALUES ($1::uuid, $2::uuid, 'encargo', $3::jsonb, $4::uuid)`,
        ot.tenantId,
        otId,
        JSON.stringify({ campos: Object.keys(stripUndefined(d)) }),
        req?.user?.sub ?? null,
      );
    });
    return this.ver(req, otId);
  }

  async validar(req: any, otId: string, body: unknown) {
    const ot = await this.ot(req, otId);
    if (["cerrada", "anulada"].includes(ot.estado)) throw new BadRequestException(`La OT ${ot.codigo} está ${ot.estado}.`);
    const v = ValidacionSchema.parse(body ?? {});
    const { errores, avisos } = revisarValidacionLab(v, { laboratorio: ot.unidadCodigo, fechaCompromiso: ot.fechaCompromiso });
    if (errores.length) throw new BadRequestException(errores.join(" "));
    const yo = req?.user?.sub ?? null;
    await this.prisma.$transaction(async (tx) => {
      await this.asegurar(tx, otId, ot.tenantId);
      if (!v.alcanceConforme) {
        await tx.$executeRawUnsafe(
          `UPDATE ot_encargo SET alcance_conforme = FALSE, alcance_observacion = $2, devuelta_ventas_at = now(), devuelta_ventas_por = $3::uuid,
                  devuelta_ventas_motivo = $2, validada_at = NULL, validada_por = NULL WHERE ot_id = $1::uuid`,
          otId,
          v.observacion,
          yo,
        );
      } else {
        await tx.$executeRawUnsafe(
          `UPDATE ot_encargo SET alcance_conforme = TRUE, alcance_observacion = $2, clasificacion_vehiculo = $3, subtipo_vehiculo = $4,
                  fecha_inspeccion = $5::date, fecha_inicio_interna = $6::date, fecha_termino_interna = $7::date, fecha_informe_interna = $8::date,
                  escalar_jefe_seccion = $9, validada_at = now(), validada_por = $10::uuid, devuelta_ventas_at = NULL,
                  devuelta_ventas_por = NULL, devuelta_ventas_motivo = NULL
            WHERE ot_id = $1::uuid`,
          otId,
          v.observacion ?? null,
          v.clasificacionVehiculo ?? null,
          v.subtipoVehiculo ?? null,
          v.fechaInspeccion ?? null,
          v.fechaInicio ?? null,
          v.fechaTermino ?? null,
          v.fechaInforme ?? null,
          v.escalarJefeSeccion ?? null,
          yo,
        );
      }
      await tx.$executeRawUnsafe(
        `INSERT INTO ot_historial (tenant_id, ot_id, tipo, detalle, usuario_id) VALUES ($1::uuid, $2::uuid, $3, $4::jsonb, $5::uuid)`,
        ot.tenantId,
        otId,
        v.alcanceConforme ? "validacion_laboratorio" : "devuelta_ventas",
        JSON.stringify(v),
        yo,
      );
    });
    const r = await this.ver(req, otId);
    return {
      ...r,
      avisos,
      mensaje: v.alcanceConforme
        ? `OT ${ot.codigo} recepcionada en el laboratorio con sus fechas internas.`
        : `OT ${ot.codigo} devuelta a Ventas por alcance no conforme.`,
    };
  }
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/**
 * Herencia de la cotización al aceptarla (EP-00 5.1, BL-159): moneda, forma de
 * pago, referencia, descripción técnica, valor inicial (total) y paridad. Lo
 * llama cotizacion.service al crear la OT. Idempotente.
 */
export async function heredarDeCotizacion(db: any, tenantId: string, otId: string, cotizacionId: string) {
  await db.$executeRawUnsafe(
    `INSERT INTO ot_encargo (ot_id, tenant_id, moneda, forma_pago, referencia, descripcion_tecnica, valor_inicial, paridad)
     SELECT $1::uuid, $2::uuid, c.moneda, c.forma_pago, c.referencia, c.descripcion_tecnica, c.total, c.dolar_valor
       FROM cotizacion c WHERE c.id = $3::uuid
     ON CONFLICT (ot_id) DO UPDATE SET moneda = EXCLUDED.moneda, forma_pago = EXCLUDED.forma_pago, referencia = EXCLUDED.referencia,
       descripcion_tecnica = EXCLUDED.descripcion_tecnica, valor_inicial = EXCLUDED.valor_inicial, paridad = EXCLUDED.paridad`,
    otId,
    tenantId,
    cotizacionId,
  );
}

@ApiTags("ot")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("ot")
export class EncargoController {
  constructor(private readonly svc: EncargoService) {}

  @Get(":id/encargo")
  @RequierePermiso("ot.ver")
  @ApiOperation({ summary: "Datos del encargo de la OT (heredados, clasificación, oficio, contrato o lote, carril DSA) y validación del laboratorio" })
  ver(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.ver(req, id);
  }

  @Put(":id/encargo")
  @RequierePermiso("ot.crear")
  guardar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.guardar(req, id, body);
  }

  @Post(":id/encargo/validacion-laboratorio")
  @RequierePermiso("ot.planificar")
  @ApiOperation({ summary: "Recepcionar en el laboratorio (alcance conforme y fechas internas) o devolver a Ventas" })
  validar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.validar(req, id, body);
  }
}

@Module({ controllers: [EncargoController, RecepcionDcoController], providers: [EncargoService], exports: [EncargoService] })
export class EncargoModule {}
