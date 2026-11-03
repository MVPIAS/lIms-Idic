import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { PrismaService } from "../common/prisma.service";
import { libroXlsx } from "../common/xlsx-escritura";
import { hoyCl } from "../ot/plazos";
import { AlcanceService } from "../rbac/alcance.service";
import { cumplimiento, diasEntre, erroresEjecucion, erroresPlan, estadoPlazo, ocurrencias, siguienteFecha, sumarDias } from "./plan-mantencion";

// ===========================================================================
// Mantención preventiva y gestión de equipos (contrato §4.4.3): plan por
// equipo con frecuencia y próxima fecha, registro de lo ejecutado contra el
// plan (o correctivo), calendario de calibraciones y mantenciones, y reporte
// de gestión (cumplimiento, atrasos, costos, calibraciones vencidas) con su
// descarga en Excel. Alcance por el laboratorio del equipo.
// Reglas puras en plan-mantencion.ts.
// ===========================================================================

const UUID = new ParseUUIDPipe({ version: "4", errorHttpStatusCode: 400 });
const tenantDe = (req: any): string => req?.user?.tenantId;
const texto = (v: unknown, max: number) => {
  const t = typeof v === "string" ? v.trim() : "";
  return t ? t.slice(0, max) : null;
};
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

@Injectable()
export class MantencionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
  ) {}

  private async unidades(req: any, permiso: string) {
    return this.alcance.filtroUnidades(req, permiso);
  }

  private async equipo(req: any, id: string, permiso: string) {
    const [e] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, codigo, COALESCE(nombre, descripcion) AS nombre, unidad_id FROM equipo WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL`,
      id,
      tenantDe(req),
    );
    if (!e) throw new NotFoundException("Equipo no encontrado.");
    const u = await this.unidades(req, permiso);
    if (u && e.unidad_id && !u.includes(e.unidad_id)) throw new ForbiddenException(`El equipo ${e.codigo} es de otro laboratorio.`);
    return e;
  }

  /** Próxima mantención del equipo = la más cercana de sus planes activos. */
  private async recalcularEquipo(equipoId: string) {
    await this.prisma.$executeRawUnsafe(
      `UPDATE equipo SET proxima_mantencion = (SELECT MIN(proxima_fecha) FROM plan_mantencion WHERE equipo_id = $1::uuid AND activo) WHERE id = $1::uuid`,
      equipoId,
    );
  }

  /* --------------------------------------------------------------- planes --- */

  async planes(req: any, q: { equipoId?: string; estado?: string }) {
    const u = await this.unidades(req, "equipo.ver");
    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT p.id, p.equipo_id AS "equipoId", e.codigo AS "equipoCodigo", COALESCE(e.nombre, e.descripcion) AS "equipoNombre", un.codigo AS laboratorio,
              p.tipo, p.descripcion, p.frecuencia_dias AS "frecuenciaDias", p.proxima_fecha::text AS "proximaFecha",
              p.responsable_id AS "responsableId", us.nombre_completo AS responsable, p.proveedor, p.activo,
              (SELECT max(m.fecha)::text FROM mantencion m WHERE m.plan_id = p.id) AS "ultimaEjecucion"
         FROM plan_mantencion p
         JOIN equipo e ON e.id = p.equipo_id AND e.deleted_at IS NULL
         LEFT JOIN unidad un ON un.id = e.unidad_id
         LEFT JOIN usuario us ON us.id = p.responsable_id
        WHERE p.tenant_id = $1::uuid AND p.activo AND ($2::uuid IS NULL OR p.equipo_id = $2::uuid)
          AND ($3::uuid[] IS NULL OR e.unidad_id IS NULL OR e.unidad_id = ANY($3::uuid[]))
        ORDER BY p.proxima_fecha, e.codigo`,
      tenantDe(req),
      q.equipoId || null,
      u,
    );
    const hoy = hoyCl();
    const conEstado = filas.map((f) => ({ ...f, estado: estadoPlazo(f.proximaFecha, hoy) }));
    return q.estado ? conEstado.filter((f) => f.estado === q.estado) : conEstado;
  }

  private datosPlan(b: any) {
    const d = {
      equipoId: texto(b?.equipoId, 40),
      tipo: texto(b?.tipo, 20) ?? "preventiva",
      descripcion: texto(b?.descripcion, 300),
      frecuenciaDias: b?.frecuenciaDias == null || b?.frecuenciaDias === "" ? null : Number(b.frecuenciaDias),
      proximaFecha: texto(b?.proximaFecha, 10),
      responsableId: texto(b?.responsableId, 40),
      proveedor: texto(b?.proveedor, 200),
    };
    const e = erroresPlan(d);
    if (e.length) throw new BadRequestException(e.join(" "));
    return d;
  }

  async crearPlan(req: any, b: any) {
    const d = this.datosPlan(b);
    await this.equipo(req, d.equipoId!, "equipo.gestionar");
    const [p] = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO plan_mantencion (tenant_id, equipo_id, tipo, descripcion, frecuencia_dias, proxima_fecha, responsable_id, proveedor, creado_por)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::date, $7::uuid, $8, $9::uuid) RETURNING id`,
      tenantDe(req), d.equipoId, d.tipo, d.descripcion, d.frecuenciaDias, d.proximaFecha, d.responsableId, d.proveedor, req?.user?.sub ?? null,
    );
    await this.recalcularEquipo(d.equipoId!);
    return { id: p.id };
  }

  private async plan(req: any, id: string, permiso: string) {
    const [p] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, equipo_id, frecuencia_dias, proxima_fecha::text AS proxima_fecha, activo FROM plan_mantencion WHERE id = $1::uuid AND tenant_id = $2::uuid`,
      id,
      tenantDe(req),
    );
    if (!p || !p.activo) throw new NotFoundException("Plan de mantención no encontrado.");
    await this.equipo(req, p.equipo_id, permiso);
    return p;
  }

  async editarPlan(req: any, id: string, b: any) {
    const p = await this.plan(req, id, "equipo.gestionar");
    const d = this.datosPlan({ ...b, equipoId: p.equipo_id });
    await this.prisma.$executeRawUnsafe(
      `UPDATE plan_mantencion SET tipo = $2, descripcion = $3, frecuencia_dias = $4, proxima_fecha = $5::date, responsable_id = $6::uuid,
              proveedor = $7, actualizado_en = now() WHERE id = $1::uuid`,
      id, d.tipo, d.descripcion, d.frecuenciaDias, d.proximaFecha, d.responsableId, d.proveedor,
    );
    await this.recalcularEquipo(p.equipo_id);
    return { id };
  }

  async bajaPlan(req: any, id: string) {
    const p = await this.plan(req, id, "equipo.gestionar");
    await this.prisma.$executeRawUnsafe(`UPDATE plan_mantencion SET activo = FALSE, actualizado_en = now() WHERE id = $1::uuid`, id);
    await this.recalcularEquipo(p.equipo_id);
    return { ok: true };
  }

  private datosEjecucion(b: any) {
    const d = {
      fecha: texto(b?.fecha, 10),
      ejecutadaPor: texto(b?.ejecutadaPor, 200),
      descripcion: texto(b?.descripcion, 2000),
      resultado: texto(b?.resultado, 30),
      costo: b?.costo == null || b?.costo === "" ? null : Number(String(b.costo).replace(",", ".")),
      observaciones: texto(b?.observaciones, 2000),
    };
    const e = erroresEjecucion(d, hoyCl());
    if (e.length) throw new BadRequestException(e.join(" "));
    return d;
  }

  /** Registra la mantención hecha según el plan y corre su próxima fecha. */
  async ejecutar(req: any, id: string, b: any) {
    const p = await this.plan(req, id, "equipo.gestionar");
    const d = this.datosEjecucion(b);
    const proxima = siguienteFecha(d.fecha!, p.frecuencia_dias);
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO mantencion (tenant_id, equipo_id, plan_id, tipo, fecha, fecha_programada, ejecutada_por, descripcion, costo, resultado, observaciones, proxima_fecha, registrada_por)
         SELECT $1::uuid, $2::uuid, $3::uuid, tipo, $4::date, $5::date, $6, COALESCE($7, descripcion), $8, $9, $10, $11::date, $12::uuid FROM plan_mantencion WHERE id = $3::uuid`,
        tenantDe(req), p.equipo_id, id, d.fecha, p.proxima_fecha, d.ejecutadaPor, d.descripcion, d.costo, d.resultado ?? "conforme", d.observaciones, proxima, req?.user?.sub ?? null,
      );
      await tx.$executeRawUnsafe(`UPDATE plan_mantencion SET proxima_fecha = $2::date, actualizado_en = now() WHERE id = $1::uuid`, id, proxima);
      // Un resultado no conforme deja el equipo fuera de servicio hasta revisarlo.
      if (d.resultado === "no_conforme") await tx.$executeRawUnsafe(`UPDATE equipo SET estado = 'fuera_servicio' WHERE id = $1::uuid`, p.equipo_id);
    });
    await this.recalcularEquipo(p.equipo_id);
    return { proximaFecha: proxima, fueraDeServicio: d.resultado === "no_conforme" };
  }

  /** Mantención correctiva (sin plan). */
  async correctiva(req: any, equipoId: string, b: any) {
    await this.equipo(req, equipoId, "equipo.gestionar");
    const d = this.datosEjecucion(b);
    if (!d.descripcion) throw new BadRequestException("Describa la falla y lo que se hizo.");
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO mantencion (tenant_id, equipo_id, tipo, fecha, ejecutada_por, descripcion, costo, resultado, observaciones, registrada_por)
       VALUES ($1::uuid, $2::uuid, 'correctiva', $3::date, $4, $5, $6, $7, $8, $9::uuid)`,
      tenantDe(req), equipoId, d.fecha, d.ejecutadaPor, d.descripcion, d.costo, d.resultado ?? "conforme", d.observaciones, req?.user?.sub ?? null,
    );
    return { ok: true };
  }

  async historial(req: any, equipoId: string) {
    const e = await this.equipo(req, equipoId, "equipo.ver");
    const [mantenciones, calibraciones] = await Promise.all([
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT m.id, m.tipo, m.fecha::text AS fecha, m.fecha_programada::text AS "fechaProgramada", m.ejecutada_por AS "ejecutadaPor", m.descripcion,
                m.costo::float AS costo, m.resultado, m.observaciones, u.nombre_completo AS "registradaPor"
           FROM mantencion m LEFT JOIN usuario u ON u.id = m.registrada_por
          WHERE m.equipo_id = $1::uuid ORDER BY m.fecha DESC, m.created_at DESC LIMIT 200`,
        equipoId,
      ),
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT id, fecha::text AS fecha, ejecutada_por AS "ejecutadaPor", resultado, proxima_fecha::text AS "proximaFecha", certificado_ref AS certificado
           FROM calibracion WHERE equipo_id = $1::uuid AND deleted_at IS NULL ORDER BY fecha DESC LIMIT 200`,
        equipoId,
      ),
    ]);
    return { equipo: { id: e.id, codigo: e.codigo, nombre: e.nombre }, mantenciones, calibraciones };
  }

  /* ------------------------------------------------------------ calendario --- */

  private rango(desde?: string, hasta?: string) {
    const hoy = hoyCl();
    const d = desde && FECHA.test(desde) ? desde : sumarDias(hoy, -30);
    const h = hasta && FECHA.test(hasta) ? hasta : sumarDias(hoy, 90);
    if (diasEntre(d, h) < 0) throw new BadRequestException("La fecha «hasta» es anterior a «desde».");
    if (diasEntre(d, h) > 731) throw new BadRequestException("El rango no puede superar dos años.");
    return { desde: d, hasta: h };
  }

  /** Calibraciones (próxima fecha del equipo) y mantenciones programadas en el rango. */
  async calendario(req: any, q: { desde?: string; hasta?: string }) {
    const { desde, hasta } = this.rango(q.desde, q.hasta);
    const u = await this.unidades(req, "equipo.ver");
    const equipos = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT e.id, e.codigo, COALESCE(e.nombre, e.descripcion) AS nombre, un.codigo AS laboratorio, e.estado, e.proxima_calibracion::text AS proxima_calibracion
         FROM equipo e LEFT JOIN unidad un ON un.id = e.unidad_id
        WHERE e.tenant_id = $1::uuid AND e.deleted_at IS NULL AND e.estado <> 'baja'
          AND ($2::uuid[] IS NULL OR e.unidad_id IS NULL OR e.unidad_id = ANY($2::uuid[]))`,
      tenantDe(req),
      u,
    );
    const hoy = hoyCl();
    const eventos: any[] = [];
    for (const e of equipos)
      if (e.proxima_calibracion && diasEntre(desde, e.proxima_calibracion) >= 0 && diasEntre(e.proxima_calibracion, hasta) >= 0)
        eventos.push({ fecha: e.proxima_calibracion, tipo: "calibracion", equipoId: e.id, equipo: `${e.codigo} · ${e.nombre}`, laboratorio: e.laboratorio, detalle: "Calibración", estado: estadoPlazo(e.proxima_calibracion, hoy) });
    for (const p of await this.planes(req, {}))
      for (const f of ocurrencias(p.proximaFecha, p.frecuenciaDias, desde, hasta))
        eventos.push({ fecha: f, tipo: p.tipo, planId: p.id, equipoId: p.equipoId, equipo: `${p.equipoCodigo} · ${p.equipoNombre}`, laboratorio: p.laboratorio, detalle: p.descripcion, estado: estadoPlazo(f, hoy) });
    // Lo vencido antes del rango y aún pendiente también se muestra (atrasado).
    for (const p of await this.planes(req, { estado: "vencido" }))
      if (diasEntre(p.proximaFecha, desde) > 0)
        eventos.push({ fecha: p.proximaFecha, tipo: p.tipo, planId: p.id, equipoId: p.equipoId, equipo: `${p.equipoCodigo} · ${p.equipoNombre}`, laboratorio: p.laboratorio, detalle: p.descripcion, estado: "vencido" });
    eventos.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.equipo.localeCompare(b.equipo));
    return { desde, hasta, eventos };
  }

  /* -------------------------------------------------------------- reporte --- */

  async reporte(req: any, q: { desde?: string; hasta?: string }) {
    const hoy = hoyCl();
    const desde = q.desde && FECHA.test(q.desde) ? q.desde : sumarDias(hoy, -365);
    const hasta = q.hasta && FECHA.test(q.hasta) ? q.hasta : hoy;
    if (diasEntre(desde, hasta) < 0) throw new BadRequestException("La fecha «hasta» es anterior a «desde».");
    const u = await this.unidades(req, "equipo.ver");
    const equipos = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT e.id, e.codigo, COALESCE(e.nombre, e.descripcion) AS nombre, e.estado, un.codigo AS laboratorio,
              e.proxima_calibracion::text AS "proximaCalibracion", e.proxima_mantencion::text AS "proximaMantencion"
         FROM equipo e LEFT JOIN unidad un ON un.id = e.unidad_id
        WHERE e.tenant_id = $1::uuid AND e.deleted_at IS NULL AND e.estado <> 'baja'
          AND ($2::uuid[] IS NULL OR e.unidad_id IS NULL OR e.unidad_id = ANY($2::uuid[]))
        ORDER BY un.codigo NULLS LAST, e.codigo`,
      tenantDe(req),
      u,
    );
    const ids = equipos.map((e) => e.id);
    const ejecutadas = ids.length
      ? await this.prisma.$queryRawUnsafe<any[]>(
          `SELECT equipo_id, tipo, fecha::text AS fecha, fecha_programada::text AS fecha_programada, costo::float AS costo
             FROM mantencion WHERE equipo_id = ANY($1::uuid[]) AND fecha BETWEEN $2::date AND $3::date`,
          ids,
          desde,
          hasta,
        )
      : [];
    const vencidosPorEquipo = new Map<string, number>();
    for (const p of await this.planes(req, { estado: "vencido" }))
      if (diasEntre(desde, p.proximaFecha) >= 0) vencidosPorEquipo.set(p.equipoId, (vencidosPorEquipo.get(p.equipoId) ?? 0) + 1);
    const porEquipo = equipos.map((e) => {
      const ej = ejecutadas.filter((m) => m.equipo_id === e.id);
      const c = cumplimiento(ej.map((m) => ({ fecha: m.fecha, fechaProgramada: m.fecha_programada, costo: m.costo })), vencidosPorEquipo.get(e.id) ?? 0);
      return {
        ...e,
        calibracion: estadoPlazo(e.proximaCalibracion, hoy),
        mantencion: estadoPlazo(e.proximaMantencion, hoy),
        correctivas: ej.filter((m) => m.tipo === "correctiva").length,
        ...c,
      };
    });
    const total = cumplimiento(
      ejecutadas.map((m) => ({ fecha: m.fecha, fechaProgramada: m.fecha_programada, costo: m.costo })),
      [...vencidosPorEquipo.values()].reduce((a, b) => a + b, 0),
    );
    const resumen = {
      equipos: equipos.length,
      operativos: equipos.filter((e) => e.estado === "operativo").length,
      fueraDeServicio: equipos.filter((e) => e.estado === "fuera_servicio").length,
      calibracionVencida: porEquipo.filter((e) => e.calibracion === "vencido").length,
      calibracionPorVencer: porEquipo.filter((e) => e.calibracion === "por_vencer").length,
      sinPlan: porEquipo.filter((e) => e.mantencion === "sin_fecha").length,
      correctivas: ejecutadas.filter((m) => m.tipo === "correctiva").length,
      ...total,
    };
    return { desde, hasta, resumen, equipos: porEquipo };
  }

  async reporteXlsx(req: any, q: { desde?: string; hasta?: string }) {
    const r = await this.reporte(req, q);
    const ESTADO: Record<string, string> = { vencido: "Vencida", por_vencer: "Por vencer", al_dia: "Al día", sin_fecha: "Sin fecha" };
    const fecha = (d: string | null) => (d ? d.split("-").reverse().join("-") : "");
    return libroXlsx([
      {
        nombre: "Resumen",
        anchos: [44, 16],
        filas: [
          ["Reporte de gestión de equipos", `${fecha(r.desde)} a ${fecha(r.hasta)}`],
          ["Equipos", r.resumen.equipos],
          ["Operativos", r.resumen.operativos],
          ["Fuera de servicio", r.resumen.fueraDeServicio],
          ["Calibración vencida", r.resumen.calibracionVencida],
          ["Calibración por vencer (30 días)", r.resumen.calibracionPorVencer],
          ["Equipos sin plan de mantención", r.resumen.sinPlan],
          ["Mantenciones programadas", r.resumen.programadas],
          ["Ejecutadas a tiempo", r.resumen.aTiempo],
          ["Ejecutadas con atraso", r.resumen.atrasadas],
          ["Pendientes vencidas", r.resumen.pendientes],
          ["Cumplimiento del plan (%)", r.resumen.porcentaje ?? ""],
          ["Mantenciones correctivas", r.resumen.correctivas],
          ["Costo de mantenciones (CLP)", r.resumen.costo],
        ],
      },
      {
        nombre: "Por equipo",
        autoFiltro: true,
        anchos: [14, 36, 10, 14, 14, 16, 14, 16, 12, 10, 10, 12, 14],
        filas: [
          ["Código", "Equipo", "Lab.", "Estado", "Calibración", "Próx. calibración", "Mantención", "Próx. mantención", "Programadas", "A tiempo", "Atrasadas", "Pendientes", "Costo (CLP)"],
          ...r.equipos.map((e: any) => [
            e.codigo, e.nombre, e.laboratorio ?? "", e.estado, ESTADO[e.calibracion], fecha(e.proximaCalibracion), ESTADO[e.mantencion], fecha(e.proximaMantencion),
            e.programadas, e.aTiempo, e.atrasadas, e.pendientes, e.costo,
          ]),
        ],
      },
    ]);
  }
}

@ApiTags("mantencion")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("mantencion")
export class MantencionController {
  constructor(private readonly m: MantencionService) {}

  @Get("planes")
  @RequierePermiso("equipo.ver")
  planes(@Query("equipoId") equipoId: string | undefined, @Query("estado") estado: string | undefined, @Req() req: any) {
    return this.m.planes(req, { equipoId, estado });
  }

  @Post("planes")
  @RequierePermiso("equipo.gestionar")
  crear(@Body() b: any, @Req() req: any) {
    return this.m.crearPlan(req, b);
  }

  @Patch("planes/:id")
  @RequierePermiso("equipo.gestionar")
  editar(@Param("id", UUID) id: string, @Body() b: any, @Req() req: any) {
    return this.m.editarPlan(req, id, b);
  }

  @Delete("planes/:id")
  @RequierePermiso("equipo.gestionar")
  baja(@Param("id", UUID) id: string, @Req() req: any) {
    return this.m.bajaPlan(req, id);
  }

  @Post("planes/:id/ejecutar")
  @RequierePermiso("equipo.gestionar")
  ejecutar(@Param("id", UUID) id: string, @Body() b: any, @Req() req: any) {
    return this.m.ejecutar(req, id, b);
  }

  @Post("equipos/:id/correctiva")
  @RequierePermiso("equipo.gestionar")
  correctiva(@Param("id", UUID) id: string, @Body() b: any, @Req() req: any) {
    return this.m.correctiva(req, id, b);
  }

  @Get("equipos/:id/historial")
  @RequierePermiso("equipo.ver")
  historial(@Param("id", UUID) id: string, @Req() req: any) {
    return this.m.historial(req, id);
  }

  @Get("calendario")
  @RequierePermiso("equipo.ver")
  calendario(@Query("desde") desde: string | undefined, @Query("hasta") hasta: string | undefined, @Req() req: any) {
    return this.m.calendario(req, { desde, hasta });
  }

  @Get("reporte")
  @RequierePermiso("equipo.ver")
  reporte(@Query("desde") desde: string | undefined, @Query("hasta") hasta: string | undefined, @Req() req: any) {
    return this.m.reporte(req, { desde, hasta });
  }

  @Get("reporte.xlsx")
  @RequierePermiso("equipo.ver")
  async reporteXlsx(@Query("desde") desde: string | undefined, @Query("hasta") hasta: string | undefined, @Req() req: any, @Res() res: any) {
    const b = await this.m.reporteXlsx(req, { desde, hasta });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="gestion_equipos.xlsx"`);
    res.send(b);
  }
}

@Module({
  controllers: [MantencionController],
  providers: [MantencionService],
})
export class MantencionModule {}
