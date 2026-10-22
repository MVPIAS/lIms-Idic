import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "../../common/prisma.service";
import { createHash } from "node:crypto";
import { Sql, tenantDe, usuarioDe } from "../comun/bpch-comun.service";
import { faltantesInscripcionCu } from "../prototipos/reglas-prototipo";
import { generarPdf } from "../../plantilla-render/pdf.renderer";
import { hoyChile } from "../../common/fecha-chile";
import { TIPOS_LISTADO, agruparListado, csvListado, entraEnListado, htmlListado, type TipoListado } from "./listado-oficial";
import {
  ESTADOS_CODIFICACION,
  LISTADOS_CODIFICACION,
  errorCambioEstadoCodificacion,
  erroresInscripcion,
  normalizarCnc,
} from "../comun/reglas-bpch";

const texto = (max: number) => z.string().trim().max(max);

export const InscripcionBody = z.object({
  listado: z.enum(LISTADOS_CODIFICACION),
  cnc: texto(80),
  clienteId: z.string().uuid().optional().nullable(),
  fabricanteNombre: texto(200).optional().nullable(),
  fabricanteRut: texto(20).optional().nullable(),
  elementoGenerico: texto(240).optional().nullable(),
  producto: texto(240),
  claseDivisionUn: texto(20).optional().nullable(),
  numeroUn: texto(10).optional().nullable(),
  catElementoId: z.string().uuid().optional().nullable(),
  certificadoNumero: texto(60).optional().nullable(),
  observaciones: texto(2000).optional().nullable(),
  /** Modelos DGMN del listado oficial (EP-09 9.10 y 9.16): grupo («21 Semigelatina granulada»), EQ.DIN 60 % y PTN/PIN. */
  grupoListado: texto(120).optional().nullable(),
  eqDin60: z.number().min(0).max(100).optional().nullable(),
  ptnPin: texto(10).optional().nullable(),
});
export type Inscripcion = z.infer<typeof InscripcionBody>;

export const EdicionBody = InscripcionBody.partial().extend({ motivo: texto(500).optional() });

export const CambioEstadoBody = z.object({ estado: z.enum(ESTADOS_CODIFICACION), motivo: texto(500) });

export const CambioTitularBody = z.object({
  clienteId: z.string().uuid().optional().nullable(),
  fabricanteNombre: texto(200).optional().nullable(),
  fabricanteRut: texto(20).optional().nullable(),
  motivo: texto(500),
  reinspeccionId: z.string().uuid().optional().nullable(),
});

export const DesdePrototipoBody = z.object({
  listado: z.enum(["EXPLOSIVOS", "SUSTANCIAS_QUIMICAS"]),
  grupoListado: texto(120).optional().nullable(),
  eqDin60: z.number().min(0).max(100).optional().nullable(),
  ptnPin: texto(10).optional().nullable(),
});

export const ListadoOficialBody = z.object({
  listado: z.enum(TIPOS_LISTADO),
  /** Nombre del fabricante tal como está en la Codificación Única; vacío = todos. */
  fabricante: texto(200).optional().nullable(),
  fechaEdicion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha de edición AAAA-MM-DD"),
});

export const FiltroCodificacion = z.object({
  listado: z.enum(LISTADOS_CODIFICACION).optional(),
  estado: z.enum(ESTADOS_CODIFICACION).optional(),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const COLUMNAS = `c.id, c.listado, c.estado, c.cnc_dgmn AS cnc, c.cliente_id AS "clienteId",
  c.fabricante_nombre AS "fabricanteNombre", c.fabricante_rut AS "fabricanteRut",
  c.elemento_generico AS "elementoGenerico", c.producto, c.clase_division_un AS "claseDivisionUn",
  c.numero_un AS "numeroUn", c.cat_elemento_id AS "catElementoId", ce.nombre AS "catElementoNombre",
  c.certificado_id AS "certificadoId", COALESCE(ct.numero, c.certificado_numero) AS "certificadoNumero",
  c.observaciones, c.grupo_listado AS "grupoListado", c.eq_din_60::float8 AS "eqDin60", c.ptn_pin AS "ptnPin",
  c.created_at AS "createdAt", c.updated_at AS "updatedAt"`;
const DESDE = `FROM bpch_codificacion c
  LEFT JOIN cat_elemento ce ON ce.id = c.cat_elemento_id
  LEFT JOIN certificado ct ON ct.id = c.certificado_id`;

/**
 * Listado de Codificación Única (DGMN/BPCH): inscripción, corrección,
 * receso / reactivación, cambio de titular e historial. Se consulta al
 * registrar internaciones y reinspecciones (búsqueda por código o producto).
 */
@Injectable()
export class CodificacionService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(req: any, f: z.infer<typeof FiltroCodificacion>) {
    const tenantId = tenantDe(req);
    const args: unknown[] = [tenantId];
    const p = (v: unknown) => (args.push(v), `$${args.length}`);
    const where = [`c.tenant_id = $1::uuid`, `c.deleted_at IS NULL`];
    if (f.listado) where.push(`c.listado = ${p(f.listado)}`);
    if (f.estado) where.push(`c.estado = ${p(f.estado)}`);
    if (f.q) {
      const q = p(`%${f.q}%`);
      const n = p(`%${normalizarCnc(f.q)}%`);
      where.push(`(c.producto ILIKE ${q} OR c.fabricante_nombre ILIKE ${q} OR c.fabricante_rut ILIKE ${q} OR c.elemento_generico ILIKE ${q} OR c.cnc_normalizado ILIKE ${n})`);
    }
    const limit = f.limit ?? 50;
    const page = f.page ?? 1;
    const [{ total }] = await this.prisma.$queryRawUnsafe<{ total: number }[]>(`SELECT count(*)::int AS total ${DESDE} WHERE ${where.join(" AND ")}`, ...args);
    const conteos = await this.prisma.$queryRawUnsafe<{ listado: string; estado: string; n: number }[]>(
      `SELECT listado, estado, count(*)::int AS n FROM bpch_codificacion WHERE tenant_id = $1::uuid AND deleted_at IS NULL GROUP BY 1, 2`,
      tenantId,
    );
    const data = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT ${COLUMNAS} ${DESDE} WHERE ${where.join(" AND ")}
        ORDER BY c.fabricante_nombre, c.producto LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      ...args,
    );
    return { data, meta: { page, limit, total: Number(total), totalPages: Math.max(1, Math.ceil(Number(total) / limit)) }, conteos };
  }

  /* ------------------------------------------- EP-09 9.16 listado oficial --- */

  private async productosListado(tenantId: string, tipo: TipoListado, fabricante?: string | null) {
    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT ${COLUMNAS} ${DESDE}
        WHERE c.tenant_id = $1::uuid AND c.deleted_at IS NULL
          AND ($2::text IS NULL OR upper(btrim(c.fabricante_nombre)) = upper(btrim($2::text)))`,
      tenantId,
      fabricante?.trim() || null,
    );
    return filas.filter((p) => entraEnListado(p, tipo));
  }

  /** Fabricantes con productos en el listado (para elegir a quién se emite). */
  async fabricantesListado(req: any, listado: string) {
    const tipo = (TIPOS_LISTADO as readonly string[]).includes(listado) ? (listado as TipoListado) : "EXPLOSIVOS";
    const ps = await this.productosListado(tenantDe(req), tipo);
    const m = new Map<string, { fabricante: string; rut: string | null; elementos: number }>();
    for (const p of ps) {
      const k = p.fabricanteNombre.trim();
      const x = m.get(k) ?? { fabricante: k, rut: p.fabricanteRut ?? null, elementos: 0 };
      x.elementos++;
      m.set(k, x);
    }
    return [...m.values()].sort((a, b) => a.fabricante.localeCompare(b.fabricante, "es"));
  }

  /** Genera el listado oficial (PDF para firma, o Excel) y deja constancia de la emisión. */
  async listadoOficial(req: any, body: unknown, formato: "pdf" | "csv") {
    const tenantId = tenantDe(req);
    const d = ListadoOficialBody.parse(body ?? {});
    if (d.fechaEdicion > hoyChile()) throw new BadRequestException("La fecha de edición no puede ser futura.");
    const secciones = agruparListado(await this.productosListado(tenantId, d.listado, d.fabricante), d.listado);
    const total = secciones.reduce((s, x) => s + x.total, 0);
    if (!total) throw new ConflictException("No hay productos en ese listado para el fabricante indicado.");
    const base = `listado_${d.listado.toLowerCase()}_${(d.fabricante?.trim() || "todos").replace(/[^A-Za-z0-9]+/g, "_").slice(0, 40)}_${d.fechaEdicion}`;
    let contenido: Buffer;
    if (formato === "csv") contenido = Buffer.from(csvListado(secciones), "utf8");
    else {
      // Firmantes por cargo: quién firma y cómo llega la firma de la DGMN está por confirmar (EP-09 P4).
      const cuerpo = htmlListado(secciones, d.listado, d.fechaEdicion, {
        subdirector: "Subdirector del Banco de Pruebas de Chile",
        dgmn: "Jefe Depto. Control de Armas y Explosivos · DGMN",
      });
      const hash = createHash("sha256").update(cuerpo, "utf8").digest("hex");
      contenido = await generarPdf(
        cuerpo,
        {
          numero: `Listado ${d.listado.replace("_", " ").toLowerCase()} · ${total} elemento(s)`,
          codigoVerificacion: "—",
          hash,
          fecha: d.fechaEdicion.split("-").reverse().join("-"),
          urlVerificacion: "",
        },
        `Listado de Codificación Única · ${d.fabricante?.trim() || "todos los fabricantes"}`,
      );
    }
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO bpch_listado_emision (tenant_id, listado, fabricante, fecha_edicion, total_elementos, formato, hash_sha256, created_by)
       VALUES ($1::uuid, $2, $3, $4::date, $5, $6, $7, $8::uuid)`,
      tenantId,
      d.listado,
      d.fabricante?.trim() || null,
      d.fechaEdicion,
      total,
      formato,
      createHash("sha256").update(contenido).digest("hex"),
      usuarioDe(req),
    );
    return { contenido, nombre: `${base}.${formato}`, tipo: formato === "pdf" ? "application/pdf" : "text/csv; charset=utf-8" };
  }

  async emisionesListado(req: any) {
    return this.prisma.$queryRawUnsafe<any[]>(
      `SELECT e.id, e.listado, e.fabricante, e.fecha_edicion AS "fechaEdicion", e.total_elementos AS total, e.formato,
              e.created_at AS "createdAt", u.nombre_completo AS "emitidoPor"
         FROM bpch_listado_emision e LEFT JOIN usuario u ON u.id = e.created_by
        WHERE e.tenant_id = $1::uuid ORDER BY e.created_at DESC LIMIT 50`,
      tenantDe(req),
    );
  }

  async detalle(req: any, id: string) {
    const fila = await this.uno(tenantDe(req), id);
    const historial = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT h.id, h.evento, h.detalle, h.created_at AS "createdAt", h.ot_id AS "otId", o.codigo AS "otCodigo",
              h.certificado_id AS "certificadoId", ct.numero AS "certificadoNumero", u.nombre_completo AS "usuarioNombre"
         FROM bpch_codificacion_historial h
         LEFT JOIN orden_trabajo o ON o.id = h.ot_id
         LEFT JOIN certificado ct ON ct.id = h.certificado_id
         LEFT JOIN usuario u ON u.id = h.usuario_id
        WHERE h.codificacion_id = $1::uuid
        ORDER BY h.created_at DESC, h.id`,
      id,
    );
    return { ...fila, historial };
  }

  /** Búsqueda exacta por código (normalizado): la usan internación y reinspección. */
  /** Producto por su código CNC. Dentro de `sql` ve lo inscrito en la misma transacción. */
  async porCnc(tenantId: string, cnc: string, sql: Sql = this.prisma) {
    const filas = await sql.$queryRawUnsafe<any[]>(
      `SELECT ${COLUMNAS} ${DESDE} WHERE c.tenant_id = $1::uuid AND c.deleted_at IS NULL AND c.cnc_normalizado = $2`,
      tenantId,
      normalizarCnc(cnc),
    );
    return filas[0] ?? null;
  }

  async uno(tenantId: string, id: string, sql: Sql = this.prisma) {
    const filas = await sql.$queryRawUnsafe<any[]>(
      `SELECT ${COLUMNAS} ${DESDE} WHERE c.id = $1::uuid AND c.tenant_id = $2::uuid AND c.deleted_at IS NULL`,
      id,
      tenantId,
    );
    if (!filas[0]) throw new NotFoundException("Producto no encontrado en la Codificación Única.");
    return filas[0];
  }

  /** Completa fabricante desde el maestro de clientes si se indica clienteId. */
  private async fabricante(tenantId: string, d: { clienteId?: string | null; fabricanteNombre?: string | null; fabricanteRut?: string | null }) {
    if (d.clienteId) {
      const c = await this.prisma.cliente.findFirst({ where: { id: d.clienteId, tenantId }, select: { id: true, razonSocial: true, rut: true } });
      if (!c) throw new BadRequestException("La empresa indicada no existe en el maestro de clientes.");
      return { clienteId: c.id, nombre: d.fabricanteNombre?.trim() || c.razonSocial, rut: d.fabricanteRut?.trim() || c.rut };
    }
    return { clienteId: null, nombre: d.fabricanteNombre?.trim() ?? "", rut: d.fabricanteRut?.trim() || null };
  }

  private async exigirCncLibre(sql: Sql, tenantId: string, cnc: string, exceptoId?: string) {
    const ya = await sql.$queryRawUnsafe<{ id: string; producto: string }[]>(
      `SELECT id, producto FROM bpch_codificacion WHERE tenant_id = $1::uuid AND deleted_at IS NULL AND cnc_normalizado = $2 AND ($3::uuid IS NULL OR id <> $3::uuid)`,
      tenantId,
      normalizarCnc(cnc),
      exceptoId ?? null,
    );
    if (ya[0]) throw new ConflictException(`El código ${cnc.trim()} ya está inscrito (${ya[0].producto}).`);
  }

  async anotar(sql: Sql, d: { tenantId: string; codificacionId: string; evento: string; detalle?: Record<string, unknown>; otId?: string | null; certificadoId?: string | null; usuarioId: string | null }) {
    await sql.$executeRawUnsafe(
      `INSERT INTO bpch_codificacion_historial (tenant_id, codificacion_id, evento, detalle, ot_id, certificado_id, usuario_id, created_at)
       VALUES ($1::uuid, $2::uuid, $3, $4::jsonb, $5::uuid, $6::uuid, $7::uuid, clock_timestamp())`,
      d.tenantId,
      d.codificacionId,
      d.evento,
      JSON.stringify(d.detalle ?? {}),
      d.otId ?? null,
      d.certificadoId ?? null,
      d.usuarioId,
    );
  }

  /** Inscripción (alta manual o al certificar). Dentro de `sql` si viene de otro proceso. */
  async inscribir(req: any, body: Inscripcion, sql: Sql = this.prisma, origen: { evento?: string; otId?: string | null; certificadoId?: string | null } = {}) {
    const tenantId = tenantDe(req);
    const fab = await this.fabricante(tenantId, body);
    const errores = erroresInscripcion({ ...body, fabricanteNombre: fab.nombre });
    if (errores.length) throw new BadRequestException(errores.join(" "));
    await this.exigirCncLibre(sql, tenantId, body.cnc);
    if (body.catElementoId) {
      const e = await sql.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM cat_elemento WHERE id = $1::uuid AND tenant_id = $2::uuid`, body.catElementoId, tenantId);
      if (!e[0]) throw new BadRequestException("El elemento del catálogo indicado no existe.");
    }
    const [fila] = await sql.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO bpch_codificacion (tenant_id, listado, estado, cnc_dgmn, cnc_normalizado, cliente_id, fabricante_nombre, fabricante_rut,
              elemento_generico, producto, clase_division_un, numero_un, cat_elemento_id, certificado_id, certificado_numero, observaciones,
              created_by, updated_by, grupo_listado, eq_din_60, ptn_pin)
       VALUES ($1::uuid, $2, 'VIGENTE', $3, $4, $5::uuid, $6, $7, $8, $9, $10, $11, $12::uuid, $13::uuid, $14, $15, $16::uuid, $16::uuid, $17, $18, $19)
       RETURNING id`,
      tenantId,
      body.listado,
      body.cnc.trim(),
      normalizarCnc(body.cnc),
      fab.clienteId,
      fab.nombre,
      fab.rut,
      body.elementoGenerico?.trim() || null,
      body.producto.trim(),
      body.claseDivisionUn?.trim() || null,
      body.numeroUn?.trim() || null,
      body.catElementoId ?? null,
      origen.certificadoId ?? null,
      body.certificadoNumero?.trim() || null,
      body.observaciones?.trim() || null,
      usuarioDe(req),
      body.grupoListado?.trim() || null,
      body.eqDin60 ?? null,
      body.ptnPin?.trim().toUpperCase() || null,
    );
    await this.anotar(sql, {
      tenantId,
      codificacionId: fila.id,
      evento: origen.evento ?? "alta",
      detalle: { listado: body.listado, cnc: body.cnc.trim(), producto: body.producto.trim(), fabricante: fab.nombre },
      otId: origen.otId,
      certificadoId: origen.certificadoId,
      usuarioId: usuarioDe(req),
    });
    return fila.id;
  }

  async crear(req: any, body: unknown) {
    const id = await this.inscribir(req, InscripcionBody.parse(body ?? {}));
    return this.detalle(req, id);
  }

  /**
   * EP-08 8.17 (BL-180): inscribe el tipo aprobado de un prototipo con sus datos
   * heredados (fabricante, elemento, código CNC, clase/división y Nº ONU de su
   * clasificación) y el certificado de aprobación de tipo asociado.
   */
  async desdePrototipo(req: any, prototipoId: string, body: unknown) {
    const tenantId = tenantDe(req);
    const d = DesdePrototipoBody.parse(body ?? {});
    const [p] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT p.id, p.codigo, p.estado, p.dictamen, p.codigo_cnc, p.cliente_id, p.elemento, p.grupo_propuesto, p.ot_id, p.documento_id,
              d.estado AS doc_estado, d.numero AS doc_numero, c.clase_division, c.grupo_compatibilidad, c.numero_onu
         FROM bpch_prototipo p
         LEFT JOIN certificado d ON d.id = p.documento_id
         LEFT JOIN bpch_clasificacion c ON c.id = p.clasificacion_id
        WHERE p.id = $1::uuid AND p.tenant_id = $2::uuid`,
      prototipoId,
      tenantId,
    );
    if (!p) throw new NotFoundException("Prototipo no encontrado.");
    const ya = p.codigo_cnc
      ? await this.prisma.$queryRawUnsafe<any[]>(
          `SELECT id FROM bpch_codificacion WHERE tenant_id = $1::uuid AND deleted_at IS NULL AND cnc_normalizado = $2`,
          tenantId,
          normalizarCnc(p.codigo_cnc),
        )
      : [];
    const faltan = faltantesInscripcionCu({ estado: p.estado, dictamen: p.dictamen, documentoEstado: p.doc_estado, codigoCnc: p.codigo_cnc, yaInscrito: ya.length > 0 });
    if (faltan.length) throw new ConflictException(faltan.join(" "));
    const id = await this.prisma.$transaction((tx) =>
      this.inscribir(
        req,
        {
          listado: d.listado,
          cnc: p.codigo_cnc,
          clienteId: p.cliente_id,
          producto: p.elemento,
          elementoGenerico: p.grupo_propuesto ?? null,
          claseDivisionUn: p.clase_division ? `${p.clase_division}${p.grupo_compatibilidad ?? ""}` : null,
          numeroUn: p.numero_onu ?? null,
          certificadoNumero: p.doc_numero ?? null,
          grupoListado: d.grupoListado ?? null,
          eqDin60: d.eqDin60 ?? null,
          ptnPin: d.ptnPin ?? null,
          observaciones: `Inscrito desde el prototipo ${p.codigo} (tipo aprobado).`,
        } as Inscripcion,
        tx as any,
        { evento: "alta_certificacion", otId: p.ot_id, certificadoId: p.documento_id },
      ),
    );
    return this.detalle(req, id);
  }

  async editar(req: any, id: string, body: unknown) {
    const tenantId = tenantDe(req);
    const dto = EdicionBody.parse(body ?? {});
    const actual = await this.uno(tenantId, id);
    const fab = dto.clienteId !== undefined || dto.fabricanteNombre !== undefined || dto.fabricanteRut !== undefined
      ? await this.fabricante(tenantId, {
          clienteId: dto.clienteId === undefined ? actual.clienteId : dto.clienteId,
          fabricanteNombre: dto.fabricanteNombre === undefined ? actual.fabricanteNombre : dto.fabricanteNombre,
          fabricanteRut: dto.fabricanteRut === undefined ? actual.fabricanteRut : dto.fabricanteRut,
        })
      : { clienteId: actual.clienteId, nombre: actual.fabricanteNombre, rut: actual.fabricanteRut };
    const nuevo = {
      listado: dto.listado ?? actual.listado,
      cnc: dto.cnc ?? actual.cnc,
      producto: dto.producto ?? actual.producto,
      elementoGenerico: dto.elementoGenerico === undefined ? actual.elementoGenerico : dto.elementoGenerico,
      claseDivisionUn: dto.claseDivisionUn === undefined ? actual.claseDivisionUn : dto.claseDivisionUn,
      numeroUn: dto.numeroUn === undefined ? actual.numeroUn : dto.numeroUn,
      catElementoId: dto.catElementoId === undefined ? actual.catElementoId : dto.catElementoId,
      certificadoNumero: dto.certificadoNumero === undefined ? actual.certificadoNumero : dto.certificadoNumero,
      observaciones: dto.observaciones === undefined ? actual.observaciones : dto.observaciones,
      grupoListado: dto.grupoListado === undefined ? actual.grupoListado : dto.grupoListado,
      eqDin60: dto.eqDin60 === undefined ? actual.eqDin60 : dto.eqDin60,
      ptnPin: dto.ptnPin === undefined ? actual.ptnPin : dto.ptnPin,
    };
    const errores = erroresInscripcion({ ...nuevo, fabricanteNombre: fab.nombre });
    if (errores.length) throw new BadRequestException(errores.join(" "));
    if (nuevo.catElementoId && nuevo.catElementoId !== actual.catElementoId) {
      const e = await this.prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM cat_elemento WHERE id = $1::uuid AND tenant_id = $2::uuid`, nuevo.catElementoId, tenantId);
      if (!e[0]) throw new BadRequestException("El elemento del catálogo indicado no existe.");
    }
    const cambiaCodigo = normalizarCnc(nuevo.cnc) !== normalizarCnc(actual.cnc);
    if (cambiaCodigo) {
      if (!dto.motivo || dto.motivo.trim().length < 5) throw new BadRequestException("Para corregir el código CNC-DGMN indique el motivo (mínimo 5 caracteres).");
      await this.exigirCncLibre(this.prisma, tenantId, nuevo.cnc, id);
    }
    const cambios: Record<string, { antes: unknown; ahora: unknown }> = {};
    const comparar = (k: string, a: unknown, b: unknown) => {
      if ((a ?? null) !== (b ?? null)) cambios[k] = { antes: a ?? null, ahora: b ?? null };
    };
    comparar("listado", actual.listado, nuevo.listado);
    comparar("cnc", actual.cnc, nuevo.cnc?.trim());
    comparar("producto", actual.producto, nuevo.producto?.trim());
    comparar("fabricante", actual.fabricanteNombre, fab.nombre);
    comparar("claseDivisionUn", actual.claseDivisionUn, nuevo.claseDivisionUn?.trim() || null);
    comparar("numeroUn", actual.numeroUn, nuevo.numeroUn?.trim() || null);
    comparar("grupoListado", actual.grupoListado, nuevo.grupoListado?.trim() || null);
    comparar("eqDin60", actual.eqDin60, nuevo.eqDin60 ?? null);
    comparar("ptnPin", actual.ptnPin, nuevo.ptnPin?.trim().toUpperCase() || null);
    if (!Object.keys(cambios).length && nuevo.observaciones === actual.observaciones && nuevo.catElementoId === actual.catElementoId && nuevo.elementoGenerico === actual.elementoGenerico && nuevo.certificadoNumero === actual.certificadoNumero)
      return this.detalle(req, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE bpch_codificacion SET listado = $2, cnc_dgmn = $3, cnc_normalizado = $4, cliente_id = $5::uuid, fabricante_nombre = $6,
                fabricante_rut = $7, elemento_generico = $8, producto = $9, clase_division_un = $10, numero_un = $11,
                cat_elemento_id = $12::uuid, certificado_numero = $13, observaciones = $14, updated_by = $15::uuid, updated_at = now(),
                grupo_listado = $16, eq_din_60 = $17, ptn_pin = $18
          WHERE id = $1::uuid`,
        id,
        nuevo.listado,
        nuevo.cnc.trim(),
        normalizarCnc(nuevo.cnc),
        fab.clienteId,
        fab.nombre,
        fab.rut,
        nuevo.elementoGenerico?.trim() || null,
        nuevo.producto.trim(),
        nuevo.claseDivisionUn?.trim() || null,
        nuevo.numeroUn?.trim() || null,
        nuevo.catElementoId ?? null,
        nuevo.certificadoNumero?.trim() || null,
        nuevo.observaciones?.trim() || null,
        usuarioDe(req),
        nuevo.grupoListado?.trim() || null,
        nuevo.eqDin60 ?? null,
        nuevo.ptnPin?.trim().toUpperCase() || null,
      );
      await this.anotar(tx, { tenantId, codificacionId: id, evento: "edicion", detalle: { cambios, motivo: dto.motivo?.trim() || null }, usuarioId: usuarioDe(req) });
    });
    return this.detalle(req, id);
  }

  async cambiarEstado(req: any, id: string, body: unknown) {
    const tenantId = tenantDe(req);
    const dto = CambioEstadoBody.parse(body ?? {});
    const actual = await this.uno(tenantId, id);
    const error = errorCambioEstadoCodificacion(actual.estado, dto.estado, dto.motivo);
    if (error) throw new ConflictException(error);
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`UPDATE bpch_codificacion SET estado = $2, updated_by = $3::uuid, updated_at = now() WHERE id = $1::uuid`, id, dto.estado, usuarioDe(req));
      await this.anotar(tx, { tenantId, codificacionId: id, evento: dto.estado === "EN_RECESO" ? "receso" : "reactivacion", detalle: { desde: actual.estado, motivo: dto.motivo }, usuarioId: usuarioDe(req) });
    });
    return this.detalle(req, id);
  }

  /** Cambio de titular (p. ej. tras el traspaso que motivó una reinspección). Queda en el historial. */
  async cambiarTitular(req: any, id: string, body: unknown, sql: Sql = this.prisma) {
    const tenantId = tenantDe(req);
    const dto = CambioTitularBody.parse(body ?? {});
    if (!dto.motivo || dto.motivo.length < 5) throw new BadRequestException("Indique el motivo del cambio de titular (mínimo 5 caracteres).");
    const actual = await this.uno(tenantId, id);
    const fab = await this.fabricante(tenantId, dto);
    if (!fab.nombre) throw new BadRequestException("Indique el nuevo titular (empresa del maestro de clientes o nombre).");
    if (fab.nombre === actual.fabricanteNombre && (fab.clienteId ?? null) === (actual.clienteId ?? null))
      throw new ConflictException("El titular indicado ya es el titular del producto.");
    await sql.$executeRawUnsafe(
      `UPDATE bpch_codificacion SET cliente_id = $2::uuid, fabricante_nombre = $3, fabricante_rut = $4, updated_by = $5::uuid, updated_at = now() WHERE id = $1::uuid`,
      id,
      fab.clienteId,
      fab.nombre,
      fab.rut,
      usuarioDe(req),
    );
    await this.anotar(sql, {
      tenantId,
      codificacionId: id,
      evento: "cambio_titular",
      detalle: { anterior: { nombre: actual.fabricanteNombre, rut: actual.fabricanteRut }, nuevo: { nombre: fab.nombre, rut: fab.rut }, motivo: dto.motivo, reinspeccionId: dto.reinspeccionId ?? null },
      usuarioId: usuarioDe(req),
    });
    return id;
  }
}
