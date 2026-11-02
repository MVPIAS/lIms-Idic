import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Module,
  NotFoundException,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { AuthGuard } from "@nestjs/passport";
import { GestorDocumentalService } from "./gestor.service";
import { MAX_DOCUMENTO_BYTES } from "./gestor";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { PrismaClient } from "@prisma/client";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { AlcanceService } from "../rbac/alcance.service";

// ===========================================================================
// Módulo DOCUMENTOS · Buscador global de documentos EMITIDOS por el LIMS
// (contrato §4.6.1). El árbol de carpetas con versiones (§4.6.2/§4.6.3) es el
// gestor documental: GestorDocumentalController, al final de este fichero.
//
// Los "documentos" del sistema son los certificados/informes EMITIDOS:
//   · certificado        (núcleo LIMS · informes de ensayo, certificados…)
//   · saec_certificado   (módulo SAEC · certificados de evidencia/pericia)
//
// SOLO LECTURA. Mismo patrón e idéntico aislamiento por tenant que
// reportes.module.ts / saec.module.ts: NUNCA se interpola entrada del usuario
// en el SQL; los valores viajan SIEMPRE como parámetros posicionales ($1, $2…)
// vía $queryRawUnsafe. Los únicos fragmentos que se concatenan al texto de la
// consulta son cláusulas fijas escritas en el código (no vienen del query
// string). Filtra por tenant_id y deleted_at. Permiso `ot.ver`.
//
// ALCANCE POR LABORATORIO: cada documento cuenta para la unidad que lo emite
// (certificado.unidad_id o, si falta, el laboratorio de su OT; los del SAEC, el
// laboratorio de la OT de la evidencia o la Delegación Nº 11). Quien consulta
// solo ve los de su alcance (AlcanceService): las jefaturas su rama, los
// perfiles globales todo.
//
// `saec_certificado` NO está en el schema de Prisma (vive en packages/db/
// saec.sql). Puede no existir si el SAEC no se ha desplegado en un entorno, así
// que su rama del UNION se añade en runtime solo si la tabla existe
// (to_regclass), evitando un 500 «relation does not exist».
// ===========================================================================

interface DocumentoResultado {
  origen: "informe" | "saec";
  tipo: string | null;
  codigo: string | null;
  otCodigo: string | null;
  cliente: string | null;
  fecha: string | null;
  estado: string | null;
  hashSha256: string | null;
  codigoVerificacion: string | null;
  urlVerificacion: string | null;
}

@ApiTags("documentos")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("documentos")
export class DocumentosController {
  private prisma = new PrismaClient();

  constructor(private readonly alcance: AlcanceService) {}

  private tenantId(req: any): string {
    const id = req?.user?.tenantId;
    if (!id) throw new NotFoundException("Tenant no resuelto en el token");
    return id;
  }

  private paginacion(page?: string, limit?: string) {
    const p = Math.max(1, parseInt(page ?? "1") || 1);
    const l = Math.min(200, Math.max(1, parseInt(limit ?? "50") || 50));
    return { p, l, offset: (p - 1) * l };
  }

  /**
   * RF §4.6.1/§4.6.2 · Buscador global de documentos emitidos.
   *
   * GET /api/documentos?q=&tipo=&desde=&hasta=&clienteId=&otId=&page=&limit=
   *   q          texto libre: código del documento / código de la OT / razón
   *              social del cliente / código de verificación (ILIKE).
   *   tipo       origen del documento: "informe" | "saec".
   *   desde/hasta rango de fecha de emisión (inclusive).
   *   clienteId  UUID del cliente.
   *   otId       UUID de la orden de trabajo.
   */
  @Get()
  @RequierePermiso("ot.ver")
  async buscar(
    @Query("q") q?: string,
    @Query("tipo") tipo?: string,
    @Query("desde") desde?: string,
    @Query("hasta") hasta?: string,
    @Query("clienteId") clienteId?: string,
    @Query("otId") otId?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
    @Req() req?: any,
  ): Promise<{ data: DocumentoResultado[]; meta: { page: number; limit: number; total: number } }> {
    const tenantId = this.tenantId(req);
    const { p, l, offset } = this.paginacion(page, limit);

    // ¿Existe la tabla del SAEC en este entorno? Si no, no se une su rama.
    const reg = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT to_regclass('public.saec_certificado') IS NOT NULL AS existe`,
    );
    const haySaec = Boolean(reg[0]?.existe);

    // --- Subconsulta unificada (informes + saec). tenant_id = $1 en ambas ---
    const ramaInforme = `
      SELECT 'informe'::text AS origen,
             c.tipo               AS tipo,
             c.codigo             AS codigo,
             ot.codigo            AS ot_codigo,
             cl.razon_social      AS cliente,
             c.fecha              AS fecha,
             c.estado             AS estado,
             c.hash_sha256        AS hash_sha256,
             c.codigo_verificacion AS codigo_verificacion,
             c.url_verificacion   AS url_verificacion,
             ot.id                AS ot_id,
             cl.id                AS cliente_id,
             COALESCE(c.unidad_id, ot.unidad_principal) AS unidad_id
        FROM certificado c
        JOIN orden_trabajo ot ON ot.id = c.ot_id
        LEFT JOIN cliente cl   ON cl.id = ot.cliente_id
       WHERE c.tenant_id = $1::uuid AND c.deleted_at IS NULL`;

    const ramaSaec = `
      SELECT 'saec'::text AS origen,
             'SAEC'::text          AS tipo,
             sc.codigo             AS codigo,
             ot2.codigo            AS ot_codigo,
             cl2.razon_social      AS cliente,
             sc.emitido_at         AS fecha,
             sc.estado             AS estado,
             sc.hash_documento     AS hash_sha256,
             sc.codigo_verificacion AS codigo_verificacion,
             NULL::text            AS url_verificacion,
             ot2.id                AS ot_id,
             COALESCE(e.cliente_id, ot2.cliente_id) AS cliente_id,
             COALESCE(ot2.unidad_principal,
                      (SELECT u.id FROM unidad u WHERE u.tenant_id = sc.tenant_id AND u.codigo = 'D11' LIMIT 1)) AS unidad_id
        FROM saec_certificado sc
        JOIN evidencia e        ON e.id = sc.evidencia_id
        LEFT JOIN orden_trabajo ot2 ON ot2.id = e.ot_id
        LEFT JOIN cliente cl2   ON cl2.id = COALESCE(e.cliente_id, ot2.cliente_id)
       WHERE sc.tenant_id = $1::uuid AND sc.deleted_at IS NULL`;

    const union = haySaec ? `${ramaInforme}\nUNION ALL${ramaSaec}` : ramaInforme;

    // --- Filtros del buscador, aplicados al conjunto unificado ---
    const args: any[] = [tenantId];
    const filtros: string[] = [];

    // Alcance por laboratorio (null = perfil global, sin filtro).
    const unidades = await this.alcance.filtroUnidades(req);
    if (unidades) {
      args.push(unidades);
      filtros.push(`AND d.unidad_id = ANY($${args.length}::uuid[])`);
    }

    if (tipo === "informe" || tipo === "saec") {
      args.push(tipo);
      filtros.push(`AND d.origen = $${args.length}`);
    }
    if (q) {
      args.push(`%${q}%`);
      const n = args.length;
      filtros.push(
        `AND (d.codigo ILIKE $${n} OR d.ot_codigo ILIKE $${n} OR d.cliente ILIKE $${n} OR d.codigo_verificacion ILIKE $${n})`,
      );
    }
    if (desde) {
      args.push(desde);
      filtros.push(`AND d.fecha >= $${args.length}::timestamptz`);
    }
    if (hasta) {
      // hasta inclusive: hasta el final del día indicado.
      args.push(hasta);
      filtros.push(`AND d.fecha < ($${args.length}::date + INTERVAL '1 day')`);
    }
    if (clienteId) {
      args.push(clienteId);
      filtros.push(`AND d.cliente_id = $${args.length}::uuid`);
    }
    if (otId) {
      args.push(otId);
      filtros.push(`AND d.ot_id = $${args.length}::uuid`);
    }

    const where = filtros.join(" ");

    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT d.*, COUNT(*) OVER() AS total_count
         FROM (${union}) d
        WHERE 1 = 1 ${where}
        ORDER BY d.fecha DESC NULLS LAST
        LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      ...args,
      l,
      offset,
    );

    const total = filas.length ? Number(filas[0].total_count) : 0;
    const data: DocumentoResultado[] = filas.map((f) => ({
      origen: f.origen,
      tipo: f.tipo,
      codigo: f.codigo,
      otCodigo: f.ot_codigo,
      cliente: f.cliente,
      fecha: f.fecha,
      estado: f.estado,
      hashSha256: f.hash_sha256,
      codigoVerificacion: f.codigo_verificacion,
      urlVerificacion: f.url_verificacion,
    }));

    return { data, meta: { page: p, limit: l, total } };
  }
}

// ===========================================================================
// Gestor documental (§4.6.1–§4.6.3): carpetas jerárquicas, documentos con
// versiones, publicación, renombrado y permisos por usuario (gestor.service.ts).
// Va ANTES que DocumentosController en el módulo: sus rutas son más específicas.
// ===========================================================================

const UUID = new ParseUUIDPipe({ version: "4", errorHttpStatusCode: 400 });
const SUBIDA = FileInterceptor("archivo", { limits: { fileSize: MAX_DOCUMENTO_BYTES, files: 1, fields: 12 } });

@ApiTags("documentos")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("documentos")
export class GestorDocumentalController {
  constructor(private readonly g: GestorDocumentalService) {}

  @Get("carpetas")
  @RequierePermiso("documento.ver")
  arbol(@Req() req: any) {
    return this.g.arbol(req);
  }

  @Post("carpetas")
  @RequierePermiso("documento.gestionar")
  crearCarpeta(@Body() b: any, @Req() req: any) {
    return this.g.crearCarpeta(req, b);
  }

  @Patch("carpetas/:id")
  @RequierePermiso("documento.gestionar")
  editarCarpeta(@Param("id", UUID) id: string, @Body() b: any, @Req() req: any) {
    return this.g.editarCarpeta(req, id, b);
  }

  @Delete("carpetas/:id")
  @RequierePermiso("documento.gestionar")
  borrarCarpeta(@Param("id", UUID) id: string, @Req() req: any) {
    return this.g.borrarCarpeta(req, id);
  }

  @Get("usuarios")
  @RequierePermiso("documento.gestionar")
  usuarios(@Query("q") q: string | undefined, @Req() req: any) {
    return this.g.usuarios(req, q);
  }

  @Get("archivos")
  @RequierePermiso("documento.ver")
  listar(
    @Req() req: any,
    @Query("carpetaId") carpetaId?: string,
    @Query("otId") otId?: string,
    @Query("muestraId") muestraId?: string,
    @Query("clienteId") clienteId?: string,
    @Query("q") texto?: string,
    @Query("subcarpetas") subcarpetas?: string,
  ) {
    return this.g.listar(req, { carpetaId, otId, muestraId, clienteId, texto, subcarpetas });
  }

  @Post("archivos")
  @RequierePermiso("documento.gestionar")
  @UseInterceptors(SUBIDA)
  crear(@UploadedFile() archivo: any, @Body() b: any, @Req() req: any) {
    return this.g.crear(req, archivo, b);
  }

  @Get("archivos/:id")
  @RequierePermiso("documento.ver")
  ver(@Param("id", UUID) id: string, @Req() req: any) {
    return this.g.ver(req, id);
  }

  @Patch("archivos/:id")
  @RequierePermiso("documento.gestionar")
  editar(@Param("id", UUID) id: string, @Body() b: any, @Req() req: any) {
    return this.g.editar(req, id, b);
  }

  @Delete("archivos/:id")
  @RequierePermiso("documento.gestionar")
  borrar(@Param("id", UUID) id: string, @Req() req: any) {
    return this.g.borrar(req, id);
  }

  @Put("archivos/:id/accesos")
  @RequierePermiso("documento.gestionar")
  accesos(@Param("id", UUID) id: string, @Body() b: any, @Req() req: any) {
    return this.g.accesos(req, id, b);
  }

  @Post("archivos/:id/versiones")
  @RequierePermiso("documento.gestionar")
  @UseInterceptors(SUBIDA)
  nuevaVersion(@Param("id", UUID) id: string, @UploadedFile() archivo: any, @Body() b: any, @Req() req: any) {
    return this.g.nuevaVersion(req, id, archivo, b);
  }

  @Post("archivos/:id/versiones/:numero/publicar")
  @RequierePermiso("documento.gestionar")
  publicar(@Param("id", UUID) id: string, @Param("numero", ParseIntPipe) numero: number, @Req() req: any) {
    return this.g.publicar(req, id, numero);
  }

  /** Descarga: sin `numero`, la versión publicada. */
  @Get("archivos/:id/descargar")
  @RequierePermiso("documento.ver")
  async descargar(@Param("id", UUID) id: string, @Query("numero") numero: string | undefined, @Req() req: any, @Res() res: any) {
    const n = numero ? parseInt(numero, 10) : undefined;
    if (numero && !Number.isInteger(n)) throw new BadRequestException("Número de versión inválido.");
    const a = await this.g.descargar(req, id, n);
    res.setHeader("Content-Type", a.mime);
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(a.nombre)}`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    res.send(a.datos);
  }
}

@Module({
  controllers: [GestorDocumentalController, DocumentosController],
  providers: [GestorDocumentalService],
})
export class DocumentosModule {}
