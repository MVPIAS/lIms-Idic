/**
 * Biblioteca de especificaciones técnicas del cliente (E.T.) y su uso en la OT
 * · LIMS IDIC. Reglas puras: reglas-et.ts y aplicar-et.ts. Contrato:
 * docs/FLUJO_ESPECIFICACIONES_MUESTREO.md. SQL: align_r2b_especificacion_tecnica.sql.
 *
 * Biblioteca (Catálogo › Especificaciones técnicas):
 *   GET    /especificaciones-tecnicas                 et.ver · las de su alcance
 *   GET    /especificaciones-tecnicas/:id             et.ver · cabecera, puntos, versiones, uso
 *   POST   /especificaciones-tecnicas                 et.gestionar · nueva E.T. (borrador v1)
 *   PUT    /especificaciones-tecnicas/:id             et.gestionar · cabecera del borrador
 *   PUT    /especificaciones-tecnicas/:id/puntos      et.gestionar · puntos del borrador
 *   POST   /especificaciones-tecnicas/:id/publicar    et.gestionar · «Publicar → vigente»
 *   POST   /especificaciones-tecnicas/:id/nueva-version  et.gestionar · copia en borrador v+1 (motivo)
 *   POST   /especificaciones-tecnicas/:id/anular      et.gestionar · con motivo
 *   POST   /especificaciones-tecnicas/:id/pdf         et.gestionar · PDF (máx. 10 MB)
 *   GET    /especificaciones-tecnicas/:id/pdf         et.ver
 * En la OT:
 *   GET    /especificaciones-tecnicas/ot/:otId        ot.ver · E.T. de la OT y de sus muestras, elegibles y avance
 *   PUT    /especificaciones-tecnicas/ot/:otId        ot.crear o muestra.crear · elegir la E.T. de la OT
 *   PUT    /especificaciones-tecnicas/muestra/:id     muestra.crear · E.T. propia de una muestra
 *   POST   /especificaciones-tecnicas/ot/:otId/aplicar  resultado.crear · «Aplicar requisitos de la E.T. → veredicto»
 *   GET    /especificaciones-tecnicas/muestra/:id/desglose   muestra.ver · árbol producto → componentes e inspecciones
 *   POST   /especificaciones-tecnicas/muestra/:id/desglose   muestra.crear · «Confirmar plan de ensayos → asignar»
 *   PUT    /especificaciones-tecnicas/resultado/:id/clase    resultado.aprobar · clase de la no conformidad
 */
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { createHash } from "crypto";
import { z } from "zod";
import { PrismaService } from "../common/prisma.service";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { AlcanceService } from "../rbac/alcance.service";
import { FlujoRealModule, PuenteAnalisisService } from "../flujo-real/flujo-real.module";
import { recalcularVeredictoMuestra } from "../laboratorio/laboratorio.module";
import { CLASES_DEFECTO } from "../muestreo/nch44";
import { aplicarEtAMuestra, puntosDeEt } from "./aplicar-et";
import {
  ORIGENES_ET,
  TIPOS_PUNTO,
  codigoSubmuestra,
  erroresAsignacion,
  erroresPublicar,
  erroresPunto,
  motivoNoPermitido,
  planDesglose,
  especDePunto,
  nombreItemInspeccion,
  puedeGestionar,
  puedeVer,
  siguienteVersion,
  type EstadoEt,
  type PuntoEt,
} from "./reglas-et";

const tenantDe = (req: any): string => req?.user?.tenantId;
const usuarioDe = (req: any): string | null => req?.user?.sub ?? null;
const tiene = (req: any, p: string) => (req?.user?.roles ?? []).includes("SUPERADMIN") || (req?.user?.permisos ?? []).includes(p);
function exigirAlguno(req: any, permisos: string[]) {
  if (!permisos.some((p) => tiene(req, p))) throw new ForbiddenException(`Permiso insuficiente. Requiere uno de: ${permisos.join(", ")}`);
}

export const MAX_PDF_ET = 10 * 1024 * 1024;
type ArchivoSubido = { buffer: Buffer; originalname?: string };

const texto = (max: number) => z.string().trim().max(max).nullable().optional();
const CabeceraEt = z
  .object({
    codigo: z.string().trim().min(2, "Indique el código de la E.T.").max(60).regex(/^[\p{L}\p{N} ./_-]+$/u, "Código: letras, dígitos, espacio y . / _ -"),
    nombre: z.string().trim().min(3, "Indique el nombre de la E.T.").max(300),
    origen: z.enum(ORIGENES_ET).default("cliente"),
    clienteId: z.string().uuid().nullable().optional(),
    mandante: texto(120),
    licitacion: texto(120),
    producto: texto(240),
    catElementoId: z.string().uuid().nullable().optional(),
    laboratorios: z.array(z.string().uuid()).max(30).default([]),
    reutilizable: z.boolean().default(true),
    vigenteDesde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD").nullable().optional(),
    observaciones: texto(4000),
  })
  .strict();
const EdicionEt = CabeceraEt.omit({ codigo: true }).partial().strict();

const numeroOpc = z.number().finite().nullable().optional();
const PuntoBody = z
  .object({
    punto: z.string().trim().max(40),
    componente: texto(120),
    caracteristica: z.string().trim().max(300),
    catMetodoId: z.string().uuid().nullable().optional(),
    catAnalitoId: z.string().uuid().nullable().optional(),
    laboratorioId: z.string().uuid().nullable().optional(),
    tipo: z.enum(TIPOS_PUNTO),
    limiteInf: texto(120),
    nominal: texto(120),
    limiteSup: texto(120),
    unidad: texto(30),
    requisito: texto(2000),
    cond2Etiqueta: texto(120),
    cond2Inf: numeroOpc,
    cond2Sup: numeroOpc,
    cond2Unidad: texto(30),
    planN: z.number().int().nullable().optional(),
    planC: z.number().int().nullable().optional(),
    planM: numeroOpc,
    planMM: numeroOpc,
    claseDefecto: z.enum(CLASES_DEFECTO).nullable().optional(),
    observacion: texto(1000),
  })
  .strict();
const PuntosBody = z.object({ puntos: z.array(PuntoBody).max(500) }).strict();
const MotivoBody = z.object({ motivo: z.string({ required_error: "Indique el motivo (mínimo 5 caracteres)." }).trim().min(5, "Indique el motivo (mínimo 5 caracteres).").max(1000) }).strict();
const AsignarBody = z
  .object({
    etId: z.string().uuid().nullable(),
    /** Aplicar enseguida los requisitos a los ensayos que ya tiene la OT. */
    aplicar: z.boolean().optional(),
  })
  .strict();
const ClaseBody = z
  .object({ clase: z.enum(CLASES_DEFECTO).nullable(), motivo: z.string({ required_error: "Indique el motivo (mínimo 5 caracteres)." }).trim().min(5, "Indique el motivo (mínimo 5 caracteres).").max(1000) })
  .strict();
const DesgloseBody = z.object({ componentes: z.array(z.string().trim().min(1).max(120)).max(50).optional() }).strict();

/** Columnas de la E.T. con los nombres del DTO. */
const SELECT_ET = `et.id, et.codigo, et.version, et.nombre, et.origen, et.cliente_id AS "clienteId", c.razon_social AS "clienteNombre",
  et.mandante, et.licitacion, et.producto, et.cat_elemento_id AS "catElementoId", el.nombre AS "elementoNombre",
  et.laboratorios, et.reutilizable, et.estado, to_char(et.vigente_desde, 'YYYY-MM-DD') AS "vigenteDesde", et.observaciones,
  et.reemplaza_id AS "reemplazaId", et.motivo_version AS "motivoVersion",
  et.created_at AS "createdAt", uc.nombre_completo AS "creadaPorNombre", et.updated_at AS "updatedAt",
  et.publicada_at AS "publicadaAt", up.nombre_completo AS "publicadaPorNombre",
  et.anulada_at AS "anuladaAt", et.anulada_motivo AS "anuladaMotivo",
  (SELECT count(*)::int FROM especificacion_tecnica_punto p WHERE p.et_id = et.id) AS "nPuntos",
  (SELECT json_build_object('nombre', f.nombre, 'bytes', f.bytes, 'subidoAt', f.subido_at) FROM especificacion_tecnica_pdf f WHERE f.et_id = et.id) AS pdf`;
const FROM_ET = `FROM especificacion_tecnica et
  LEFT JOIN cliente c ON c.id = et.cliente_id
  LEFT JOIN cat_elemento el ON el.id = et.cat_elemento_id
  LEFT JOIN usuario uc ON uc.id = et.creada_por
  LEFT JOIN usuario up ON up.id = et.publicada_por`;

@Injectable()
export class EspecificacionTecnicaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
    private readonly puente: PuenteAnalisisService,
  ) {}

  /* ---------------------------------------------------------- lectura --- */

  private async laboratorios(tenantId: string) {
    return this.prisma.$queryRawUnsafe<{ id: string; codigo: string; nombre: string }[]>(
      `SELECT id, codigo, nombre FROM unidad WHERE tenant_id = $1::uuid AND activa
          AND COALESCE(tipo, 'LABORATORIO') IN ('LABORATORIO', 'SUCURSAL', 'DELEGACION') ORDER BY codigo`,
      tenantId,
    );
  }

  async listar(req: any, q: { q?: string; estado?: string; laboratorio?: string; clienteId?: string }) {
    const tenantId = tenantDe(req);
    const filtroVer = await this.alcance.filtroUnidades(req, "et.ver");
    const filtroGestion = tiene(req, "et.gestionar") ? await this.alcance.filtroUnidades(req, "et.gestionar") : undefined;
    const params: unknown[] = [tenantId];
    const cond: string[] = ["et.tenant_id = $1::uuid"];
    if (q.estado && ["borrador", "vigente", "reemplazada", "anulada"].includes(q.estado)) {
      params.push(q.estado);
      cond.push(`et.estado = $${params.length}`);
    } else if (q.estado !== "todas") cond.push(`et.estado IN ('borrador', 'vigente')`);
    if (q.q?.trim()) {
      params.push(`%${q.q.trim().slice(0, 80)}%`);
      cond.push(`(et.codigo ILIKE $${params.length} OR et.nombre ILIKE $${params.length} OR et.producto ILIKE $${params.length} OR et.licitacion ILIKE $${params.length} OR c.razon_social ILIKE $${params.length})`);
    }
    if (q.laboratorio && /^[0-9a-f-]{36}$/i.test(q.laboratorio)) {
      params.push(q.laboratorio);
      cond.push(`(cardinality(et.laboratorios) = 0 OR $${params.length}::uuid = ANY(et.laboratorios))`);
    }
    if (q.clienteId && /^[0-9a-f-]{36}$/i.test(q.clienteId)) {
      params.push(q.clienteId);
      cond.push(`(et.cliente_id IS NULL OR et.cliente_id = $${params.length}::uuid OR et.reutilizable)`);
    }
    if (filtroVer) {
      params.push(filtroVer);
      cond.push(`(cardinality(et.laboratorios) = 0 OR et.laboratorios && $${params.length}::uuid[])`);
    }
    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT ${SELECT_ET} ${FROM_ET} WHERE ${cond.join(" AND ")} ORDER BY et.codigo, et.version DESC LIMIT 500`,
      ...params,
    );
    const labs = await this.laboratorios(tenantId);
    const nombreLab = new Map(labs.map((l) => [l.id, l.codigo]));
    return {
      puedeCrear: filtroGestion !== undefined,
      laboratorios: labs,
      data: filas.map((f) => ({
        ...f,
        laboratoriosCodigos: (f.laboratorios ?? []).map((l: string) => nombreLab.get(l) ?? "?"),
        puedeGestionar: filtroGestion !== undefined && puedeGestionar(f.laboratorios ?? [], filtroGestion),
      })),
    };
  }

  /** E.T. del tenant y visible para el usuario (404 / 403). */
  private async cargar(req: any, id: string) {
    const f = await this.prisma.$queryRawUnsafe<any[]>(`SELECT ${SELECT_ET} ${FROM_ET} WHERE et.id = $1::uuid AND et.tenant_id = $2::uuid`, id, tenantDe(req));
    const et = f[0];
    if (!et) throw new NotFoundException(`Especificación técnica ${id} no encontrada`);
    if (!puedeVer(et.laboratorios ?? [], await this.alcance.filtroUnidades(req, "et.ver")))
      throw new ForbiddenException("Fuera de su alcance: la E.T. es de laboratorios que usted no tiene asignados.");
    return et;
  }

  /** E.T. que el usuario gestiona (et.gestionar con alcance sobre todos sus laboratorios). */
  private async cargarGestion(req: any, id: string) {
    const et = await this.cargar(req, id);
    if (!puedeGestionar(et.laboratorios ?? [], await this.alcance.filtroUnidades(req, "et.gestionar")))
      throw new ForbiddenException(
        (et.laboratorios ?? []).length
          ? "Fuera de su alcance: la E.T. incluye laboratorios que usted no tiene asignados."
          : "Una E.T. sin laboratorio la gestiona Calidad o Administración (alcance global).",
      );
    return et;
  }

  async detalle(req: any, id: string) {
    const et = await this.cargar(req, id);
    const tenantId = tenantDe(req);
    const [puntos, versiones, uso, labs] = await Promise.all([
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT p.id, p.orden, p.punto, p.componente, p.caracteristica, p.cat_metodo_id AS "catMetodoId", p.cat_analito_id AS "catAnalitoId",
                m.codigo AS "metodoCodigo", m.nombre AS "metodoNombre", a.nombre AS "analitoNombre",
                p.laboratorio_id AS "laboratorioId", u.codigo AS "laboratorioCodigo", p.tipo,
                p.limite_inf AS "limiteInf", p.nominal, p.limite_sup AS "limiteSup", p.unidad, p.requisito,
                p.cond2_etiqueta AS "cond2Etiqueta", p.cond2_inf::float8 AS "cond2Inf", p.cond2_sup::float8 AS "cond2Sup", p.cond2_unidad AS "cond2Unidad",
                p.plan_n AS "planN", p.plan_c AS "planC", p.plan_m::float8 AS "planM", p.plan_mm::float8 AS "planMM",
                p.clase_defecto AS "claseDefecto", p.observacion
           FROM especificacion_tecnica_punto p
           LEFT JOIN cat_metodo m ON m.id = p.cat_metodo_id
           LEFT JOIN cat_analito a ON a.id = p.cat_analito_id
           LEFT JOIN unidad u ON u.id = p.laboratorio_id
          WHERE p.et_id = $1::uuid ORDER BY p.orden, p.punto`,
        id,
      ),
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT id, version, estado, publicada_at AS "publicadaAt", motivo_version AS "motivoVersion", created_at AS "createdAt"
           FROM especificacion_tecnica WHERE tenant_id = $1::uuid AND codigo = $2 ORDER BY version DESC`,
        tenantId,
        et.codigo,
      ),
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT DISTINCT o.id, o.codigo, o.estado FROM orden_trabajo o
          WHERE o.tenant_id = $1::uuid AND (o.et_id = $2::uuid OR o.id IN (SELECT m.ot_id FROM muestra m WHERE m.et_id = $2::uuid AND m.deleted_at IS NULL))
            AND ($3::uuid[] IS NULL OR o.unidad_principal = ANY($3::uuid[]))
          ORDER BY o.codigo DESC LIMIT 50`,
        tenantId,
        id,
        // Solo las OT que el usuario puede ver.
        await this.alcance.filtroUnidades(req, "ot.ver"),
      ),
      this.laboratorios(tenantId),
    ]);
    const filtroGestion = tiene(req, "et.gestionar") ? await this.alcance.filtroUnidades(req, "et.gestionar") : undefined;
    const gestiona = filtroGestion !== undefined && puedeGestionar(et.laboratorios ?? [], filtroGestion);
    const esUltima = versiones[0]?.id === et.id;
    const nombreLab = new Map(labs.map((l) => [l.id, l.codigo]));
    return {
      ...et,
      laboratoriosCodigos: (et.laboratorios ?? []).map((l: string) => nombreLab.get(l) ?? "?"),
      puntos,
      versiones,
      uso,
      laboratorios: labs,
      erroresPublicar: et.estado === "borrador" ? erroresPublicar(puntos as PuntoEt[]) : [],
      acciones: {
        editar: gestiona && !motivoNoPermitido(et.estado, "editar"),
        publicar: gestiona && !motivoNoPermitido(et.estado, "publicar"),
        nuevaVersion: gestiona && !motivoNoPermitido(et.estado, "nueva_version", { esUltima }),
        anular: gestiona && !motivoNoPermitido(et.estado, "anular"),
        subirPdf: gestiona && !motivoNoPermitido(et.estado, "subir_pdf", { tienePdf: !!et.pdf }),
      },
    };
  }

  /**
   * Métodos del catálogo para los puntos de la E.T.: los del laboratorio (por su
   * CODSUCDEL) o, sin laboratorio, búsqueda en todo el catálogo; con sus analitos.
   */
  async metodosCatalogo(req: any, q: { laboratorio?: string; q?: string }) {
    const tenantId = tenantDe(req);
    const params: unknown[] = [tenantId];
    const cond = ["m.tenant_id = $1::uuid", "m.deleted_at IS NULL", "m.activo"];
    if (q.laboratorio && /^[0-9a-f-]{36}$/i.test(q.laboratorio)) {
      params.push(q.laboratorio);
      cond.push(`f.codsucdel = (SELECT codsucdel FROM unidad WHERE id = $${params.length}::uuid)`);
    }
    if (q.q?.trim()) {
      params.push(`%${q.q.trim().slice(0, 80)}%`);
      cond.push(`(m.codigo ILIKE $${params.length} OR m.nombre ILIKE $${params.length} OR e.nombre ILIKE $${params.length})`);
    }
    if (params.length === 1) return { metodos: [] };
    const metodos = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT m.id, m.codigo, m.nombre, m.norma, e.nombre AS ensayo,
              COALESCE((SELECT json_agg(json_build_object('id', a.id, 'nombre', a.nombre, 'unidad', a.unidad,
                                 -- Requisito del catálogo como referencia (el que regiría sin E.T.).
                                 'catalogoMin', COALESCE(e.limite_inf, a.rango_min), 'catalogoMax', COALESCE(e.limite_sup, a.rango_max)) ORDER BY a.nombre)
                          FROM cat_analito a
                          LEFT JOIN LATERAL (SELECT ce.limite_inf, ce.limite_sup FROM cat_especificacion ce
                                              WHERE ce.analito_id = a.id AND ce.deleted_at IS NULL AND ce.activo
                                              ORDER BY (ce.ambito = 'estandar') DESC, ce.created_at LIMIT 1) e ON true
                         WHERE a.metodo_id = m.id AND a.deleted_at IS NULL AND a.activo), '[]'::json) AS analitos
         FROM cat_metodo m LEFT JOIN cat_ensayo e ON e.id = m.ensayo_id LEFT JOIN cat_familia f ON f.id = e.familia_id
        WHERE ${cond.join(" AND ")}
        ORDER BY m.nombre LIMIT 200`,
      ...params,
    );
    return { metodos };
  }

  /* -------------------------------------------------------- escritura --- */

  private async validarLaboratorios(req: any, labs: string[]) {
    const tenantId = tenantDe(req);
    if (labs.length) {
      const ok = await this.prisma.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM unidad WHERE tenant_id = $1::uuid AND id = ANY($2::uuid[])`,
        tenantId,
        labs,
      );
      if (ok[0].n !== new Set(labs).size) throw new BadRequestException("Algún laboratorio indicado no existe.");
    }
    if (!puedeGestionar(labs, await this.alcance.filtroUnidades(req, "et.gestionar")))
      throw new ForbiddenException(
        labs.length
          ? "Solo puede gestionar E.T. de los laboratorios de su alcance."
          : "Indique el laboratorio de la E.T.: sin laboratorio solo la gestiona Calidad o Administración.",
      );
  }

  /**
   * B-036 · Buscador acotado de clientes para asociar la E.T. a su cliente.
   * Quien gestiona E.T. (p. ej. el Jefe del LEM) no siempre tiene «cliente.ver»:
   * aquí solo ve razón social y RUT, con un mínimo de 2 letras y 10 resultados.
   */
  async buscarClientes(req: any, q: string | undefined) {
    const t = String(q ?? "").trim().slice(0, 80);
    if (t.length < 2) return [];
    return this.prisma.$queryRawUnsafe<{ id: string; razonSocial: string; rut: string | null }[]>(
      `SELECT id, razon_social AS "razonSocial", rut FROM cliente
        WHERE tenant_id = $1::uuid AND deleted_at IS NULL AND (razon_social ILIKE $2 OR rut ILIKE $2)
        ORDER BY razon_social LIMIT 10`,
      tenantDe(req),
      `%${t.replace(/[%_\\]/g, (m) => "\\" + m)}%`,
    );
  }

  private async validarCliente(tenantId: string, clienteId?: string | null) {
    if (!clienteId) return;
    const c = await this.prisma.cliente.findFirst({ where: { id: clienteId, tenantId }, select: { id: true } });
    if (!c) throw new BadRequestException("El cliente indicado no existe.");
  }

  async crear(req: any, body: unknown) {
    const dto = CabeceraEt.parse(body ?? {});
    const tenantId = tenantDe(req);
    await this.validarLaboratorios(req, dto.laboratorios);
    await this.validarCliente(tenantId, dto.clienteId);
    const ya = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, version, estado FROM especificacion_tecnica WHERE tenant_id = $1::uuid AND upper(codigo) = upper($2) ORDER BY version DESC LIMIT 1`,
      tenantId,
      dto.codigo,
    );
    if (ya[0])
      throw new ConflictException(
        `Ya existe la E.T. ${dto.codigo} (v${ya[0].version}, ${ya[0].estado}): ábrala y use «Nueva versión» para cambiarla.`,
      );
    const f = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO especificacion_tecnica (tenant_id, codigo, version, nombre, origen, cliente_id, mandante, licitacion, producto, cat_elemento_id,
              laboratorios, reutilizable, vigente_desde, observaciones, creada_por, actualizada_por)
       VALUES ($1::uuid, $2, 1, $3, $4, $5::uuid, $6, $7, $8, $9::uuid, $10::uuid[], $11, $12::date, $13, $14::uuid, $14::uuid)
       RETURNING id`,
      tenantId,
      dto.codigo,
      dto.nombre,
      dto.origen,
      dto.clienteId ?? null,
      dto.mandante || null,
      dto.licitacion || null,
      dto.producto || null,
      dto.catElementoId ?? null,
      [...new Set(dto.laboratorios)],
      dto.reutilizable,
      dto.vigenteDesde ?? null,
      dto.observaciones || null,
      usuarioDe(req),
    );
    return this.detalle(req, f[0].id);
  }

  async editar(req: any, id: string, body: unknown) {
    const et = await this.cargarGestion(req, id);
    const bloqueo = motivoNoPermitido(et.estado, "editar");
    if (bloqueo) throw new ConflictException(bloqueo);
    const dto = EdicionEt.parse(body ?? {});
    if (dto.laboratorios) await this.validarLaboratorios(req, dto.laboratorios);
    if (dto.clienteId !== undefined) await this.validarCliente(tenantDe(req), dto.clienteId);
    const sets: string[] = [];
    const vals: unknown[] = [id];
    const set = (col: string, v: unknown, cast = "") => {
      vals.push(v);
      sets.push(`${col} = $${vals.length}${cast}`);
    };
    if (dto.nombre !== undefined) set("nombre", dto.nombre);
    if (dto.origen !== undefined) set("origen", dto.origen);
    if (dto.clienteId !== undefined) set("cliente_id", dto.clienteId, "::uuid");
    if (dto.mandante !== undefined) set("mandante", dto.mandante || null);
    if (dto.licitacion !== undefined) set("licitacion", dto.licitacion || null);
    if (dto.producto !== undefined) set("producto", dto.producto || null);
    if (dto.catElementoId !== undefined) set("cat_elemento_id", dto.catElementoId, "::uuid");
    if (dto.laboratorios !== undefined) set("laboratorios", [...new Set(dto.laboratorios)], "::uuid[]");
    if (dto.reutilizable !== undefined) set("reutilizable", dto.reutilizable);
    if (dto.vigenteDesde !== undefined) set("vigente_desde", dto.vigenteDesde, "::date");
    if (dto.observaciones !== undefined) set("observaciones", dto.observaciones || null);
    if (sets.length) {
      vals.push(usuarioDe(req));
      await this.prisma.$executeRawUnsafe(
        `UPDATE especificacion_tecnica SET ${sets.join(", ")}, actualizada_por = $${vals.length}::uuid, updated_at = now() WHERE id = $1::uuid`,
        ...vals,
      );
    }
    return this.detalle(req, id);
  }

  async guardarPuntos(req: any, id: string, body: unknown) {
    const et = await this.cargarGestion(req, id);
    const bloqueo = motivoNoPermitido(et.estado, "editar");
    if (bloqueo) throw new ConflictException(bloqueo);
    const { puntos } = PuntosBody.parse(body ?? {});
    const errores = puntos.flatMap((p, i) => erroresPunto(p as PuntoEt, `Fila ${i + 1}`));
    // Métodos y analitos del catálogo del tenant; el analito, del método indicado.
    const metodoIds = [...new Set(puntos.map((p) => p.catMetodoId).filter((x): x is string => !!x))];
    const analitoIds = [...new Set(puntos.map((p) => p.catAnalitoId).filter((x): x is string => !!x))];
    const tenantId = tenantDe(req);
    const metodos = metodoIds.length ? await this.prisma.catMetodo.findMany({ where: { id: { in: metodoIds }, tenantId }, select: { id: true } }) : [];
    const analitos = analitoIds.length
      ? await this.prisma.catAnalito.findMany({ where: { id: { in: analitoIds }, tenantId }, select: { id: true, metodoId: true } })
      : [];
    const metodoDe = new Map(analitos.map((a) => [a.id, a.metodoId]));
    puntos.forEach((p, i) => {
      if (p.catMetodoId && !metodos.some((m) => m.id === p.catMetodoId)) errores.push(`Fila ${i + 1}: el método no existe en el catálogo.`);
      if (p.catAnalitoId && metodoDe.get(p.catAnalitoId) !== p.catMetodoId) errores.push(`Fila ${i + 1}: el analito no es del método indicado.`);
    });
    if (errores.length) throw new BadRequestException(errores.join(" "));
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`DELETE FROM especificacion_tecnica_punto WHERE et_id = $1::uuid`, id);
      let orden = 0;
      for (const p of puntos) {
        orden += 10;
        await tx.$executeRawUnsafe(
          `INSERT INTO especificacion_tecnica_punto (et_id, orden, punto, componente, caracteristica, cat_metodo_id, cat_analito_id, laboratorio_id,
                  tipo, limite_inf, nominal, limite_sup, unidad, requisito, cond2_etiqueta, cond2_inf, cond2_sup, cond2_unidad,
                  plan_n, plan_c, plan_m, plan_mm, clase_defecto, observacion)
           VALUES ($1::uuid, $2, $3, $4, $5, $6::uuid, $7::uuid, $8::uuid, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)`,
          id,
          orden,
          p.punto,
          p.componente || null,
          p.caracteristica,
          p.catMetodoId ?? null,
          p.catAnalitoId ?? null,
          p.laboratorioId ?? null,
          p.tipo,
          p.limiteInf || null,
          p.nominal || null,
          p.limiteSup || null,
          p.unidad || null,
          p.requisito || null,
          p.cond2Etiqueta || null,
          p.cond2Inf ?? null,
          p.cond2Sup ?? null,
          p.cond2Unidad || null,
          p.tipo === "clases" ? p.planN ?? null : null,
          p.tipo === "clases" ? p.planC ?? null : null,
          p.tipo === "clases" ? p.planM ?? null : null,
          p.tipo === "clases" ? p.planMM ?? null : null,
          p.claseDefecto ?? null,
          p.observacion || null,
        );
      }
      await tx.$executeRawUnsafe(`UPDATE especificacion_tecnica SET actualizada_por = $2::uuid, updated_at = now() WHERE id = $1::uuid`, id, usuarioDe(req));
    });
    return this.detalle(req, id);
  }

  async publicar(req: any, id: string) {
    const et = await this.cargarGestion(req, id);
    const bloqueo = motivoNoPermitido(et.estado, "publicar");
    if (bloqueo) throw new ConflictException(bloqueo);
    const puntos = await puntosDeEt(this.prisma, id);
    const errores = erroresPublicar(puntos);
    if (errores.length) throw new BadRequestException(errores.join(" "));
    await this.prisma.$transaction(async (tx) => {
      // La versión vigente anterior queda reemplazada (las OT que la eligieron la conservan).
      await tx.$executeRawUnsafe(
        `UPDATE especificacion_tecnica SET estado = 'reemplazada', updated_at = now()
          WHERE tenant_id = $1::uuid AND codigo = $2 AND estado = 'vigente' AND id <> $3::uuid`,
        tenantDe(req),
        et.codigo,
        id,
      );
      await tx.$executeRawUnsafe(
        `UPDATE especificacion_tecnica SET estado = 'vigente', publicada_por = $2::uuid, publicada_at = now(),
                vigente_desde = COALESCE(vigente_desde, (now() AT TIME ZONE 'America/Santiago')::date), updated_at = now()
          WHERE id = $1::uuid`,
        id,
        usuarioDe(req),
      );
    });
    return this.detalle(req, id);
  }

  async nuevaVersion(req: any, id: string, body: unknown) {
    const et = await this.cargarGestion(req, id);
    const { motivo } = MotivoBody.parse(body ?? {});
    const tenantId = tenantDe(req);
    const versiones = await this.prisma.$queryRawUnsafe<{ id: string; version: number; estado: string }[]>(
      `SELECT id, version, estado FROM especificacion_tecnica WHERE tenant_id = $1::uuid AND codigo = $2 ORDER BY version DESC`,
      tenantId,
      et.codigo,
    );
    // Un borrador abierto se edita: no se crea otro (es lo más útil que decir primero).
    const borrador = versiones.find((v) => v.estado === "borrador");
    if (borrador && borrador.id !== id) throw new ConflictException(`Ya hay un borrador de la E.T. ${et.codigo} (v${borrador.version}): edítelo.`);
    const bloqueo = motivoNoPermitido(et.estado, "nueva_version", { esUltima: versiones[0]?.id === id });
    if (bloqueo) throw new ConflictException(bloqueo);
    const version = siguienteVersion(versiones.map((v) => v.version));
    const nueva = await this.prisma.$transaction(async (tx) => {
      const f = await tx.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO especificacion_tecnica (tenant_id, codigo, version, nombre, origen, cliente_id, mandante, licitacion, producto, cat_elemento_id,
                laboratorios, reutilizable, observaciones, reemplaza_id, motivo_version, creada_por, actualizada_por)
         SELECT tenant_id, codigo, $2, nombre, origen, cliente_id, mandante, licitacion, producto, cat_elemento_id,
                laboratorios, reutilizable, observaciones, id, $3, $4::uuid, $4::uuid
           FROM especificacion_tecnica WHERE id = $1::uuid
         RETURNING id`,
        id,
        version,
        motivo,
        usuarioDe(req),
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO especificacion_tecnica_punto (et_id, orden, punto, componente, caracteristica, cat_metodo_id, cat_analito_id, laboratorio_id,
                tipo, limite_inf, nominal, limite_sup, unidad, requisito, cond2_etiqueta, cond2_inf, cond2_sup, cond2_unidad,
                plan_n, plan_c, plan_m, plan_mm, clase_defecto, observacion)
         SELECT $2::uuid, orden, punto, componente, caracteristica, cat_metodo_id, cat_analito_id, laboratorio_id,
                tipo, limite_inf, nominal, limite_sup, unidad, requisito, cond2_etiqueta, cond2_inf, cond2_sup, cond2_unidad,
                plan_n, plan_c, plan_m, plan_mm, clase_defecto, observacion
           FROM especificacion_tecnica_punto WHERE et_id = $1::uuid`,
        id,
        f[0].id,
      );
      return f[0].id;
    });
    return this.detalle(req, nueva);
  }

  async anular(req: any, id: string, body: unknown) {
    const et = await this.cargarGestion(req, id);
    const bloqueo = motivoNoPermitido(et.estado, "anular");
    if (bloqueo) throw new ConflictException(bloqueo);
    const { motivo } = MotivoBody.parse(body ?? {});
    await this.prisma.$executeRawUnsafe(
      `UPDATE especificacion_tecnica SET estado = 'anulada', anulada_por = $2::uuid, anulada_at = now(), anulada_motivo = $3, updated_at = now()
        WHERE id = $1::uuid`,
      id,
      usuarioDe(req),
      motivo,
    );
    return this.detalle(req, id);
  }

  async subirPdf(req: any, id: string, archivo: ArchivoSubido | undefined) {
    const et = await this.cargarGestion(req, id);
    const bloqueo = motivoNoPermitido(et.estado, "subir_pdf", { tienePdf: !!et.pdf });
    if (bloqueo) throw new ConflictException(bloqueo);
    if (!archivo?.buffer?.length) throw new BadRequestException("Adjunte el PDF de la E.T.");
    if (archivo.buffer.length > MAX_PDF_ET) throw new BadRequestException("El PDF no puede superar 10 MB.");
    if (archivo.buffer.subarray(0, 5).toString("latin1") !== "%PDF-") throw new BadRequestException("El archivo no es un PDF válido.");
    const nombre = (archivo.originalname ?? "especificacion.pdf").replace(/[^\p{L}\p{N} ._-]/gu, "_").slice(0, 200);
    const hash = createHash("sha256").update(archivo.buffer).digest("hex");
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO especificacion_tecnica_pdf (et_id, nombre, bytes, hash_sha256, datos, subido_por)
       VALUES ($1::uuid, $2, $3, $4, $5, $6::uuid)
       ON CONFLICT (et_id) DO UPDATE SET nombre = EXCLUDED.nombre, bytes = EXCLUDED.bytes, hash_sha256 = EXCLUDED.hash_sha256,
              datos = EXCLUDED.datos, subido_por = EXCLUDED.subido_por, subido_at = now()`,
      id,
      nombre,
      archivo.buffer.length,
      hash,
      archivo.buffer.toString("base64"),
      usuarioDe(req),
    );
    return this.detalle(req, id);
  }

  async pdf(req: any, id: string) {
    await this.cargar(req, id);
    const f = await this.prisma.$queryRawUnsafe<{ nombre: string; datos: string; hash_sha256: string }[]>(
      `SELECT nombre, datos, hash_sha256 FROM especificacion_tecnica_pdf WHERE et_id = $1::uuid`,
      id,
    );
    if (!f[0]) throw new NotFoundException("La E.T. no tiene PDF.");
    return { nombre: f[0].nombre, datos: Buffer.from(f[0].datos, "base64"), hash: f[0].hash_sha256 };
  }

  /* ------------------------------------------------------------ en la OT --- */

  private async otEnAlcance(req: any, otId: string, permiso?: string | string[]) {
    const ot = await this.prisma.ordenTrabajo.findFirst({
      where: { id: otId, tenantId: tenantDe(req) },
      select: { id: true, codigo: true, estado: true, unidadPrincipal: true, clienteId: true },
    });
    if (!ot) throw new NotFoundException(`Orden de trabajo ${otId} no encontrada`);
    await this.alcance.exigirUnidad(req, ot.unidadPrincipal, `la OT ${ot.codigo}`, permiso);
    return ot;
  }

  /** E.T. elegible para la OT (vigente, del cliente o reutilizable, del laboratorio). 400 con el motivo si no. */
  private async etAsignable(tenantId: string, etId: string, ot: { clienteId: string; unidadPrincipal: string | null }) {
    const f = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, codigo, version, estado, reutilizable, cliente_id AS "clienteId", laboratorios FROM especificacion_tecnica
        WHERE id = $1::uuid AND tenant_id = $2::uuid`,
      etId,
      tenantId,
    );
    if (!f[0]) throw new BadRequestException("La E.T. indicada no existe.");
    const errores = erroresAsignacion({ ...f[0], laboratorios: f[0].laboratorios ?? [] }, { clienteId: ot.clienteId, unidadId: ot.unidadPrincipal });
    if (errores.length) throw new BadRequestException(errores.join(" "));
    return f[0] as { id: string; codigo: string; version: number };
  }

  async deOt(req: any, otId: string) {
    const ot = await this.otEnAlcance(req, otId, "ot.ver");
    const tenantId = tenantDe(req);
    const [actual, muestras, elegibles, conteo] = await Promise.all([
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT et.id, et.codigo, et.version, et.nombre, et.estado, et.licitacion, et.producto,
                (SELECT count(*)::int FROM especificacion_tecnica_punto p WHERE p.et_id = et.id) AS "nPuntos",
                EXISTS (SELECT 1 FROM especificacion_tecnica_pdf f WHERE f.et_id = et.id) AS "tienePdf",
                o.et_asignada_at AS "asignadaAt", u.nombre_completo AS "asignadaPorNombre"
           FROM orden_trabajo o JOIN especificacion_tecnica et ON et.id = o.et_id LEFT JOIN usuario u ON u.id = o.et_asignada_por
          WHERE o.id = $1::uuid`,
        otId,
      ),
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT m.id, m.codigo, m.nombre, m.parent_muestra_id AS "padreId", m.et_componente AS componente,
                et.id AS "etId", et.codigo AS "etCodigo", et.version AS "etVersion"
           FROM muestra m LEFT JOIN especificacion_tecnica et ON et.id = m.et_id
          WHERE m.ot_id = $1::uuid AND m.deleted_at IS NULL ORDER BY m.codigo`,
        otId,
      ),
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT et.id, et.codigo, et.version, et.nombre, et.licitacion, et.producto, c.razon_social AS "clienteNombre"
           FROM especificacion_tecnica et LEFT JOIN cliente c ON c.id = et.cliente_id
          WHERE et.tenant_id = $1::uuid AND et.estado = 'vigente'
            AND (et.reutilizable OR et.cliente_id IS NULL OR et.cliente_id = $2::uuid)
            AND (cardinality(et.laboratorios) = 0 OR $3::uuid IS NULL OR $3::uuid = ANY(et.laboratorios))
          ORDER BY et.codigo LIMIT 300`,
        tenantId,
        ot.clienteId,
        ot.unidadPrincipal,
      ),
      this.prisma.$queryRawUnsafe<{ total: number; de_et: number }[]>(
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE espec_origen = 'et')::int AS de_et
           FROM resultado r JOIN muestra m ON m.id = r.muestra_id WHERE m.ot_id = $1::uuid AND r.deleted_at IS NULL AND m.deleted_at IS NULL`,
        otId,
      ),
    ]);
    const abierta = !["cerrada", "anulada"].includes(ot.estado);
    return {
      ot,
      et: actual[0] ?? null,
      muestras,
      elegibles,
      ensayos: { total: conteo[0]?.total ?? 0, deEt: conteo[0]?.de_et ?? 0 },
      puede: {
        elegir: abierta && (tiene(req, "ot.crear") || tiene(req, "muestra.crear")),
        aplicar: abierta && tiene(req, "resultado.crear"),
        desglosar: abierta && tiene(req, "muestra.crear"),
      },
    };
  }

  async asignarOt(req: any, otId: string, body: unknown) {
    exigirAlguno(req, ["ot.crear", "muestra.crear"]);
    const permisos = ["ot.crear", "muestra.crear"].filter((p) => tiene(req, p));
    const ot = await this.otEnAlcance(req, otId, permisos[0]);
    if (["cerrada", "anulada"].includes(ot.estado)) throw new ConflictException(`La OT ${ot.codigo} está ${ot.estado}.`);
    const dto = AsignarBody.parse(body ?? {});
    const tenantId = tenantDe(req);
    const et = dto.etId ? await this.etAsignable(tenantId, dto.etId, ot) : null;
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE orden_trabajo SET et_id = $2::uuid, et_asignada_por = $3::uuid, et_asignada_at = now(), updated_at = now() WHERE id = $1::uuid`,
        otId,
        et?.id ?? null,
        usuarioDe(req),
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO ot_historial (tenant_id, ot_id, tipo, detalle, usuario_id) VALUES ($1::uuid, $2::uuid, 'especificacion_tecnica', $3::jsonb, $4::uuid)`,
        tenantId,
        otId,
        JSON.stringify({ et: et ? `${et.codigo} v${et.version}` : null }),
        usuarioDe(req),
      );
    });
    const aplicado = dto.aplicar && et && tiene(req, "resultado.crear") ? await this.aplicarOt(req, otId) : null;
    return { ...(await this.deOt(req, otId)), aplicado };
  }

  async asignarMuestra(req: any, muestraId: string, body: unknown) {
    const m = await this.prisma.muestra.findFirst({ where: { id: muestraId, tenantId: tenantDe(req), deletedAt: null }, select: { id: true, otId: true, codigo: true } });
    if (!m?.otId) throw new NotFoundException(`Muestra ${muestraId} no encontrada`);
    const ot = await this.otEnAlcance(req, m.otId, "muestra.crear");
    if (["cerrada", "anulada"].includes(ot.estado)) throw new ConflictException(`La OT ${ot.codigo} está ${ot.estado}.`);
    const dto = AsignarBody.parse(body ?? {});
    const et = dto.etId ? await this.etAsignable(tenantDe(req), dto.etId, ot) : null;
    await this.prisma.$executeRawUnsafe(`UPDATE muestra SET et_id = $2::uuid WHERE id = $1::uuid`, muestraId, et?.id ?? null);
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO ot_historial (tenant_id, ot_id, tipo, detalle, usuario_id) VALUES ($1::uuid, $2::uuid, 'especificacion_tecnica', $3::jsonb, $4::uuid)`,
      tenantDe(req),
      ot.id,
      JSON.stringify({ muestra: m.codigo, et: et ? `${et.codigo} v${et.version}` : null }),
      usuarioDe(req),
    );
    const aplicado = dto.aplicar && et && tiene(req, "resultado.crear") ? await this.aplicarMuestras(req, [muestraId]) : null;
    return { ...(await this.deOt(req, ot.id)), aplicado };
  }

  private async aplicarMuestras(req: any, muestraIds: string[]) {
    const tenantId = tenantDe(req);
    // Cambiar lo que vino del catálogo es de la jefatura (resultado.aprobar en el laboratorio).
    const esJefatura = tiene(req, "resultado.aprobar");
    const resumenes = [];
    for (const id of muestraIds) {
      const r = await aplicarEtAMuestra(this.prisma, tenantId, id, { usuarioId: usuarioDe(req), esJefatura });
      if (r) {
        await recalcularVeredictoMuestra(this.prisma, id);
        resumenes.push({ muestraId: id, ...r });
      }
    }
    return {
      muestras: resumenes,
      aplicados: resumenes.reduce((s, r) => s + r.aplicados, 0),
      sinPunto: resumenes.reduce((s, r) => s + r.sinPunto, 0),
      omitidos: resumenes.flatMap((r) => r.omitidos),
    };
  }

  /** «Aplicar requisitos de la E.T. → veredicto» en todas las muestras de la OT. */
  async aplicarOt(req: any, otId: string) {
    const ot = await this.otEnAlcance(req, otId, "resultado.crear");
    if (["cerrada", "anulada"].includes(ot.estado)) throw new ConflictException(`La OT ${ot.codigo} está ${ot.estado}.`);
    const muestras = await this.prisma.muestra.findMany({ where: { otId, deletedAt: null }, select: { id: true } });
    const r = await this.aplicarMuestras(req, muestras.map((m) => m.id));
    if (!r.muestras.length) throw new ConflictException("Ni la OT ni sus muestras tienen una E.T. elegida.");
    return r;
  }

  /* ------------------------------------------------------- desglose --- */

  private async muestraEnAlcance(req: any, muestraId: string, permiso: string) {
    const m = await this.prisma.muestra.findFirst({ where: { id: muestraId, tenantId: tenantDe(req), deletedAt: null } });
    if (!m?.otId) throw new NotFoundException(`Muestra ${muestraId} no encontrada`);
    const ot = await this.otEnAlcance(req, m.otId, permiso);
    return { m, ot };
  }

  async desglose(req: any, muestraId: string) {
    const { m, ot } = await this.muestraEnAlcance(req, muestraId, "muestra.ver");
    const f = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT et.id, et.codigo, et.version, et.nombre FROM muestra mu LEFT JOIN orden_trabajo o ON o.id = mu.ot_id
         JOIN especificacion_tecnica et ON et.id = COALESCE(mu.et_id, o.et_id) WHERE mu.id = $1::uuid`,
      muestraId,
    );
    const et = f[0] ?? null;
    const hijas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, codigo, nombre, et_componente AS componente,
              (SELECT count(*)::int FROM resultado r WHERE r.muestra_id = m.id AND r.deleted_at IS NULL) AS ensayos
         FROM muestra m WHERE parent_muestra_id = $1::uuid AND deleted_at IS NULL ORDER BY codigo`,
      muestraId,
    );
    if (!et) return { muestra: { id: m.id, codigo: m.codigo, nombre: m.nombre }, ot, et: null, plan: null, submuestras: hijas };
    const puntos = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT p.id, p.punto, p.componente, p.caracteristica, p.tipo, p.cat_metodo_id AS "catMetodoId", p.cat_analito_id AS "catAnalitoId",
              p.limite_inf AS "limiteInf", p.nominal, p.limite_sup AS "limiteSup", p.unidad, p.requisito,
              m.codigo AS "metodoCodigo", m.nombre AS "metodoNombre", u.codigo AS "laboratorioCodigo"
         FROM especificacion_tecnica_punto p LEFT JOIN cat_metodo m ON m.id = p.cat_metodo_id LEFT JOIN unidad u ON u.id = p.laboratorio_id
        WHERE p.et_id = $1::uuid ORDER BY p.orden, p.punto`,
      et.id,
    );
    const plan = planDesglose(puntos as PuntoEt[]);
    const hechos = new Set(hijas.map((h) => String(h.componente ?? "").toLowerCase()));
    return {
      muestra: { id: m.id, codigo: m.codigo, nombre: m.nombre },
      ot,
      et,
      plan: { ...plan, componentes: plan.componentes.map((c) => ({ ...c, yaDesglosado: hechos.has(c.nombre.toLowerCase()) })) },
      submuestras: hijas,
    };
  }

  /**
   * «Confirmar plan de ensayos → asignar» (EP-03 1.3): cada componente de la E.T.
   * pasa a ser una submuestra trazable (<muestra>-C<k>, parent_muestra_id) con
   * los ensayos de sus puntos; los ensayos del producto y el checklist de
   * inspecciones quedan en la muestra del producto (las inspecciones no son
   * muestras). Los requisitos salen de la E.T. Idempotente: un componente ya
   * desglosado no se repite.
   */
  async desglosar(req: any, muestraId: string, body: unknown) {
    const { m, ot } = await this.muestraEnAlcance(req, muestraId, "muestra.crear");
    if (["cerrada", "anulada"].includes(ot.estado)) throw new ConflictException(`La OT ${ot.codigo} está ${ot.estado}.`);
    const dto = DesgloseBody.parse(body ?? {});
    const d = await this.desglose(req, muestraId);
    if (!d.et || !d.plan) throw new ConflictException("La muestra no tiene una E.T. con puntos: elíjala en la OT o en la muestra.");
    if (await this.esSubmuestra(muestraId))
      throw new ConflictException("Esta muestra ya es un componente: desglose la muestra del producto.");
    const elegidos = dto.componentes ? new Set(dto.componentes.map((c) => c.toLowerCase())) : null;
    const tenantId = tenantDe(req);
    const creadas = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRawUnsafe(`SELECT id FROM muestra WHERE id = $1::uuid FOR UPDATE`, muestraId);
        const hechas: { codigo: string; componente: string; ensayos: number }[] = [];
        // Ensayos del producto e inspecciones en la muestra del producto.
        const delProducto = [...new Set([...d.plan!.producto.metodoIds, ...d.plan!.inspecciones.metodoIds])];
        let ensayosProducto = 0;
        if (delProducto.length)
          ensayosProducto = (await this.puente.generarAnalisis(ot.id, { muestraId, metodoIds: delProducto }, tenantId, req, tx)).creados;
        // B-033: los puntos «Inspección» sin ensayo del catálogo forman el checklist: un ítem de
        // atributo por punto (Cumple / No cumple), ligado al punto. Idempotente por punto.
        for (const p of d.plan!.inspecciones.sinEnsayo ?? []) {
          const espec = especDePunto(p);
          const n = await tx.$executeRawUnsafe(
            `INSERT INTO resultado (tenant_id, ot_id, muestra_id, et_punto_id, estado, tipo_dato, requisito, unidad, clase_defecto, espec_origen, espec_fuente, replicas, veredicto)
             SELECT $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'pendiente', 'atributo', $5, $6, $7, 'et', $8, '[]'::jsonb, 'pendiente'
              WHERE NOT EXISTS (SELECT 1 FROM resultado r WHERE r.muestra_id = $3::uuid AND r.et_punto_id = $4::uuid AND r.deleted_at IS NULL)`,
            tenantId,
            ot.id,
            muestraId,
            p.id,
            espec.requisito ?? p.caracteristica ?? null,
            espec.unidad,
            espec.claseDefecto,
            `E.T. ${d.et!.codigo} v${d.et!.version} · punto ${p.punto}`.slice(0, 240),
          );
          ensayosProducto += Number(n) || 0;
        }
        const existentes = await tx.muestra.findMany({ where: { tenantId, codigo: { startsWith: m.codigo } }, select: { codigo: true } });
        const codigos = existentes.map((e) => e.codigo);
        const yaHechos = new Set(
          (
            await tx.$queryRawUnsafe<{ c: string }[]>(
              `SELECT lower(et_componente) AS c FROM muestra WHERE parent_muestra_id = $1::uuid AND deleted_at IS NULL`,
              muestraId,
            )
          ).map((x) => x.c),
        );
        for (const c of d.plan!.componentes) {
          if (yaHechos.has(c.nombre.toLowerCase()) || (elegidos && !elegidos.has(c.nombre.toLowerCase()))) continue;
          const codigo = codigoSubmuestra(m.codigo, codigos);
          codigos.push(codigo);
          const f = await tx.$queryRawUnsafe<{ id: string }[]>(
            `INSERT INTO muestra (tenant_id, ot_id, codigo, nombre, cliente_id, estado, cat_elemento_id, parent_muestra_id, et_componente,
                    toma_muestra, condicion_recepcion, condicion_observacion, sello_numero, identificacion_cliente, sellos_verificados,
                    recepcionada_at, recepcionada_por, muestreo_id)
             SELECT tenant_id, ot_id, $2, $3, cliente_id, estado, cat_elemento_id, id, $4,
                    toma_muestra, condicion_recepcion, condicion_observacion, sello_numero, identificacion_cliente, sellos_verificados,
                    recepcionada_at, recepcionada_por, muestreo_id
               FROM muestra WHERE id = $1::uuid
             RETURNING id`,
            muestraId,
            codigo,
            `${m.nombre ?? m.codigo} · ${c.nombre}`.slice(0, 200),
            c.nombre,
          );
          const g = await this.puente.generarAnalisis(ot.id, { muestraId: f[0].id, metodoIds: c.metodoIds }, tenantId, req, tx);
          hechas.push({ codigo, componente: c.nombre, ensayos: g.creados });
        }
        await tx.$executeRawUnsafe(
          `INSERT INTO ot_historial (tenant_id, ot_id, tipo, detalle, usuario_id) VALUES ($1::uuid, $2::uuid, 'desglose_componentes', $3::jsonb, $4::uuid)`,
          tenantId,
          ot.id,
          JSON.stringify({ muestra: m.codigo, et: `${d.et!.codigo} v${d.et!.version}`, submuestras: hechas, ensayosProducto }),
          usuarioDe(req),
        );
        return { submuestras: hechas, ensayosProducto };
      },
      { maxWait: 15_000, timeout: 120_000 },
    );
    return { ...(await this.desglose(req, muestraId)), creadas };
  }

  private async esSubmuestra(muestraId: string) {
    const f = await this.prisma.$queryRawUnsafe<{ p: string | null }[]>(`SELECT parent_muestra_id AS p FROM muestra WHERE id = $1::uuid`, muestraId);
    return !!f[0]?.p;
  }

  /* --------------------------------------------------- clase de la NC --- */

  /** Clase de la no conformidad (EP-05 5.2): la trae la E.T.; la jefatura la cambia con motivo. */
  async clase(req: any, resultadoId: string, body: unknown) {
    const dto = ClaseBody.parse(body ?? {});
    const r = await this.prisma.resultado.findFirst({
      where: { id: resultadoId, deletedAt: null, muestra: { tenantId: tenantDe(req) } },
      select: { id: true, otId: true, estado: true, claseDefecto: true, muestra: { select: { otId: true, codigo: true } } },
    });
    if (!r) throw new NotFoundException(`Resultado ${resultadoId} no encontrado`);
    const ot = await this.otEnAlcance(req, r.otId ?? r.muestra.otId!, "resultado.aprobar");
    if (["cerrada", "anulada"].includes(ot.estado)) throw new ConflictException(`La OT ${ot.codigo} está ${ot.estado}.`);
    if (r.estado === "aprobado") throw new ConflictException("El resultado está aprobado: su clase ya no cambia (reábralo si corresponde).");
    if ((r.claseDefecto ?? null) === dto.clase) return { id: r.id, claseDefecto: r.claseDefecto };
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE resultado SET clase_defecto = $2, clase_defecto_por = $3::uuid, clase_defecto_at = now() WHERE id = $1::uuid`,
        r.id,
        dto.clase,
        usuarioDe(req),
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO ot_historial (tenant_id, ot_id, tipo, detalle, usuario_id) VALUES ($1::uuid, $2::uuid, 'clase_defecto', $3::jsonb, $4::uuid)`,
        tenantDe(req),
        ot.id,
        JSON.stringify({ muestra: r.muestra.codigo, resultadoId: r.id, antes: r.claseDefecto ?? null, despues: dto.clase, motivo: dto.motivo }),
        usuarioDe(req),
      );
    });
    return { id: r.id, claseDefecto: dto.clase };
  }
}

@ApiTags("especificaciones-tecnicas")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("especificaciones-tecnicas")
export class EspecificacionTecnicaController {
  constructor(private readonly svc: EspecificacionTecnicaService) {}

  /* --- rutas de la OT (antes que «:id») --- */

  @Get("ot/:otId")
  @RequierePermiso("ot.ver")
  @ApiOperation({ summary: "E.T. de la OT y de sus muestras, E.T. elegibles y cuántos ensayos ya la aplican" })
  deOt(@Param("otId", ParseUUIDPipe) otId: string, @Req() req: any) {
    return this.svc.deOt(req, otId);
  }

  @Put("ot/:otId")
  @ApiOperation({ summary: "Elegir (o quitar) la E.T. de la OT · ot.crear o muestra.crear" })
  asignarOt(@Param("otId", ParseUUIDPipe) otId: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.asignarOt(req, otId, body);
  }

  @Post("ot/:otId/aplicar")
  @RequierePermiso("resultado.crear")
  @ApiOperation({ summary: "«Aplicar requisitos de la E.T. → veredicto» a los ensayos de la OT" })
  aplicar(@Param("otId", ParseUUIDPipe) otId: string, @Req() req: any) {
    return this.svc.aplicarOt(req, otId);
  }

  @Put("muestra/:id")
  @RequierePermiso("muestra.crear")
  @ApiOperation({ summary: "E.T. propia de una muestra (manda sobre la de la OT)" })
  asignarMuestra(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.asignarMuestra(req, id, body);
  }

  @Get("muestra/:id/desglose")
  @RequierePermiso("muestra.ver")
  @ApiOperation({ summary: "Árbol producto → componentes e inspecciones de la E.T. de la muestra" })
  desglose(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.desglose(req, id);
  }

  @Post("muestra/:id/desglose")
  @RequierePermiso("muestra.crear")
  @ApiOperation({ summary: "«Confirmar plan de ensayos → asignar»: submuestras por componente e inspecciones" })
  desglosar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.desglosar(req, id, body);
  }

  @Put("resultado/:id/clase")
  @RequierePermiso("resultado.aprobar")
  @ApiOperation({ summary: "Clase de la no conformidad (crítico, mayor, menor), con motivo" })
  clase(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.clase(req, id, body);
  }

  /* --- biblioteca --- */

  @Get("clientes")
  @RequierePermiso("et.gestionar")
  @ApiOperation({ summary: "Buscador acotado de clientes (razón social y RUT) para asociar la E.T. a su cliente (?q=, mín. 2 letras)" })
  buscarClientes(@Query("q") q: string | undefined, @Req() req: any) {
    return this.svc.buscarClientes(req, q);
  }

  @Get("catalogo/metodos")
  @RequierePermiso("et.ver")
  @ApiOperation({ summary: "Métodos del catálogo (del laboratorio o por texto) con sus analitos, para los puntos de la E.T." })
  metodosCatalogo(@Query() q: any, @Req() req: any) {
    return this.svc.metodosCatalogo(req, { laboratorio: q?.laboratorio, q: q?.q });
  }

  @Get()
  @RequierePermiso("et.ver")
  listar(@Query() q: any, @Req() req: any) {
    return this.svc.listar(req, { q: q?.q, estado: q?.estado, laboratorio: q?.laboratorio, clienteId: q?.clienteId });
  }

  @Post()
  @RequierePermiso("et.gestionar")
  crear(@Body() body: unknown, @Req() req: any) {
    return this.svc.crear(req, body);
  }

  @Get(":id")
  @RequierePermiso("et.ver")
  detalle(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.detalle(req, id);
  }

  @Put(":id")
  @RequierePermiso("et.gestionar")
  editar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.editar(req, id, body);
  }

  @Put(":id/puntos")
  @RequierePermiso("et.gestionar")
  puntos(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.guardarPuntos(req, id, body);
  }

  @Post(":id/publicar")
  @RequierePermiso("et.gestionar")
  publicar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.publicar(req, id);
  }

  @Post(":id/nueva-version")
  @RequierePermiso("et.gestionar")
  nuevaVersion(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.nuevaVersion(req, id, body);
  }

  @Post(":id/anular")
  @RequierePermiso("et.gestionar")
  anular(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.anular(req, id, body);
  }

  @Post(":id/pdf")
  @RequierePermiso("et.gestionar")
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("archivo", { limits: { fileSize: MAX_PDF_ET, files: 1, fields: 5 } }))
  subirPdf(@Param("id", ParseUUIDPipe) id: string, @UploadedFile() archivo: ArchivoSubido | undefined, @Req() req: any) {
    return this.svc.subirPdf(req, id, archivo);
  }

  @Get(":id/pdf")
  @RequierePermiso("et.ver")
  async pdf(@Param("id", ParseUUIDPipe) id: string, @Req() req: any, @Res() res: Response) {
    const f = await this.svc.pdf(req, id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", String(f.datos.length));
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(f.nombre)}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, max-age=300");
    res.end(f.datos);
  }
}

@Module({
  imports: [FlujoRealModule],
  controllers: [EspecificacionTecnicaController],
  providers: [EspecificacionTecnicaService],
})
export class EspecificacionTecnicaModule {}
