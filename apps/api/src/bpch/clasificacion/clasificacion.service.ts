import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomInt } from "crypto";
import { z } from "zod";
import { PrismaService } from "../../common/prisma.service";
import { fmtFecha, fmtFechaHora } from "../../plantilla-render/html.util";
import { documentoCompleto, type Sello } from "../../plantilla-render/plantilla-defecto";
import { generarPdf } from "../../plantilla-render/pdf.renderer";
import { OtDesdeProcesoService } from "../ot-desde-proceso.service";
import { cuerpoDocumentoClasificacion } from "./documento-clasificacion";
import {
  EFECTOS_KOENEN,
  evaluarPruebas,
  normalizarNumeroOnu,
  textoClasificacion,
  validarRegistro,
  type Pruebas,
} from "./reglas-clasificacion";

/* ---------------------------------------------------------------- DTOs --- */

const texto = (max: number) =>
  z.preprocess((v) => (typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : v), z.string().max(max).nullable().optional());
const num = (min: number, max: number) => z.coerce.number().finite().min(min).max(max);

const SerieIt21 = z.object({
  ensayos: z
    .array(z.object({ tuboFragmentado: z.boolean(), placaPerforada: z.boolean(), observacion: texto(500) }))
    .max(10),
});
export const PruebasSchema = z
  .object({
    it21: z
      .object({ aplica: z.boolean(), serie1: SerieIt21.nullable().optional(), serie2: SerieIt21.nullable().optional() })
      .nullable()
      .optional(),
    it22: z
      .object({
        aplica: z.boolean(),
        serie: z.union([z.literal(1), z.literal(2)]),
        masaMuestraG: num(0, 100000).nullable().optional(),
        ensayos: z
          .array(
            z.object({
              orificioMm: num(0.1, 30),
              efecto: z.enum(EFECTOS_KOENEN),
              tiempoS: num(0, 100000).nullable().optional(),
              masaFragmentosG: num(0, 100000).nullable().optional(),
            }),
          )
          .max(10),
      })
      .nullable()
      .optional(),
    it23: z
      .object({
        aplica: z.boolean(),
        ensayos: z
          .array(
            z.object({
              presionMaxKpa: num(0, 1000000),
              tiempoMs: num(0, 1000000).nullable().optional(),
              masaG: num(0, 100000).nullable().optional(),
            }),
          )
          .max(10),
      })
      .nullable()
      .optional(),
  })
  .strict();

const Campos = {
  sustancia: z.string().trim().min(1, "Indique la sustancia o producto.").max(240),
  clienteId: z.string().uuid().nullable().optional(),
  descripcion: texto(4000),
  otId: z.string().uuid().nullable().optional(),
  muestraRef: texto(120),
  pruebas: PruebasSchema.optional(),
  explosiva: z.boolean().nullable().optional(),
  claseDivision: texto(10),
  grupoCompatibilidad: texto(2),
  numeroOnu: texto(10),
  nombreEnvio: texto(300),
  justificacion: texto(4000),
};
export const CrearClasificacion = z.object(Campos).strict();
export const EditarClasificacion = z.object(Campos).partial().strict();
export const Motivo = z.object({ motivo: z.string().trim().min(5, "Indique el motivo (al menos 5 caracteres).").max(2000) });

/* ------------------------------------------------------------- servicio --- */

const SELECT = `
  SELECT c.*, cl.razon_social AS cliente_nombre, cl.rut AS cliente_rut, ot.codigo AS ot_codigo,
         uc.nombre_completo AS clasificado_por_nombre, ua.nombre_completo AS aprobado_por_nombre,
         ud.nombre_completo AS devuelto_por_nombre, un.nombre_completo AS anulada_por_nombre
    FROM bpch_clasificacion c
    LEFT JOIN cliente cl ON cl.id = c.cliente_id
    LEFT JOIN orden_trabajo ot ON ot.id = c.ot_id
    LEFT JOIN usuario uc ON uc.id = c.clasificado_por
    LEFT JOIN usuario ua ON ua.id = c.aprobado_por
    LEFT JOIN usuario ud ON ud.id = c.devuelto_por
    LEFT JOIN usuario un ON un.id = c.anulada_por`;

/**
 * Clasificación de sustancias (BPCH): maestro con las pruebas ONU, la decisión
 * de quien clasifica y su aprobación. Reglas en reglas-clasificacion.ts.
 *
 * Ciclo: borrador → registrada (quien clasifica) → aprobada (otra persona, se
 * genera y sella el documento) · devolver (registrada → borrador) · anular ·
 * reclasificar (nueva versión desde una aprobada; al aprobarse, la anterior
 * queda «reemplazada»).
 */
@Injectable()
export class ClasificacionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly comun: OtDesdeProcesoService,
  ) {}

  private get baseVerificacion(): string {
    return (process.env.URL_VERIFICACION ?? "https://verificar.idic.cl/c").replace(/\/+$/, "");
  }

  /** Listas vigentes (parámetros del sistema) para los combos y la validación. */
  async config(tenantId: string) {
    const filas = await this.prisma.$queryRawUnsafe<{ categoria: string; codigo: string; etiqueta: string }[]>(
      `SELECT categoria, codigo, etiqueta FROM parametro_sistema
        WHERE tenant_id = $1::uuid AND activo AND categoria IN ('clase_division_onu', 'grupo_compatibilidad_onu')
        ORDER BY categoria, orden, codigo`,
      tenantId,
    );
    const de = (c: string) => filas.filter((f) => f.categoria === c).map((f) => ({ codigo: f.codigo, etiqueta: f.etiqueta }));
    return {
      clasesDivision: de("clase_division_onu"),
      gruposCompatibilidad: de("grupo_compatibilidad_onu"),
      efectosKoenen: EFECTOS_KOENEN,
      placasKoenen: { 1: [12, 5, 1], 2: [12, 5, 2] },
      umbralTptKpa: 2070,
    };
  }

  private mapear(r: any) {
    const pruebas: Pruebas = r.pruebas ?? {};
    const evaluacion = evaluarPruebas(pruebas);
    return {
      id: r.id,
      codigo: r.codigo,
      version: r.version,
      reemplazaId: r.reemplaza_id,
      sustancia: r.sustancia,
      cliente: r.cliente_id ? { id: r.cliente_id, razonSocial: r.cliente_nombre, rut: r.cliente_rut } : null,
      descripcion: r.descripcion,
      ot: r.ot_id ? { id: r.ot_id, codigo: r.ot_codigo } : null,
      muestraRef: r.muestra_ref,
      pruebas,
      evaluacion,
      explosiva: r.explosiva,
      claseDivision: r.clase_division,
      grupoCompatibilidad: r.grupo_compatibilidad,
      numeroOnu: r.numero_onu,
      nombreEnvio: r.nombre_envio,
      justificacion: r.justificacion,
      resumen: textoClasificacion({
        explosiva: r.explosiva,
        claseDivision: r.clase_division,
        grupoCompatibilidad: r.grupo_compatibilidad,
        numeroOnu: r.numero_onu,
      }),
      estado: r.estado,
      clasificadoPor: r.clasificado_por ? { id: r.clasificado_por, nombre: r.clasificado_por_nombre } : null,
      clasificadoAt: r.clasificado_at,
      aprobadoPor: r.aprobado_por ? { id: r.aprobado_por, nombre: r.aprobado_por_nombre } : null,
      aprobadoAt: r.aprobado_at,
      devuelto: r.devuelto_at ? { motivo: r.devuelto_motivo, por: r.devuelto_por_nombre, at: r.devuelto_at } : null,
      anulada: r.anulada_at ? { motivo: r.anulada_motivo, por: r.anulada_por_nombre, at: r.anulada_at } : null,
      documento: r.documento_numero
        ? { numero: r.documento_numero, hash: r.documento_hash, codigoVerificacion: r.documento_codigo_verificacion }
        : null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  private async fila(tenantId: string, id: string) {
    const filas = await this.prisma.$queryRawUnsafe<any[]>(`${SELECT} WHERE c.id = $1::uuid AND c.tenant_id = $2::uuid`, id, tenantId);
    if (!filas[0]) throw new NotFoundException("Clasificación no encontrada.");
    return filas[0];
  }

  async listar(tenantId: string, f: { q?: string; estado?: string; vigentes?: boolean; limit?: number }) {
    const args: unknown[] = [tenantId];
    const p = (v: unknown) => {
      args.push(v);
      return `$${args.length}`;
    };
    const where = ["c.tenant_id = $1::uuid"];
    if (f.q?.trim()) {
      const q = p(`%${f.q.trim()}%`);
      where.push(`(c.sustancia ILIKE ${q} OR c.codigo ILIKE ${q} OR c.numero_onu ILIKE ${q} OR cl.razon_social ILIKE ${q})`);
    }
    if (f.vigentes) where.push(`c.estado = 'aprobada'`);
    else if (f.estado?.trim()) where.push(`c.estado = ${p(f.estado.trim())}`);
    const limit = Math.min(Math.max(Number(f.limit) || 200, 1), 500);
    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `${SELECT} WHERE ${where.join(" AND ")} ORDER BY c.updated_at DESC LIMIT ${limit}`,
      ...args,
    );
    const data = filas.map((r) => {
      const m = this.mapear(r);
      const { pruebas: _p, ...resto } = m;
      return resto;
    });
    return { data, meta: { total: data.length } };
  }

  async detalle(tenantId: string, id: string) {
    const c = this.mapear(await this.fila(tenantId, id));
    const [versiones, prototipos, productos] = await Promise.all([
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT id, version, estado, aprobado_at FROM bpch_clasificacion WHERE tenant_id = $1::uuid AND codigo = $2 ORDER BY version`,
        tenantId,
        c.codigo,
      ),
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT id, codigo, elemento, estado FROM bpch_prototipo WHERE clasificacion_id = $1::uuid ORDER BY created_at`,
        id,
      ),
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT p.id, p.producto, o.id AS oc_id, o.numero AS oc_numero
           FROM bpch_oc_producto p JOIN bpch_oc_operativa o ON o.id = p.oc_id
          WHERE p.clasificacion_id = $1::uuid ORDER BY o.numero`,
        id,
      ),
    ]);
    return {
      ...c,
      versiones: versiones.map((v) => ({ id: v.id, version: v.version, estado: v.estado, aprobadoAt: v.aprobado_at })),
      usos: {
        prototipos: prototipos.map((x) => ({ id: x.id, codigo: x.codigo, elemento: x.elemento, estado: x.estado })),
        productosPn: productos.map((x) => ({ id: x.id, producto: x.producto, ocId: x.oc_id, ocNumero: x.oc_numero })),
      },
    };
  }

  private async validarReferencias(tenantId: string, d: { clienteId?: string | null; otId?: string | null }) {
    if (d.clienteId) {
      const c = await this.prisma.cliente.findFirst({ where: { id: d.clienteId, tenantId }, select: { id: true } });
      if (!c) throw new BadRequestException("El fabricante / origen indicado no existe.");
    }
    if (d.otId) {
      const o = await this.prisma.ordenTrabajo.findFirst({ where: { id: d.otId, tenantId }, select: { id: true } });
      if (!o) throw new BadRequestException("La OT indicada no existe.");
    }
  }

  private columnas(d: z.infer<typeof EditarClasificacion>): Record<string, unknown> {
    const m: Record<string, unknown> = {};
    if (d.sustancia !== undefined) m.sustancia = d.sustancia;
    if (d.clienteId !== undefined) m.cliente_id = d.clienteId;
    if (d.descripcion !== undefined) m.descripcion = d.descripcion;
    if (d.otId !== undefined) m.ot_id = d.otId;
    if (d.muestraRef !== undefined) m.muestra_ref = d.muestraRef;
    if (d.pruebas !== undefined) m.pruebas = JSON.stringify(d.pruebas);
    if (d.explosiva !== undefined) m.explosiva = d.explosiva;
    if (d.claseDivision !== undefined) m.clase_division = d.claseDivision;
    if (d.grupoCompatibilidad !== undefined) m.grupo_compatibilidad = d.grupoCompatibilidad?.toUpperCase() ?? null;
    if (d.numeroOnu !== undefined) {
      const onu = normalizarNumeroOnu(d.numeroOnu);
      if (onu !== null && !/^\d{4}$/.test(onu)) throw new BadRequestException("El Nº ONU son cuatro dígitos (p. ej. 0456).");
      m.numero_onu = onu;
    }
    if (d.nombreEnvio !== undefined) m.nombre_envio = d.nombreEnvio;
    if (d.justificacion !== undefined) m.justificacion = d.justificacion;
    return m;
  }

  async crear(tenantId: string, usuarioId: string | null, body: unknown) {
    const d = CrearClasificacion.parse(body ?? {});
    await this.validarReferencias(tenantId, d);
    const cols = this.columnas(d);
    const id = await this.prisma.$transaction(async (tx) => {
      const codigo = await this.comun.correlativo(tx, tenantId, "CLS");
      const nombres = Object.keys(cols);
      const valores = Object.values(cols);
      const filas = await tx.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO bpch_clasificacion (tenant_id, codigo, created_by${nombres.map((n) => `, ${n}`).join("")})
         VALUES ($1::uuid, $2, $3::uuid${nombres.map((n, i) => `, $${i + 4}${n === "pruebas" ? "::jsonb" : n.endsWith("_id") ? "::uuid" : ""}`).join("")})
         RETURNING id`,
        tenantId,
        codigo,
        usuarioId,
        ...valores,
      );
      return filas[0].id;
    });
    return this.detalle(tenantId, id);
  }

  async editar(tenantId: string, id: string, body: unknown) {
    const d = EditarClasificacion.parse(body ?? {});
    const actual = await this.fila(tenantId, id);
    if (actual.estado !== "borrador")
      throw new ConflictException(`La clasificación está ${actual.estado}: solo se edita en borrador (pida que la devuelvan o reclasifique).`);
    await this.validarReferencias(tenantId, d);
    const cols = this.columnas(d);
    const nombres = Object.keys(cols);
    if (nombres.length) {
      await this.prisma.$executeRawUnsafe(
        `UPDATE bpch_clasificacion SET ${nombres
          .map((n, i) => `${n} = $${i + 2}${n === "pruebas" ? "::jsonb" : n.endsWith("_id") ? "::uuid" : ""}`)
          .join(", ")}, updated_at = now() WHERE id = $1::uuid AND estado = 'borrador'`,
        id,
        ...Object.values(cols),
      );
    }
    return this.detalle(tenantId, id);
  }

  /** Errores para registrar (también los usa la pantalla para avisar antes). */
  async faltantesRegistro(tenantId: string, r: any): Promise<string[]> {
    const cfg = await this.config(tenantId);
    return validarRegistro(
      {
        explosiva: r.explosiva,
        claseDivision: r.clase_division,
        grupoCompatibilidad: r.grupo_compatibilidad,
        numeroOnu: r.numero_onu,
        justificacion: r.justificacion,
      },
      evaluarPruebas(r.pruebas ?? {}),
      { clasesValidas: cfg.clasesDivision.map((c) => c.codigo), gruposValidos: cfg.gruposCompatibilidad.map((g) => g.codigo) },
    );
  }

  async registrar(tenantId: string, id: string, usuarioId: string | null) {
    const r = await this.fila(tenantId, id);
    if (r.estado !== "borrador") throw new ConflictException(`La clasificación está ${r.estado}: no se puede registrar.`);
    const errores = await this.faltantesRegistro(tenantId, r);
    if (errores.length) throw new BadRequestException(`No se puede registrar la clasificación. ${errores.join(" ")}`);
    await this.prisma.$executeRawUnsafe(
      `UPDATE bpch_clasificacion SET estado = 'registrada', clasificado_por = $2::uuid, clasificado_at = now(), updated_at = now()
        WHERE id = $1::uuid AND estado = 'borrador'`,
      id,
      usuarioId,
    );
    return this.detalle(tenantId, id);
  }

  async devolver(tenantId: string, id: string, usuarioId: string | null, body: unknown) {
    const { motivo } = Motivo.parse(body ?? {});
    const r = await this.fila(tenantId, id);
    if (r.estado !== "registrada") throw new ConflictException(`Solo se devuelve una clasificación registrada (está ${r.estado}).`);
    await this.prisma.$executeRawUnsafe(
      `UPDATE bpch_clasificacion SET estado = 'borrador', devuelto_motivo = $2, devuelto_por = $3::uuid, devuelto_at = now(),
              clasificado_por = NULL, clasificado_at = NULL, updated_at = now()
        WHERE id = $1::uuid AND estado = 'registrada'`,
      id,
      motivo,
      usuarioId,
    );
    return this.detalle(tenantId, id);
  }

  private nuevoCodigoVerificacion(): string {
    const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let s = "";
    for (let i = 0; i < 12; i++) s += abc[randomInt(abc.length)];
    return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
  }

  /** Aprueba (otra persona que quien clasificó) y sella el documento. */
  async aprobar(tenantId: string, id: string, usuarioId: string | null) {
    const r = await this.fila(tenantId, id);
    if (r.estado !== "registrada") throw new ConflictException(`Solo se aprueba una clasificación registrada (está ${r.estado}).`);
    if (usuarioId && r.clasificado_por === usuarioId)
      throw new ForbiddenException("Quien clasificó la sustancia no puede aprobar su propia clasificación.");
    const errores = await this.faltantesRegistro(tenantId, r);
    if (errores.length) throw new BadRequestException(`La clasificación ya no es válida. ${errores.join(" ")}`);
    const aprobador = usuarioId
      ? await this.prisma.usuario.findUnique({ where: { id: usuarioId }, select: { nombreCompleto: true } })
      : null;
    const ahora = new Date();
    const codigoVerificacion = this.nuevoCodigoVerificacion();
    const numero = r.version > 1 ? `${r.codigo}-V${r.version}` : r.codigo;
    const cuerpo = cuerpoDocumentoClasificacion({
      numero,
      fecha: fmtFecha(ahora),
      codigo: r.codigo,
      version: r.version,
      sustancia: r.sustancia,
      fabricante: r.cliente_nombre ?? "",
      rut: r.cliente_rut ?? "",
      ot: r.ot_codigo ?? "",
      muestra: r.muestra_ref ?? "",
      descripcion: r.descripcion ?? "",
      explosiva: r.explosiva,
      claseDivision: r.clase_division ?? "",
      grupoCompatibilidad: r.grupo_compatibilidad ?? "",
      numeroOnu: r.numero_onu ?? "",
      nombreEnvio: r.nombre_envio ?? "",
      justificacion: r.justificacion ?? "",
      clasificadoPor: r.clasificado_por_nombre ?? "",
      clasificadoAt: fmtFechaHora(r.clasificado_at),
      aprobadoPor: aprobador?.nombreCompleto ?? "",
      aprobadoAt: fmtFechaHora(ahora),
      pruebas: r.pruebas ?? {},
    });
    const hash = createHash("sha256").update(cuerpo, "utf8").digest("hex");
    await this.prisma.$transaction(async (tx) => {
      const n = await tx.$executeRawUnsafe(
        `UPDATE bpch_clasificacion SET estado = 'aprobada', aprobado_por = $2::uuid, aprobado_at = $3,
                documento_numero = $4, documento_html = $5, documento_hash = $6, documento_codigo_verificacion = $7, updated_at = now()
          WHERE id = $1::uuid AND estado = 'registrada'`,
        id,
        usuarioId,
        ahora,
        numero,
        cuerpo,
        hash,
        codigoVerificacion,
      );
      if (n !== 1) throw new ConflictException("La clasificación cambió mientras se aprobaba. Vuelva a cargarla.");
      // Reclasificación: la versión anterior aprobada queda reemplazada.
      if (r.reemplaza_id)
        await tx.$executeRawUnsafe(
          `UPDATE bpch_clasificacion SET estado = 'reemplazada', updated_at = now() WHERE id = $1::uuid AND estado = 'aprobada'`,
          r.reemplaza_id,
        );
    });
    return this.detalle(tenantId, id);
  }

  async anular(tenantId: string, id: string, usuarioId: string | null, body: unknown) {
    const { motivo } = Motivo.parse(body ?? {});
    const r = await this.fila(tenantId, id);
    if (r.estado === "anulada" || r.estado === "reemplazada")
      throw new ConflictException(`La clasificación ya está ${r.estado}.`);
    await this.prisma.$executeRawUnsafe(
      `UPDATE bpch_clasificacion SET estado = 'anulada', anulada_motivo = $2, anulada_por = $3::uuid, anulada_at = now(), updated_at = now()
        WHERE id = $1::uuid`,
      id,
      motivo,
      usuarioId,
    );
    return this.detalle(tenantId, id);
  }

  /** Nueva versión (borrador) de una clasificación aprobada, con sus datos de partida. */
  async reclasificar(tenantId: string, id: string, usuarioId: string | null) {
    const r = await this.fila(tenantId, id);
    if (r.estado !== "aprobada") throw new ConflictException("Solo se reclasifica una clasificación aprobada.");
    const abierta = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM bpch_clasificacion WHERE tenant_id = $1::uuid AND codigo = $2 AND estado IN ('borrador', 'registrada')`,
      tenantId,
      r.codigo,
    );
    if (abierta.length) throw new ConflictException("Ya hay una nueva versión en curso de esta clasificación.");
    const filas = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO bpch_clasificacion (tenant_id, codigo, version, reemplaza_id, sustancia, cliente_id, descripcion, ot_id, muestra_ref,
              pruebas, explosiva, clase_division, grupo_compatibilidad, numero_onu, nombre_envio, justificacion, created_by)
       SELECT tenant_id, codigo, (SELECT max(version) + 1 FROM bpch_clasificacion WHERE tenant_id = c.tenant_id AND codigo = c.codigo),
              id, sustancia, cliente_id, descripcion, ot_id, muestra_ref, pruebas, explosiva, clase_division, grupo_compatibilidad,
              numero_onu, nombre_envio, justificacion, $2::uuid
         FROM bpch_clasificacion c WHERE c.id = $1::uuid
       RETURNING id`,
      id,
      usuarioId,
    );
    return this.detalle(tenantId, filas[0].id);
  }

  /** Documento sellado (solo clasificaciones aprobadas o reemplazadas). */
  private async documento(tenantId: string, id: string) {
    const r = await this.fila(tenantId, id);
    if (!r.documento_html) throw new NotFoundException("La clasificación aún no tiene documento: se genera al aprobarla.");
    const sello: Sello = {
      numero: r.documento_numero,
      codigoVerificacion: r.documento_codigo_verificacion ?? "—",
      hash: r.documento_hash ?? "",
      fecha: fmtFecha(r.aprobado_at),
      urlVerificacion: this.baseVerificacion,
      estadoDocumento: r.estado === "anulada" ? "anulado" : undefined,
      motivoEstado: r.estado === "anulada" ? r.anulada_motivo : null,
    };
    const titulo = `${r.documento_numero} · Clasificación de sustancia · ${r.sustancia}`;
    return { r, sello, titulo };
  }

  async html(tenantId: string, id: string) {
    const { r, sello, titulo } = await this.documento(tenantId, id);
    return documentoCompleto(r.documento_html, sello, titulo);
  }

  async pdf(tenantId: string, id: string) {
    const { r, sello, titulo } = await this.documento(tenantId, id);
    return { buffer: await generarPdf(r.documento_html, sello, titulo), nombre: `${r.documento_numero}.pdf` };
  }

  /** Clasificación aprobada (para prototipos y productos de la O/C). 400 si no lo está. */
  async exigirAprobada(tenantId: string, id: string) {
    const r = await this.fila(tenantId, id);
    if (r.estado !== "aprobada")
      throw new BadRequestException(`La clasificación ${r.codigo} está ${r.estado}: solo se puede usar una clasificación aprobada.`);
    return r;
  }
}
