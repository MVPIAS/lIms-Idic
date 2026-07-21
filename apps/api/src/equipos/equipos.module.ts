import {
  Body,
  ConflictException,
  Controller,
  Delete,
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
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { z } from "zod";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermisoCrud } from "../auth/permisos.decorator";

// ---------------------------------------------------------------------------
// Módulo EQUIPOS · calibración y cadena de custodia de muestras.
//
// Cubre dos requisitos NCh-ISO/IEC 17025 marcados [MVP] en el SRS y reportados
// como CRÍTICOS-ausentes en docs/AUDITORIA_FUNCIONAL.md (§5.6 y §5.7):
//
//   RF-D04 · Equipos y condiciones
//     D04.1 registrar el equipo usado en cada resultado
//     D04.2 BLOQUEAR el registro si la calibración está vencida  <-- núcleo del RF
//     D04.3 condiciones ambientales (T°, HR)
//   RF-C02 · Cadena de custodia
//     C02.1 quién / cuándo / dónde · C02.2 transferencias · C02.3 disposición final
//
// Las tablas (`equipo`, `calibracion`, `muestra_custodia`) las crea
// `packages/db/equipos_custodia.sql` y NO están en el schema de Prisma, así que
// —igual que crm.module.ts— este módulo usa SQL crudo tipado sobre un
// PrismaClient propio, con el mismo aislamiento por tenant (req.user.tenantId),
// 404 cross-tenant, soft-delete y respuestas { data, meta }.
// ---------------------------------------------------------------------------

/* ========================================================================== */
/* Vocabularios y esquemas                                                     */
/* ========================================================================== */

/** Estados de equipo. Solo `operativo` puede ejecutar ensayos (RF-D04.2). */
const ESTADOS_EQUIPO = ["operativo", "en_calibracion", "fuera_servicio"] as const;

/** Resultados de calibración. `no_conforme` NO renueva la vigencia del equipo. */
const RESULTADOS_CALIBRACION = ["conforme", "conforme_con_obs", "no_conforme"] as const;

/** Un resultado que acredita la calibración (renueva la vigencia del equipo). */
const RESULTADOS_QUE_ACREDITAN: readonly string[] = ["conforme", "conforme_con_obs"];

/**
 * Eventos de la cadena de custodia (RF-C02).
 * `devolucion` y `destruccion` son la disposición final (RF-C02.3).
 */
const EVENTOS_CUSTODIA = [
  "recepcion",
  "traslado",
  "preparacion",
  "analisis",
  "almacenamiento",
  "transferencia",
  "devolucion",
  "destruccion",
] as const;

const emptyToNull = (v: unknown) => (v === "" ? null : v);

/**
 * Normaliza a `YYYY-MM-DD`.
 *
 * Las columnas DATE vuelven de Prisma como `Date` (medianoche UTC), y
 * `String(date)` las rinde en HORA LOCAL: en Chile (UTC-4) `2026-06-10` se
 * imprimiría como "Tue Jun 09 2026…", así que un `.slice(0,10)` daría
 * "Tue Jun 09" y, de paso, un día de menos. `toISOString()` evita ambos fallos.
 */
const soloFecha = (v: unknown): string | null => {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};
const optStr = (max: number) => z.preprocess(emptyToNull, z.string().max(max).nullable().optional());
const optDate = () => z.preprocess(emptyToNull, z.string().nullable().optional());

const CrearEquipoSchema = z.object({
  codigo: z.string().min(1).max(40),
  nombre: z.string().min(1).max(200),
  descripcion: optStr(2000),
  fabricante: optStr(120), // "marca"
  modelo: optStr(120),
  serie: optStr(120),
  ubicacion: optStr(120),
  unidadId: z.preprocess(emptyToNull, z.string().uuid().nullable().optional()),
  estado: z.enum(ESTADOS_EQUIPO).optional(),
  fechaUltimaCalibracion: optDate(),
  proximaCalibracion: optDate(),
  responsableId: z.preprocess(emptyToNull, z.string().uuid().nullable().optional()),
});
const ActualizarEquipoSchema = CrearEquipoSchema.partial();

const CrearCalibracionSchema = z.object({
  equipoId: z.string().uuid(),
  fecha: z.string().min(4),
  ejecutadaPor: optStr(200), // proveedor / laboratorio
  normaCalibracion: optStr(120),
  certificadoRef: optStr(120),
  resultado: z.enum(RESULTADOS_CALIBRACION),
  proximaFecha: optDate(), // vigencia hasta
  observaciones: optStr(4000),
});
const ActualizarCalibracionSchema = CrearCalibracionSchema.partial().omit({ equipoId: true });

const CrearCustodiaSchema = z.object({
  muestraId: z.string().uuid(),
  evento: z.enum(EVENTOS_CUSTODIA).optional(),
  deUsuarioId: z.preprocess(emptyToNull, z.string().uuid().nullable().optional()),
  aUsuarioId: z.preprocess(emptyToNull, z.string().uuid().nullable().optional()),
  fecha: optDate(),
  motivo: optStr(4000),
  ubicacionOrigen: optStr(120),
  ubicacionDestino: optStr(120),
  tempCelsius: z.preprocess(emptyToNull, z.coerce.number().nullable().optional()),
  humedadPct: z.preprocess(emptyToNull, z.coerce.number().min(0).max(100).nullable().optional()),
  selloNumero: optStr(40),
  selloIntegro: z.preprocess(emptyToNull, z.coerce.boolean().nullable().optional()),
  observaciones: optStr(4000),
});

/** Mapa campo JSON (camelCase) → columna (snake_case) para el PATCH dinámico. */
const COLS_EQUIPO: Record<string, string> = {
  codigo: "codigo",
  nombre: "nombre",
  descripcion: "descripcion",
  fabricante: "fabricante",
  modelo: "modelo",
  serie: "serie",
  ubicacion: "ubicacion",
  unidadId: "unidad_id",
  estado: "estado",
  fechaUltimaCalibracion: "fecha_ultima_calibracion",
  proximaCalibracion: "proxima_calibracion",
  responsableId: "responsable_id",
};
const CAST_EQUIPO: Record<string, string> = {
  unidad_id: "::uuid",
  responsable_id: "::uuid",
  fecha_ultima_calibracion: "::date",
  proxima_calibracion: "::date",
};

const COLS_CALIBRACION: Record<string, string> = {
  fecha: "fecha",
  ejecutadaPor: "ejecutada_por",
  normaCalibracion: "norma_calibracion",
  certificadoRef: "certificado_ref",
  resultado: "resultado",
  proximaFecha: "proxima_fecha",
  observaciones: "observaciones",
};
const CAST_CALIBRACION: Record<string, string> = { fecha: "::date", proxima_fecha: "::date" };

/* ========================================================================== */
/* Tipos públicos                                                              */
/* ========================================================================== */

/** Motivo normalizado por el que un equipo no es apto. `null` => es apto. */
export type MotivoNoApto =
  | "calibracion_vencida"
  | "sin_calibracion"
  | "equipo_en_calibracion"
  | "equipo_fuera_servicio"
  | "equipo_no_operativo";

/** Veredicto de aptitud de un equipo (RF-D04.2). */
export interface EquipoAptoResult {
  apto: boolean;
  /** Texto legible para la UI/API. `null` cuando el equipo es apto. */
  motivo: string | null;
  /** Código estable para lógica de negocio. `null` cuando el equipo es apto. */
  codigoMotivo: MotivoNoApto | null;
  equipoId: string;
  codigo: string;
  nombre: string;
  estado: string;
  proximaCalibracion: string | null;
  /** Días hasta el vencimiento. Negativo => vencida hace N días. */
  diasParaVencer: number | null;
}

/* ========================================================================== */
/* EquiposService                                                              */
/* ========================================================================== */

@Injectable()
export class EquiposService {
  private prisma = new PrismaClient();

  /* --- helpers ----------------------------------------------------------- */

  /** Resuelve el tenant del JWT. Sin tenant no se sirve nada. */
  tenantId(req: any): string {
    const id = req?.user?.tenantId;
    if (!id) throw new NotFoundException("Tenant no resuelto en el token");
    return id;
  }

  private usuarioId(req: any): string | null {
    return req?.user?.sub ?? req?.user?.id ?? req?.user?.usuarioId ?? null;
  }

  /** Carga un equipo del tenant. 404 si no existe, está borrado, o es de otro tenant. */
  async cargarEquipo(id: string, tenantId: string): Promise<any> {
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT e.*,
              to_jsonb(u.*)  AS unidad,
              to_jsonb(r.*)  AS responsable,
              (e.estado = 'operativo'
               AND e.proxima_calibracion IS NOT NULL
               AND e.proxima_calibracion >= CURRENT_DATE) AS apto,
              (e.proxima_calibracion IS NOT NULL
               AND e.proxima_calibracion < CURRENT_DATE)  AS calibracion_vencida,
              (e.proxima_calibracion - CURRENT_DATE)      AS dias_para_vencer
         FROM equipo e
         LEFT JOIN unidad  u ON u.id = e.unidad_id
         LEFT JOIN usuario r ON r.id = e.responsable_id
        WHERE e.id = $1::uuid AND e.tenant_id = $2::uuid AND e.deleted_at IS NULL
        LIMIT 1`,
      id,
      tenantId,
    );
    if (!rows.length) throw new NotFoundException("Equipo no encontrado");
    return rows[0];
  }

  /* --- RF-D04.2 · aptitud del equipo -------------------------------------- */

  /**
   * Evalúa la aptitud de un equipo SIN lanzar excepción.
   * Úsalo para pintar la UI o responder `GET /equipos/:id/apto`.
   *
   * Un equipo es apto <=> está `operativo` Y tiene una calibración vigente
   * (`proxima_calibracion >= CURRENT_DATE`).
   *
   * @throws NotFoundException si el equipo no existe o es de otro tenant.
   */
  async evaluarApto(equipoId: string, tenantId: string): Promise<EquipoAptoResult> {
    const e = await this.cargarEquipo(equipoId, tenantId);

    const base = {
      equipoId: e.id,
      codigo: e.codigo,
      nombre: e.nombre,
      estado: e.estado,
      proximaCalibracion: soloFecha(e.proxima_calibracion),
      diasParaVencer: e.dias_para_vencer != null ? Number(e.dias_para_vencer) : null,
    };

    const noApto = (codigoMotivo: MotivoNoApto, motivo: string): EquipoAptoResult => ({
      apto: false,
      motivo,
      codigoMotivo,
      ...base,
    });

    // 1. El estado manda: un equipo en calibración o fuera de servicio no ensaya.
    if (e.estado !== "operativo") {
      const porEstado: Record<string, [MotivoNoApto, string]> = {
        en_calibracion: [
          "equipo_en_calibracion",
          `El equipo ${e.codigo} está en calibración y no puede utilizarse para ensayos.`,
        ],
        fuera_servicio: [
          "equipo_fuera_servicio",
          `El equipo ${e.codigo} está fuera de servicio y no puede utilizarse para ensayos.`,
        ],
      };
      const [codigoMotivo, motivo] = porEstado[e.estado] ?? [
        "equipo_no_operativo",
        `El equipo ${e.codigo} no está operativo (estado: ${e.estado}).`,
      ];
      return noApto(codigoMotivo, motivo);
    }

    // 2. Sin fecha de vigencia no hay calibración acreditada => no apto (falla cerrado).
    if (!e.proxima_calibracion) {
      return noApto(
        "sin_calibracion",
        `El equipo ${e.codigo} no tiene una calibración registrada y no puede utilizarse para ensayos.`,
      );
    }

    // 3. Calibración vencida => bloqueo (RF-D04.2).
    if (e.calibracion_vencida) {
      const dias = Math.abs(Number(e.dias_para_vencer ?? 0));
      return noApto(
        "calibracion_vencida",
        `Calibración vencida: el equipo ${e.codigo} tiene la calibración caducada desde el ` +
          `${base.proximaCalibracion} (hace ${dias} día${dias === 1 ? "" : "s"}). ` +
          `No puede registrarse un resultado con este equipo hasta recalibrarlo.`,
      );
    }

    return { apto: true, motivo: null, codigoMotivo: null, ...base };
  }

  /**
   * Verifica que un equipo sea APTO para ensayar y BLOQUEA si no lo es (RF-D04.2).
   *
   * Este es el punto de integración para `laboratorio.module.ts`: llámalo desde
   * `ResultadoService.capturar()` antes de persistir el resultado, pasándole el
   * `equipoId` informado por el analista.
   *
   *   await this.equipos.verificarApto(dto.equipoId, tenantId);
   *
   * @param equipoId  UUID del equipo con el que se pretende ensayar.
   * @param tenantId  Tenant del solicitante (req.user.tenantId).
   * @returns         El veredicto (siempre `apto: true`) si el equipo es apto.
   * @throws NotFoundException  si el equipo no existe o pertenece a otro tenant.
   * @throws ConflictException  (HTTP 409) si la calibración está vencida/ausente
   *                            o el equipo no está operativo. `response.motivo`
   *                            y `response.codigoMotivo` explican el bloqueo.
   */
  async verificarApto(equipoId: string, tenantId: string): Promise<EquipoAptoResult> {
    const veredicto = await this.evaluarApto(equipoId, tenantId);
    if (!veredicto.apto) {
      throw new ConflictException({
        statusCode: 409,
        error: "Equipo no apto",
        message: veredicto.motivo,
        codigoMotivo: veredicto.codigoMotivo,
        equipoId: veredicto.equipoId,
        codigo: veredicto.codigo,
        proximaCalibracion: veredicto.proximaCalibracion,
      });
    }
    return veredicto;
  }

  /* --- equipos ----------------------------------------------------------- */

  async listarEquipos(
    tenantId: string,
    opts: { page: number; limit: number; estado?: string; soloVencidos?: boolean; search?: string },
  ) {
    const { page, limit, estado, soloVencidos, search } = opts;
    const offset = (page - 1) * limit;

    const filtros: string[] = [];
    const args: any[] = [tenantId];
    if (estado) {
      args.push(estado);
      filtros.push(`AND e.estado = $${args.length}`);
    }
    if (soloVencidos) {
      filtros.push(`AND e.proxima_calibracion IS NOT NULL AND e.proxima_calibracion < CURRENT_DATE`);
    }
    if (search) {
      args.push(`%${search}%`);
      filtros.push(
        `AND (e.codigo ILIKE $${args.length} OR e.nombre ILIKE $${args.length} OR e.serie ILIKE $${args.length})`,
      );
    }
    const where = filtros.join(" ");

    const data = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT e.*,
              to_jsonb(u.*) AS unidad,
              to_jsonb(r.*) AS responsable,
              (e.estado = 'operativo'
               AND e.proxima_calibracion IS NOT NULL
               AND e.proxima_calibracion >= CURRENT_DATE) AS apto,
              (e.proxima_calibracion IS NOT NULL
               AND e.proxima_calibracion < CURRENT_DATE)  AS calibracion_vencida,
              (e.proxima_calibracion - CURRENT_DATE)      AS dias_para_vencer
         FROM equipo e
         LEFT JOIN unidad  u ON u.id = e.unidad_id
         LEFT JOIN usuario r ON r.id = e.responsable_id
        WHERE e.tenant_id = $1::uuid AND e.deleted_at IS NULL ${where}
        ORDER BY e.codigo ASC
        LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,
      ...args,
    );

    const totalRows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::int AS total
         FROM equipo e
        WHERE e.tenant_id = $1::uuid AND e.deleted_at IS NULL ${where}`,
      ...args,
    );

    // KPIs de la cabecera: se calculan sobre TODO el parque, no sobre la página.
    const kpiRows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE estado = 'operativo')::int AS operativos,
              COUNT(*) FILTER (WHERE proxima_calibracion IS NOT NULL
                                 AND proxima_calibracion < CURRENT_DATE)::int AS vencidos,
              COUNT(*) FILTER (WHERE proxima_calibracion IS NOT NULL
                                 AND proxima_calibracion >= CURRENT_DATE
                                 AND proxima_calibracion < CURRENT_DATE + 30)::int AS por_vencer,
              COUNT(*) FILTER (WHERE estado = 'operativo'
                                 AND proxima_calibracion IS NOT NULL
                                 AND proxima_calibracion >= CURRENT_DATE)::int AS aptos
         FROM equipo
        WHERE tenant_id = $1::uuid AND deleted_at IS NULL`,
      tenantId,
    );

    const total = Number(totalRows[0]?.total ?? 0);
    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        kpis: kpiRows[0] ?? {},
      },
    };
  }

  async crearEquipo(tenantId: string, d: z.infer<typeof CrearEquipoSchema>) {
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `INSERT INTO equipo
         (tenant_id, codigo, nombre, descripcion, fabricante, modelo, serie, ubicacion,
          unidad_id, estado, fecha_ultima_calibracion, proxima_calibracion, responsable_id)
       VALUES
         ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::uuid, $10, $11::date, $12::date, $13::uuid)
       RETURNING *`,
      tenantId,
      d.codigo,
      d.nombre,
      d.descripcion ?? null,
      d.fabricante ?? null,
      d.modelo ?? null,
      d.serie ?? null,
      d.ubicacion ?? null,
      d.unidadId ?? null,
      d.estado ?? "operativo",
      d.fechaUltimaCalibracion ?? null,
      d.proximaCalibracion ?? null,
      d.responsableId ?? null,
    );
    return rows[0];
  }

  async actualizarEquipo(id: string, tenantId: string, d: Record<string, unknown>) {
    await this.cargarEquipo(id, tenantId); // valida pertenencia (404 cross-tenant)

    const sets: string[] = [];
    const args: any[] = [id, tenantId];
    for (const [key, col] of Object.entries(COLS_EQUIPO)) {
      if (key in d) {
        args.push(d[key] ?? null);
        sets.push(`${col} = $${args.length}${CAST_EQUIPO[col] ?? ""}`);
      }
    }
    if (!sets.length) return this.cargarEquipo(id, tenantId);
    sets.push("updated_at = now()");

    await this.prisma.$executeRawUnsafe(
      `UPDATE equipo SET ${sets.join(", ")}
        WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL`,
      ...args,
    );
    return this.cargarEquipo(id, tenantId);
  }

  async eliminarEquipo(id: string, tenantId: string) {
    await this.cargarEquipo(id, tenantId);
    await this.prisma.$executeRawUnsafe(
      `UPDATE equipo SET deleted_at = now(), updated_at = now()
        WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL`,
      id,
      tenantId,
    );
    return { ok: true };
  }

  /* --- calibraciones ------------------------------------------------------ */

  async cargarCalibracion(id: string, tenantId: string): Promise<any> {
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT c.*, to_jsonb(e.*) AS equipo
         FROM calibracion c
         JOIN equipo e ON e.id = c.equipo_id
        WHERE c.id = $1::uuid AND c.tenant_id = $2::uuid AND c.deleted_at IS NULL
        LIMIT 1`,
      id,
      tenantId,
    );
    if (!rows.length) throw new NotFoundException("Calibración no encontrada");
    return rows[0];
  }

  /** Historial de calibraciones de un equipo, de la más reciente a la más antigua. */
  async calibracionesDeEquipo(equipoId: string, tenantId: string) {
    await this.cargarEquipo(equipoId, tenantId); // 404 si el equipo no es del tenant
    const data = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT c.*, to_jsonb(u.*) AS registrada_por_usuario
         FROM calibracion c
         LEFT JOIN usuario u ON u.id = c.registrada_por
        WHERE c.equipo_id = $1::uuid AND c.tenant_id = $2::uuid AND c.deleted_at IS NULL
        ORDER BY c.fecha DESC, c.created_at DESC`,
      equipoId,
      tenantId,
    );
    return { data, meta: { total: data.length } };
  }

  async listarCalibraciones(
    tenantId: string,
    opts: { page: number; limit: number; equipoId?: string },
  ) {
    const { page, limit, equipoId } = opts;
    const offset = (page - 1) * limit;

    const args: any[] = [tenantId];
    let filtro = "";
    if (equipoId) {
      args.push(equipoId);
      filtro = ` AND c.equipo_id = $${args.length}::uuid`;
    }

    const data = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT c.*, to_jsonb(e.*) AS equipo
         FROM calibracion c
         JOIN equipo e ON e.id = c.equipo_id
        WHERE c.tenant_id = $1::uuid AND c.deleted_at IS NULL${filtro}
        ORDER BY c.fecha DESC, c.created_at DESC
        LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,
      ...args,
    );
    const totalRows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::int AS total
         FROM calibracion c
        WHERE c.tenant_id = $1::uuid AND c.deleted_at IS NULL${filtro}`,
      ...args,
    );
    const total = Number(totalRows[0]?.total ?? 0);
    return { data, meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
  }

  /**
   * Registra una calibración. Si acredita el equipo (`conforme` /
   * `conforme_con_obs`) sincroniza la vigencia en `equipo`:
   * `fecha_ultima_calibracion` y `proxima_calibracion`.
   *
   * Solo se sincroniza si esta calibración es la MÁS RECIENTE del equipo; así,
   * cargar a posteriori un certificado antiguo no revive ni caduca la vigencia
   * vigente por accidente.
   */
  async crearCalibracion(
    tenantId: string,
    usuarioId: string | null,
    d: z.infer<typeof CrearCalibracionSchema>,
  ) {
    await this.cargarEquipo(d.equipoId, tenantId); // 404 cross-tenant

    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRawUnsafe<any[]>(
        `INSERT INTO calibracion
           (tenant_id, equipo_id, fecha, ejecutada_por, norma_calibracion,
            certificado_ref, resultado, proxima_fecha, observaciones, registrada_por)
         VALUES
           ($1::uuid, $2::uuid, $3::date, $4, $5, $6, $7, $8::date, $9, $10::uuid)
         RETURNING *`,
        tenantId,
        d.equipoId,
        d.fecha,
        d.ejecutadaPor ?? null,
        d.normaCalibracion ?? null,
        d.certificadoRef ?? null,
        d.resultado,
        d.proximaFecha ?? null,
        d.observaciones ?? null,
        usuarioId,
      );
      const cal = rows[0];

      if (RESULTADOS_QUE_ACREDITAN.includes(d.resultado)) {
        await tx.$executeRawUnsafe(
          `UPDATE equipo
              SET fecha_ultima_calibracion = $3::date,
                  proxima_calibracion      = COALESCE($4::date, proxima_calibracion),
                  updated_at               = now()
            WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL
              AND (fecha_ultima_calibracion IS NULL OR fecha_ultima_calibracion <= $3::date)`,
          d.equipoId,
          tenantId,
          d.fecha,
          d.proximaFecha ?? null,
        );
      }
      return cal;
    });
  }

  async actualizarCalibracion(id: string, tenantId: string, d: Record<string, unknown>) {
    await this.cargarCalibracion(id, tenantId);

    const sets: string[] = [];
    const args: any[] = [id, tenantId];
    for (const [key, col] of Object.entries(COLS_CALIBRACION)) {
      if (key in d) {
        args.push(d[key] ?? null);
        sets.push(`${col} = $${args.length}${CAST_CALIBRACION[col] ?? ""}`);
      }
    }
    if (!sets.length) return this.cargarCalibracion(id, tenantId);

    await this.prisma.$executeRawUnsafe(
      `UPDATE calibracion SET ${sets.join(", ")}
        WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL`,
      ...args,
    );
    return this.cargarCalibracion(id, tenantId);
  }

  async eliminarCalibracion(id: string, tenantId: string) {
    await this.cargarCalibracion(id, tenantId);
    await this.prisma.$executeRawUnsafe(
      `UPDATE calibracion SET deleted_at = now()
        WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL`,
      id,
      tenantId,
    );
    return { ok: true };
  }

  /* --- cadena de custodia (RF-C02) ---------------------------------------- */

  /** Hash del eslabón: sha256(hash_prev || payload canónico). */
  private hashEslabon(hashPrev: string | null, payload: Record<string, unknown>): string {
    const canonico = JSON.stringify(payload, Object.keys(payload).sort());
    return createHash("sha256")
      .update(`${hashPrev ?? "GENESIS"}|${canonico}`)
      .digest("hex");
  }

  /**
   * Registra un traspaso en la cadena de custodia de una muestra (RF-C02.2).
   *
   * La cadena es append-only y encadenada por hash: cada registro incorpora el
   * hash del anterior de la MISMA muestra, de modo que alterar un eslabón
   * invalida todos los posteriores (evidencia de manipulación exigible en 17025).
   *
   * El `SELECT ... FOR UPDATE` sobre la muestra serializa los traspasos
   * concurrentes de esa muestra; sin él, dos peticiones simultáneas leerían el
   * mismo `hash_prev` y bifurcarían la cadena.
   */
  async crearCustodia(
    tenantId: string,
    usuarioId: string | null,
    d: z.infer<typeof CrearCustodiaSchema>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // La muestra debe ser del tenant (404 cross-tenant) y queda bloqueada.
      const muestras = await tx.$queryRawUnsafe<any[]>(
        `SELECT id, codigo, ubicacion FROM muestra
          WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL
          FOR UPDATE`,
        d.muestraId,
        tenantId,
      );
      if (!muestras.length) throw new NotFoundException("Muestra no encontrada");

      const prev = await tx.$queryRawUnsafe<any[]>(
        `SELECT hash_registro FROM muestra_custodia
          WHERE muestra_id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL
          ORDER BY fecha DESC, created_at DESC
          LIMIT 1`,
        d.muestraId,
        tenantId,
      );
      const hashPrev: string | null = prev[0]?.hash_registro ?? null;

      const evento = d.evento ?? "transferencia";
      const fecha = d.fecha ?? new Date().toISOString();
      const hash = this.hashEslabon(hashPrev, {
        muestraId: d.muestraId,
        evento,
        deUsuarioId: d.deUsuarioId ?? null,
        aUsuarioId: d.aUsuarioId ?? null,
        fecha,
        motivo: d.motivo ?? null,
        ubicacionOrigen: d.ubicacionOrigen ?? null,
        ubicacionDestino: d.ubicacionDestino ?? null,
        registradoPor: usuarioId,
      });

      const rows = await tx.$queryRawUnsafe<any[]>(
        `INSERT INTO muestra_custodia
           (tenant_id, muestra_id, evento, de_usuario_id, a_usuario_id, fecha, motivo,
            ubicacion_origen, ubicacion_destino, temp_celsius, humedad_pct,
            sello_numero, sello_integro, observaciones, registrado_por, hash_prev, hash_registro)
         VALUES
           ($1::uuid, $2::uuid, $3, $4::uuid, $5::uuid, $6::timestamptz, $7,
            $8, $9, $10, $11, $12, $13, $14, $15::uuid, $16, $17)
         RETURNING *`,
        tenantId,
        d.muestraId,
        evento,
        d.deUsuarioId ?? null,
        d.aUsuarioId ?? null,
        fecha,
        d.motivo ?? null,
        d.ubicacionOrigen ?? null,
        d.ubicacionDestino ?? null,
        d.tempCelsius ?? null,
        d.humedadPct ?? null,
        d.selloNumero ?? null,
        d.selloIntegro ?? null,
        d.observaciones ?? null,
        usuarioId,
        hashPrev,
        hash,
      );

      // La ubicación de destino pasa a ser la ubicación actual de la muestra.
      if (d.ubicacionDestino) {
        await tx.$executeRawUnsafe(
          `UPDATE muestra SET ubicacion = $3
            WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL`,
          d.muestraId,
          tenantId,
          d.ubicacionDestino,
        );
      }

      return rows[0];
    });
  }

  /** Trazabilidad completa de una muestra, en orden cronológico (RF-C02.1). */
  async custodiaDeMuestra(muestraId: string, tenantId: string) {
    const muestras = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, codigo, nombre, estado, ubicacion FROM muestra
        WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL`,
      muestraId,
      tenantId,
    );
    if (!muestras.length) throw new NotFoundException("Muestra no encontrada");

    const data = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT c.*,
              to_jsonb(du.*) AS de_usuario,
              to_jsonb(au.*) AS a_usuario,
              to_jsonb(ru.*) AS registrado_por_usuario
         FROM muestra_custodia c
         LEFT JOIN usuario du ON du.id = c.de_usuario_id
         LEFT JOIN usuario au ON au.id = c.a_usuario_id
         LEFT JOIN usuario ru ON ru.id = c.registrado_por
        WHERE c.muestra_id = $1::uuid AND c.tenant_id = $2::uuid AND c.deleted_at IS NULL
        ORDER BY c.fecha ASC, c.created_at ASC`,
      muestraId,
      tenantId,
    );
    return { data, meta: { total: data.length, muestra: muestras[0] } };
  }

  /**
   * Unidades del tenant (sólo id/código/nombre) para poblar el selector del
   * alta de equipos. No existe un `GET /unidades` en la API, así que el módulo
   * sirve su propio catálogo mínimo en vez de dejar el campo muerto. Si algún
   * día CatalogoModule expone `/unidades`, este endpoint puede retirarse.
   */
  async listarUnidades(tenantId: string) {
    const data = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, codigo, nombre FROM unidad
        WHERE tenant_id = $1::uuid AND activa = TRUE
        ORDER BY codigo ASC`,
      tenantId,
    );
    return { data, meta: { total: data.length } };
  }

  async listarCustodia(tenantId: string, opts: { page: number; limit: number }) {
    const { page, limit } = opts;
    const offset = (page - 1) * limit;

    const data = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT c.*,
              to_jsonb(m.*)  AS muestra,
              to_jsonb(du.*) AS de_usuario,
              to_jsonb(au.*) AS a_usuario
         FROM muestra_custodia c
         JOIN muestra m ON m.id = c.muestra_id
         LEFT JOIN usuario du ON du.id = c.de_usuario_id
         LEFT JOIN usuario au ON au.id = c.a_usuario_id
        WHERE c.tenant_id = $1::uuid AND c.deleted_at IS NULL
        ORDER BY c.fecha DESC, c.created_at DESC
        LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,
      tenantId,
    );
    const totalRows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::int AS total FROM muestra_custodia
        WHERE tenant_id = $1::uuid AND deleted_at IS NULL`,
      tenantId,
    );
    const total = Number(totalRows[0]?.total ?? 0);
    return { data, meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
  }
}

/* ========================================================================== */
/* Controllers                                                                 */
/* ========================================================================== */

const pag = (page: string, limit: string, max = 200, def = 100) => ({
  page: Math.max(1, parseInt(page) || 1),
  limit: Math.min(max, Math.max(1, parseInt(limit) || def)),
});

@ApiTags("equipos")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@RequierePermisoCrud({
  ver: "equipo.ver",
  crear: "equipo.gestionar",
  editar: "equipo.gestionar",
  eliminar: "equipo.gestionar",
})
@Controller("equipos")
export class EquipoController {
  constructor(private readonly svc: EquiposService) {}

  @Get()
  async listar(
    @Query("page") page = "1",
    @Query("limit") limit = "100",
    @Query("estado") estado: string | undefined,
    @Query("vencidos") vencidos: string | undefined,
    @Query("search") search: string | undefined,
    @Req() req: any,
  ) {
    return this.svc.listarEquipos(this.svc.tenantId(req), {
      ...pag(page, limit),
      estado,
      soloVencidos: vencidos === "1" || vencidos === "true",
      search: search || undefined,
    });
  }

  /**
   * Catálogo de unidades para el selector del alta de equipos.
   * DEBE declararse antes de `@Get(":id")`: Nest resuelve las rutas en orden y
   * "catalogo/unidades" no debe caer en el comodín del detalle.
   */
  @Get("catalogo/unidades")
  async unidades(@Req() req: any) {
    return this.svc.listarUnidades(this.svc.tenantId(req));
  }

  @Get(":id")
  async detalle(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.cargarEquipo(id, this.svc.tenantId(req));
  }

  /**
   * RF-D04.2 · ¿Puede este equipo usarse para ensayar?
   * Consulta NO bloqueante: responde 200 con `{ apto:false, motivo }` en vez de
   * lanzar 409, para que la UI pueda avisar antes de que el analista capture.
   */
  @Get(":id/apto")
  async apto(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.evaluarApto(id, this.svc.tenantId(req));
  }

  @Get(":id/calibraciones")
  async calibraciones(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.calibracionesDeEquipo(id, this.svc.tenantId(req));
  }

  @Post()
  async crear(@Body() body: unknown, @Req() req: any) {
    return this.svc.crearEquipo(this.svc.tenantId(req), CrearEquipoSchema.parse(body));
  }

  @Patch(":id")
  async actualizar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const d = ActualizarEquipoSchema.parse(body) as Record<string, unknown>;
    return this.svc.actualizarEquipo(id, this.svc.tenantId(req), d);
  }

  @Delete(":id")
  async eliminar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.eliminarEquipo(id, this.svc.tenantId(req));
  }
}

@ApiTags("calibraciones")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@RequierePermisoCrud({
  ver: "equipo.ver",
  crear: "equipo.gestionar",
  editar: "equipo.gestionar",
  eliminar: "equipo.gestionar",
})
@Controller("calibraciones")
export class CalibracionController {
  constructor(private readonly svc: EquiposService) {}

  @Get()
  async listar(
    @Query("page") page = "1",
    @Query("limit") limit = "100",
    @Query("equipoId") equipoId: string | undefined,
    @Req() req: any,
  ) {
    return this.svc.listarCalibraciones(this.svc.tenantId(req), {
      ...pag(page, limit),
      equipoId: equipoId || undefined,
    });
  }

  @Get(":id")
  async detalle(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.cargarCalibracion(id, this.svc.tenantId(req));
  }

  @Post()
  async crear(@Body() body: unknown, @Req() req: any) {
    const d = CrearCalibracionSchema.parse(body);
    return this.svc.crearCalibracion(
      this.svc.tenantId(req),
      req?.user?.sub ?? req?.user?.id ?? null,
      d,
    );
  }

  @Patch(":id")
  async actualizar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const d = ActualizarCalibracionSchema.parse(body) as Record<string, unknown>;
    return this.svc.actualizarCalibracion(id, this.svc.tenantId(req), d);
  }

  @Delete(":id")
  async eliminar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.eliminarCalibracion(id, this.svc.tenantId(req));
  }
}

/**
 * RF-C02 · Cadena de custodia de MUESTRAS.
 * Append-only por diseño: no se exponen PATCH ni DELETE. Un traspaso erróneo se
 * corrige con un traspaso compensatorio, nunca borrando el historial.
 */
@ApiTags("custodia")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@RequierePermisoCrud({
  ver: "muestra.ver",
  crear: "muestra.transferir",
})
@Controller("custodia")
export class CustodiaController {
  constructor(private readonly svc: EquiposService) {}

  @Get()
  async listar(
    @Query("muestraId") muestraId: string | undefined,
    @Query("page") page = "1",
    @Query("limit") limit = "100",
    @Req() req: any,
  ) {
    const tenantId = this.svc.tenantId(req);
    // Con ?muestraId= devuelve la trazabilidad cronológica completa de esa
    // muestra (sin paginar: la cadena se lee entera o no se lee).
    if (muestraId) return this.svc.custodiaDeMuestra(muestraId, tenantId);
    return this.svc.listarCustodia(tenantId, pag(page, limit));
  }

  @Post()
  async crear(@Body() body: unknown, @Req() req: any) {
    const d = CrearCustodiaSchema.parse(body);
    return this.svc.crearCustodia(
      this.svc.tenantId(req),
      req?.user?.sub ?? req?.user?.id ?? null,
      d,
    );
  }
}

/* ========================================================================== */

@Module({
  controllers: [EquipoController, CalibracionController, CustodiaController],
  providers: [EquiposService],
  // Exportado para que LaboratorioModule pueda inyectar EquiposService y llamar
  // a verificarApto() desde ResultadoService.capturar() (RF-D04.2).
  exports: [EquiposService],
})
export class EquiposModule {}
