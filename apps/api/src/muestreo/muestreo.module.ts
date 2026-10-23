/**
 * Registro de muestreo de la OT y plan NCh 43/44 · LIMS IDIC. Reglas puras:
 * nch44.ts y reglas-muestreo.ts. SQL: align_r2b_muestreo.sql. Contrato:
 * docs/FLUJO_ESPECIFICACIONES_MUESTREO.md.
 *
 *   GET    /muestreo/plan                    ot.ver · propuesta NCh 44 (letra, n, Ac/Re) y período NCh 43
 *   GET    /muestreo/ot/:otId                ot.ver · muestreos de la OT, valores por defecto y qué puede hacer
 *   POST   /muestreo/ot/:otId                muestreo.registrar · nuevo muestreo (borrador)
 *   PUT    /muestreo/:id                     muestreo.registrar · datos y plan (borrador)
 *   POST   /muestreo/:id/seleccion           muestreo.registrar · unidades por selección sistemática NCh 43
 *   PUT    /muestreo/:id/unidades            muestreo.registrar · tabla de unidades (serie, talla, panel)
 *   POST   /muestreo/:id/unidades/:uid/reemplazo  muestreo.registrar · reemplazo de una unidad (motivo)
 *   POST   /muestreo/:id/registrar           muestreo.registrar · «Registrar muestreo → entregar al laboratorio»
 *   POST   /muestreo/:id/recibir             muestra.crear · «recibido conforme» (o no conforme, con motivo)
 *   PUT    /muestreo/:id/muestras            muestra.crear · muestras de la OT que salen de este muestreo
 *   POST   /muestreo/:id/anular              muestreo.registrar · con motivo (antes de recibirlo)
 *   POST   /muestreo/:id/fotos               muestreo.registrar · registro fotográfico (PNG o JPEG)
 *   GET    /muestreo/fotos/:fotoId/imagen    ot.ver
 *   DELETE /muestreo/fotos/:fotoId           muestreo.registrar (antes de recibirlo)
 *   GET    /muestreo/:id/conclusion          ot.ver · veredicto del lote propuesto (no conformidades por clase vs Ac/Re)
 *   POST   /muestreo/:id/concluir            resultado.aprobar · «Concluir → revisión técnica»
 */
import { precargaMuestreo } from "./reglas-muestreo";
import {
  BadRequestException,
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
import { createHash, randomInt } from "crypto";
import { z } from "zod";
import { PrismaService } from "../common/prisma.service";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { AlcanceService } from "../rbac/alcance.service";
import { errorDimensionesFoto, tipoImagen } from "../plantilla-render/reglas-fotos";
import {
  AQLS,
  CLASES_DEFECTO,
  ETIQUETA_NIVEL,
  NIVELES,
  PlanError,
  TABLAS,
  periodoExtraccion,
  proponerPlan,
  seleccionSistematica,
  veredictoLote,
  type ClaseDefecto,
  type Nivel,
  type ReglaSinPlan,
  type Tabla,
} from "./nch44";
import {
  ETIQUETA_FORMULARIO,
  TIPOS_FORMULARIO,
  contarDefectuosas,
  erroresRecepcion,
  faltantesRegistro,
  motivoNoEditable,
  normalizarPlan,
  normalizarSellos,
  type EstadoMuestreo,
  type PlanGuardado,
} from "./reglas-muestreo";

const tenantDe = (req: any): string => req?.user?.tenantId;
const usuarioDe = (req: any): string | null => req?.user?.sub ?? null;
const tiene = (req: any, p: string) => (req?.user?.roles ?? []).includes("SUPERADMIN") || (req?.user?.permisos ?? []).includes(p);

const MAX_FOTO = 2 * 1024 * 1024;
const MAX_FOTOS_MUESTREO = 30;
type ArchivoSubido = { buffer: Buffer; originalname?: string };

const texto = (max: number) => z.string().trim().max(max).nullable().optional();
const aqlCampo = z.union([z.string().max(10), z.number(), z.null()]).optional();
const PlanBody = z
  .object({
    nivel: z.enum(NIVELES).optional(),
    tabla: z.enum(TABLAS).optional(),
    aql: z.object({ critico: aqlCampo, mayor: aqlCampo, menor: aqlCampo }).partial().optional(),
    n: z.number().int().nullable().optional(),
    motivoN: texto(500),
    manual: z
      .object(Object.fromEntries(CLASES_DEFECTO.map((c) => [c, z.object({ ac: z.number().int(), re: z.number().int() }).optional()])))
      .partial()
      .optional(),
    seleccion: z
      .object({ metodo: z.enum(["sistematica", "aleatoria", "manual"]).optional(), inicio: z.number().int().nullable().optional(), paso: z.number().int().nullable().optional() })
      .optional(),
  })
  .strict();
const DatosBody = z
  .object({
    tipoFormulario: z.enum(TIPOS_FORMULARIO).optional(),
    numeroFormulario: texto(60),
    lugar: texto(240),
    fechaToma: z.string().max(40).nullable().optional(),
    responsable: texto(200),
    solicitadoPor: texto(200),
    producto: texto(240),
    catElementoId: z.string().uuid().nullable().optional(),
    proveedor: texto(240),
    guiaDespacho: texto(60),
    identificacionLote: texto(120),
    fechaElaboracion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD").nullable().optional(),
    tamanoLote: z.number().int().positive().nullable().optional(),
    unidadPresentacion: texto(40),
    tamanoMuestra: z.number().int().positive().nullable().optional(),
    cantidadEnvase: texto(200),
    materialAdicional: texto(2000),
    sellos: z.union([z.string().max(4000), z.array(z.string().max(60)).max(100)]).nullable().optional(),
    registroFotoNumero: texto(60),
    devolucionExcedente: z.boolean().nullable().optional(),
    costoUf: z.number().nonnegative().max(1_000_000).nullable().optional(),
    tiempoRespuesta: texto(60),
    observaciones: texto(4000),
    lineaMovil: z.boolean().optional(),
    lineaMovilPlan: texto(2000),
    /** Plan NCh 44 (null = quitarlo). */
    plan: PlanBody.nullable().optional(),
  })
  .strict();
const SeleccionBody = z
  .object({ inicio: z.number().int().nullable().optional(), paso: z.number().int().nullable().optional(), sortear: z.boolean().optional() })
  .strict();
const UnidadesBody = z
  .object({
    unidades: z
      .array(
        z
          .object({
            posicion: z.number().int().positive().nullable().optional(),
            identificacion: texto(120),
            talla: texto(40),
            ubicacion: texto(80),
          })
          .strict(),
      )
      .max(2000),
  })
  .strict();
const ReemplazoBody = z
  .object({
    identificacion: z.string().trim().min(1, "Indique la unidad de reemplazo").max(120),
    posicion: z.number().int().positive().nullable().optional(),
    motivo: z.string({ required_error: "Indique el motivo del reemplazo (mínimo 5 caracteres)." }).trim().min(5, "Indique el motivo del reemplazo (mínimo 5 caracteres).").max(1000),
  })
  .strict();
const RecibirBody = z.object({ conforme: z.boolean(), observacion: texto(2000) }).strict();
const MuestrasBody = z.object({ muestraIds: z.array(z.string().uuid()).max(500) }).strict();
const MotivoBody = z.object({ motivo: z.string({ required_error: "Indique el motivo (mínimo 5 caracteres)." }).trim().min(5, "Indique el motivo (mínimo 5 caracteres).").max(1000) }).strict();
const ConcluirBody = z
  .object({
    conclusion: z.string({ required_error: "Escriba la conclusión del lote." }).trim().min(5, "Escriba la conclusión del lote (mínimo 5 caracteres).").max(4000),
    /** Unidades no conformes verificadas por clase, si difieren de las que cuenta el sistema (con motivo). */
    defectuosas: z.object(Object.fromEntries(CLASES_DEFECTO.map((c) => [c, z.number().int().min(0).max(100000)]))).partial().optional(),
    motivo: texto(1000),
  })
  .strict();

/** Columnas del muestreo con los nombres del DTO. */
const SELECT_MUESTREO = `mu.id, mu.ot_id AS "otId", mu.numero_formulario AS "numeroFormulario", mu.tipo_formulario AS "tipoFormulario",
  mu.lugar, mu.fecha_toma AS "fechaToma", mu.responsable, mu.solicitado_por AS "solicitadoPor", mu.producto, mu.cat_elemento_id AS "catElementoId",
  mu.proveedor, mu.guia_despacho AS "guiaDespacho", mu.identificacion_lote AS "identificacionLote",
  to_char(mu.fecha_elaboracion, 'YYYY-MM-DD') AS "fechaElaboracion", mu.tamano_lote AS "tamanoLote", mu.unidad_presentacion AS "unidadPresentacion",
  mu.tamano_muestra AS "tamanoMuestra", mu.cantidad_envase AS "cantidadEnvase", mu.material_adicional AS "materialAdicional", mu.sellos,
  mu.registro_foto_numero AS "registroFotoNumero", mu.devolucion_excedente AS "devolucionExcedente", mu.costo_uf::float8 AS "costoUf",
  mu.tiempo_respuesta AS "tiempoRespuesta", mu.observaciones, mu.plan, mu.linea_movil AS "lineaMovil", mu.linea_movil_plan AS "lineaMovilPlan",
  mu.estado, mu.created_at AS "createdAt", uc.nombre_completo AS "creadoPorNombre",
  mu.registrado_at AS "registradoAt", ur.nombre_completo AS "registradoPorNombre",
  mu.recibido_conforme AS "recibidoConforme", mu.recibido_observacion AS "recibidoObservacion", mu.recibido_at AS "recibidoAt",
  urc.nombre_completo AS "recibidoPorNombre", mu.veredicto_lote AS "veredictoLote", mu.conclusion, mu.concluido_at AS "concluidoAt",
  uco.nombre_completo AS "concluidoPorNombre", mu.anulado_motivo AS "anuladoMotivo", mu.anulado_at AS "anuladoAt"`;
const FROM_MUESTREO = `FROM ot_muestreo mu
  LEFT JOIN usuario uc ON uc.id = mu.creado_por
  LEFT JOIN usuario ur ON ur.id = mu.registrado_por
  LEFT JOIN usuario urc ON urc.id = mu.recibido_por
  LEFT JOIN usuario uco ON uco.id = mu.concluido_por`;

/** Columnas del DTO → columna y conversión. */
const CAMPOS: [string, string, string][] = [
  ["tipoFormulario", "tipo_formulario", ""],
  ["numeroFormulario", "numero_formulario", ""],
  ["lugar", "lugar", ""],
  ["fechaToma", "fecha_toma", "::timestamptz"],
  ["responsable", "responsable", ""],
  ["solicitadoPor", "solicitado_por", ""],
  ["producto", "producto", ""],
  ["catElementoId", "cat_elemento_id", "::uuid"],
  ["proveedor", "proveedor", ""],
  ["guiaDespacho", "guia_despacho", ""],
  ["identificacionLote", "identificacion_lote", ""],
  ["fechaElaboracion", "fecha_elaboracion", "::date"],
  ["tamanoLote", "tamano_lote", "::int"],
  ["unidadPresentacion", "unidad_presentacion", ""],
  ["tamanoMuestra", "tamano_muestra", "::int"],
  ["cantidadEnvase", "cantidad_envase", ""],
  ["materialAdicional", "material_adicional", ""],
  ["registroFotoNumero", "registro_foto_numero", ""],
  ["devolucionExcedente", "devolucion_excedente", "::boolean"],
  ["costoUf", "costo_uf", "::numeric"],
  ["tiempoRespuesta", "tiempo_respuesta", ""],
  ["observaciones", "observaciones", ""],
  ["lineaMovil", "linea_movil", "::boolean"],
  ["lineaMovilPlan", "linea_movil_plan", ""],
];

/** Fecha y hora de la toma: ISO o «AAAA-MM-DDTHH:MM» en hora de Chile. */
function leerFechaToma(v: string | null | undefined): Date | null {
  if (v == null || v.trim() === "") return null;
  const s = v.trim();
  // Sin zona: es hora de Chile (lo que escribe el usuario en la pantalla).
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)) {
    const base = new Date(`${s}Z`);
    const enChile = new Date(base.toLocaleString("en-US", { timeZone: "America/Santiago" }));
    const enUtc = new Date(base.toLocaleString("en-US", { timeZone: "UTC" }));
    return new Date(base.getTime() + (enUtc.getTime() - enChile.getTime()));
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new BadRequestException("Fecha y hora de la toma no válidas.");
  return d;
}

@Injectable()
export class MuestreoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
  ) {}

  private async parametros(tenantId: string) {
    const f = await this.prisma.$queryRawUnsafe<{ categoria: string; codigo: string; valor: string | null }[]>(
      `SELECT categoria, codigo, valor FROM parametro_sistema
        WHERE tenant_id = $1::uuid AND activo AND categoria IN ('muestreo_plan', 'veredicto_lote')`,
      tenantId,
    );
    const v = (c: string, k: string) => f.find((x) => x.categoria === c && x.codigo === k)?.valor ?? null;
    const aql = (k: string, d: string) => {
      const x = v("muestreo_plan", k) ?? d;
      return x === "ninguno" ? null : x;
    };
    const nivel = v("muestreo_plan", "nivel");
    return {
      nivel: ((NIVELES as readonly string[]).includes(nivel ?? "") ? nivel : "II") as Nivel,
      aql: { critico: aql("aql_critico", "ninguno"), mayor: aql("aql_mayor", "2.5"), menor: aql("aql_menor", "4") },
      reglaSinPlan: (v("veredicto_lote", "regla_sin_plan") === "critica_o_mayor" ? "critica_o_mayor" : "cualquier_nc") as ReglaSinPlan,
    };
  }

  private async otEnAlcance(req: any, otId: string, permiso: string) {
    const ot = await this.prisma.ordenTrabajo.findFirst({
      where: { id: otId, tenantId: tenantDe(req) },
      select: { id: true, codigo: true, estado: true, unidadPrincipal: true, clienteId: true, unidad: { select: { codigo: true } } },
    });
    if (!ot) throw new NotFoundException(`Orden de trabajo ${otId} no encontrada`);
    await this.alcance.exigirUnidad(req, ot.unidadPrincipal, `la OT ${ot.codigo}`, permiso);
    return ot;
  }

  /** Muestreo del tenant y de una OT del alcance del usuario para el permiso. */
  private async cargar(req: any, id: string, permiso: string) {
    const f = await this.prisma.$queryRawUnsafe<any[]>(`SELECT ${SELECT_MUESTREO} ${FROM_MUESTREO} WHERE mu.id = $1::uuid AND mu.tenant_id = $2::uuid`, id, tenantDe(req));
    if (!f[0]) throw new NotFoundException(`Muestreo ${id} no encontrado`);
    const ot = await this.otEnAlcance(req, f[0].otId, permiso);
    return { mu: f[0], ot };
  }

  private exigirOtAbierta(ot: { codigo: string; estado: string }) {
    if (["cerrada", "anulada"].includes(ot.estado)) throw new ConflictException(`La OT ${ot.codigo} está ${ot.estado}: el muestreo ya no se modifica.`);
  }

  private async historial(otId: string, tenantId: string, usuarioId: string | null, detalle: Record<string, unknown>, db: any = this.prisma) {
    await db.$executeRawUnsafe(
      `INSERT INTO ot_historial (tenant_id, ot_id, tipo, detalle, usuario_id) VALUES ($1::uuid, $2::uuid, 'muestreo', $3::jsonb, $4::uuid)`,
      tenantId,
      otId,
      JSON.stringify(detalle),
      usuarioId,
    );
  }

  /* ------------------------------------------------------------ lectura --- */

  async plan(req: any, q: Record<string, string | undefined>) {
    const tamanoLote = Number(q.tamanoLote);
    if (!Number.isInteger(tamanoLote) || tamanoLote < 2) throw new BadRequestException("Indique el tamaño del lote (entero de 2 o más).");
    const nivel = (q.nivel ?? "II") as Nivel;
    if (!(NIVELES as readonly string[]).includes(nivel)) throw new BadRequestException("Nivel de inspección desconocido.");
    const tabla = (q.tabla ?? "normal") as Tabla;
    if (!(TABLAS as readonly string[]).includes(tabla)) throw new BadRequestException("Tabla desconocida.");
    const aql: Partial<Record<ClaseDefecto, string>> = {};
    for (const c of CLASES_DEFECTO) {
      const v = q[`aql_${c}`];
      if (v && v !== "ninguno") aql[c] = v;
    }
    try {
      const p = proponerPlan({ tamanoLote, nivel, tabla, aql });
      return { ...p, periodo: periodoExtraccion(tamanoLote, p.nExtraer) };
    } catch (e) {
      if (e instanceof PlanError) throw new BadRequestException(e.message);
      throw e;
    }
  }

  async deOt(req: any, otId: string) {
    const ot = await this.otEnAlcance(req, otId, "ot.ver");
    const tenantId = tenantDe(req);
    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT ${SELECT_MUESTREO} ${FROM_MUESTREO} WHERE mu.ot_id = $1::uuid ORDER BY mu.created_at`,
      otId,
    );
    const ids = filas.map((f) => f.id);
    const [unidades, fotos, muestras] = ids.length
      ? await Promise.all([
          this.prisma.$queryRawUnsafe<any[]>(
            `SELECT id, muestreo_id AS "muestreoId", orden, posicion, identificacion, talla, ubicacion, reemplaza_id AS "reemplazaId",
                    reemplazada, motivo_reemplazo AS "motivoReemplazo"
               FROM ot_muestreo_unidad WHERE muestreo_id = ANY($1::uuid[]) ORDER BY muestreo_id, orden`,
            ids,
          ),
          this.prisma.$queryRawUnsafe<any[]>(
            `SELECT id, muestreo_id AS "muestreoId", pie, bytes, created_at AS "createdAt" FROM ot_muestreo_foto
              WHERE muestreo_id = ANY($1::uuid[]) AND deleted_at IS NULL ORDER BY created_at`,
            ids,
          ),
          this.prisma.$queryRawUnsafe<any[]>(
            `SELECT id, codigo, nombre, muestreo_id AS "muestreoId", sello_numero AS "selloNumero", sellos_verificados AS "sellosVerificados"
               FROM muestra WHERE ot_id = $1::uuid AND deleted_at IS NULL AND parent_muestra_id IS NULL ORDER BY codigo`,
            otId,
          ),
        ])
      : [[], [], await this.prisma.$queryRawUnsafe<any[]>(
          `SELECT id, codigo, nombre, muestreo_id AS "muestreoId", sello_numero AS "selloNumero", sellos_verificados AS "sellosVerificados"
             FROM muestra WHERE ot_id = $1::uuid AND deleted_at IS NULL AND parent_muestra_id IS NULL ORDER BY codigo`,
          otId,
        )];
    const abierta = !["cerrada", "anulada"].includes(ot.estado);
    return {
      ot: { id: ot.id, codigo: ot.codigo, estado: ot.estado, laboratorio: ot.unidad?.codigo ?? null },
      porDefecto: await this.parametros(tenantId),
      opciones: {
        formularios: TIPOS_FORMULARIO.map((t) => ({ valor: t, etiqueta: ETIQUETA_FORMULARIO[t] })),
        niveles: NIVELES.map((n) => ({ valor: n, etiqueta: ETIQUETA_NIVEL[n] })),
        aql: AQLS.map((a) => ({ valor: String(a), etiqueta: String(a).replace(".", ",") })),
      },
      puede: {
        registrar: abierta && tiene(req, "muestreo.registrar"),
        recibir: abierta && tiene(req, "muestra.crear"),
        concluir: abierta && tiene(req, "resultado.aprobar"),
      },
      muestras,
      muestreos: filas.map((f) => ({
        ...f,
        unidades: unidades.filter((u) => u.muestreoId === f.id),
        fotos: fotos.filter((x) => x.muestreoId === f.id).map((x) => ({ ...x, url: `muestreo/fotos/${x.id}/imagen` })),
        muestras: muestras.filter((m) => m.muestreoId === f.id).map((m) => m.id),
        faltantes: f.estado === "borrador" ? faltantesRegistro({ ...f, sellos: f.sellos ?? [] }, fotos.filter((x) => x.muestreoId === f.id).length) : [],
      })),
    };
  }

  /* ---------------------------------------------------------- escritura --- */

  /** Valida y prepara las columnas a guardar desde el DTO (incluido el plan). */
  private async columnas(tenantId: string, dto: z.infer<typeof DatosBody>, actual: any | null) {
    const sets: { col: string; cast: string; valor: unknown }[] = [];
    for (const [k, col, cast] of CAMPOS) {
      if (!(k in dto)) continue;
      let v = (dto as any)[k];
      if (k === "fechaToma") v = leerFechaToma(v);
      else if (typeof v === "string") v = v.trim() || null;
      sets.push({ col, cast, valor: v ?? (k === "lineaMovil" ? false : null) });
    }
    if ("sellos" in dto) sets.push({ col: "sellos", cast: "::text[]", valor: normalizarSellos(dto.sellos ?? []) });
    if (dto.catElementoId) {
      const e = await this.prisma.catElemento.findFirst({ where: { id: dto.catElementoId, tenantId }, select: { id: true } });
      if (!e) throw new BadRequestException("El producto indicado no existe en el catálogo.");
    }
    const tamanoLote = "tamanoLote" in dto ? dto.tamanoLote ?? null : actual?.tamanoLote ?? null;
    if ("plan" in dto || ("tamanoLote" in dto && actual?.plan)) {
      const entrada = "plan" in dto ? dto.plan : actual?.plan ? { ...actual.plan, aql: actual.plan.aql, manual: manualDe(actual.plan) } : null;
      if (entrada == null) sets.push({ col: "plan", cast: "::jsonb", valor: null });
      else {
        const r = normalizarPlan(entrada as any, tamanoLote);
        if (r.errores.length) throw new BadRequestException(r.errores.join(" "));
        sets.push({ col: "plan", cast: "::jsonb", valor: JSON.stringify(r.plan) });
        // El tamaño de muestra del formulario es el n del plan.
        if (!sets.some((s) => s.col === "tamano_muestra")) sets.push({ col: "tamano_muestra", cast: "::int", valor: r.plan!.n });
      }
    }
    const lote = tamanoLote;
    const muestra = sets.find((s) => s.col === "tamano_muestra")?.valor ?? actual?.tamanoMuestra ?? null;
    if (lote != null && muestra != null && (muestra as number) > lote)
      throw new BadRequestException(`El tamaño de la muestra (${muestra}) no puede superar el del lote (${lote}).`);
    return sets;
  }

  async crear(req: any, otId: string, body: unknown) {
    const ot = await this.otEnAlcance(req, otId, "muestreo.registrar");
    this.exigirOtAbierta(ot);
    const tenantId = tenantDe(req);
    // B-087: lo que el encargo de la OT ya sabe (proveedor, lugar, producto y E.T., lote) llega precargado.
    const [enc] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT lugar_muestreo AS "lugarMuestreo", item, et_texto AS "etTexto", proveedor, cantidad::text AS cantidad, unidad_cantidad AS "unidadCantidad"
         FROM ot_encargo WHERE ot_id = $1::uuid`,
      otId,
    );
    const dto = precargaMuestreo(DatosBody.parse(body ?? {}), enc);
    if (!dto.numeroFormulario?.trim()) throw new BadRequestException("Indique el Nº de formulario de muestreo.");
    await this.exigirFormularioUnico(tenantId, dto.numeroFormulario, null);
    const sets = await this.columnas(tenantId, dto, null);
    const cols = ["tenant_id", "ot_id", "creado_por", "actualizado_por", ...sets.map((s) => s.col)];
    const vals = [tenantId, otId, usuarioDe(req), usuarioDe(req), ...sets.map((s) => s.valor)];
    const casts = ["::uuid", "::uuid", "::uuid", "::uuid", ...sets.map((s) => s.cast)];
    const f = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO ot_muestreo (${cols.join(", ")}) VALUES (${vals.map((_, i) => `$${i + 1}${casts[i]}`).join(", ")}) RETURNING id`,
      ...vals,
    );
    await this.historial(otId, tenantId, usuarioDe(req), { accion: "crear", formulario: dto.numeroFormulario.trim() });
    return { id: f[0].id, ...(await this.deOt(req, otId)) };
  }

  private async exigirFormularioUnico(tenantId: string, numero: string, excepto: string | null) {
    const ya = await this.prisma.$queryRawUnsafe<{ codigo: string }[]>(
      `SELECT o.codigo FROM ot_muestreo mu JOIN orden_trabajo o ON o.id = mu.ot_id
        WHERE mu.tenant_id = $1::uuid AND upper(mu.numero_formulario) = upper($2) AND mu.estado <> 'anulado'
          AND ($3::uuid IS NULL OR mu.id <> $3::uuid) LIMIT 1`,
      tenantId,
      numero.trim(),
      excepto,
    );
    if (ya[0]) throw new ConflictException(`El formulario Nº ${numero.trim()} ya está registrado en la OT ${ya[0].codigo}.`);
  }

  async editar(req: any, id: string, body: unknown) {
    const { mu, ot } = await this.cargar(req, id, "muestreo.registrar");
    this.exigirOtAbierta(ot);
    const bloqueo = motivoNoEditable(mu.estado);
    if (bloqueo) throw new ConflictException(bloqueo);
    const dto = DatosBody.parse(body ?? {});
    const tenantId = tenantDe(req);
    if ("numeroFormulario" in dto) {
      if (!dto.numeroFormulario?.trim()) throw new BadRequestException("El Nº de formulario es obligatorio.");
      await this.exigirFormularioUnico(tenantId, dto.numeroFormulario, id);
    }
    const sets = await this.columnas(tenantId, dto, mu);
    if (sets.length) {
      const vals: unknown[] = [id, ...sets.map((s) => s.valor), usuarioDe(req)];
      await this.prisma.$executeRawUnsafe(
        `UPDATE ot_muestreo SET ${sets.map((s, i) => `${s.col} = $${i + 2}${s.cast}`).join(", ")},
                actualizado_por = $${vals.length}::uuid, updated_at = now() WHERE id = $1::uuid`,
        ...vals,
      );
    }
    return this.deOt(req, ot.id);
  }

  /** Unidades de la selección sistemática NCh 43 (reemplaza la tabla de unidades). */
  async seleccion(req: any, id: string, body: unknown) {
    const { mu, ot } = await this.cargar(req, id, "muestreo.registrar");
    this.exigirOtAbierta(ot);
    const bloqueo = motivoNoEditable(mu.estado);
    if (bloqueo) throw new ConflictException(bloqueo);
    const dto = SeleccionBody.parse(body ?? {});
    if (!mu.tamanoLote || !mu.tamanoMuestra) throw new BadRequestException("Indique el tamaño del lote y de la muestra antes de seleccionar las unidades.");
    let posiciones: number[];
    let paso: number;
    let inicio: number;
    try {
      paso = dto.paso ?? periodoExtraccion(mu.tamanoLote, mu.tamanoMuestra);
      inicio = dto.sortear || dto.inicio == null ? randomInt(1, paso + 1) : dto.inicio;
      posiciones = seleccionSistematica(mu.tamanoLote, mu.tamanoMuestra, inicio, paso);
    } catch (e) {
      if (e instanceof PlanError) throw new BadRequestException(e.message);
      throw e;
    }
    const plan: PlanGuardado | null = mu.plan ?? null;
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`DELETE FROM ot_muestreo_unidad WHERE muestreo_id = $1::uuid`, id);
      let orden = 0;
      for (const p of posiciones) {
        orden++;
        await tx.$executeRawUnsafe(`INSERT INTO ot_muestreo_unidad (muestreo_id, orden, posicion) VALUES ($1::uuid, $2, $3)`, id, orden, p);
      }
      if (plan)
        await tx.$executeRawUnsafe(
          `UPDATE ot_muestreo SET plan = jsonb_set(plan, '{seleccion}', $2::jsonb), updated_at = now() WHERE id = $1::uuid`,
          id,
          JSON.stringify({ metodo: "sistematica", inicio, paso }),
        );
    });
    return this.deOt(req, ot.id);
  }

  async guardarUnidades(req: any, id: string, body: unknown) {
    const { mu, ot } = await this.cargar(req, id, "muestreo.registrar");
    this.exigirOtAbierta(ot);
    const bloqueo = motivoNoEditable(mu.estado);
    if (bloqueo) throw new ConflictException(bloqueo);
    const { unidades } = UnidadesBody.parse(body ?? {});
    if (mu.tamanoLote) {
      const fuera = unidades.find((u) => u.posicion != null && u.posicion > mu.tamanoLote);
      if (fuera) throw new BadRequestException(`La posición ${fuera.posicion} supera el tamaño del lote (${mu.tamanoLote}).`);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`DELETE FROM ot_muestreo_unidad WHERE muestreo_id = $1::uuid`, id);
      let orden = 0;
      for (const u of unidades) {
        orden++;
        await tx.$executeRawUnsafe(
          `INSERT INTO ot_muestreo_unidad (muestreo_id, orden, posicion, identificacion, talla, ubicacion) VALUES ($1::uuid, $2, $3, $4, $5, $6)`,
          id,
          orden,
          u.posicion ?? null,
          u.identificacion || null,
          u.talla || null,
          u.ubicacion || null,
        );
      }
    });
    return this.deOt(req, ot.id);
  }

  /** Serie destruida → reemplazo (EP-05 3.2; alimenta el CRB): hasta que el laboratorio concluye el lote. */
  async reemplazo(req: any, id: string, unidadId: string, body: unknown) {
    const { mu, ot } = await this.cargar(req, id, "muestreo.registrar");
    this.exigirOtAbierta(ot);
    if (mu.estado === "anulado") throw new ConflictException("El muestreo está anulado.");
    if (mu.veredictoLote) throw new ConflictException("El lote ya está concluido: no se reemplazan unidades.");
    const dto = ReemplazoBody.parse(body ?? {});
    const u = await this.prisma.$queryRawUnsafe<{ id: string; reemplazada: boolean; posicion: number | null }[]>(
      `SELECT id, reemplazada, posicion FROM ot_muestreo_unidad WHERE id = $1::uuid AND muestreo_id = $2::uuid`,
      unidadId,
      id,
    );
    if (!u[0]) throw new NotFoundException("La unidad no es de este muestreo.");
    if (u[0].reemplazada) throw new ConflictException("Esa unidad ya fue reemplazada.");
    await this.prisma.$transaction(async (tx) => {
      const orden = await tx.$queryRawUnsafe<{ n: number }[]>(`SELECT COALESCE(max(orden), 0)::int + 1 AS n FROM ot_muestreo_unidad WHERE muestreo_id = $1::uuid`, id);
      await tx.$executeRawUnsafe(`UPDATE ot_muestreo_unidad SET reemplazada = true, motivo_reemplazo = $2 WHERE id = $1::uuid`, unidadId, dto.motivo);
      await tx.$executeRawUnsafe(
        `INSERT INTO ot_muestreo_unidad (muestreo_id, orden, posicion, identificacion, reemplaza_id) VALUES ($1::uuid, $2, $3, $4, $5::uuid)`,
        id,
        orden[0].n,
        dto.posicion ?? null,
        dto.identificacion,
        unidadId,
      );
      await this.historial(ot.id, tenantDe(req), usuarioDe(req), { accion: "reemplazo", formulario: mu.numeroFormulario, reemplazo: dto.identificacion, motivo: dto.motivo }, tx);
    });
    return this.deOt(req, ot.id);
  }

  async registrar(req: any, id: string) {
    const { mu, ot } = await this.cargar(req, id, "muestreo.registrar");
    this.exigirOtAbierta(ot);
    if (mu.estado !== "borrador") throw new ConflictException(motivoNoEditable(mu.estado) ?? "El muestreo ya está registrado.");
    const fotos = await this.prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM ot_muestreo_foto WHERE muestreo_id = $1::uuid AND deleted_at IS NULL`,
      id,
    );
    const faltan = faltantesRegistro({ ...mu, sellos: mu.sellos ?? [] }, fotos[0].n);
    if (faltan.length) throw new BadRequestException(`Para registrar el muestreo falta: ${faltan.join(", ")}.`);
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE ot_muestreo SET estado = 'registrado', registrado_por = $2::uuid, registrado_at = now(), updated_at = now() WHERE id = $1::uuid`,
        id,
        usuarioDe(req),
      );
      await this.historial(ot.id, tenantDe(req), usuarioDe(req), { accion: "registrar", formulario: mu.numeroFormulario }, tx);
    });
    return this.deOt(req, ot.id);
  }

  async recibir(req: any, id: string, body: unknown) {
    const { mu, ot } = await this.cargar(req, id, "muestra.crear");
    this.exigirOtAbierta(ot);
    const dto = RecibirBody.parse(body ?? {});
    const errores = erroresRecepcion(mu.estado as EstadoMuestreo, dto.conforme, dto.observacion);
    if (errores.length) throw new ConflictException(errores.join(" "));
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE ot_muestreo SET estado = 'recibido', recibido_conforme = $2, recibido_observacion = $3, recibido_por = $4::uuid, recibido_at = now(),
                updated_at = now() WHERE id = $1::uuid`,
        id,
        dto.conforme,
        dto.observacion?.trim() || null,
        usuarioDe(req),
      );
      await this.historial(ot.id, tenantDe(req), usuarioDe(req), { accion: "recibir", formulario: mu.numeroFormulario, conforme: dto.conforme, observacion: dto.observacion ?? null }, tx);
    });
    return this.deOt(req, ot.id);
  }

  async muestras(req: any, id: string, body: unknown) {
    const { mu, ot } = await this.cargar(req, id, "muestra.crear");
    this.exigirOtAbierta(ot);
    if (mu.estado === "anulado") throw new ConflictException("El muestreo está anulado.");
    const { muestraIds } = MuestrasBody.parse(body ?? {});
    const deOt = await this.prisma.muestra.findMany({ where: { id: { in: muestraIds }, otId: ot.id, deletedAt: null }, select: { id: true } });
    if (deOt.length !== new Set(muestraIds).size) throw new BadRequestException("Alguna muestra no es de esta OT.");
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE muestra SET muestreo_id = NULL WHERE muestreo_id = $1::uuid AND NOT (id = ANY($2::uuid[]))`,
        id,
        muestraIds,
      );
      if (muestraIds.length)
        await tx.$executeRawUnsafe(
          // Las submuestras de componentes siguen a su muestra.
          `UPDATE muestra SET muestreo_id = $1::uuid WHERE id = ANY($2::uuid[]) OR parent_muestra_id = ANY($2::uuid[])`,
          id,
          muestraIds,
        );
    });
    return this.deOt(req, ot.id);
  }

  async anular(req: any, id: string, body: unknown) {
    const { mu, ot } = await this.cargar(req, id, "muestreo.registrar");
    this.exigirOtAbierta(ot);
    if (mu.estado === "anulado") throw new ConflictException("El muestreo ya está anulado.");
    if (mu.estado === "recibido") throw new ConflictException("El laboratorio ya recibió el muestreo: no se anula.");
    const { motivo } = MotivoBody.parse(body ?? {});
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE ot_muestreo SET estado = 'anulado', anulado_motivo = $2, anulado_por = $3::uuid, anulado_at = now(), updated_at = now() WHERE id = $1::uuid`,
        id,
        motivo,
        usuarioDe(req),
      );
      await tx.$executeRawUnsafe(`UPDATE muestra SET muestreo_id = NULL WHERE muestreo_id = $1::uuid`, id);
      await this.historial(ot.id, tenantDe(req), usuarioDe(req), { accion: "anular", formulario: mu.numeroFormulario, motivo }, tx);
    });
    return this.deOt(req, ot.id);
  }

  /* ------------------------------------------------------------ fotos --- */

  async subirFoto(req: any, id: string, archivo: ArchivoSubido | undefined, cuerpo: any) {
    const { mu, ot } = await this.cargar(req, id, "muestreo.registrar");
    this.exigirOtAbierta(ot);
    if (["recibido", "anulado"].includes(mu.estado)) throw new ConflictException("El muestreo ya no admite fotos.");
    if (!archivo?.buffer?.length) throw new BadRequestException("Adjunte una foto (PNG o JPEG).");
    if (archivo.buffer.length > MAX_FOTO) throw new BadRequestException("La foto no puede superar 2 MB.");
    const mime = tipoImagen(archivo.buffer);
    if (!mime) throw new BadRequestException("El archivo no es una imagen PNG o JPEG válida.");
    const dim = errorDimensionesFoto(archivo.buffer, mime);
    if (dim) throw new BadRequestException(dim);
    const n = await this.prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ot_muestreo_foto WHERE muestreo_id = $1::uuid AND deleted_at IS NULL`, id);
    if (n[0].n >= MAX_FOTOS_MUESTREO) throw new ConflictException(`El muestreo ya tiene ${MAX_FOTOS_MUESTREO} fotos.`);
    const pie = typeof cuerpo?.pie === "string" ? cuerpo.pie.trim().slice(0, 500) : null;
    const nombre = (archivo.originalname ?? "foto").replace(/[^\p{L}\p{N} ._-]/gu, "_").slice(0, 200);
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO ot_muestreo_foto (tenant_id, muestreo_id, nombre, mime, bytes, datos, hash_sha256, pie, subida_por)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9::uuid)`,
      tenantDe(req),
      id,
      nombre,
      mime,
      archivo.buffer.length,
      archivo.buffer.toString("base64"),
      createHash("sha256").update(archivo.buffer).digest("hex"),
      pie || null,
      usuarioDe(req),
    );
    return this.deOt(req, ot.id);
  }

  private async foto(req: any, fotoId: string, permiso: string) {
    const f = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT f.id, f.muestreo_id AS "muestreoId", f.mime, f.datos, f.hash_sha256 AS hash FROM ot_muestreo_foto f
        WHERE f.id = $1::uuid AND f.tenant_id = $2::uuid AND f.deleted_at IS NULL`,
      fotoId,
      tenantDe(req),
    );
    if (!f[0]) throw new NotFoundException(`Foto ${fotoId} no encontrada`);
    const c = await this.cargar(req, f[0].muestreoId, permiso);
    return { f: f[0], ...c };
  }

  async imagen(req: any, fotoId: string) {
    const { f } = await this.foto(req, fotoId, "ot.ver");
    return { mime: f.mime as string, datos: Buffer.from(f.datos, "base64"), hash: f.hash as string };
  }

  async quitarFoto(req: any, fotoId: string) {
    const { mu, ot } = await this.foto(req, fotoId, "muestreo.registrar");
    this.exigirOtAbierta(ot);
    if (["recibido", "anulado"].includes(mu.estado)) throw new ConflictException("El muestreo ya no admite cambios en sus fotos.");
    await this.prisma.$executeRawUnsafe(`UPDATE ot_muestreo_foto SET deleted_at = now() WHERE id = $1::uuid`, fotoId);
    return this.deOt(req, ot.id);
  }

  /* -------------------------------------------- conclusión del lote --- */

  private async datosConclusion(req: any, mu: any, ot: { id: string }) {
    const tenantId = tenantDe(req);
    const prm = await this.parametros(tenantId);
    // Muestras del muestreo (y sus componentes); si no hay ninguna enlazada, las de la OT.
    const enlazadas = await this.prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM muestra WHERE muestreo_id = $1::uuid AND deleted_at IS NULL`, mu.id);
    const resultados = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT r.id, r.veredicto, r.clase_defecto AS "claseDefecto", COALESCE(m.parent_muestra_id, m.id) AS "muestraId",
              m.codigo AS "muestraCodigo", COALESCE(a.nombre, an.nombre) AS ensayo, r.espec_fuente AS "especFuente"
         FROM resultado r JOIN muestra m ON m.id = r.muestra_id
         LEFT JOIN cat_analito a ON a.id = r.cat_analito_id LEFT JOIN analito an ON an.id = r.analito_id
        WHERE r.deleted_at IS NULL AND m.deleted_at IS NULL
          AND ${enlazadas[0].n ? "m.muestreo_id = $1::uuid" : "m.ot_id = $2::uuid"}
        ORDER BY m.codigo`,
      mu.id,
      ot.id,
    );
    const conteo = contarDefectuosas(resultados);
    const plan: PlanGuardado | null = mu.plan ?? null;
    const conteos = CLASES_DEFECTO.map((c) => ({ clase: c, defectuosas: conteo[c], ac: plan?.clases?.[c]?.ac ?? null, re: plan?.clases?.[c]?.re ?? null }));
    // Sin ensayos todavía no hay nada que concluir: queda pendiente.
    const pendientes = resultados.length ? conteo.pendientes : 1;
    const propuesta = veredictoLote(conteos, { reglaSinPlan: prm.reglaSinPlan, pendientes });
    return {
      prm,
      conteo,
      propuesta,
      noConformes: resultados.filter((r) => r.veredicto === "no_cumple"),
      alcance: enlazadas[0].n ? "las muestras del muestreo" : "todas las muestras de la OT (ninguna está enlazada al muestreo)",
      sinEnsayos: resultados.length === 0,
      plan,
    };
  }

  async conclusion(req: any, id: string) {
    const { mu, ot } = await this.cargar(req, id, "ot.ver");
    const d = await this.datosConclusion(req, mu, ot);
    return {
      muestreo: { id: mu.id, numeroFormulario: mu.numeroFormulario, estado: mu.estado, veredictoLote: mu.veredictoLote, conclusion: mu.conclusion, concluidoAt: mu.concluidoAt, concluidoPorNombre: mu.concluidoPorNombre },
      reglaSinPlan: d.prm.reglaSinPlan,
      alcance: d.alcance,
      pendientes: d.conteo.pendientes,
      sinEnsayos: d.sinEnsayos,
      sinClase: d.conteo.sinClase,
      propuesta: d.propuesta,
      noConformes: d.noConformes,
      puedeConcluir: tiene(req, "resultado.aprobar") && !["cerrada", "anulada"].includes(ot.estado) && mu.estado !== "anulado",
    };
  }

  /** «Concluir → revisión técnica» (EP-05 5.3): veredicto del lote con las defectuosas verificadas. */
  async concluir(req: any, id: string, body: unknown) {
    const { mu, ot } = await this.cargar(req, id, "resultado.aprobar");
    this.exigirOtAbierta(ot);
    if (mu.estado === "anulado") throw new ConflictException("El muestreo está anulado.");
    const dto = ConcluirBody.parse(body ?? {});
    const d = await this.datosConclusion(req, mu, ot);
    const cambiadas = CLASES_DEFECTO.filter((c) => dto.defectuosas?.[c] != null && dto.defectuosas[c] !== d.conteo[c]);
    if (cambiadas.length && (dto.motivo?.trim().length ?? 0) < 5)
      throw new BadRequestException("Las unidades no conformes difieren de las que cuenta el sistema: indique el motivo (mínimo 5 caracteres).");
    const conteos = CLASES_DEFECTO.map((c) => ({
      clase: c,
      defectuosas: dto.defectuosas?.[c] ?? d.conteo[c],
      ac: d.plan?.clases?.[c]?.ac ?? null,
      re: d.plan?.clases?.[c]?.re ?? null,
    }));
    const v = veredictoLote(conteos, { reglaSinPlan: d.prm.reglaSinPlan, pendientes: d.conteo.pendientes });
    if (d.sinEnsayos) throw new ConflictException("Las muestras del lote aún no tienen ensayos: no hay nada que concluir.");
    if (v.veredicto === "pendiente")
      throw new ConflictException(`Quedan ${d.conteo.pendientes} ensayo(s) sin decidir: el lote se concluye cuando todos tienen veredicto.`);
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE ot_muestreo SET veredicto_lote = $2, conclusion = $3, concluido_por = $4::uuid, concluido_at = now(), updated_at = now() WHERE id = $1::uuid`,
        id,
        v.veredicto,
        dto.conclusion,
        usuarioDe(req),
      );
      await this.historial(
        ot.id,
        tenantDe(req),
        usuarioDe(req),
        { accion: "concluir", formulario: mu.numeroFormulario, veredicto: v.veredicto, detalle: v.detalle, motivo: dto.motivo ?? null },
        tx,
      );
    });
    return this.conclusion(req, id);
  }
}

/** Ac/Re escritos a mano de un plan guardado (para recalcularlo al cambiar el lote). */
function manualDe(plan: PlanGuardado) {
  const m: Record<string, { ac: number; re: number }> = {};
  for (const c of CLASES_DEFECTO) {
    const x = plan.clases?.[c];
    if (x?.manual) m[c] = { ac: x.ac, re: x.re };
  }
  return m;
}

@ApiTags("muestreo")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("muestreo")
export class MuestreoController {
  constructor(private readonly svc: MuestreoService) {}

  @Get("plan")
  @RequierePermiso("ot.ver")
  @ApiOperation({ summary: "Plan NCh 44 propuesto: letra, n, Ac/Re por clase y período de extracción NCh 43" })
  plan(@Query() q: any, @Req() req: any) {
    return this.svc.plan(req, q ?? {});
  }

  @Get("ot/:otId")
  @RequierePermiso("ot.ver")
  deOt(@Param("otId", ParseUUIDPipe) otId: string, @Req() req: any) {
    return this.svc.deOt(req, otId);
  }

  @Post("ot/:otId")
  @RequierePermiso("muestreo.registrar")
  crear(@Param("otId", ParseUUIDPipe) otId: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.crear(req, otId, body);
  }

  @Get("fotos/:fotoId/imagen")
  @RequierePermiso("ot.ver")
  async imagen(@Param("fotoId", ParseUUIDPipe) fotoId: string, @Req() req: any, @Res() res: Response) {
    const f = await this.svc.imagen(req, fotoId);
    res.setHeader("Content-Type", f.mime === "image/png" ? "image/png" : "image/jpeg");
    res.setHeader("Content-Length", String(f.datos.length));
    res.setHeader("Cache-Control", "private, max-age=600");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("ETag", `"${f.hash}"`);
    res.end(f.datos);
  }

  @Delete("fotos/:fotoId")
  @RequierePermiso("muestreo.registrar")
  quitarFoto(@Param("fotoId", ParseUUIDPipe) fotoId: string, @Req() req: any) {
    return this.svc.quitarFoto(req, fotoId);
  }

  @Put(":id")
  @RequierePermiso("muestreo.registrar")
  editar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.editar(req, id, body);
  }

  @Post(":id/seleccion")
  @RequierePermiso("muestreo.registrar")
  seleccion(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.seleccion(req, id, body);
  }

  @Put(":id/unidades")
  @RequierePermiso("muestreo.registrar")
  unidades(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.guardarUnidades(req, id, body);
  }

  @Post(":id/unidades/:uid/reemplazo")
  @RequierePermiso("muestreo.registrar")
  reemplazo(@Param("id", ParseUUIDPipe) id: string, @Param("uid", ParseUUIDPipe) uid: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.reemplazo(req, id, uid, body);
  }

  @Post(":id/registrar")
  @RequierePermiso("muestreo.registrar")
  @ApiOperation({ summary: "«Registrar muestreo → entregar al laboratorio»" })
  registrar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.registrar(req, id);
  }

  @Post(":id/recibir")
  @RequierePermiso("muestra.crear")
  @ApiOperation({ summary: "«Recibido conforme» por el laboratorio (o no conforme con motivo)" })
  recibir(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.recibir(req, id, body);
  }

  @Put(":id/muestras")
  @RequierePermiso("muestra.crear")
  muestras(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.muestras(req, id, body);
  }

  @Post(":id/anular")
  @RequierePermiso("muestreo.registrar")
  anular(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.anular(req, id, body);
  }

  @Post(":id/fotos")
  @RequierePermiso("muestreo.registrar")
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("archivo", { limits: { fileSize: MAX_FOTO, files: 1, fields: 5 } }))
  subirFoto(@Param("id", ParseUUIDPipe) id: string, @UploadedFile() archivo: ArchivoSubido | undefined, @Body() body: any, @Req() req: any) {
    return this.svc.subirFoto(req, id, archivo, body);
  }

  @Get(":id/conclusion")
  @RequierePermiso("ot.ver")
  conclusion(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.conclusion(req, id);
  }

  @Post(":id/concluir")
  @RequierePermiso("resultado.aprobar")
  @ApiOperation({ summary: "«Concluir → revisión técnica»: veredicto del lote por clase de defecto" })
  concluir(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.concluir(req, id, body);
  }
}

@Module({
  controllers: [MuestreoController],
  providers: [MuestreoService],
})
export class MuestreoModule {}
