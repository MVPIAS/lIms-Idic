import {
  Controller,
  Get,
  Module,
  NotFoundException,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { PrismaClient } from "@prisma/client";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";

// ===========================================================================
// Módulo DOCUMENTOS · Buscador global de documentos (contrato §4.6.1 / §4.6.2,
// versión acordada con el cliente: se sustituye el árbol jerárquico de carpetas
// por una BÚSQUEDA GLOBAL por título y filtros).
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
             cl.id                AS cliente_id
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
             COALESCE(e.cliente_id, ot2.cliente_id) AS cliente_id
        FROM saec_certificado sc
        JOIN evidencia e        ON e.id = sc.evidencia_id
        LEFT JOIN orden_trabajo ot2 ON ot2.id = e.ot_id
        LEFT JOIN cliente cl2   ON cl2.id = COALESCE(e.cliente_id, ot2.cliente_id)
       WHERE sc.tenant_id = $1::uuid AND sc.deleted_at IS NULL`;

    const union = haySaec ? `${ramaInforme}\nUNION ALL${ramaSaec}` : ramaInforme;

    // --- Filtros del buscador, aplicados al conjunto unificado ---
    const args: any[] = [tenantId];
    const filtros: string[] = [];

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

@Module({
  controllers: [DocumentosController],
})
export class DocumentosModule {}
