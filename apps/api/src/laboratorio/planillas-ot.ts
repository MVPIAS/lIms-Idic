/**
 * Planillas de la OT para el laboratorio · LIMS IDIC (Depto. Químico, 15-10-2026).
 *
 *  1. Planilla de registros y cálculos (vista auditable, solo lectura):
 *       GET /laboratorio/ot/:id/planilla-calculos            · resultado.ver
 *       GET /laboratorio/ot/:id/planilla-calculos?formato=csv (Excel)
 *     Por ensayo: lecturas/réplicas/variables, campos del método, fórmula (de la
 *     orden o del catálogo), fórmula aplicada, factor, resultado, especificación,
 *     quién capturó/revisó/aprobó y el historial de cambios (resultado_historial).
 *
 *  2. Planilla de costos reales (DCO-PG01-P05-IT03-FORM01):
 *       GET  /laboratorio/ot/:id/costos-reales?unidadId=     · costo_real.ver
 *       PUT  /laboratorio/ot/:id/costos-reales               · costo_real.gestionar (borrador)
 *       POST /laboratorio/ot/:id/costos-reales/cerrar        · costo_real.gestionar
 *       POST /laboratorio/ot/:id/costos-reales/reabrir       · costo_real.gestionar (motivo)
 *     Una planilla por OT y laboratorio (el responsable de la OT o uno que hace
 *     ensayos por orden interna). Todas las rutas exigen el alcance del
 *     laboratorio (AlcanceService). Reglas puras: costos-reales.ts.
 *
 *  Laboratorio de cada ensayo (revisión r3): el de su método en el catálogo
 *  (cat_familia → unidad por CODSUCDEL) si trabaja en la OT; si no, el
 *  responsable. Con eso, un laboratorio por orden interna ve en la planilla de
 *  cálculos solo sus ensayos, y «sin aprobar» cuenta solo los del laboratorio
 *  de la planilla de costos.
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
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PrismaService } from "../common/prisma.service";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { AlcanceService } from "../rbac/alcance.service";
import { factorDe } from "./factor";
import { csvPlanilla, factorAplicado, origenFormula, type EnsayoPlanilla } from "./planilla-calculos";
import {
  CATEGORIAS_COSTO,
  comparar,
  erroresCierrePlanilla,
  erroresLineas,
  estimacionDelLaboratorio,
  laboratorioDeResultado,
  resumenCostos,
  totalLinea,
  type LineaCostoReal, TIPOS_GASTO_COMISION, lineasSugeridas } from "./costos-reales";

const tenantDe = (req: any): string => req?.user?.tenantId;

/** unidad.codsucdel admite varios códigos («7003/7004»): ¿la familia del catálogo es de la unidad? */
const FAMILIA_DE_UNIDAD = `f.codsucdel = ANY(string_to_array(regexp_replace(COALESCE(u.codsucdel, ''), '[\\s,;]', '/', 'g'), '/'))`;

/** Ensayos del laboratorio que aún no están aprobados. */
function contarSinAprobar(labs: Map<string, { unidadId: string | null; estado: string }>, unidadId: string): number {
  let n = 0;
  for (const r of labs.values()) if (r.unidadId === unidadId && r.estado !== "aprobado") n++;
  return n;
}

export type UnidadOt = { id: string; codigo: string; nombre: string; principal: boolean };

/**
 * Laboratorios que trabajan en la OT: el responsable, los destinos de sus
 * órdenes internas (cat_familia → unidad por CODSUCDEL) y los «otros
 * laboratorios» indicados en la recepción de sus muestras.
 */
export async function unidadesPosiblesOt(prisma: PrismaService, otId: string, principal: string | null, tenantId: string): Promise<UnidadOt[]> {
  return prisma.$queryRawUnsafe<UnidadOt[]>(
    `SELECT u.id, u.codigo, u.nombre, (u.id = $2::uuid) AS principal
       FROM unidad u
      WHERE u.tenant_id = $3::uuid
        AND (u.id = $2::uuid
             OR u.codsucdel IN (SELECT f.codsucdel FROM orden_interna oi JOIN cat_familia f ON f.id = oi.destino_lab
                                 WHERE oi.ot_id = $1::uuid AND oi.deleted_at IS NULL AND oi.estado <> 'anulada')
             OR u.id IN (SELECT unnest(m.otros_labs) FROM muestra m WHERE m.ot_id = $1::uuid AND m.deleted_at IS NULL))
      ORDER BY (u.id = $2::uuid) DESC, u.codigo`,
    otId,
    principal,
    tenantId,
  );
}

/** Laboratorio (laboratorioDeResultado) y estado de cada ensayo vivo de la OT. */
export async function laboratoriosDeResultados(
  prisma: PrismaService,
  otId: string,
  tenantId: string,
  posibles: string[],
  principal: string | null,
): Promise<Map<string, { unidadId: string | null; estado: string }>> {
  const filas = await prisma.$queryRawUnsafe<{ id: string; estado: string; unidades: string[] }[]>(
    `SELECT r.id, r.estado, COALESCE(array_agg(DISTINCT u.id) FILTER (WHERE u.id IS NOT NULL), '{}') AS unidades
       FROM resultado r
       JOIN muestra m ON m.id = r.muestra_id
       LEFT JOIN cat_metodo cm ON cm.id = r.cat_metodo_id
       LEFT JOIN cat_ensayo ce ON ce.id = cm.ensayo_id
       LEFT JOIN cat_familia f ON f.id = ce.familia_id
       LEFT JOIN unidad u ON u.tenant_id = m.tenant_id AND f.codsucdel IS NOT NULL AND ${FAMILIA_DE_UNIDAD}
      WHERE m.tenant_id = $2::uuid AND COALESCE(r.ot_id, m.ot_id) = $1::uuid AND r.deleted_at IS NULL
      GROUP BY r.id, r.estado`,
    otId,
    tenantId,
  );
  return new Map(filas.map((f) => [f.id, { unidadId: laboratorioDeResultado(f.unidades ?? [], posibles, principal), estado: f.estado }]));
}

/* ============================== PLANILLA DE CÁLCULOS ============================== */

@Injectable()
export class PlanillaCalculosService {
  constructor(private readonly prisma: PrismaService, private readonly alcance: AlcanceService) {}

  async planilla(otId: string, req: any) {
    const tenantId = tenantDe(req);
    const ot = await this.prisma.ordenTrabajo.findFirst({ where: { id: otId, tenantId }, select: { id: true, codigo: true, estado: true, unidadPrincipal: true } });
    if (!ot) throw new NotFoundException(`Orden de trabajo ${otId} no encontrada`);
    // Quien ve el laboratorio responsable ve toda la OT. Un laboratorio que
    // trabaja en ella por orden interna (u «otros laboratorios») ve SOLO sus
    // ensayos, como en la planilla de costos (revisión r3, hallazgo 14).
    const filtro = await this.alcance.filtroUnidades(req);
    let soloLabs: Set<string> | null = null;
    let labDe: Map<string, { unidadId: string | null; estado: string }> | null = null;
    if (filtro !== null && !(ot.unidadPrincipal && filtro.includes(ot.unidadPrincipal))) {
      const posibles = (await unidadesPosiblesOt(this.prisma, ot.id, ot.unidadPrincipal, tenantId)).map((u) => u.id);
      const mios = posibles.filter((u) => u !== ot.unidadPrincipal && filtro.includes(u));
      if (!mios.length) await this.alcance.exigirUnidad(req, ot.unidadPrincipal, `la OT ${ot.codigo}`);
      soloLabs = new Set(mios);
      labDe = await laboratoriosDeResultados(this.prisma, ot.id, tenantId, posibles, ot.unidadPrincipal);
    }

    const todas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT r.id, r.estado, r.veredicto, r.unidad, r.replicas, r.lecturas, r.variables, r.promedio, r.desviacion, r.cv,
              r.resultado_final, r.valor_numerico, r.valor_texto, r.valor_sin_factor, r.formula, r.formula_aplicada,
              r.espec_origen, r.espec_catalogo, r.limite_inf, r.nominal, r.limite_sup, r.requisito, r.fecha,
              r.factor_valor, r.factor_operacion, r.factor_descripcion, r.factor_origen, r.factor_editado_at, r.factor_motivo,
              r.cat_metodo_id, a2.formula AS formula_legado_analito,
              m.codigo AS muestra, m.nombre AS muestra_nombre,
              COALESCE(ca.nombre, a2.nombre, '—') AS ensayo,
              CASE WHEN cm.id IS NOT NULL THEN cm.codigo || ' · ' || cm.nombre ELSE me.codigo || ' · ' || me.nombre END AS metodo,
              COALESCE(cm.norma, me.norma) AS norma,
              ua.nombre_completo AS analista, ur.nombre_completo AS revisor, up.nombre_completo AS aprobador,
              uf.nombre_completo AS factor_editado_por
         FROM resultado r
         JOIN muestra m ON m.id = r.muestra_id
         LEFT JOIN cat_analito ca ON ca.id = r.cat_analito_id
         LEFT JOIN cat_metodo cm ON cm.id = r.cat_metodo_id
         LEFT JOIN analito a2 ON a2.id = r.analito_id
         LEFT JOIN metodo me ON me.id = a2.metodo_id
         LEFT JOIN usuario ua ON ua.id = r.analista_id
         LEFT JOIN usuario ur ON ur.id = r.revisado_n1_por
         LEFT JOIN usuario up ON up.id = r.aprobado_por
         LEFT JOIN usuario uf ON uf.id = r.factor_editado_por
        WHERE m.tenant_id = $1::uuid AND COALESCE(r.ot_id, m.ot_id) = $2::uuid AND r.deleted_at IS NULL
        ORDER BY m.codigo, COALESCE(ca.nombre, a2.nombre), r.fecha`,
      tenantId,
      otId,
    );
    const filas = soloLabs ? todas.filter((f) => soloLabs!.has(labDe!.get(f.id)?.unidadId ?? "")) : todas;
    const ids = filas.map((f) => f.id);
    const metodoIds = [...new Set(filas.map((f) => f.cat_metodo_id).filter(Boolean))];
    const [pasos, historial] = await Promise.all([
      metodoIds.length
        ? this.prisma.$queryRawUnsafe<{ cat_metodo_id: string; nombre: string; unidad: string | null }[]>(
            `SELECT cat_metodo_id, nombre, unidad FROM paso_metodo
              WHERE cat_metodo_id = ANY($1::uuid[]) AND activo AND deleted_at IS NULL
              ORDER BY cat_metodo_id, orden, created_at`,
            metodoIds,
          )
        : Promise.resolve([]),
      // Historial: el de los ensayos vigentes y el de los eliminados de esta OT.
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT h.resultado_id, h.created_at, h.campo, h.valor_anterior, h.valor_nuevo, h.motivo, h.origen,
                u.nombre_completo AS usuario
           FROM resultado_historial h
           LEFT JOIN usuario u ON u.id = h.usuario_id
          WHERE (h.resultado_id = ANY($1::uuid[]) OR h.ot_id = $2::uuid)
            AND (h.tenant_id IS NULL OR h.tenant_id = $3::uuid)
          ORDER BY h.created_at, h.id`,
        ids,
        otId,
        tenantId,
      ),
    ]);
    const campos: Record<string, { nombre: string; unidad: string | null }[]> = {};
    for (const p of pasos) (campos[p.cat_metodo_id] ??= []).push({ nombre: p.nombre, unidad: p.unidad });

    const num = (v: any) => (v == null ? null : Number(v));
    const ensayos: EnsayoPlanilla[] = filas.map((f) => {
      const cat = (f.espec_catalogo ?? null) as Record<string, any> | null;
      const factor = factorDe(f.factor_valor, f.factor_operacion, f.factor_descripcion);
      return {
        resultadoId: f.id,
        muestra: f.muestra,
        muestraNombre: f.muestra_nombre,
        ensayo: f.ensayo,
        metodo: f.metodo,
        norma: f.norma,
        unidad: f.unidad,
        estado: f.estado,
        veredicto: f.veredicto,
        campos: f.cat_metodo_id ? campos[f.cat_metodo_id] ?? [] : [],
        lecturas: Array.isArray(f.lecturas) ? f.lecturas : [],
        replicas: Array.isArray(f.replicas) ? f.replicas.map(Number) : [],
        variables: f.variables && typeof f.variables === "object" ? f.variables : {},
        formula: f.formula ?? f.formula_legado_analito ?? null,
        formulaOrigen: origenFormula(f.formula ?? f.formula_legado_analito ?? null, f.espec_origen, cat),
        formulaCatalogo: cat?.formula ?? cat?.formulaLegado ?? f.formula_legado_analito ?? null,
        formulaAplicada: f.formula_aplicada,
        factor: factor
          ? {
              valor: factor.valor, operacion: factor.operacion, descripcion: factor.descripcion ?? null, origen: f.factor_origen,
              editadoPor: f.factor_editado_por, editadoAt: f.factor_editado_at, motivo: f.factor_motivo,
              aplicado: factorAplicado({
                valorSinFactor: f.valor_sin_factor,
                tieneValor: f.valor_numerico != null || f.resultado_final != null || f.promedio != null || (f.valor_texto ?? "") !== "",
              }),
            }
          : null,
        valorSinFactor: num(f.valor_sin_factor),
        resultado: f.valor_numerico != null ? String(Number(f.valor_numerico)) : f.valor_texto ?? (f.resultado_final != null ? String(Number(f.resultado_final)) : f.promedio != null ? String(Number(f.promedio)) : null),
        promedio: num(f.promedio),
        desviacion: num(f.desviacion),
        cv: num(f.cv),
        limiteInf: f.limite_inf,
        nominal: f.nominal,
        limiteSup: f.limite_sup,
        requisito: f.requisito,
        analista: f.analista,
        revisor: f.revisor,
        aprobador: f.aprobador,
        fecha: f.estado === "pendiente" ? null : f.fecha,
        historial: historial
          .filter((h) => h.resultado_id === f.id)
          .map((h) => ({ fecha: h.created_at, usuario: h.usuario, campo: h.campo, anterior: h.valor_anterior, nuevo: h.valor_nuevo, motivo: h.motivo, origen: h.origen })),
      };
    });
    // Los ensayos eliminados no tienen laboratorio que mostrar: solo en la vista completa.
    const eliminados = (soloLabs ? [] : historial)
      .filter((h) => h.campo === "baja" && !ids.includes(h.resultado_id))
      .map((h) => ({ resultadoId: h.resultado_id, fecha: h.created_at, usuario: h.usuario, anterior: h.valor_anterior, motivo: h.motivo }));
    return { ot: { id: ot.id, codigo: ot.codigo, estado: ot.estado }, ensayos, eliminados, soloSuLaboratorio: !!soloLabs };
  }
}

@ApiTags("laboratorio-planillas") @ApiBearerAuth() @UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("laboratorio/ot")
export class PlanillaCalculosController {
  constructor(private readonly svc: PlanillaCalculosService) {}

  @Get(":id/planilla-calculos")
  @RequierePermiso("resultado.ver")
  @ApiOperation({ summary: "Planilla de registros y cálculos de la OT (auditable, solo lectura); ?formato=csv para Excel" })
  async planilla(@Param("id", ParseUUIDPipe) id: string, @Query("formato") formato: string | undefined, @Req() req: any, @Res({ passthrough: true }) res: any) {
    const p = await this.svc.planilla(id, req);
    if ((formato ?? "").toLowerCase() !== "csv") return p;
    const nombre = `planilla_calculos_${p.ot.codigo.replace(/[^A-Za-z0-9_-]/g, "_")}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${nombre}"`);
    return csvPlanilla(p.ot.codigo, p.ensayos);
  }
}

/* ============================== PLANILLA DE COSTOS REALES ============================== */

const LineaBody = z.object({
  categoria: z.enum(CATEGORIAS_COSTO),
  cargo: z.string().trim().max(60).nullable().optional(),
  consumibleId: z.string().uuid().nullable().optional(),
  equipoId: z.string().uuid().nullable().optional(),
  descripcion: z.string().trim().max(300).nullable().optional(),
  cantidad: z.number().finite().min(0).max(1_000_000),
  unidad: z.string().trim().max(20).nullable().optional(),
  costoUnitario: z.number().finite().min(0).max(1_000_000_000),
  ordenInternaId: z.string().uuid().nullable().optional(),
  tipoGasto: z.enum(TIPOS_GASTO_COMISION).nullable().optional(),
});
const GuardarCostosBody = z.object({
  unidadId: z.string().uuid().optional(),
  observaciones: z.string().max(4000).nullable().optional(),
  lineas: z.array(LineaBody).max(200),
});
const UnidadBody = z.object({ unidadId: z.string().uuid().optional() });
const ReabrirCostosBody = z.object({
  unidadId: z.string().uuid().optional(),
  motivo: z.string().trim().min(5, "Indique el motivo de la reapertura (mínimo 5 caracteres).").max(1000),
});

@Injectable()
export class CostosRealesService {
  constructor(private readonly prisma: PrismaService, private readonly alcance: AlcanceService) {}

  /** OT del tenant, laboratorio de la planilla (posible para la OT) y alcance del usuario sobre él. */
  private async contexto(otId: string, unidadId: string | undefined, req: any) {
    const tenantId = tenantDe(req);
    const ot = await this.prisma.ordenTrabajo.findFirst({ where: { id: otId, tenantId } });
    if (!ot) throw new NotFoundException(`Orden de trabajo ${otId} no encontrada`);
    const posibles = await this.unidadesPosibles(ot.id, ot.unidadPrincipal, tenantId);
    const unidad = unidadId ?? ot.unidadPrincipal;
    if (!unidad) throw new ConflictException("La OT no tiene laboratorio responsable: fíjelo antes de completar la planilla de costos.");
    if (!posibles.some((u) => u.id === unidad))
      throw new BadRequestException("Ese laboratorio no trabaja en esta OT (no es el responsable ni recibió una orden interna o ensayos de la OT).");
    await this.alcance.exigirUnidad(req, unidad, `la planilla de costos de la OT ${ot.codigo}`);
    return { tenantId, ot, unidadId: unidad, posibles };
  }

  private unidadesPosibles(otId: string, principal: string | null, tenantId: string) {
    return unidadesPosiblesOt(this.prisma, otId, principal, tenantId);
  }

  private async planillaDe(otId: string, unidadId: string) {
    const [p] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT c.*, ua.nombre_completo AS actualizada_por_nombre, uc.nombre_completo AS cerrada_por_nombre,
              ur.nombre_completo AS reabierta_por_nombre
         FROM ot_costo_real c
         LEFT JOIN usuario ua ON ua.id = c.actualizada_por
         LEFT JOIN usuario uc ON uc.id = c.cerrada_por
         LEFT JOIN usuario ur ON ur.id = c.reabierta_por
        WHERE c.ot_id = $1::uuid AND c.unidad_id = $2::uuid`,
      otId,
      unidadId,
    );
    const lineas = p
      ? await this.prisma.$queryRawUnsafe<any[]>(
          `SELECT l.id, l.categoria, l.cargo, l.consumible_id AS "consumibleId", l.equipo_id AS "equipoId", l.descripcion,
                  l.cantidad::float8 AS cantidad, l.unidad, l.costo_unitario::float8 AS "costoUnitario", l.total::float8 AS total,
                  c.nombre AS "consumibleNombre", e.nombre AS "equipoNombre", e.codigo AS "equipoCodigo",
                  l.orden_interna_id AS "ordenInternaId", l.tipo_gasto AS "tipoGasto"
             FROM ot_costo_real_linea l
             LEFT JOIN consumible c ON c.id = l.consumible_id
             LEFT JOIN equipo e ON e.id = l.equipo_id
            WHERE l.planilla_id = $1::uuid
            ORDER BY l.orden, l.id`,
          p.id,
        )
      : [];
    return { p, lineas: lineas as (LineaCostoReal & { total: number })[] };
  }

  /**
   * Ensayos de ESE laboratorio sin aprobar en la OT (revisión r3, hallazgo 8):
   * la planilla de un laboratorio se cierra al terminar SU parte, sin esperar a
   * los demás, y no se cierra con los suyos pendientes.
   */
  private async resultadosSinAprobar(otId: string, tenantId: string, unidadId: string, principal: string | null, posibles: string[]) {
    return contarSinAprobar(await laboratoriosDeResultados(this.prisma, otId, tenantId, posibles, principal), unidadId);
  }

  private async cargos(tenantId: string) {
    return this.prisma.$queryRawUnsafe<{ codigo: string; etiqueta: string }[]>(
      `SELECT codigo, etiqueta FROM parametro_sistema
        WHERE tenant_id = $1::uuid AND categoria = 'cargo_costo' AND activo ORDER BY orden, etiqueta`,
      tenantId,
    );
  }

  async ver(otId: string, unidadId: string | undefined, req: any) {
    const { tenantId, ot, unidadId: unidad, posibles } = await this.contexto(otId, unidadId, req);
    const { p, lineas } = await this.planillaDe(ot.id, unidad);

    const cot = ot.cotizacionId
      ? await this.prisma.cotizacion.findFirst({
          where: { id: ot.cotizacionId, tenantId },
          select: { id: true, codigo: true, neto: true, costosDirectosTotal: true, lineas: { select: { tipo: true, cantidad: true, diasOHoras: true, subtotal: true } } },
        })
      : null;
    // Solicitudes de costeo con su laboratorio (cat_familia → unidad de la planilla).
    const solicitudes = cot
      ? await this.prisma.$queryRawUnsafe<{ horasHombre: number; costoDirecto: number; delLaboratorio: boolean }[]>(
          `SELECT s.horas_hombre::float8 AS "horasHombre", s.costo_directo::float8 AS "costoDirecto",
                  (COALESCE(s.unidad_id = $3::uuid, FALSE)
                   OR EXISTS (SELECT 1 FROM cat_familia f JOIN unidad u ON u.id = $3::uuid AND ${FAMILIA_DE_UNIDAD}
                               WHERE f.id = s.familia_id)) AS "delLaboratorio"
             FROM solicitud_costeo s
            WHERE s.cotizacion_id = $1::uuid AND s.tenant_id = $2::uuid AND s.deleted_at IS NULL`,
          cot.id,
          tenantId,
          unidad,
        )
      : [];
    // La planilla de UN laboratorio se compara con la estimación de SU parte (hallazgo 7).
    const estimacion = estimacionDelLaboratorio({
      costosDirectosTotal: cot ? Number(cot.costosDirectosTotal) : null,
      solicitudes: solicitudes.map((s) => ({ horasHombre: Number(s.horasHombre), costoDirecto: Number(s.costoDirecto) })),
      otHorasHombre: Number(ot.horasHombre),
      otCostoEstimado: Number(ot.costoEstimado),
      lineasCotizacion: (cot?.lineas ?? []).map((l) => ({ tipo: l.tipo, cantidad: l.cantidad, diasOHoras: l.diasOHoras != null ? Number(l.diasOHoras) : null, subtotal: Number(l.subtotal) })),
      neto: cot ? Number(cot.neto) : null,
    }, {
      multiLaboratorio: posibles.length > 1,
      solicitudesDelLaboratorio: solicitudes.filter((x) => x.delLaboratorio),
    });
    const resumen = resumenCostos(lineas);
    const labs = await laboratoriosDeResultados(this.prisma, ot.id, tenantId, posibles.map((u) => u.id), ot.unidadPrincipal);
    const sinAprobar = contarSinAprobar(labs, unidad);
    // Ensayos de ESTE laboratorio: las sugerencias no muestran equipos ni consumos de otros.
    const propios = [...labs].filter(([, x]) => x.unidadId === unidad).map(([id]) => id);

    // Sugerencias para completar: equipos usados en los ensayos del laboratorio y
    // consumos registrados (kardex) sobre sus muestras. Horas y tarifas, a mano.
    const [equipos, consumos, cargos] = await Promise.all([
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT DISTINCT e.id, e.codigo, e.nombre FROM resultado r
           JOIN equipo e ON e.id = r.equipo_id
          WHERE r.id = ANY($1::uuid[]) ORDER BY e.codigo`,
        propios,
      ),
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT c.id, c.codigo, c.nombre, c.unidad_medida AS unidad, sum(mc.cantidad)::float8 AS cantidad
           FROM movimiento_consumible mc JOIN lote_consumible l ON l.id = mc.lote_id
           JOIN consumible c ON c.id = l.consumible_id JOIN muestra m ON m.id = mc.muestra_id
          WHERE m.ot_id = $1::uuid AND mc.tipo = 'consumo' AND mc.tenant_id = $2::uuid
            AND m.id IN (SELECT r.muestra_id FROM resultado r WHERE r.id = ANY($3::uuid[]))
          GROUP BY c.id, c.codigo, c.nombre, c.unidad_medida ORDER BY c.codigo`,
        ot.id,
        tenantId,
        propios,
      ),
      this.cargos(tenantId),
    ]);

    const permisos: string[] = req?.user?.permisos ?? [];
    const puedeGestionar = (req?.user?.roles ?? []).includes("SUPERADMIN") || permisos.includes("costo_real.gestionar");
    const estado = p?.estado ?? "borrador";
    return {
      ot: { id: ot.id, codigo: ot.codigo, estado: ot.estado },
      unidad: posibles.find((u) => u.id === unidad) ?? null,
      unidadesPosibles: posibles,
      cotizacion: cot ? { id: cot.id, codigo: cot.codigo } : null,
      planilla: p
        ? {
            id: p.id, estado: p.estado, observaciones: p.observaciones,
            actualizadaPor: p.actualizada_por_nombre, actualizadaAt: p.actualizada_at,
            cerradaPor: p.cerrada_por_nombre, cerradaAt: p.cerrada_at,
            reabiertaPor: p.reabierta_por_nombre, reabiertaAt: p.reabierta_at, reabiertaMotivo: p.reabierta_motivo,
          }
        : null,
      lineas,
      resumen,
      estimacion,
      comparacion: comparar(resumen, estimacion),
      cargos,
      sugerencias: { equipos, consumos, lineas: await this.sugerenciasR4d(ot.id, unidad, cot?.id ?? null, lineas) },
      resultadosSinAprobar: sinAprobar,
      puedeGestionar,
      erroresCierre: estado === "cerrada" ? [] : erroresCierrePlanilla({ estado, lineas, resultadosSinAprobar: sinAprobar }),
    };
  }

  /**
   * Órdenes internas de la OT respondidas con costo directo (las que emitió este
   * laboratorio, o todas si la OT tiene un solo laboratorio) y gastos de comisión
   * estimados por el laboratorio en el costeo de la cotización (BL-193, BL-194).
   */
  private async sugerenciasR4d(otId: string, unidadId: string, cotizacionId: string | null, lineas: LineaCostoReal[]) {
    const ordenes = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT oi.id, oi.numero, fd.nombre AS destino, oi.costo_directo::float8 AS "costoDirecto"
         FROM orden_interna oi
         LEFT JOIN cat_familia fd ON fd.id = oi.destino_lab
         LEFT JOIN cat_familia fo ON fo.id = oi.origen_lab
        WHERE oi.ot_id = $1::uuid AND oi.deleted_at IS NULL AND oi.costo_directo IS NOT NULL
          AND (oi.origen_lab IS NULL OR fo.codsucdel IS NULL OR EXISTS (
                SELECT 1 FROM unidad u WHERE u.id = $2::uuid AND fo.codsucdel = ANY(string_to_array(regexp_replace(COALESCE(u.codsucdel, ''), '[\\s,;]', '/', 'g'), '/'))))
        ORDER BY oi.numero`,
      otId,
      unidadId,
    ).catch(() => []);
    const costeo = cotizacionId
      ? (await this.prisma.$queryRawUnsafe<{ costeo: any }[]>(
          `SELECT costeo FROM solicitud_costeo WHERE cotizacion_id = $1::uuid AND unidad_id = $2::uuid AND deleted_at IS NULL AND costeo IS NOT NULL
            ORDER BY respondida_at DESC NULLS LAST LIMIT 1`,
          cotizacionId,
          unidadId,
        ).catch(() => []))[0]?.costeo ?? null
      : null;
    return lineasSugeridas(ordenes, costeo, lineas);
  }

  async guardar(otId: string, body: z.infer<typeof GuardarCostosBody>, req: any) {
    const { tenantId, ot, unidadId } = await this.contexto(otId, body.unidadId, req);
    if (["anulada"].includes(ot.estado)) throw new ConflictException("La OT está anulada.");
    const { p } = await this.planillaDe(ot.id, unidadId);
    if (p?.estado === "cerrada") throw new ConflictException("La planilla está cerrada: reábrala (con motivo) para corregirla.");
    const lineas: LineaCostoReal[] = body.lineas.map((l) => ({ ...l, categoria: l.categoria }));
    const cargos = new Set((await this.cargos(tenantId)).map((c) => c.codigo));
    const errores = erroresLineas(lineas, cargos);
    // Consumibles y equipos deben ser del tenant.
    const consumibleIds = [...new Set(lineas.map((l) => l.consumibleId).filter((x): x is string => !!x))];
    const equipoIds = [...new Set(lineas.map((l) => l.equipoId).filter((x): x is string => !!x))];
    if (consumibleIds.length) {
      const ok = await this.prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM consumible WHERE id = ANY($1::uuid[]) AND tenant_id = $2::uuid`, consumibleIds, tenantId);
      if (ok.length !== consumibleIds.length) errores.push("Algún reactivo o consumible indicado no existe.");
    }
    if (equipoIds.length) {
      const ok = await this.prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM equipo WHERE id = ANY($1::uuid[]) AND tenant_id = $2::uuid`, equipoIds, tenantId);
      if (ok.length !== equipoIds.length) errores.push("Algún equipo indicado no existe.");
    }
    // Las órdenes internas valorizadas deben ser de esta OT (EP-00 7.1).
    const oiIds = [...new Set(lineas.map((l) => l.ordenInternaId).filter((x): x is string => !!x))];
    if (oiIds.length) {
      const ok = await this.prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM orden_interna WHERE id = ANY($1::uuid[]) AND ot_id = $2::uuid AND deleted_at IS NULL`, oiIds, ot.id);
      if (ok.length !== oiIds.length) errores.push("Alguna orden interna indicada no es de esta OT.");
    }
    if (errores.length) throw new BadRequestException(errores.join(" "));

    const usuario = req?.user?.sub ?? null;
    await this.prisma.$transaction(async (tx) => {
      const [fila] = await tx.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO ot_costo_real (tenant_id, ot_id, unidad_id, observaciones, actualizada_por, actualizada_at, created_by)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::uuid, now(), $5::uuid)
         ON CONFLICT (ot_id, unidad_id) DO UPDATE
           SET observaciones = EXCLUDED.observaciones, actualizada_por = EXCLUDED.actualizada_por, actualizada_at = now()
         WHERE ot_costo_real.estado = 'borrador'
         RETURNING id`,
        tenantId, ot.id, unidadId, body.observaciones?.trim() || null, usuario,
      );
      if (!fila) throw new ConflictException("La planilla se cerró mientras la editaba: vuelva a cargarla.");
      await tx.$executeRawUnsafe(`DELETE FROM ot_costo_real_linea WHERE planilla_id = $1::uuid`, fila.id);
      for (let i = 0; i < lineas.length; i++) {
        const l = lineas[i];
        await tx.$executeRawUnsafe(
          `INSERT INTO ot_costo_real_linea (planilla_id, orden, categoria, cargo, consumible_id, equipo_id, descripcion, cantidad, unidad, costo_unitario, total,
                                            orden_interna_id, tipo_gasto)
           VALUES ($1::uuid, $2, $3, $4, $5::uuid, $6::uuid, $7, $8, $9, $10, $11, $12::uuid, $13)`,
          fila.id, i, l.categoria, l.categoria === "horas_hombre" ? l.cargo ?? null : null, l.consumibleId ?? null, l.equipoId ?? null,
          l.descripcion?.trim() || null, l.cantidad, l.unidad?.trim() || null, l.costoUnitario, totalLinea(l),
          l.categoria === "ot_interna" ? l.ordenInternaId ?? null : null, l.categoria === "comision" ? l.tipoGasto ?? null : null,
        );
      }
    });
    return this.ver(otId, unidadId, req);
  }

  /**
   * Cierra la planilla. Todo en una transacción con la fila de la planilla
   * bloqueada (SELECT … FOR UPDATE): las líneas, el total y el evento del
   * historial son los de la planilla que se cierra, y un segundo cierre
   * simultáneo (doble clic) recibe 409 sin registrar otro evento (hallazgo 15).
   */
  async cerrar(otId: string, unidadIdPedido: string | undefined, req: any) {
    const { tenantId, ot, unidadId, posibles } = await this.contexto(otId, unidadIdPedido, req);
    const sinAprobar = await this.resultadosSinAprobar(ot.id, tenantId, unidadId, ot.unidadPrincipal, posibles.map((u) => u.id));
    const usuario = req?.user?.sub ?? null;
    await this.prisma.$transaction(async (tx) => {
      const [p] = await tx.$queryRawUnsafe<{ id: string; estado: string }[]>(
        `SELECT id, estado FROM ot_costo_real WHERE ot_id = $1::uuid AND unidad_id = $2::uuid FOR UPDATE`,
        ot.id,
        unidadId,
      );
      const lineas = p
        ? await tx.$queryRawUnsafe<LineaCostoReal[]>(
            `SELECT categoria, cargo, consumible_id AS "consumibleId", equipo_id AS "equipoId", descripcion,
                    cantidad::float8 AS cantidad, unidad, costo_unitario::float8 AS "costoUnitario"
               FROM ot_costo_real_linea WHERE planilla_id = $1::uuid ORDER BY orden, id`,
            p.id,
          )
        : [];
      const errores = erroresCierrePlanilla({ estado: p?.estado ?? "borrador", lineas, resultadosSinAprobar: sinAprobar });
      if (!p && !errores.length) errores.push("Guarde la planilla antes de cerrarla.");
      if (errores.length) throw new ConflictException(errores.join(" "));
      const resumen = resumenCostos(lineas);
      const n = await tx.$executeRawUnsafe(
        `UPDATE ot_costo_real SET estado = 'cerrada', cerrada_por = $2::uuid, cerrada_at = now() WHERE id = $1::uuid AND estado = 'borrador'`,
        p!.id,
        usuario,
      );
      if (!n) throw new ConflictException("La planilla ya está cerrada.");
      await tx.$executeRawUnsafe(
        `INSERT INTO ot_historial (tenant_id, ot_id, tipo, detalle, usuario_id) VALUES ($1::uuid, $2::uuid, 'costos_reales', $3::jsonb, $4::uuid)`,
        tenantId, ot.id, JSON.stringify({ accion: "cerrar", unidadId, total: resumen.total, horasHombre: resumen.horasHombre }), usuario,
      );
    });
    return this.ver(otId, unidadId, req);
  }

  async reabrir(otId: string, body: z.infer<typeof ReabrirCostosBody>, req: any) {
    const { tenantId, ot, unidadId } = await this.contexto(otId, body.unidadId, req);
    const { p } = await this.planillaDe(ot.id, unidadId);
    if (!p || p.estado !== "cerrada") throw new ConflictException("La planilla no está cerrada.");
    await this.prisma.$transaction(async (tx) => {
      const n = await tx.$executeRawUnsafe(
        `UPDATE ot_costo_real SET estado = 'borrador', reabierta_por = $2::uuid, reabierta_at = now(), reabierta_motivo = $3 WHERE id = $1::uuid AND estado = 'cerrada'`,
        p.id, req?.user?.sub ?? null, body.motivo,
      );
      // Una reapertura simultánea no deja dos eventos.
      if (!n) throw new ConflictException("La planilla ya fue reabierta.");
      await tx.$executeRawUnsafe(
        `INSERT INTO ot_historial (tenant_id, ot_id, tipo, detalle, usuario_id) VALUES ($1::uuid, $2::uuid, 'costos_reales', $3::jsonb, $4::uuid)`,
        tenantId, ot.id, JSON.stringify({ accion: "reabrir", unidadId, motivo: body.motivo }), req?.user?.sub ?? null,
      );
    });
    return this.ver(otId, unidadId, req);
  }
}

@ApiTags("laboratorio-planillas") @ApiBearerAuth() @UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("laboratorio/ot")
export class CostosRealesController {
  constructor(private readonly svc: CostosRealesService) {}

  @Get(":id/costos-reales")
  @RequierePermiso("costo_real.ver")
  @ApiOperation({ summary: "Planilla de costos reales de la OT (por laboratorio) y comparación con la cotización" })
  ver(@Param("id", ParseUUIDPipe) id: string, @Query("unidadId") unidadId: string | undefined, @Req() req: any) {
    if (unidadId && !/^[0-9a-f-]{36}$/i.test(unidadId)) throw new BadRequestException("unidadId inválido");
    return this.svc.ver(id, unidadId, req);
  }

  @Put(":id/costos-reales")
  @RequierePermiso("costo_real.gestionar")
  @ApiOperation({ summary: "Guarda la planilla de costos reales (borrador): horas hombre, reactivos, equipos y otros" })
  guardar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.guardar(id, GuardarCostosBody.parse(body ?? {}), req);
  }

  @Post(":id/costos-reales/cerrar")
  @RequierePermiso("costo_real.gestionar")
  @ApiOperation({ summary: "Cierra la planilla de costos reales del laboratorio" })
  cerrar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.cerrar(id, UnidadBody.parse(body ?? {}).unidadId, req);
  }

  @Post(":id/costos-reales/reabrir")
  @RequierePermiso("costo_real.gestionar")
  @ApiOperation({ summary: "Reabre una planilla de costos cerrada (motivo obligatorio)" })
  reabrir(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.reabrir(id, ReabrirCostosBody.parse(body ?? {}), req);
  }
}
