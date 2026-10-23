import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Put, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PermisoGuard } from "../../auth/permiso.guard";
import { RequierePermiso } from "../../auth/permisos.decorator";
import { PrismaService } from "../../common/prisma.service";
import { AlcanceService } from "../../rbac/alcance.service";
import { validaRut } from "../../common/rut.validator";

/**
 * Recepción de ítems y distribución de muestras · frente r4d (T08).
 *
 *   EP-00 5.7 (BL-211) · Recepción de ítems en DCO (DCO-PG01-P01-IT01):
 *     GET  /ot/:id/recepcion-dco                       · ot.ver
 *     POST /ot/:id/recepcion-dco                       · ot.recepcion_dco · «Recepcionar → entregar al laboratorio»
 *     POST /ot/:id/recepcion-dco/:rid/entregar         · ot.recepcion_dco · entrega al laboratorio
 *   EP-02 1.3 (BL-212) · Distribución de una muestra a los laboratorios:
 *     GET  /muestras/:id/distribucion                  · muestra.ver · laboratorios con ensayos de la muestra
 *     PUT  /muestras/:id/distribucion                  · muestra.transferir · «Distribuir → laboratorios»
 * Todas exigen la OT en el alcance del usuario.
 */

const fechaHora = z.string().datetime({ offset: true, message: "Fecha y hora ISO" });

const RecepcionSchema = z.object({
  portadorRut: z.string().trim().refine((r) => validaRut(r), { message: "RUT del portador inválido (no pasa módulo 11)." }),
  portadorNombre: z.string().trim().min(3, "Indique el nombre del portador.").max(160),
  portadorDireccion: z.string().trim().max(300).nullable().optional(),
  fechaRecibo: fechaHora,
  cantidadItems: z.number().int().positive("La cantidad de ítems debe ser mayor que 0.").max(100000),
  condicion: z.enum(["cumple", "no_cumple"]),
  observacion: z.string().trim().max(2000).nullable().optional(),
});

const DistribucionSchema = z.object({
  filas: z
    .array(
      z.object({
        unidadId: z.string().uuid(),
        porcion: z.string().trim().min(1, "Indique la porción entregada.").max(80),
        fechaHora,
        recibidoPor: z.string().trim().min(2, "Indique quién recibe.").max(160),
      }),
    )
    .min(1)
    .max(20),
});

/** Errores de la recepción en DCO (regla pura). */
export function erroresRecepcionDco(d: { condicion: string; observacion?: string | null; fechaRecibo: string }, ahora: Date = new Date()): string[] {
  const e: string[] = [];
  if (d.condicion === "no_cumple" && !(d.observacion && d.observacion.trim().length >= 5))
    e.push("Condición «No cumple»: describa lo observado (mínimo 5 caracteres).");
  if (new Date(d.fechaRecibo).getTime() > ahora.getTime() + 5 * 60_000) e.push("La fecha de recibo no puede ser futura.");
  return e;
}

/** Errores de la distribución: solo laboratorios con ensayos de la muestra y sin repetir (regla pura). */
export function erroresDistribucion(filas: { unidadId: string }[], laboratorios: string[]): string[] {
  const e: string[] = [];
  const vistos = new Set<string>();
  filas.forEach((f, i) => {
    if (!laboratorios.includes(f.unidadId)) e.push(`Fila ${i + 1}: el laboratorio no tiene ensayos en esta muestra.`);
    if (vistos.has(f.unidadId)) e.push(`Fila ${i + 1}: el laboratorio está repetido.`);
    vistos.add(f.unidadId);
  });
  return e;
}

@ApiTags("ot")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller()
export class RecepcionDcoController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
  ) {}

  private async ot(req: any, otId: string, permiso?: string) {
    const f = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, codigo, estado, unidad_principal AS "unidadId" FROM orden_trabajo WHERE id = $1::uuid AND tenant_id = $2::uuid`,
      otId,
      req?.user?.tenantId,
    );
    if (!f[0]) throw new NotFoundException("OT no encontrada.");
    await this.alcance.exigirUnidad(req, f[0].unidadId, `la OT ${f[0].codigo}`, permiso);
    return f[0] as { id: string; codigo: string; estado: string; unidadId: string | null };
  }

  private async lista(otId: string) {
    return this.prisma.$queryRawUnsafe<any[]>(
      `SELECT r.id, r.portador_rut AS "portadorRut", r.portador_nombre AS "portadorNombre", r.portador_direccion AS "portadorDireccion",
              r.fecha_recibo AS "fechaRecibo", r.cantidad_items AS "cantidadItems", r.condicion, r.observacion,
              u.nombre_completo AS "recibidoPor", r.entregado_lab_at AS "entregadoLabAt", ue.nombre_completo AS "entregadoLabPor", r.created_at AS "createdAt"
         FROM ot_recepcion_dco r
         LEFT JOIN usuario u ON u.id = r.recibido_por
         LEFT JOIN usuario ue ON ue.id = r.entregado_lab_por
        WHERE r.ot_id = $1::uuid ORDER BY r.fecha_recibo`,
      otId,
    );
  }

  @Get("ot/:id/recepcion-dco")
  @RequierePermiso("ot.ver")
  async ver(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    await this.ot(req, id);
    const permisos: string[] = req?.user?.permisos ?? [];
    return { recepciones: await this.lista(id), puedeRegistrar: (req?.user?.roles ?? []).includes("SUPERADMIN") || permisos.includes("ot.recepcion_dco") };
  }

  @Post("ot/:id/recepcion-dco")
  @RequierePermiso("ot.recepcion_dco")
  @ApiOperation({ summary: "Recepción de ítems del cliente en el DCO: portador, fecha, cantidad y condición" })
  async registrar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const ot = await this.ot(req, id, "ot.recepcion_dco");
    if (["cerrada", "anulada"].includes(ot.estado)) throw new ConflictException(`La OT ${ot.codigo} está ${ot.estado}.`);
    const d = RecepcionSchema.parse(body ?? {});
    const e = erroresRecepcionDco(d);
    if (e.length) throw new BadRequestException(e.join(" "));
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO ot_recepcion_dco (tenant_id, ot_id, portador_rut, portador_nombre, portador_direccion, fecha_recibo, cantidad_items, condicion, observacion, recibido_por)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::timestamptz, $7, $8, $9, $10::uuid)`,
      req?.user?.tenantId,
      id,
      d.portadorRut.toUpperCase(),
      d.portadorNombre,
      d.portadorDireccion ?? null,
      d.fechaRecibo,
      d.cantidadItems,
      d.condicion,
      d.observacion ?? null,
      req?.user?.sub ?? null,
    );
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO ot_historial (tenant_id, ot_id, tipo, detalle, usuario_id) VALUES ($1::uuid, $2::uuid, 'recepcion_dco', $3::jsonb, $4::uuid)`,
      req?.user?.tenantId,
      id,
      JSON.stringify({ cantidadItems: d.cantidadItems, condicion: d.condicion }),
      req?.user?.sub ?? null,
    );
    return this.ver(id, req);
  }

  @Post("ot/:id/recepcion-dco/:rid/entregar")
  @RequierePermiso("ot.recepcion_dco")
  async entregar(@Param("id", ParseUUIDPipe) id: string, @Param("rid", ParseUUIDPipe) rid: string, @Req() req: any) {
    await this.ot(req, id, "ot.recepcion_dco");
    const n = await this.prisma.$executeRawUnsafe(
      `UPDATE ot_recepcion_dco SET entregado_lab_at = now(), entregado_lab_por = $3::uuid
        WHERE id = $1::uuid AND ot_id = $2::uuid AND entregado_lab_at IS NULL`,
      rid,
      id,
      req?.user?.sub ?? null,
    );
    if (!n) throw new ConflictException("La recepción no existe o ya se entregó al laboratorio.");
    return this.ver(id, req);
  }

  /* ----------------------------------------- distribución de la muestra --- */

  private async muestra(req: any, muestraId: string, permiso?: string) {
    const f = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT m.id, m.codigo, m.ot_id AS "otId" FROM muestra m WHERE m.id = $1::uuid AND m.tenant_id = $2::uuid AND m.deleted_at IS NULL`,
      muestraId,
      req?.user?.tenantId,
    );
    if (!f[0]) throw new NotFoundException("Muestra no encontrada.");
    if (f[0].otId) await this.ot(req, f[0].otId, permiso);
    return f[0] as { id: string; codigo: string; otId: string | null };
  }

  /**
   * Laboratorios a los que se puede distribuir la muestra (EP-02 1.3; B-021,
   * recorrido MP-02 D02-36): los que ya tienen ensayos en ella y, antes del
   * análisis, los PREVISTOS: los «otros laboratorios» marcados en su recepción,
   * los que intervienen según el encargo de la OT y los laboratorios de la
   * misma sección que el responsable (LQA, LMB y LES en Alimentos).
   */
  private async laboratorios(muestraId: string) {
    const conEnsayos = await this.laboratoriosConEnsayos(muestraId);
    const previstos = await this.prisma.$queryRawUnsafe<{ unidadId: string; codigo: string; nombre: string; fuente: string }[]>(
      `WITH m AS (SELECT mu.id, mu.otros_labs, o.id AS ot_id, o.unidad_principal
                    FROM muestra mu JOIN orden_trabajo o ON o.id = mu.ot_id WHERE mu.id = $1::uuid),
            cand AS (
              SELECT unnest(COALESCE(m.otros_labs, '{}'::uuid[])) AS id, 'recepcion' AS fuente FROM m
              UNION ALL SELECT unnest(COALESCE(e.laboratorios, '{}'::uuid[])), 'encargo' FROM m JOIN ot_encargo e ON e.ot_id = m.ot_id
              UNION ALL SELECT u.id, 'seccion' FROM m JOIN unidad p ON p.id = m.unidad_principal
                          JOIN unidad u ON u.padre_id = p.padre_id AND u.tipo = 'LABORATORIO' AND u.activa
                         WHERE p.padre_id IS NOT NULL)
       SELECT u.id AS "unidadId", u.codigo, u.nombre, min(c.fuente) AS fuente
         FROM cand c JOIN unidad u ON u.id = c.id
        GROUP BY u.id, u.codigo, u.nombre
        ORDER BY u.codigo`,
      muestraId,
    );
    const ya = new Set(conEnsayos.map((l) => l.unidadId));
    const texto: Record<string, string> = {
      recepcion: "Previsto en la recepción (aún sin ensayos)",
      encargo: "Interviene según la OT (aún sin ensayos)",
      seccion: "Laboratorio de la sección (aún sin ensayos)",
    };
    return [
      ...conEnsayos.map((l) => ({ ...l, previsto: false })),
      ...previstos.filter((p) => !ya.has(p.unidadId)).map((p) => ({ unidadId: p.unidadId, codigo: p.codigo, nombre: p.nombre, ensayos: texto[p.fuente] ?? "Previsto", previsto: true })),
    ];
  }

  /** Laboratorios con ensayos de la muestra (método → ensayo → familia → unidad) y sus ensayos. */
  private async laboratoriosConEnsayos(muestraId: string) {
    return this.prisma.$queryRawUnsafe<{ unidadId: string; codigo: string; nombre: string; ensayos: string }[]>(
      `SELECT u.id AS "unidadId", u.codigo, u.nombre, string_agg(DISTINCT COALESCE(cm.codigo, '') || ' ' || COALESCE(cm.nombre, ''), '; ') AS ensayos
         FROM resultado r
         JOIN cat_metodo cm ON cm.id = r.cat_metodo_id
         JOIN cat_ensayo ce ON ce.id = cm.ensayo_id
         JOIN cat_familia f ON f.id = ce.familia_id
         JOIN unidad u ON u.tenant_id = f.tenant_id
                      AND f.codsucdel = ANY(string_to_array(regexp_replace(COALESCE(u.codsucdel, ''), '[\\s,;]', '/', 'g'), '/'))
        WHERE r.muestra_id = $1::uuid AND r.deleted_at IS NULL
        GROUP BY u.id, u.codigo, u.nombre
        ORDER BY u.codigo`,
      muestraId,
    );
  }

  @Get("muestras/:id/distribucion")
  @RequierePermiso("muestra.ver")
  async distribucion(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    const m = await this.muestra(req, id);
    const [labs, filas] = await Promise.all([
      this.laboratorios(id),
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT d.unidad_id AS "unidadId", u.codigo, d.porcion, d.fecha_hora AS "fechaHora", d.recibido_por AS "recibidoPor",
                ur.nombre_completo AS "registradoPor", d.created_at AS "createdAt"
           FROM muestra_distribucion d JOIN unidad u ON u.id = d.unidad_id LEFT JOIN usuario ur ON ur.id = d.registrado_por
          WHERE d.muestra_id = $1::uuid ORDER BY u.codigo`,
        id,
      ),
    ]);
    const permisos: string[] = req?.user?.permisos ?? [];
    return { muestra: m, laboratorios: labs, distribucion: filas, puedeDistribuir: (req?.user?.roles ?? []).includes("SUPERADMIN") || permisos.includes("muestra.transferir") };
  }

  @Put("muestras/:id/distribucion")
  @RequierePermiso("muestra.transferir")
  @ApiOperation({ summary: "Porción, fecha y hora y quién recibe en cada laboratorio de destino (EP-02 1.3)" })
  async distribuir(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    await this.muestra(req, id, "muestra.transferir");
    const d = DistribucionSchema.parse(body ?? {});
    const labs = await this.laboratorios(id);
    const e = erroresDistribucion(d.filas, labs.map((l) => l.unidadId));
    if (e.length) throw new BadRequestException(e.join(" "));
    const porLab = new Map(labs.filter((l) => !l.previsto).map((l) => [l.unidadId, l.ensayos]));
    await this.prisma.$transaction(async (tx) => {
      for (const f of d.filas)
        await tx.$executeRawUnsafe(
          `INSERT INTO muestra_distribucion (tenant_id, muestra_id, unidad_id, porcion, fecha_hora, recibido_por, ensayos, registrado_por)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::timestamptz, $6, $7, $8::uuid)
           ON CONFLICT (muestra_id, unidad_id) DO UPDATE SET porcion = EXCLUDED.porcion, fecha_hora = EXCLUDED.fecha_hora,
             recibido_por = EXCLUDED.recibido_por, ensayos = EXCLUDED.ensayos, registrado_por = EXCLUDED.registrado_por`,
          req?.user?.tenantId,
          id,
          f.unidadId,
          f.porcion,
          f.fechaHora,
          f.recibidoPor,
          porLab.get(f.unidadId) ?? null,
          req?.user?.sub ?? null,
        );
    });
    return this.distribucion(id, req);
  }
}
