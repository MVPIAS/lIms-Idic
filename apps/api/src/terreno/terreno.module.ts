/**
 * Trabajo en terreno sin recepción ni toma de muestras (sesión R10: Vehículos
 * Militares; también Armamento y Telecomunicaciones). Reglas puras:
 * reglas-terreno.ts. SQL: packages/db/align_sesiones_s3.sql.
 *
 * Rutas (alcance: la OT en el alcance del usuario para el permiso):
 *   GET    /terreno/ot/:otId                  ot.ver · ficha: datos, unidades, pruebas, adjuntos, pasos y protocolo
 *   POST   /terreno/ot/:otId/abrir            terreno.gestionar · 1. apertura (lugar, fechas, control al 100 % o por muestreo)
 *   PUT    /terreno/ot/:otId/datos            terreno.gestionar · corrige los datos de apertura
 *   PUT    /terreno/ot/:otId/asignacion       terreno.gestionar · 2. analistas
 *   PUT    /terreno/ot/:otId/unidades         terreno.registrar · unidades controladas (chasis, motor, año; serie)
 *   POST   /terreno/ot/:otId/pruebas          terreno.registrar · 3. pruebas del protocolo (por unidad seleccionada o generales)
 *   DELETE /terreno/pruebas/:id               terreno.registrar · quita una prueba sin registrar
 *   PUT    /terreno/ot/:otId/chequeo          terreno.registrar · 4. lista de chequeo (cumple / no cumple / no aplica)
 *   POST   /terreno/ot/:otId/adjuntos         terreno.registrar · protocolo, hoja de control, IVC u otro (PDF, imagen, Word, Excel)
 *   GET    /terreno/adjuntos/:id/archivo      ot.ver
 *   DELETE /terreno/adjuntos/:id              terreno.registrar
 *   POST   /terreno/ot/:otId/ivc              terreno.gestionar · 5. grado de cumplimiento del IVC
 *   POST   /terreno/ot/:otId/cerrar           terreno.gestionar · 6. cierre con el resultado por sistema
 */
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
import { anioChile } from "../common/fecha-chile";
import {
  MODALIDADES,
  NOMBRE_ADJUNTO,
  RESULTADOS_PRUEBA,
  TIPOS_ADJUNTO,
  erroresApertura,
  erroresIvc,
  erroresSeleccion,
  erroresUnidades,
  gradoPropuesto,
  laboratorioDeTerreno,
  pasosTerreno,
  resultadoPorSistema,
  type TipoAdjunto,
} from "./reglas-terreno";

const tenantDe = (req: any): string => req?.user?.tenantId;
const usuarioDe = (req: any): string | null => req?.user?.sub ?? null;
const tiene = (req: any, p: string) => (req?.user?.roles ?? []).includes("SUPERADMIN") || (req?.user?.permisos ?? []).includes(p);
const MAX_ADJUNTO = 10 * 1024 * 1024;
const MIME_ADJUNTO = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];
type ArchivoSubido = { buffer: Buffer; originalname?: string; mimetype?: string };

const texto = (max: number) => z.string().trim().max(max).nullable().optional();
const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD").nullable().optional();
const AperturaBody = z
  .object({
    lugar: texto(240),
    fechaInicio: dia,
    fechaTermino: dia,
    modalidad: z.enum(MODALIDADES),
    normaMuestreo: texto(20),
    letraCodigo: texto(4),
    tamanoLote: z.number().int().positive().nullable().optional(),
    nMuestras: z.number().int().positive().nullable().optional(),
    protocolo: texto(200),
    observaciones: texto(4000),
  })
  .strict();
const AsignacionBody = z.object({ analistas: z.array(z.string().uuid()).max(30) }).strict();
const UnidadesBody = z
  .object({
    unidades: z
      .array(
        z
          .object({
            descripcion: texto(200),
            chasis: texto(60),
            motor: texto(60),
            anioFabricacion: z.number().int().nullable().optional(),
            serie: texto(80),
            seleccionada: z.boolean().optional(),
            observacion: texto(500),
          })
          .strict(),
      )
      .max(500),
  })
  .strict();
const PruebasBody = z
  .object({
    pruebas: z.array(z.object({ sistema: z.string().trim().min(1).max(120), prueba: z.string().trim().min(1).max(300), requisito: texto(500) }).strict()).min(1).max(300),
    /** Una prueba por cada unidad seleccionada (por defecto, si hay unidades). */
    porUnidad: z.boolean().optional(),
  })
  .strict();
const ChequeoBody = z
  .object({
    items: z.array(z.object({ id: z.string().uuid(), resultado: z.enum(RESULTADOS_PRUEBA).nullable(), observacion: texto(1000) }).strict()).min(1).max(5000),
  })
  .strict();
const IvcBody = z.object({ numero: texto(60), grado: z.enum(["cumple", "no_cumple"]), conclusion: texto(4000) }).strict();

@Injectable()
export class TerrenoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
  ) {}

  private async ot(req: any, otId: string, permiso: string) {
    const ot = await this.prisma.ordenTrabajo.findFirst({
      where: { id: otId, tenantId: tenantDe(req) },
      select: { id: true, codigo: true, estado: true, unidadPrincipal: true, unidad: { select: { codigo: true } } },
    });
    if (!ot) throw new NotFoundException(`Orden de trabajo ${otId} no encontrada`);
    await this.alcance.exigirUnidad(req, ot.unidadPrincipal, `la OT ${ot.codigo}`, permiso);
    return ot;
  }

  private abierta(ot: { codigo: string; estado: string }) {
    if (["cerrada", "anulada"].includes(ot.estado)) throw new ConflictException(`La OT ${ot.codigo} está ${ot.estado}: el trabajo en terreno ya no se modifica.`);
  }

  private async fila(otId: string) {
    const [t] = await this.prisma.$queryRawUnsafe<any[]>(`SELECT * FROM ot_terreno WHERE ot_id = $1::uuid`, otId);
    return t ?? null;
  }

  private async exigirFila(otId: string, abiertoParaCambios = true) {
    const t = await this.fila(otId);
    if (!t) throw new ConflictException("Abra primero el trabajo en terreno de la OT.");
    if (abiertoParaCambios && t.cerrada_at) throw new ConflictException("El trabajo en terreno ya está cerrado.");
    return t;
  }

  private async aplica(tenantId: string, laboratorio: string | null) {
    const [p] = await this.prisma.$queryRawUnsafe<{ valor: string | null }[]>(
      `SELECT valor FROM parametro_sistema WHERE tenant_id = $1::uuid AND categoria = 'terreno' AND codigo = 'laboratorios' AND activo`,
      tenantId,
    );
    return laboratorioDeTerreno(p?.valor ?? null, laboratorio);
  }

  private historial(otId: string, tenantId: string, detalle: Record<string, unknown>, usuarioId: string | null) {
    return this.prisma.$executeRawUnsafe(
      `INSERT INTO ot_historial (tenant_id, ot_id, tipo, detalle, usuario_id) VALUES ($1::uuid, $2::uuid, 'terreno', $3::jsonb, $4::uuid)`,
      tenantId,
      otId,
      JSON.stringify(detalle),
      usuarioId,
    );
  }

  /** Hechos para los pasos (también los usa la ruta de la OT). */
  async hechos(otId: string) {
    return hechosTerreno(this.prisma, otId);
  }

  async ficha(req: any, otId: string) {
    const ot = await this.ot(req, otId, "ot.ver");
    const tenantId = tenantDe(req);
    const lab = ot.unidad?.codigo ?? null;
    const [aplica, t] = await Promise.all([this.aplica(tenantId, lab), this.fila(otId)]);
    const abiertaOt = !["cerrada", "anulada"].includes(ot.estado);
    const [protocolo] = lab
      ? await this.prisma.$queryRawUnsafe<{ valor: string | null }[]>(
          `SELECT valor FROM parametro_sistema WHERE tenant_id = $1::uuid AND categoria = 'terreno_protocolo' AND codigo = $2 AND activo`,
          tenantId,
          lab,
        )
      : [];
    let filasProtocolo: any[] = [];
    try {
      filasProtocolo = JSON.parse(protocolo?.valor ?? "[]");
    } catch {
      filasProtocolo = [];
    }
    const personal = await this.prisma.$queryRawUnsafe<{ id: string; nombre: string }[]>(
      `SELECT DISTINCT u.id, u.nombre_completo AS nombre FROM usuario u JOIN usuario_rol ur ON ur.usuario_id = u.id
        WHERE u.deleted_at IS NULL AND ur.unidad_id = $1::uuid ORDER BY u.nombre_completo`,
      ot.unidadPrincipal,
    );
    const puede = {
      gestionar: abiertaOt && tiene(req, "terreno.gestionar") && !t?.cerrada_at,
      registrar: abiertaOt && tiene(req, "terreno.registrar") && !t?.cerrada_at,
    };
    if (!t) return { ot: { id: ot.id, codigo: ot.codigo, estado: ot.estado, laboratorio: lab }, aplica, terreno: null, protocolo: filasProtocolo, personal, puede };
    const [unidades, pruebas, adjuntos] = await Promise.all([
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT id, orden, descripcion, chasis, motor, anio_fabricacion AS "anioFabricacion", serie, seleccionada, observacion
           FROM ot_terreno_unidad WHERE terreno_id = $1::uuid ORDER BY orden`,
        t.id,
      ),
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT p.id, p.orden, p.unidad_id AS "unidadId", p.sistema, p.prueba, p.requisito, p.resultado, p.observacion,
                p.registrado_at AS "registradoAt", u.nombre_completo AS "registradoPor"
           FROM ot_terreno_prueba p LEFT JOIN usuario u ON u.id = p.registrado_por
          WHERE p.terreno_id = $1::uuid ORDER BY p.orden`,
        t.id,
      ),
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT a.id, a.tipo, a.nombre, a.mime, a.bytes, a.created_at AS "createdAt", u.nombre_completo AS "subidoPor"
           FROM ot_terreno_adjunto a LEFT JOIN usuario u ON u.id = a.subido_por
          WHERE a.terreno_id = $1::uuid AND a.deleted_at IS NULL ORDER BY a.created_at`,
        t.id,
      ),
    ]);
    const h = await this.hechos(otId);
    return {
      ot: { id: ot.id, codigo: ot.codigo, estado: ot.estado, laboratorio: lab },
      aplica,
      terreno: {
        id: t.id,
        lugar: t.lugar,
        fechaInicio: t.fecha_inicio ? new Date(t.fecha_inicio).toISOString().slice(0, 10) : null,
        fechaTermino: t.fecha_termino ? new Date(t.fecha_termino).toISOString().slice(0, 10) : null,
        modalidad: t.modalidad,
        normaMuestreo: t.norma_muestreo,
        letraCodigo: t.letra_codigo,
        tamanoLote: t.tamano_lote,
        nMuestras: t.n_muestras,
        protocolo: t.protocolo,
        observaciones: t.observaciones,
        analistas: t.analistas ?? [],
        ivc: t.ivc_grado ? { numero: t.ivc_numero, grado: t.ivc_grado, conclusion: t.ivc_conclusion, fecha: t.ivc_at } : null,
        cerradaAt: t.cerrada_at,
      },
      unidades,
      pruebas,
      adjuntos: adjuntos.map((a) => ({ ...a, tipoNombre: NOMBRE_ADJUNTO[a.tipo as TipoAdjunto] ?? a.tipo, url: `terreno/adjuntos/${a.id}/archivo` })),
      porSistema: resultadoPorSistema(pruebas),
      gradoPropuesto: gradoPropuesto(pruebas),
      avance: pasosTerreno(h!),
      protocolo: filasProtocolo,
      personal,
      puede,
    };
  }

  async abrir(req: any, otId: string, body: unknown) {
    const ot = await this.ot(req, otId, "terreno.gestionar");
    this.abierta(ot);
    if (!(await this.aplica(tenantDe(req), ot.unidad?.codigo ?? null)))
      throw new BadRequestException(`El laboratorio ${ot.unidad?.codigo ?? "de la OT"} no trabaja en terreno (Catálogo › Parámetros › Trabajo en terreno).`);
    if (await this.fila(otId)) throw new ConflictException("La OT ya tiene su trabajo en terreno abierto.");
    const d = AperturaBody.parse(body ?? {});
    const errores = erroresApertura(d);
    if (errores.length) throw new BadRequestException(errores.join(" "));
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO ot_terreno (tenant_id, ot_id, lugar, fecha_inicio, fecha_termino, modalidad, norma_muestreo, letra_codigo, tamano_lote, n_muestras,
                               protocolo, observaciones, creado_por)
       VALUES ($1::uuid, $2::uuid, $3, $4::date, $5::date, $6, $7, $8, $9, $10, $11, $12, $13::uuid)`,
      tenantDe(req),
      otId,
      d.lugar?.trim() || null,
      d.fechaInicio || null,
      d.fechaTermino || null,
      d.modalidad,
      d.modalidad === "muestreo" ? d.normaMuestreo?.trim() || "NCh 44" : null,
      d.modalidad === "muestreo" ? d.letraCodigo?.trim().toUpperCase() || null : null,
      d.tamanoLote ?? null,
      d.modalidad === "muestreo" ? d.nMuestras ?? null : null,
      d.protocolo?.trim() || null,
      d.observaciones?.trim() || null,
      usuarioDe(req),
    );
    await this.historial(otId, tenantDe(req), { accion: "apertura", modalidad: d.modalidad, lugar: d.lugar }, usuarioDe(req));
    return this.ficha(req, otId);
  }

  async datos(req: any, otId: string, body: unknown) {
    const ot = await this.ot(req, otId, "terreno.gestionar");
    this.abierta(ot);
    const t = await this.exigirFila(otId);
    const d = AperturaBody.parse(body ?? {});
    const errores = erroresApertura(d);
    if (errores.length) throw new BadRequestException(errores.join(" "));
    await this.prisma.$executeRawUnsafe(
      `UPDATE ot_terreno SET lugar = $2, fecha_inicio = $3::date, fecha_termino = $4::date, modalidad = $5, norma_muestreo = $6, letra_codigo = $7,
              tamano_lote = $8, n_muestras = $9, protocolo = $10, observaciones = $11, updated_at = now()
        WHERE id = $1::uuid`,
      t.id,
      d.lugar?.trim() || null,
      d.fechaInicio || null,
      d.fechaTermino || null,
      d.modalidad,
      d.modalidad === "muestreo" ? d.normaMuestreo?.trim() || "NCh 44" : null,
      d.modalidad === "muestreo" ? d.letraCodigo?.trim().toUpperCase() || null : null,
      d.tamanoLote ?? null,
      d.modalidad === "muestreo" ? d.nMuestras ?? null : null,
      d.protocolo?.trim() || null,
      d.observaciones?.trim() || null,
    );
    return this.ficha(req, otId);
  }

  async asignar(req: any, otId: string, body: unknown) {
    const ot = await this.ot(req, otId, "terreno.gestionar");
    this.abierta(ot);
    const t = await this.exigirFila(otId);
    const d = AsignacionBody.parse(body ?? {});
    const ids = [...new Set(d.analistas)];
    if (!ids.length) throw new BadRequestException("Asigne al menos un analista.");
    const validos = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT DISTINCT u.id FROM usuario u JOIN usuario_rol ur ON ur.usuario_id = u.id
        WHERE u.id = ANY($1::uuid[]) AND u.deleted_at IS NULL AND ur.unidad_id = $2::uuid`,
      ids,
      ot.unidadPrincipal,
    );
    if (validos.length !== ids.length) throw new BadRequestException("Los analistas deben ser personal del laboratorio de la OT.");
    await this.prisma.$executeRawUnsafe(
      `UPDATE ot_terreno SET analistas = $2::uuid[], asignada_por = $3::uuid, asignada_at = now(), updated_at = now() WHERE id = $1::uuid`,
      t.id,
      ids,
      usuarioDe(req),
    );
    await this.historial(otId, tenantDe(req), { accion: "asignacion", analistas: ids.length }, usuarioDe(req));
    return this.ficha(req, otId);
  }

  async unidades(req: any, otId: string, body: unknown) {
    const ot = await this.ot(req, otId, "terreno.registrar");
    this.abierta(ot);
    const t = await this.exigirFila(otId);
    const d = UnidadesBody.parse(body ?? {});
    const lista = d.unidades.map((u) => ({ ...u, seleccionada: u.seleccionada ?? true }));
    const errores = [...erroresUnidades(lista, anioChile()), ...erroresSeleccion(t.modalidad, t.n_muestras, lista)];
    if (errores.length) throw new BadRequestException(errores.join(" "));
    const conResultado = await this.prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM ot_terreno_prueba WHERE terreno_id = $1::uuid AND unidad_id IS NOT NULL AND resultado IS NOT NULL`,
      t.id,
    );
    if (conResultado[0].n) throw new ConflictException("Ya hay pruebas registradas por unidad: las unidades ya no se reemplazan.");
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`DELETE FROM ot_terreno_prueba WHERE terreno_id = $1::uuid AND unidad_id IS NOT NULL`, t.id);
      await tx.$executeRawUnsafe(`DELETE FROM ot_terreno_unidad WHERE terreno_id = $1::uuid`, t.id);
      for (const [i, u] of lista.entries())
        await tx.$executeRawUnsafe(
          `INSERT INTO ot_terreno_unidad (terreno_id, orden, descripcion, chasis, motor, anio_fabricacion, serie, seleccionada, observacion)
           VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9)`,
          t.id,
          i + 1,
          u.descripcion?.trim() || null,
          u.chasis?.trim().toUpperCase() || null,
          u.motor?.trim().toUpperCase() || null,
          u.anioFabricacion ?? null,
          u.serie?.trim() || null,
          u.seleccionada,
          u.observacion?.trim() || null,
        );
    });
    return this.ficha(req, otId);
  }

  async pruebas(req: any, otId: string, body: unknown) {
    const ot = await this.ot(req, otId, "terreno.registrar");
    this.abierta(ot);
    const t = await this.exigirFila(otId);
    const d = PruebasBody.parse(body ?? {});
    const unidades = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM ot_terreno_unidad WHERE terreno_id = $1::uuid AND seleccionada ORDER BY orden`,
      t.id,
    );
    const porUnidad = (d.porUnidad ?? true) && unidades.length > 0;
    const [m] = await this.prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT COALESCE(max(orden), 0)::int AS n FROM ot_terreno_prueba WHERE terreno_id = $1::uuid`, t.id);
    let orden = m.n;
    await this.prisma.$transaction(async (tx) => {
      for (const u of porUnidad ? unidades : [{ id: null as string | null }])
        for (const p of d.pruebas)
          await tx.$executeRawUnsafe(
            `INSERT INTO ot_terreno_prueba (terreno_id, unidad_id, orden, sistema, prueba, requisito) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)`,
            t.id,
            u.id,
            ++orden,
            p.sistema,
            p.prueba,
            p.requisito?.trim() || null,
          );
      await tx.$executeRawUnsafe(`UPDATE ot_terreno SET pruebas_at = COALESCE(pruebas_at, now()), updated_at = now() WHERE id = $1::uuid`, t.id);
    });
    return this.ficha(req, otId);
  }

  async quitarPrueba(req: any, pruebaId: string) {
    const [p] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT p.id, p.resultado, t.ot_id, t.cerrada_at FROM ot_terreno_prueba p JOIN ot_terreno t ON t.id = p.terreno_id
        WHERE p.id = $1::uuid AND t.tenant_id = $2::uuid`,
      pruebaId,
      tenantDe(req),
    );
    if (!p) throw new NotFoundException("Prueba no encontrada.");
    const ot = await this.ot(req, p.ot_id, "terreno.registrar");
    this.abierta(ot);
    if (p.cerrada_at) throw new ConflictException("El trabajo en terreno ya está cerrado.");
    if (p.resultado) throw new ConflictException("La prueba ya tiene resultado: no se quita.");
    await this.prisma.$executeRawUnsafe(`DELETE FROM ot_terreno_prueba WHERE id = $1::uuid`, pruebaId);
    return this.ficha(req, p.ot_id);
  }

  async chequeo(req: any, otId: string, body: unknown) {
    const ot = await this.ot(req, otId, "terreno.registrar");
    this.abierta(ot);
    const t = await this.exigirFila(otId);
    if (t.ivc_grado) throw new ConflictException("El IVC ya se emitió: la lista de chequeo no se cambia.");
    const d = ChequeoBody.parse(body ?? {});
    const ids = d.items.map((x) => x.id);
    const propias = await this.prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM ot_terreno_prueba WHERE terreno_id = $1::uuid AND id = ANY($2::uuid[])`, t.id, ids);
    if (propias.length !== new Set(ids).size) throw new BadRequestException("Hay pruebas que no son de esta OT.");
    await this.prisma.$transaction(async (tx) => {
      for (const x of d.items)
        await tx.$executeRawUnsafe(
          `UPDATE ot_terreno_prueba SET resultado = $2, observacion = $3, registrado_por = $4::uuid, registrado_at = CASE WHEN $2::text IS NULL THEN NULL ELSE now() END
            WHERE id = $1::uuid`,
          x.id,
          x.resultado,
          x.observacion?.trim() || null,
          x.resultado ? usuarioDe(req) : null,
        );
      await tx.$executeRawUnsafe(`UPDATE ot_terreno SET chequeo_at = now(), updated_at = now() WHERE id = $1::uuid`, t.id);
    });
    return this.ficha(req, otId);
  }

  async subirAdjunto(req: any, otId: string, archivo: ArchivoSubido | undefined, cuerpo: any) {
    const ot = await this.ot(req, otId, "terreno.registrar");
    this.abierta(ot);
    const t = await this.exigirFila(otId, false);
    const tipo = String(cuerpo?.tipo ?? "");
    if (!(TIPOS_ADJUNTO as readonly string[]).includes(tipo)) throw new BadRequestException("Indique el tipo: protocolo, hoja_control, ivc u otro.");
    if (!archivo?.buffer?.length) throw new BadRequestException("Adjunte el archivo.");
    if (archivo.buffer.length > MAX_ADJUNTO) throw new BadRequestException("El archivo no puede superar 10 MB.");
    const mime = mimeAdjunto(archivo.buffer, archivo.originalname ?? "");
    if (!mime || !MIME_ADJUNTO.includes(mime)) throw new BadRequestException("Formatos admitidos: PDF, PNG, JPEG, Word (.docx) o Excel (.xlsx).");
    const nombre = (archivo.originalname ?? "documento").replace(/[^\p{L}\p{N} ._-]/gu, "_").slice(0, 200);
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO ot_terreno_adjunto (tenant_id, terreno_id, tipo, nombre, mime, bytes, datos, hash_sha256, subido_por)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9::uuid)`,
      tenantDe(req),
      t.id,
      tipo,
      nombre,
      mime,
      archivo.buffer.length,
      archivo.buffer.toString("base64"),
      createHash("sha256").update(archivo.buffer).digest("hex"),
      usuarioDe(req),
    );
    await this.historial(otId, tenantDe(req), { accion: "adjunto", tipo, archivo: nombre }, usuarioDe(req));
    return this.ficha(req, otId);
  }

  private async adjunto(req: any, id: string, permiso: string) {
    const [a] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT a.*, t.ot_id, t.cerrada_at FROM ot_terreno_adjunto a JOIN ot_terreno t ON t.id = a.terreno_id
        WHERE a.id = $1::uuid AND a.tenant_id = $2::uuid AND a.deleted_at IS NULL`,
      id,
      tenantDe(req),
    );
    if (!a) throw new NotFoundException("Archivo no encontrado.");
    const ot = await this.ot(req, a.ot_id, permiso);
    return { a, ot };
  }

  async archivo(req: any, id: string) {
    const { a } = await this.adjunto(req, id, "ot.ver");
    return { mime: a.mime as string, nombre: a.nombre as string, datos: Buffer.from(a.datos, "base64") };
  }

  async quitarAdjunto(req: any, id: string) {
    const { a, ot } = await this.adjunto(req, id, "terreno.registrar");
    this.abierta(ot);
    if (a.cerrada_at) throw new ConflictException("El trabajo en terreno ya está cerrado: sus documentos no se quitan.");
    await this.prisma.$executeRawUnsafe(`UPDATE ot_terreno_adjunto SET deleted_at = now() WHERE id = $1::uuid`, id);
    return this.ficha(req, a.ot_id);
  }

  async ivc(req: any, otId: string, body: unknown) {
    const ot = await this.ot(req, otId, "terreno.gestionar");
    this.abierta(ot);
    const t = await this.exigirFila(otId);
    const d = IvcBody.parse(body ?? {});
    const pruebas = await this.prisma.$queryRawUnsafe<{ sistema: string; resultado: string | null }[]>(
      `SELECT sistema, resultado FROM ot_terreno_prueba WHERE terreno_id = $1::uuid`,
      t.id,
    );
    const h = await this.hechos(otId);
    const errores = erroresIvc(d, pruebas, h!.adjuntos);
    if (errores.length) throw new BadRequestException(errores.join(" "));
    await this.prisma.$executeRawUnsafe(
      `UPDATE ot_terreno SET ivc_numero = $2, ivc_grado = $3, ivc_conclusion = $4, ivc_por = $5::uuid, ivc_at = now(), updated_at = now() WHERE id = $1::uuid`,
      t.id,
      d.numero?.trim() || null,
      d.grado,
      d.conclusion?.trim() || null,
      usuarioDe(req),
    );
    await this.historial(otId, tenantDe(req), { accion: "ivc", grado: d.grado, numero: d.numero ?? null }, usuarioDe(req));
    return this.ficha(req, otId);
  }

  async cerrar(req: any, otId: string) {
    const ot = await this.ot(req, otId, "terreno.gestionar");
    this.abierta(ot);
    const t = await this.exigirFila(otId);
    if (!t.ivc_grado) throw new ConflictException("Emita primero el IVC con su grado de cumplimiento.");
    const pruebas = await this.prisma.$queryRawUnsafe<{ sistema: string; resultado: string | null }[]>(
      `SELECT sistema, resultado FROM ot_terreno_prueba WHERE terreno_id = $1::uuid`,
      t.id,
    );
    await this.prisma.$executeRawUnsafe(`UPDATE ot_terreno SET cerrada_por = $2::uuid, cerrada_at = now(), updated_at = now() WHERE id = $1::uuid`, t.id, usuarioDe(req));
    await this.historial(otId, tenantDe(req), { accion: "cierre", grado: t.ivc_grado, porSistema: resultadoPorSistema(pruebas) }, usuarioDe(req));
    return this.ficha(req, otId);
  }
}

/** Tipo del archivo por su firma (PDF, PNG, JPEG) o, si es un ZIP de Office, por su extensión. */
export function mimeAdjunto(b: Buffer, nombre: string): string | null {
  if (b.length >= 5 && b.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) {
    if (/\.docx$/i.test(nombre)) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if (/\.xlsx$/i.test(nombre)) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  return null;
}

type Sql = { $queryRawUnsafe<T = unknown>(q: string, ...v: any[]): Promise<T> };

/** Hechos del trabajo en terreno de la OT (null si no tiene). Sin inyección: lo usa la ruta de la OT. */
export async function hechosTerreno(db: Sql, otId: string) {
  try {
    const [t] = await db.$queryRawUnsafe<any[]>(
      `SELECT t.id, t.cerrada_at, t.ivc_grado, cardinality(t.analistas) AS analistas,
              (SELECT count(*) FROM ot_terreno_prueba p WHERE p.terreno_id = t.id)::int AS pruebas,
              (SELECT count(*) FROM ot_terreno_prueba p WHERE p.terreno_id = t.id AND p.resultado IS NOT NULL)::int AS registradas,
              (SELECT count(*) FROM ot_terreno_adjunto a WHERE a.terreno_id = t.id AND a.deleted_at IS NULL AND a.tipo = 'protocolo')::int AS protocolo,
              (SELECT count(*) FROM ot_terreno_adjunto a WHERE a.terreno_id = t.id AND a.deleted_at IS NULL AND a.tipo = 'hoja_control')::int AS hoja,
              (SELECT count(*) FROM ot_terreno_adjunto a WHERE a.terreno_id = t.id AND a.deleted_at IS NULL AND a.tipo = 'ivc')::int AS ivc
         FROM ot_terreno t WHERE t.ot_id = $1::uuid`,
      otId,
    );
    if (!t) return null;
    return {
      abierto: true,
      analistas: Number(t.analistas ?? 0),
      pruebas: Number(t.pruebas),
      registradas: Number(t.registradas),
      adjuntos: { protocolo: Number(t.protocolo), hoja_control: Number(t.hoja), ivc: Number(t.ivc) },
      ivcGrado: t.ivc_grado ?? null,
      cerrado: Boolean(t.cerrada_at),
    };
  } catch {
    return null;
  }
}

@ApiTags("terreno")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("terreno")
export class TerrenoController {
  constructor(private readonly svc: TerrenoService) {}

  @Get("ot/:otId")
  @RequierePermiso("ot.ver")
  @ApiOperation({ summary: "R10 · Trabajo en terreno de la OT: datos, unidades, pruebas, adjuntos y pasos" })
  ficha(@Param("otId", ParseUUIDPipe) otId: string, @Req() req: any) {
    return this.svc.ficha(req, otId);
  }

  @Post("ot/:otId/abrir")
  @RequierePermiso("terreno.gestionar")
  @ApiOperation({ summary: "1 · Apertura del trabajo en terreno (sin recepción ni toma de muestras)" })
  abrir(@Param("otId", ParseUUIDPipe) otId: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.abrir(req, otId, body);
  }

  @Put("ot/:otId/datos")
  @RequierePermiso("terreno.gestionar")
  datos(@Param("otId", ParseUUIDPipe) otId: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.datos(req, otId, body);
  }

  @Put("ot/:otId/asignacion")
  @RequierePermiso("terreno.gestionar")
  @ApiOperation({ summary: "2 · Asignación de analistas" })
  asignar(@Param("otId", ParseUUIDPipe) otId: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.asignar(req, otId, body);
  }

  @Put("ot/:otId/unidades")
  @RequierePermiso("terreno.registrar")
  @ApiOperation({ summary: "Unidades controladas: vehículo (chasis, motor, año), arma o equipo (serie)" })
  unidades(@Param("otId", ParseUUIDPipe) otId: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.unidades(req, otId, body);
  }

  @Post("ot/:otId/pruebas")
  @RequierePermiso("terreno.registrar")
  @ApiOperation({ summary: "3 · Pruebas según el protocolo de recepción cualitativa" })
  pruebas(@Param("otId", ParseUUIDPipe) otId: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.pruebas(req, otId, body);
  }

  @Delete("pruebas/:id")
  @RequierePermiso("terreno.registrar")
  quitarPrueba(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.quitarPrueba(req, id);
  }

  @Put("ot/:otId/chequeo")
  @RequierePermiso("terreno.registrar")
  @ApiOperation({ summary: "4 · Lista de chequeo: resultado de cada prueba" })
  chequeo(@Param("otId", ParseUUIDPipe) otId: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.chequeo(req, otId, body);
  }

  @Post("ot/:otId/adjuntos")
  @RequierePermiso("terreno.registrar")
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("archivo", { limits: { fileSize: MAX_ADJUNTO, files: 1, fields: 3 } }))
  subirAdjunto(@Param("otId", ParseUUIDPipe) otId: string, @UploadedFile() archivo: ArchivoSubido | undefined, @Body() body: any, @Req() req: any) {
    return this.svc.subirAdjunto(req, otId, archivo, body);
  }

  @Get("adjuntos/:id/archivo")
  @RequierePermiso("ot.ver")
  async archivo(@Param("id", ParseUUIDPipe) id: string, @Req() req: any, @Res() res: Response) {
    const a = await this.svc.archivo(req, id);
    res.setHeader("Content-Type", a.mime);
    res.setHeader("Content-Length", String(a.datos.length));
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(a.nombre)}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.end(a.datos);
  }

  @Delete("adjuntos/:id")
  @RequierePermiso("terreno.registrar")
  quitarAdjunto(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.quitarAdjunto(req, id);
  }

  @Post("ot/:otId/ivc")
  @RequierePermiso("terreno.gestionar")
  @ApiOperation({ summary: "5 · IVC: grado de cumplimiento (cumple / no cumple)" })
  ivc(@Param("otId", ParseUUIDPipe) otId: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.ivc(req, otId, body);
  }

  @Post("ot/:otId/cerrar")
  @RequierePermiso("terreno.gestionar")
  @ApiOperation({ summary: "6 · Cierre del trabajo en terreno con el resultado por sistema" })
  cerrar(@Param("otId", ParseUUIDPipe) otId: string, @Req() req: any) {
    return this.svc.cerrar(req, otId);
  }
}

@Module({
  controllers: [TerrenoController],
  providers: [TerrenoService],
})
export class TerrenoModule {}
