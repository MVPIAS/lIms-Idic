/**
 * Órdenes internas (D4 del ANALISIS_FLUJO_REAL): derivación de parte de una OT a
 * OTRO laboratorio, con los ensayos del catálogo que le corresponden.
 *
 * Reglas puras: orden-interna.reglas.ts. Ciclo (frente r1b · EP-01 2.2, 0.6,
 * 3.7, 5.5; EP-02 0.6, 5.4; EP-03 0.6, 2.2, 3.5, 5.5):
 *   1. Emitida (abierta): el solicitante (analista o jefatura del laboratorio
 *      de la OT, permiso orden_interna.emitir) elige destino, ensayos, muestra
 *      de origen, requisito y fecha de envío.
 *   2. Recibida: el laboratorio de destino (orden_interna.responder, alcance
 *      sobre el DESTINO) la recibe; se crean en la muestra los ensayos derivados.
 *   3. Respondida: el destino guarda su informe de respuesta (número RESPUESTA_OI),
 *      horas, insumos y costo directo.
 *   4. Cerrada: el destino la cierra (con todos sus resultados capturados y
 *      ningún 0,00 sin explicar) y el informe vuelve al solicitante.
 *   5. Dada por recibida: el solicitante la integra («Dar por recibido → evaluación»).
 *
 * Alcance: quien emite, edita, borra, anula o da por recibida tiene la OT de
 * origen en su alcance; quien recibe, responde o cierra tiene el laboratorio
 * de DESTINO en su alcance; quien consulta, uno de los dos.
 *
 * Rutas (permiso):
 *   GET    ordenes-internas                    · lista (ot.ver)          ?otId= ?estado= ?search=
 *   GET    ordenes-internas/bandeja            · bandeja de entrada: las que llegan a los laboratorios de su alcance (ot.ver)
 *   GET    ordenes-internas/:id                · ficha: datos, resultados derivados, qué falta y historial (ot.ver)
 *   GET    ordenes-internas/ot/:otId           · las de una OT (ot.ver; OT en alcance)
 *   GET    ordenes-internas/destinos?otId=     · laboratorios a los que se puede derivar (ot.ver)
 *   GET    ordenes-internas/destinos/:familiaId/ensayos?otId=&q= · ensayos del destino (ot.ver)
 *   POST   ordenes-internas                    · emitir (orden_interna.emitir)
 *   PATCH  ordenes-internas/:id                · editar mientras está abierta (orden_interna.emitir)
 *   POST   ordenes-internas/:id/recibir        · «Recibir OT interna → recepción» (orden_interna.responder)
 *   POST   ordenes-internas/:id/responder      · guardar la respuesta (orden_interna.responder)
 *   POST   ordenes-internas/:id/cerrar         · «Cerrar OT interna → devolver al solicitante» (orden_interna.responder)
 *   POST   ordenes-internas/:id/dar-por-recibido · «Dar por recibido → evaluación» (orden_interna.emitir)
 *   POST   ordenes-internas/:id/anular         · anular con motivo (orden_interna.anular)
 *   DELETE ordenes-internas/:id                · borrar una abierta (orden_interna.anular)
 */
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Inject,
  Injectable,
  forwardRef,
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
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PrismaService } from "../common/prisma.service";
import { BaseCrudService, DEV_TENANT } from "../common/base-crud.service";
import { BaseCrudController } from "../common/base-crud.controller";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso, RequierePermisoCrud } from "../auth/permisos.decorator";
import { generarNumeroOrdenInterna } from "../common/correlativo";
import { AlcanceService } from "../rbac/alcance.service";
import { NumeracionService } from "../plantilla-render/numeracion.service";
// Ciclo de importación con flujo-real.module (que registra este controlador): forwardRef.
import { PuenteAnalisisService } from "./flujo-real.module";
import {
  erroresContenido,
  erroresEmision,
  erroresRespuesta,
  faltantesCierreOi,
  motivoNoAceptable,
  motivoNoAnulable,
  motivoNoBorrable,
  motivoNoEditable,
  motivoNoRecibible,
  normalizarEnsayos,
  pasoOi,
  type CambioOi,
  type ResultadoDerivado,
} from "./orden-interna.reglas";
import { diaChile } from "../common/fecha-chile";

const tenantDe = (req: any): string => req?.user?.tenantId ?? DEV_TENANT;
const usuarioDe = (req: any): string | null => req?.user?.sub ?? null;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** La unidad del organigrama que corresponde a una familia del catálogo (por CODSUCDEL; admite «7003/7004»). */
const UNIDAD_DE_FAMILIA = `
  SELECT u.id, u.codigo, u.nombre
    FROM unidad u
   WHERE u.tenant_id = f.tenant_id AND u.activa
     AND f.codsucdel = ANY(string_to_array(regexp_replace(COALESCE(u.codsucdel, ''), '[\\s,;]', '/', 'g'), '/'))
   ORDER BY (u.tipo = 'LABORATORIO') DESC, u.codigo
   LIMIT 1`;

/** Columnas de una orden interna para las pantallas (OT, destino, ensayos, quién). */
const SELECT_OI = `
  SELECT oi.id, oi.numero, oi.tipo, oi.estado, oi.detalle, oi.ensayos, oi.ot_id AS "otId",
         oi.destino_lab AS "destinoLab", oi.origen_lab AS "origenLab",
         oi.created_at AS "createdAt", oi.updated_at AS "updatedAt",
         oi.anulada_at AS "anuladaAt", oi.motivo_anulacion AS "motivoAnulacion",
         oi.muestra_id AS "muestraId", m.codigo AS "muestraCodigo", m.nombre AS "muestraNombre",
         oi.requisito, to_char(oi.fecha_envio, 'YYYY-MM-DD') AS "fechaEnvio", oi.ie_referencia AS "ieReferencia",
         oi.recibida_at AS "recibidaAt", ur.nombre_completo AS "recibidaPorNombre",
         oi.respuesta_numero AS "respuestaNumero", oi.respuesta_informe AS "respuestaInforme",
         oi.respuesta_horas::float8 AS "respuestaHoras", oi.respuesta_insumos AS "respuestaInsumos",
         oi.costo_directo::float8 AS "costoDirecto", oi.respondida_at AS "respondidaAt", urs.nombre_completo AS "respondidaPorNombre",
         oi.cerrada_at AS "cerradaAt", ucr.nombre_completo AS "cerradaPorNombre",
         oi.aceptada_at AS "aceptadaAt", ua.nombre_completo AS "aceptadaPorNombre", oi.aceptada_observacion AS "aceptadaObservacion",
         ot.codigo AS "otCodigo", ot.estado AS "otEstado", ot.unidad_principal AS "otUnidadId",
         uo.codigo AS "otUnidadCodigo", uo.nombre AS "otUnidadNombre",
         f.nombre AS "destinoNombre", f.codsucdel AS "destinoCodsucdel",
         ud.id AS "destinoUnidadId", ud.codigo AS "destinoUnidadCodigo", ud.nombre AS "destinoUnidadNombre",
         uc.nombre_completo AS "creadaPor",
         COALESCE(
           (SELECT 'Internación ' || i.numero || ' · Resolución DGMN ' || COALESCE(i.resolucion_numero, '—')
                   || COALESCE(' del ' || to_char(i.resolucion_fecha, 'DD-MM-YYYY'), '')
              FROM bpch_internacion i WHERE i.ot_id = oi.ot_id AND i.estado <> 'anulada' ORDER BY i.created_at DESC LIMIT 1),
           (SELECT 'Producción Nacional · RAF ' || r.numero || ' · O/C ' || oc.numero
              FROM bpch_pn_inspeccion pi JOIN bpch_oc_operativa oc ON oc.id = pi.oc_id JOIN bpch_raf r ON r.id = oc.raf_id
             WHERE pi.ot_id = oi.ot_id LIMIT 1),
           (SELECT 'Reinspección ' || r.numero FROM bpch_reinspeccion r WHERE r.ot_id = oi.ot_id LIMIT 1)
         ) AS "origenBpch",
         COALESCE(array_length(oi.ensayos, 1), 0)::int AS "nEnsayos",
         COALESCE((SELECT json_agg(json_build_object('id', e.id, 'codigo', e.codigo, 'nombre', e.nombre) ORDER BY e.nombre)
                     FROM cat_ensayo e WHERE e.id = ANY(oi.ensayos)), '[]'::json) AS "ensayosDetalle"
    FROM orden_interna oi
    JOIN orden_trabajo ot ON ot.id = oi.ot_id
    LEFT JOIN unidad uo ON uo.id = ot.unidad_principal
    LEFT JOIN muestra m ON m.id = oi.muestra_id
    LEFT JOIN cat_familia f ON f.id = oi.destino_lab
    LEFT JOIN LATERAL (${UNIDAD_DE_FAMILIA}) ud ON TRUE
    LEFT JOIN usuario uc ON uc.id = oi.created_by
    LEFT JOIN usuario ur ON ur.id = oi.recibida_por
    LEFT JOIN usuario urs ON urs.id = oi.respondida_por
    LEFT JOIN usuario ucr ON ucr.id = oi.cerrada_por
    LEFT JOIN usuario ua ON ua.id = oi.aceptada_por`;

const FechaIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha en formato AAAA-MM-DD");
export const OrdenInternaCreate = z
  .object({
    otId: z.string().uuid(),
    tipo: z.enum(["interna", "generica_interna", "muestreo"]).default("interna"),
    numero: z.string().max(40).optional(),
    origenLab: z.string().uuid().optional(),
    destinoLab: z.string().uuid().optional(),
    // Una orden nace abierta: la recibe el laboratorio de destino.
    estado: z.literal("abierta").default("abierta"),
    ensayos: z.array(z.string().uuid()).max(200).optional(),
    detalle: z.string().max(4000).optional(),
    muestraId: z.string().uuid().optional(),
    requisito: z.string().trim().max(2000).optional(),
    fechaEnvio: FechaIso.optional(),
    ieReferencia: z.string().trim().max(80).optional(),
  })
  .strict();
export const OrdenInternaUpdate = z
  .object({
    otId: z.string().uuid().optional(),
    tipo: z.enum(["interna", "generica_interna", "muestreo"]).optional(),
    origenLab: z.string().uuid().nullable().optional(),
    destinoLab: z.string().uuid().nullable().optional(),
    estado: z.enum(["abierta", "recibida", "cerrada", "anulada"]).optional(),
    ensayos: z.array(z.string().uuid()).max(200).optional(),
    detalle: z.string().max(4000).nullable().optional(),
    muestraId: z.string().uuid().optional(),
    requisito: z.string().trim().max(2000).optional(),
    fechaEnvio: FechaIso.optional(),
    ieReferencia: z.string().trim().max(80).nullable().optional(),
  })
  .strict();
const Motivo = z.object({ motivo: z.string().trim().max(1000).default("") });
export const RespuestaSchema = z
  .object({
    informe: z.string().trim().max(8000).nullable().optional(),
    horas: z.number().finite(),
    insumos: z.string().trim().max(2000).nullable().optional(),
    costoDirecto: z.number().finite(),
    /** Nº del informe de respuesta si el destino usa otro («Boletín N° …»); sin él, lo propone la numeración. */
    respuestaNumero: z.string().trim().min(1).max(80).optional(),
  })
  .strict();
const Aceptar = z.object({ observacion: z.string().trim().max(2000).nullable().optional() }).strict();
/** AAAA-MM-DD → Date (mediodía UTC, para que la zona horaria no cambie el día). */
const aFecha = (f?: string | null) => (f ? new Date(`${f}T12:00:00Z`) : undefined);

@Injectable()
export class OrdenInternaService extends BaseCrudService {
  constructor(
    prisma: PrismaService,
    private readonly numeracion: NumeracionService,
  ) {
    super(prisma, {
      model: "ordenInterna",
      search: ["numero", "tipo", "estado", "detalle"],
      orderBy: { createdAt: "desc" },
      tenant: true,
      softDelete: true,
    });
  }

  private async historial(tenantId: string, id: string, accion: string, detalle: unknown, usuarioId: string | null, db: any = this.prisma) {
    await db.$executeRawUnsafe(
      `INSERT INTO orden_interna_historial (tenant_id, orden_interna_id, accion, detalle, usuario_id)
       VALUES ($1::uuid, $2::uuid, $3, $4::jsonb, $5::uuid)`,
      tenantId,
      id,
      accion,
      JSON.stringify(detalle ?? {}),
      usuarioId,
    );
  }

  /** Alta: numera OI-AAAA-NNNN (correlativo atómico), deja quién la creó y su historial. */
  override async crear(data: any, tenantId?: string, usuarioId: string | null = null) {
    const tid = tenantId ?? DEV_TENANT;
    const numero = data?.numero ?? (await generarNumeroOrdenInterna(this.prisma, tid));
    const oi: any = await super.crear({ ...data, numero, ...(usuarioId ? { createdBy: usuarioId } : {}) }, tenantId);
    if (oi?.id)
      await this.historial(
        tid,
        oi.id,
        "creada",
        { destinoLab: data?.destinoLab ?? null, ensayos: data?.ensayos ?? [], muestraId: data?.muestraId ?? null },
        usuarioId,
      );
    return oi;
  }

  override async actualizar(id: string, data: any, tenantId?: string, usuarioId: string | null = null) {
    const r = await super.actualizar(id, { ...data, updatedAt: new Date() }, tenantId);
    const soloEstado = Object.keys(data ?? {}).every((k) => k === "estado");
    await this.historial(tenantId ?? DEV_TENANT, id, soloEstado ? "estado" : "editada", data, usuarioId);
    return r;
  }

  override async eliminar(id: string, tenantId?: string, usuarioId: string | null = null) {
    const r = await super.eliminar(id, tenantId);
    await this.historial(tenantId ?? DEV_TENANT, id, "eliminada", {}, usuarioId);
    return r;
  }

  async anular(id: string, motivo: string, tenantId: string, usuarioId: string | null) {
    const n = await this.prisma.$executeRawUnsafe(
      `UPDATE orden_interna SET estado = 'anulada', anulada_at = now(), anulada_por = $3::uuid,
              motivo_anulacion = $4, updated_at = now()
        WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL AND estado NOT IN ('anulada', 'cerrada')`,
      id,
      tenantId,
      usuarioId,
      motivo,
    );
    if (n !== 1) throw new ConflictException("La orden interna cambió de estado mientras tanto; recargue.");
    await this.historial(tenantId, id, "anulada", { motivo }, usuarioId);
    return this.ficha(id, tenantId);
  }

  /**
   * Lista con OT, destino y ensayos. `filtro` = unidades visibles (null = todas).
   * `bandeja`: solo las que LLEGAN a esas unidades (bandeja de entrada del
   * laboratorio de destino), no las que emiten.
   */
  async lista(
    tenantId: string,
    filtro: string[] | null,
    q: { otId?: string; estado?: string; estados?: string[]; search?: string; limit?: number; bandeja?: boolean },
  ) {
    const conds = [`oi.tenant_id = $1::uuid`, `oi.deleted_at IS NULL`];
    const vals: unknown[] = [tenantId];
    if (filtro !== null) {
      vals.push(filtro);
      conds.push(
        q.bandeja
          ? `ud.id = ANY($${vals.length}::uuid[])`
          : `(ot.unidad_principal = ANY($${vals.length}::uuid[]) OR ud.id = ANY($${vals.length}::uuid[]))`,
      );
    }
    if (q.otId) {
      vals.push(q.otId);
      conds.push(`oi.ot_id = $${vals.length}::uuid`);
    }
    if (q.estado) {
      vals.push(q.estado);
      conds.push(`oi.estado = $${vals.length}`);
    } else if (q.estados?.length) {
      vals.push(q.estados);
      conds.push(`oi.estado = ANY($${vals.length}::text[])`);
    }
    if (q.search?.trim()) {
      vals.push(`%${q.search.trim()}%`);
      const p = `$${vals.length}`;
      conds.push(`(oi.numero ILIKE ${p} OR ot.codigo ILIKE ${p} OR COALESCE(oi.detalle, '') ILIKE ${p} OR COALESCE(f.nombre, '') ILIKE ${p} OR COALESCE(ud.codigo, '') ILIKE ${p} OR COALESCE(oi.requisito, '') ILIKE ${p})`);
    }
    vals.push(Math.min(500, Math.max(1, q.limit ?? 200)));
    return this.prisma.$queryRawUnsafe<any[]>(
      `${SELECT_OI} WHERE ${conds.join(" AND ")} ORDER BY oi.created_at DESC LIMIT $${vals.length}`,
      ...vals,
    );
  }

  /** Resultados de los ensayos derivados en la muestra de origen (o en las muestras de la OT). */
  async resultadosDerivados(otId: string, ensayos: string[], muestraId: string | null, db: any = this.prisma) {
    if (!ensayos.length) return [] as (ResultadoDerivado & { muestra: string; analito: string | null; unidad: string | null; id: string })[];
    return db.$queryRawUnsafe(
      `SELECT r.id, e.id AS "ensayoId", e.nombre AS ensayo, r.estado,
              COALESCE(r.resultado_final, r.valor_numerico)::float8 AS valor, r.valor_texto AS texto, r.observacion,
              m.codigo AS muestra, ca.nombre AS analito, r.unidad
         FROM resultado r
         JOIN muestra m ON m.id = r.muestra_id
         JOIN cat_metodo cm ON cm.id = r.cat_metodo_id
         JOIN cat_ensayo e ON e.id = cm.ensayo_id
         LEFT JOIN cat_analito ca ON ca.id = r.cat_analito_id
        WHERE COALESCE(r.ot_id, m.ot_id) = $1::uuid AND r.deleted_at IS NULL AND m.deleted_at IS NULL
          AND e.id = ANY($2::uuid[]) AND ($3::uuid IS NULL OR m.id = $3::uuid)
        ORDER BY m.codigo, e.nombre, ca.nombre`,
      otId,
      ensayos,
      muestraId,
    );
  }

  async ficha(id: string, tenantId: string) {
    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `${SELECT_OI} WHERE oi.id = $1::uuid AND oi.tenant_id = $2::uuid AND oi.deleted_at IS NULL`,
      id,
      tenantId,
    );
    const oi = filas[0];
    if (!oi) throw new NotFoundException(`Orden interna ${id} no encontrada`);
    const [historial, resultados] = await Promise.all([
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT h.id, h.accion, h.detalle, h.created_at AS "createdAt", u.nombre_completo AS "usuarioNombre"
           FROM orden_interna_historial h LEFT JOIN usuario u ON u.id = h.usuario_id
          WHERE h.orden_interna_id = $1::uuid ORDER BY h.created_at`,
        id,
      ),
      this.resultadosDerivados(oi.otId, oi.ensayos ?? [], oi.muestraId ?? null),
    ]);
    const faltantesCierre =
      oi.estado === "recibida"
        ? faltantesCierreOi({
            estado: oi.estado,
            respondida: Boolean(oi.respondidaAt),
            ensayos: (oi.ensayosDetalle ?? []).map((e: any) => ({ id: e.id, nombre: e.nombre })),
            resultados,
          })
        : [];
    // Nº que tendrá el informe de respuesta (orientativo, no se reserva hasta guardar).
    const propuesta =
      !oi.respuestaNumero && ["abierta", "recibida"].includes(oi.estado)
        ? await this.numeracion
            .proximo({
              tenantId,
              unidadId: oi.destinoUnidadId ?? null,
              tipo: "RESPUESTA_OI",
              fecha: new Date(),
              ot: oi.otCodigo,
              muestra: oi.muestraCodigo,
              ni: oi.numero,
            })
            .then((p) => p.numero)
            .catch(() => null)
        : null;
    const costoOt = await this.prisma.$queryRawUnsafe<{ total: number }[]>(
      `SELECT COALESCE(sum(costo_directo), 0)::float8 AS total FROM orden_interna
        WHERE ot_id = $1::uuid AND deleted_at IS NULL AND estado <> 'anulada'`,
      oi.otId,
    );
    return {
      ...oi,
      paso: pasoOi(oi),
      historial,
      resultados,
      faltantesCierre,
      respuestaNumeroPropuesto: propuesta,
      costoDirectoOt: costoOt[0]?.total ?? 0,
    };
  }

  /** «Recibir OT interna → recepción»: estado recibida y ensayos derivados creados en la muestra. */
  async recibir(
    id: string,
    tenantId: string,
    usuarioId: string | null,
    crearEnsayos: (oi: { otId: string; muestraId: string; ensayos: string[] }) => Promise<unknown>,
    /** Por PATCH { estado: "recibida" } (compatibilidad) el historial sigue diciendo «estado». */
    porPatch = false,
  ) {
    const oi = await this.prisma.ordenInterna.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { estado: true, otId: true, muestraId: true, ensayos: true },
    });
    if (!oi) throw new NotFoundException(`Orden interna ${id} no encontrada`);
    const m = motivoNoRecibible(oi.estado);
    if (m) throw new ConflictException(m);
    const n = await this.prisma.$executeRawUnsafe(
      `UPDATE orden_interna SET estado = 'recibida', recibida_at = now(), recibida_por = $3::uuid, updated_at = now()
        WHERE id = $1::uuid AND tenant_id = $2::uuid AND estado = 'abierta' AND deleted_at IS NULL`,
      id,
      tenantId,
      usuarioId,
    );
    if (n !== 1) throw new ConflictException("La orden interna cambió de estado mientras tanto; recargue.");
    let ensayos: unknown = null;
    if (oi.muestraId && oi.ensayos?.length) ensayos = await crearEnsayos({ otId: oi.otId, muestraId: oi.muestraId, ensayos: oi.ensayos });
    await this.historial(tenantId, id, porPatch ? "estado" : "recibida", porPatch ? { estado: "recibida", ensayos } : { ensayos }, usuarioId);
    return this.ficha(id, tenantId);
  }

  /** Guarda (o corrige mientras sigue recibida) la respuesta del destino. Reserva el Nº de informe la primera vez. */
  async responder(id: string, tenantId: string, usuarioId: string | null, dto: z.infer<typeof RespuestaSchema>) {
    const f = await this.ficha(id, tenantId);
    const e = erroresRespuesta(f.estado, { horas: dto.horas, costoDirecto: dto.costoDirecto, informe: dto.informe, insumos: dto.insumos });
    if (e.length) throw (f.estado !== "recibida" ? new ConflictException(e.join(" ")) : new BadRequestException(e.join(" ")));
    await this.prisma.$transaction(async (tx) => {
      let numero: string | null = dto.respuestaNumero ?? f.respuestaNumero ?? null;
      if (!numero) {
        const r = await this.numeracion.reservar(
          tx,
          { tenantId, unidadId: f.destinoUnidadId ?? null, tipo: "RESPUESTA_OI", fecha: new Date(), ot: f.otCodigo, muestra: f.muestraCodigo, ni: f.numero },
          async (n) =>
            Boolean(
              await tx.ordenInterna.findFirst({ where: { tenantId, respuestaNumero: n, NOT: { id } }, select: { id: true } }),
            ),
        );
        numero = r.numero ?? `I.E. N° ${f.numero}`;
      }
      const n = await tx.$executeRawUnsafe(
        `UPDATE orden_interna
            SET respuesta_numero = $3, respuesta_informe = $4, respuesta_horas = $5, respuesta_insumos = $6, costo_directo = $7,
                respondida_at = COALESCE(respondida_at, now()), respondida_por = $8::uuid, updated_at = now()
          WHERE id = $1::uuid AND tenant_id = $2::uuid AND estado = 'recibida' AND deleted_at IS NULL`,
        id,
        tenantId,
        numero,
        dto.informe?.trim() || null,
        dto.horas,
        dto.insumos?.trim() || null,
        dto.costoDirecto,
        usuarioId,
      );
      if (n !== 1) throw new ConflictException("La orden interna cambió de estado mientras tanto; recargue.");
      await this.historial(
        tenantId,
        id,
        f.respondidaAt ? "respuesta_corregida" : "respondida",
        { numero, horas: dto.horas, costoDirecto: dto.costoDirecto },
        usuarioId,
        tx,
      );
    });
    return this.ficha(id, tenantId);
  }

  /** «Cerrar OT interna → devolver al solicitante». */
  async cerrar(id: string, tenantId: string, usuarioId: string | null) {
    const f = await this.ficha(id, tenantId);
    if (f.estado !== "recibida") throw new ConflictException(f.estado === "abierta" ? "Reciba primero la orden interna." : `La orden interna está ${f.estado}.`);
    if (f.faltantesCierre.length) throw new ConflictException(`No se puede cerrar la orden interna. ${f.faltantesCierre.join(" ")}`);
    const n = await this.prisma.$executeRawUnsafe(
      `UPDATE orden_interna SET estado = 'cerrada', cerrada_at = now(), cerrada_por = $3::uuid, updated_at = now()
        WHERE id = $1::uuid AND tenant_id = $2::uuid AND estado = 'recibida' AND respondida_at IS NOT NULL AND deleted_at IS NULL`,
      id,
      tenantId,
      usuarioId,
    );
    if (n !== 1) throw new ConflictException("La orden interna cambió de estado mientras tanto; recargue.");
    await this.historial(tenantId, id, "cerrada", { informe: f.respuestaNumero }, usuarioId);
    return this.ficha(id, tenantId);
  }

  /** «Dar por recibido → evaluación»: el solicitante integra el informe de respuesta. */
  async aceptar(id: string, tenantId: string, usuarioId: string | null, observacion: string | null) {
    const oi = await this.prisma.ordenInterna.findFirst({ where: { id, tenantId, deletedAt: null }, select: { estado: true, aceptadaAt: true } });
    if (!oi) throw new NotFoundException(`Orden interna ${id} no encontrada`);
    const m = motivoNoAceptable(oi.estado, oi.aceptadaAt);
    if (m) throw new ConflictException(m);
    const n = await this.prisma.$executeRawUnsafe(
      `UPDATE orden_interna SET aceptada_at = now(), aceptada_por = $3::uuid, aceptada_observacion = $4, updated_at = now()
        WHERE id = $1::uuid AND tenant_id = $2::uuid AND estado = 'cerrada' AND aceptada_at IS NULL AND deleted_at IS NULL`,
      id,
      tenantId,
      usuarioId,
      observacion,
    );
    if (n !== 1) throw new ConflictException("La orden interna cambió de estado mientras tanto; recargue.");
    await this.historial(tenantId, id, "dada_por_recibida", { observacion }, usuarioId);
    return this.ficha(id, tenantId);
  }

  /** Laboratorios del catálogo (familias con su unidad del organigrama) a los que se puede derivar. */
  async destinos(tenantId: string, excluirUnidad: string | null) {
    return this.prisma.$queryRawUnsafe<any[]>(
      `SELECT f.id, f.codsucdel, f.nombre, u.id AS "unidadId", u.codigo AS "unidadCodigo", u.nombre AS "unidadNombre",
              (SELECT count(*) FROM cat_ensayo e WHERE e.familia_id = f.id AND e.deleted_at IS NULL AND e.activo)::int AS ensayos
         FROM cat_familia f
         JOIN LATERAL (${UNIDAD_DE_FAMILIA}) u ON TRUE
        WHERE f.tenant_id = $1::uuid AND f.deleted_at IS NULL AND f.activo
          AND ($2::uuid IS NULL OR u.id <> $2::uuid)
          -- Sin ensayos vigentes en el catálogo no hay nada que derivarle.
          AND EXISTS (SELECT 1 FROM cat_ensayo e WHERE e.familia_id = f.id AND e.deleted_at IS NULL AND e.activo)
        ORDER BY u.codigo, f.nombre`,
      tenantId,
      excluirUnidad,
    );
  }

  /**
   * Ensayos vigentes de una familia de destino. Con `otId`, marca los que ya
   * figuran en la OT (resultados o líneas de su cotización) para proponerlos.
   */
  async ensayosDestino(tenantId: string, familiaId: string, otId: string | null, q: string) {
    return this.prisma.$queryRawUnsafe<any[]>(
      `SELECT e.id, e.codigo, e.nombre,
              ($3::uuid IS NOT NULL AND (
                 EXISTS (SELECT 1 FROM resultado r JOIN muestra m ON m.id = r.muestra_id JOIN cat_metodo cm ON cm.id = r.cat_metodo_id
                          WHERE COALESCE(r.ot_id, m.ot_id) = $3::uuid AND r.deleted_at IS NULL AND cm.ensayo_id = e.id)
                 OR EXISTS (SELECT 1 FROM orden_trabajo ot JOIN linea_cotizacion cl ON cl.cotizacion_id = ot.cotizacion_id
                             WHERE ot.id = $3::uuid AND cl.cat_ensayo_id = e.id))) AS "enOt"
         FROM cat_ensayo e
        WHERE e.tenant_id = $1::uuid AND e.familia_id = $2::uuid AND e.deleted_at IS NULL AND e.activo
          AND ($4 = '' OR e.nombre ILIKE '%' || $4 || '%' OR e.codigo ILIKE '%' || $4 || '%')
        ORDER BY 4 DESC, e.nombre
        LIMIT 400`,
      tenantId,
      familiaId,
      otId,
      q,
    );
  }

  /** Ids de ensayo vigentes de la familia (para validar lo que llega). */
  async idsEnsayosDe(tenantId: string, familiaId: string, ids: string[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const filas = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM cat_ensayo WHERE tenant_id = $1::uuid AND familia_id = $2::uuid AND deleted_at IS NULL AND id = ANY($3::uuid[])`,
      tenantId,
      familiaId,
      ids,
    );
    return new Set(filas.map((f) => f.id));
  }

  /** Método vigente por defecto de cada ensayo (el primero por código), para crear el ensayo en la muestra. */
  async metodosPorDefecto(tenantId: string, ensayos: string[]): Promise<string[]> {
    if (!ensayos.length) return [];
    const filas = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT DISTINCT ON (cm.ensayo_id) cm.id
         FROM cat_metodo cm
        WHERE cm.tenant_id = $1::uuid AND cm.ensayo_id = ANY($2::uuid[]) AND cm.deleted_at IS NULL AND COALESCE(cm.activo, TRUE)
          AND EXISTS (SELECT 1 FROM cat_analito a WHERE a.metodo_id = cm.id AND a.deleted_at IS NULL AND a.activo)
        ORDER BY cm.ensayo_id, cm.codigo`,
      tenantId,
      ensayos,
    );
    return filas.map((f) => f.id);
  }

  /** ¿La familia de destino es la del laboratorio responsable de la OT? (y la familia de ese laboratorio, para origen). */
  async familias(tenantId: string, destinoLab: string | null, unidadOt: string | null) {
    const filas = await this.prisma.$queryRawUnsafe<{ destino_existe: boolean; destino_es_principal: boolean; origen: string | null }[]>(
      `SELECT EXISTS (SELECT 1 FROM cat_familia WHERE id = $2::uuid AND tenant_id = $1::uuid AND deleted_at IS NULL) AS destino_existe,
              EXISTS (SELECT 1 FROM cat_familia f JOIN unidad u ON u.id = $3::uuid
                       WHERE f.id = $2::uuid
                         AND f.codsucdel = ANY(string_to_array(regexp_replace(COALESCE(u.codsucdel, ''), '[\\s,;]', '/', 'g'), '/'))) AS destino_es_principal,
              (SELECT f.id FROM cat_familia f JOIN unidad u ON u.id = $3::uuid
                WHERE f.tenant_id = $1::uuid AND f.deleted_at IS NULL
                  AND f.codsucdel = ANY(string_to_array(regexp_replace(COALESCE(u.codsucdel, ''), '[\\s,;]', '/', 'g'), '/'))
                ORDER BY f.activo DESC, f.codsucdel LIMIT 1) AS origen`,
      tenantId,
      destinoLab,
      unidadOt,
    );
    return filas[0] ?? { destino_existe: false, destino_es_principal: false, origen: null };
  }

  /** Unidad del organigrama del laboratorio de destino de una orden (null si no se resuelve). */
  async unidadDestino(id: string, tenantId: string): Promise<{ unidadId: string | null; numero: string }> {
    const f = await this.prisma.$queryRawUnsafe<{ unidad_id: string | null; numero: string }[]>(
      `SELECT ud.id AS unidad_id, oi.numero
         FROM orden_interna oi
         LEFT JOIN cat_familia f ON f.id = oi.destino_lab
         LEFT JOIN LATERAL (${UNIDAD_DE_FAMILIA}) ud ON TRUE
        WHERE oi.id = $1::uuid AND oi.tenant_id = $2::uuid AND oi.deleted_at IS NULL`,
      id,
      tenantId,
    );
    if (!f[0]) throw new NotFoundException(`Orden interna ${id} no encontrada`);
    return { unidadId: f[0].unidad_id, numero: f[0].numero };
  }
}

/**
 * Consultas con ruta estática (`destinos`, `ot/:otId`, `bandeja`): controlador
 * PROPIO declarado ANTES del CRUD para que su ruta gane a `@Get(":id")`.
 */
@ApiTags("ordenes-internas")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("ordenes-internas")
export class OrdenInternaConsultaController {
  constructor(
    private readonly svc: OrdenInternaService,
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
  ) {}

  private async otEnAlcance(otId: string, req: any) {
    const ot = await this.prisma.ordenTrabajo.findFirst({
      where: { id: otId, tenantId: tenantDe(req) },
      select: { id: true, codigo: true, unidadPrincipal: true },
    });
    if (!ot) throw new NotFoundException(`Orden de trabajo ${otId} no encontrada`);
    await this.alcance.exigirUnidad(req, ot.unidadPrincipal, `la OT ${ot.codigo}`);
    return ot;
  }

  @Get("bandeja")
  @RequierePermiso("ot.ver")
  @ApiOperation({ summary: "Bandeja de entrada: órdenes internas que llegan a los laboratorios de su alcance (?estado=pendientes|todas|abierta|recibida|cerrada)" })
  async bandeja(@Query("estado") estado: string | undefined, @Query("search") search: string | undefined, @Req() req: any) {
    const filtro = await this.alcance.filtroUnidades(req);
    const e = String(estado ?? "pendientes");
    const q =
      e === "todas" ? {} : ["abierta", "recibida", "cerrada", "anulada"].includes(e) ? { estado: e } : { estados: ["abierta", "recibida"] };
    return this.svc.lista(tenantDe(req), filtro, { ...q, search, limit: 300, bandeja: true });
  }

  @Get("destinos")
  @RequierePermiso("ot.ver")
  @ApiOperation({ summary: "Laboratorios a los que se puede derivar (?otId= excluye el responsable de la OT)" })
  async destinos(@Query("otId") otId: string | undefined, @Req() req: any) {
    const ot = otId && UUID_RE.test(otId) ? await this.otEnAlcance(otId, req) : null;
    return this.svc.destinos(tenantDe(req), ot?.unidadPrincipal ?? null);
  }

  @Get("destinos/:familiaId/ensayos")
  @RequierePermiso("ot.ver")
  @ApiOperation({ summary: "Ensayos del laboratorio de destino (?otId= marca los que ya figuran en la OT; ?q=)" })
  async ensayos(
    @Param("familiaId", ParseUUIDPipe) familiaId: string,
    @Query("otId") otId: string | undefined,
    @Query("q") q: string | undefined,
    @Req() req: any,
  ) {
    const ot = otId && UUID_RE.test(otId) ? await this.otEnAlcance(otId, req) : null;
    return this.svc.ensayosDestino(tenantDe(req), familiaId, ot?.id ?? null, String(q ?? "").trim().slice(0, 100));
  }

  @Get("ot/:otId")
  @RequierePermiso("ot.ver")
  @ApiOperation({ summary: "Órdenes internas de una OT (la OT debe estar en el alcance)" })
  async deOt(@Param("otId", ParseUUIDPipe) otId: string, @Req() req: any) {
    const ot = await this.otEnAlcance(otId, req);
    return this.svc.lista(tenantDe(req), null, { otId: ot.id, limit: 500 });
  }
}

@ApiTags("ordenes-internas")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("ordenes-internas")
@RequierePermisoCrud({
  ver: "ot.ver",
  crear: "orden_interna.emitir",
  editar: "orden_interna.emitir",
  eliminar: "orden_interna.anular",
})
export class OrdenInternaController extends BaseCrudController {
  protected createSchema = OrdenInternaCreate;
  protected updateSchema = OrdenInternaUpdate;
  constructor(
    protected svc: OrdenInternaService,
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
    @Inject(forwardRef(() => PuenteAnalisisService)) private readonly puente: PuenteAnalisisService,
  ) {
    super();
  }

  /**
   * Una orden interna da al laboratorio de destino acceso a la OT (planillas de
   * cálculos y de costos): solo la crea o cambia quien tiene la OT de origen en
   * su alcance por laboratorio (revisión de seguridad r3). 404 si es de otro tenant.
   */
  private async exigirAlcanceOt(otId: string, req: any) {
    const ot = await this.prisma.ordenTrabajo.findFirst({
      where: { id: otId, ...(req?.user?.tenantId ? { tenantId: req.user.tenantId } : {}) },
      select: { codigo: true, unidadPrincipal: true, createdAt: true },
    });
    if (!ot) throw new NotFoundException(`Orden de trabajo ${otId} no encontrada`);
    await this.alcance.exigirUnidad(req, ot.unidadPrincipal, `la OT ${ot.codigo}`);
    return ot;
  }

  /** Recibir, responder y cerrar: el laboratorio de DESTINO debe estar en el alcance de quien actúa. */
  private async exigirAlcanceDestino(id: string, req: any) {
    const d = await this.svc.unidadDestino(id, tenantDe(req));
    if (!d.unidadId) throw new ConflictException(`La orden interna ${d.numero} no tiene laboratorio de destino.`);
    await this.alcance.exigirUnidad(req, d.unidadId, `el laboratorio de destino de la orden interna ${d.numero}`);
  }

  private async ordenDe(id: string, req: any) {
    const oi = await this.prisma.ordenInterna.findFirst({
      where: { id, deletedAt: null, ...(req?.user?.tenantId ? { tenantId: req.user.tenantId } : {}) },
      select: { otId: true, estado: true, destinoLab: true, ensayos: true, muestraId: true, requisito: true, fechaEnvio: true },
    });
    if (!oi) throw new NotFoundException(`Orden interna ${id} no encontrada`);
    return oi;
  }

  /** Destino y ensayos válidos para la OT (400 con los motivos). Devuelve la familia de origen sugerida. */
  private async validarContenido(tenantId: string, unidadOt: string | null, destinoLab: string | null | undefined, ensayos: string[]) {
    if (!destinoLab && !ensayos.length) return { origen: null as string | null };
    const fam = destinoLab ? await this.svc.familias(tenantId, destinoLab, unidadOt) : { destino_existe: false, destino_es_principal: false, origen: null };
    if (destinoLab && !fam.destino_existe) throw new BadRequestException("El laboratorio de destino no existe en el catálogo.");
    const delDestino = destinoLab && ensayos.length ? await this.svc.idsEnsayosDe(tenantId, destinoLab, ensayos) : null;
    const errores = erroresContenido({ destinoLab, ensayos, destinoEsPrincipal: fam.destino_es_principal, ensayosDelDestino: delDestino });
    if (errores.length) throw new BadRequestException(errores.join(" "));
    return { origen: fam.origen };
  }

  /** Muestra de origen, requisito y fecha de envío (EP-01 2.2). */
  private async validarEmision(
    tenantId: string,
    otId: string,
    fechaOt: Date | null,
    d: { muestraId?: string | null; requisito?: string | null; fechaEnvio?: string | null },
  ) {
    const muestra = d.muestraId
      ? await this.prisma.muestra.findFirst({ where: { id: d.muestraId, tenantId, deletedAt: null }, select: { otId: true } })
      : null;
    const errores = erroresEmision({
      muestraId: d.muestraId,
      muestraDeLaOt: d.muestraId ? muestra?.otId === otId : undefined,
      requisito: d.requisito,
      fechaEnvio: d.fechaEnvio,
      fechaOt,
    });
    if (errores.length) throw new BadRequestException(errores.join(" "));
  }

  @Get()
  @RequierePermiso("ot.ver")
  override async listar(
    @Query("page") _page = "1",
    @Query("limit") limit = "200",
    @Query("search") search?: string,
    @Req() req?: any,
  ) {
    const filtro = await this.alcance.filtroUnidades(req);
    const q = req?.query ?? {};
    const otId = typeof q.otId === "string" && UUID_RE.test(q.otId) ? q.otId : undefined;
    const estado = typeof q.estado === "string" && ["abierta", "recibida", "cerrada", "anulada"].includes(q.estado) ? q.estado : undefined;
    const tope = parseInt(limit) || 200;
    const data = await this.svc.lista(tenantDe(req), filtro, { otId, estado, search, limit: tope });
    return { data, meta: { page: 1, limit: tope, total: data.length, totalPages: 1 } };
  }

  @Get(":id")
  @RequierePermiso("ot.ver")
  override async detalle(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    const f = await this.svc.ficha(id, tenantDe(req));
    const filtro = await this.alcance.filtroUnidades(req);
    if (filtro !== null && !filtro.includes(f.otUnidadId) && !(f.destinoUnidadId && filtro.includes(f.destinoUnidadId)))
      throw new NotFoundException(`Orden interna ${id} no encontrada`);
    // Qué puede hacer quien mira (permiso + alcance sobre la OT de origen o sobre el destino):
    // la ficha solo ofrece los botones que la API aceptará.
    const tiene = (p: string) => (req?.user?.roles ?? []).includes("SUPERADMIN") || (req?.user?.permisos ?? []).includes(p);
    const [enOrigen, enDestino, anulaEnOrigen, capturaEnDestino] = await Promise.all([
      tiene("orden_interna.emitir") ? this.alcance.puedeVerUnidad(req, f.otUnidadId, "orden_interna.emitir") : false,
      tiene("orden_interna.responder") && f.destinoUnidadId ? this.alcance.puedeVerUnidad(req, f.destinoUnidadId, "orden_interna.responder") : false,
      tiene("orden_interna.anular") ? this.alcance.puedeVerUnidad(req, f.otUnidadId, "orden_interna.anular") : false,
      // El analista del destino captura los ensayos derivados (resultado.crear en el destino; D02-25).
      tiene("resultado.crear") && f.destinoUnidadId ? this.alcance.puedeVerUnidad(req, f.destinoUnidadId, "resultado.crear") : false,
    ]);
    return {
      ...f,
      puedo: {
        editar: enOrigen && f.estado === "abierta",
        anular: anulaEnOrigen && (f.estado === "abierta" || f.estado === "recibida"),
        recibir: enDestino && f.estado === "abierta",
        responder: enDestino && f.estado === "recibida",
        cerrar: enDestino && f.estado === "recibida",
        darPorRecibido: enOrigen && f.estado === "cerrada" && !f.aceptadaAt,
        capturar: capturaEnDestino && f.estado === "recibida",
      },
    };
  }

  @Post()
  override async crear(@Body() body: unknown, @Req() req: any) {
    const dto = OrdenInternaCreate.parse(body);
    const ot = await this.exigirAlcanceOt(dto.otId, req);
    const ensayos = normalizarEnsayos(dto.ensayos);
    const { origen } = await this.validarContenido(tenantDe(req), ot.unidadPrincipal ?? null, dto.destinoLab, ensayos);
    await this.validarEmision(tenantDe(req), dto.otId, ot.createdAt ?? null, dto);
    // El número lo da siempre el correlativo (OI-AAAA-NNNN): no se acepta uno escrito a mano.
    const { numero: _numero, fechaEnvio, ...datos } = dto;
    return this.svc.crear(
      {
        ...datos,
        ensayos,
        requisito: dto.requisito?.trim(),
        fechaEnvio: aFecha(fechaEnvio),
        ieReferencia: dto.ieReferencia?.trim() || undefined,
        ...(dto.origenLab || !origen ? {} : { origenLab: origen }),
      },
      tenantDe(req),
      usuarioDe(req),
    );
  }

  @Patch(":id")
  override async actualizar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const dto = OrdenInternaUpdate.parse(body);
    const oi = await this.ordenDe(id, req);
    const ot = await this.exigirAlcanceOt(oi.otId, req);
    const motivo = motivoNoEditable(oi.estado, dto as CambioOi);
    if (motivo) throw new ConflictException(motivo);
    // El cierre exige la respuesta del destino: se hace con «Cerrar OT interna».
    if (dto.estado === "cerrada" && oi.estado !== "cerrada")
      throw new ConflictException(
        "La cierra el laboratorio de destino con «Cerrar OT interna → devolver al solicitante», tras guardar su respuesta.",
      );
    // Marcar recibida (compatibilidad): el mismo paso que «Recibir», que además crea los ensayos en la muestra.
    if (dto.estado === "recibida" && oi.estado === "abierta" && Object.keys(dto).length === 1)
      return this.svc.recibir(id, tenantDe(req), usuarioDe(req), (x) => this.crearEnsayos(x, req), true);
    const cambio: any = { ...dto };
    if (dto.ensayos !== undefined || dto.destinoLab !== undefined) {
      const destino = dto.destinoLab !== undefined ? dto.destinoLab : oi.destinoLab ?? null;
      const ensayos = normalizarEnsayos(dto.ensayos ?? oi.ensayos ?? []);
      // Cambiar el destino sin indicar ensayos los vacía (eran del laboratorio anterior).
      const finales = dto.ensayos === undefined && dto.destinoLab !== undefined && dto.destinoLab !== oi.destinoLab ? [] : ensayos;
      await this.validarContenido(tenantDe(req), ot.unidadPrincipal ?? null, destino, finales);
      cambio.ensayos = finales;
    }
    if (dto.muestraId !== undefined || dto.requisito !== undefined || dto.fechaEnvio !== undefined) {
      const fecha = dto.fechaEnvio ?? diaChile(oi.fechaEnvio);
      await this.validarEmision(tenantDe(req), oi.otId, ot.createdAt ?? null, {
        muestraId: dto.muestraId ?? oi.muestraId,
        requisito: dto.requisito ?? oi.requisito,
        fechaEnvio: fecha,
      });
      if (dto.fechaEnvio !== undefined) cambio.fechaEnvio = aFecha(dto.fechaEnvio);
    }
    return this.svc.actualizar(id, cambio, tenantDe(req), usuarioDe(req));
  }

  /** Crea en la muestra de origen los ensayos derivados (método por defecto de cada ensayo; idempotente). */
  private async crearEnsayos(x: { otId: string; muestraId: string; ensayos: string[] }, req: any) {
    const metodoIds = await this.svc.metodosPorDefecto(tenantDe(req), x.ensayos);
    if (!metodoIds.length) return { creados: 0, omitidos: 0, aviso: "Los ensayos derivados no tienen método vigente en el catálogo." };
    const r = await this.puente.generarAnalisis(x.otId, { muestraId: x.muestraId, metodoIds }, tenantDe(req), req, this.prisma, {
      sinAlcanceOt: true,
    });
    return { creados: r.creados, omitidos: r.omitidos };
  }

  @Post(":id/recibir")
  @RequierePermiso("orden_interna.responder")
  @ApiOperation({ summary: "«Recibir OT interna → recepción»: el laboratorio de destino la recibe; se crean sus ensayos en la muestra" })
  async recibir(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    await this.exigirAlcanceDestino(id, req);
    return this.svc.recibir(id, tenantDe(req), usuarioDe(req), (x) => this.crearEnsayos(x, req));
  }

  @Post(":id/responder")
  @RequierePermiso("orden_interna.responder")
  @ApiOperation({ summary: "Respuesta del destino: Nº de informe, informe, horas, insumos y costo directo" })
  async responder(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const dto = RespuestaSchema.parse(body);
    await this.exigirAlcanceDestino(id, req);
    return this.svc.responder(id, tenantDe(req), usuarioDe(req), dto);
  }

  @Post(":id/cerrar")
  @RequierePermiso("orden_interna.responder")
  @ApiOperation({ summary: "«Cerrar OT interna → devolver al solicitante» (resultados capturados y respuesta guardada)" })
  async cerrar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    await this.exigirAlcanceDestino(id, req);
    return this.svc.cerrar(id, tenantDe(req), usuarioDe(req));
  }

  @Post(":id/dar-por-recibido")
  @RequierePermiso("orden_interna.emitir")
  @ApiOperation({ summary: "«Dar por recibido → evaluación»: el laboratorio solicitante integra el informe de respuesta" })
  async darPorRecibido(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const { observacion } = Aceptar.parse(body ?? {});
    const oi = await this.ordenDe(id, req);
    await this.exigirAlcanceOt(oi.otId, req);
    return this.svc.aceptar(id, tenantDe(req), usuarioDe(req), observacion?.trim() || null);
  }

  @Post(":id/anular")
  @RequierePermiso("orden_interna.anular")
  @ApiOperation({ summary: "Anular la orden interna con motivo (deja de dar acceso a la OT al laboratorio de destino)" })
  async anular(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const { motivo } = Motivo.parse(body ?? {});
    const oi = await this.ordenDe(id, req);
    await this.exigirAlcanceOt(oi.otId, req);
    const m = motivoNoAnulable(oi.estado, motivo);
    if (m) throw (oi.estado === "anulada" || oi.estado === "cerrada" ? new ConflictException(m) : new BadRequestException(m));
    return this.svc.anular(id, motivo, tenantDe(req), usuarioDe(req));
  }

  @Delete(":id")
  override async eliminar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    const oi = await this.ordenDe(id, req);
    await this.exigirAlcanceOt(oi.otId, req);
    const m = motivoNoBorrable(oi.estado);
    if (m) throw new ConflictException(m);
    return this.svc.eliminar(id, tenantDe(req), usuarioDe(req));
  }
}
