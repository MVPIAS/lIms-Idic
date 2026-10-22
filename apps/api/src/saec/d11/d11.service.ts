import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from "@nestjs/common";
import * as QRCode from "qrcode";
import { z } from "zod";
import { PrismaService } from "../../common/prisma.service";
import { AlcanceService } from "../../rbac/alcance.service";
import { PuenteAnalisisService, RegistroMuestrasService } from "../../flujo-real/flujo-real.module";
import { PlantillaRenderService, type DocumentoEnRender } from "../../plantilla-render/plantilla-render.service";
import { FirmaDocumentoService } from "../../plantilla-render/firma-documento.service";
import { escapeHtml, fmtFecha, fmtFechaHora } from "../../plantilla-render/html.util";
import { anioChile, hoyChile } from "../../common/fecha-chile";
import { svgCode128 } from "../../common/code128";
import { leerTabla, TablaError } from "../../common/tabla-archivo";
import {
  CLASES,
  NOMBRE_CAMINO,
  NOMBRE_CLASE,
  NOMBRE_ETAPA_ARMA,
  NOMBRE_GRUPO,
  NOMBRE_TIPO_ARMA,
  TIPOS_ARMA,
  avanceD11,
  caminoDe,
  certificadoVigente,
  configD11,
  enmascararSerie,
  erroresAcunacion,
  erroresCapturaExplicita,
  erroresCertificado,
  etapaArma,
  grupoEnsayo,
  mapearPlanilla,
  normalizarSerie,
  rangoEmision,
  requiereAcunacion,
  resultadoActa,
  tipoEntrada,
  totalSegunResolucion,
  verificarContraResolucion,
  vigenciaHasta,
  type ConfigD11,
  type EnsayoArma,
  type EstadoArma,
  type TipoArma,
} from "./reglas-d11";

/* ======================================================================== */
/* Cuerpos de las peticiones                                                 */
/* ======================================================================== */

const fechaDia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD");
const texto = (max: number) => z.string().trim().max(max);
const opcional = (max: number) => texto(max).optional().nullable();
const uuid = z.string().uuid();

export const ProgramacionBody = z.object({
  fecha: fechaDia,
  lugar: texto(240).min(3, "Indique el lugar de la recepción (p. ej. el arsenal)."),
  responsableId: uuid,
});
export const LlegadaBody = z.object({
  fecha: fechaDia,
  transportista: texto(200).min(2, "Indique el transportista."),
  bultos: z.number().int().min(1, "Indique cuántos bultos llegan.").max(100_000),
  avisoPrevio: z.boolean({ required_error: "Indique si el importador avisó con 24 h de anticipación." }),
  observaciones: opcional(2000),
});
export const ActaBody = z.object({
  bultos: z.number().int().min(0).max(100_000),
  cantidad: z.number().int().min(0).max(100_000),
  ubicacion: texto(160).min(2, "Indique la ubicación en bodega."),
  responsableId: uuid,
  observaciones: opcional(4000),
});
const ArmaBody = z.object({
  resolucionArmaId: uuid.optional().nullable(),
  tipo: z.enum(TIPOS_ARMA),
  marcaId: uuid,
  modeloId: uuid,
  calibreId: uuid,
  paisOrigen: texto(80).min(2, "Indique el país de origen."),
  serie: opcional(80),
  sinSerie: z.boolean().optional(),
  accesorios: opcional(300),
  lote: opcional(80),
});
export const RegistroArmasBody = z.object({ armas: z.array(ArmaBody).min(1, "Indique al menos un arma.").max(200, "Registre como máximo 200 armas de una vez.") });
export const ClasificacionBody = z.object({
  items: z
    .array(
      z.object({
        armaOtId: uuid,
        clase: z.enum(CLASES),
        permisibilidad: z.enum(["permitida", "prohibida"]),
        camino: z.enum(["cip", "completa"]).optional().nullable(),
      }),
    )
    .min(1)
    .max(200),
  motivo: opcional(500),
});
export const EnsayosBody = z.object({
  valores: z
    .array(
      z.object({
        resultadoId: uuid,
        valor: z.union([z.number().finite(), z.string().max(120)]).optional().nullable(),
        atributo: z.enum(["cumple", "no_cumple"]).optional().nullable(),
        observacion: opcional(2000),
      }),
    )
    .max(200),
  motivo: opcional(1000),
});
export const AcunacionBody = z.object({
  items: z
    .array(
      z.object({
        armaOtId: uuid,
        numero: texto(30).min(1, "Indique el Nº del cuño."),
        anio: z.number().int().min(1990).max(2100),
      }),
    )
    .min(1)
    .max(200),
});
export const CertificadosBody = z.object({ armaOtIds: z.array(uuid).min(1).max(200) });
export const MovimientoBody = z.object({
  evento: z.literal("cambio_ubicacion"),
  ubicacion: texto(160).min(2, "Indique la nueva ubicación."),
  motivo: texto(300).min(5, "Indique el motivo (mínimo 5 caracteres)."),
});
export const EntregaBody = z.object({
  receptorNombre: texto(200).min(2, "Indique quién recibe."),
  receptorDocumento: opcional(40),
  fecha: fechaDia,
  codigos: z.array(texto(60)).min(1, "Lea o escriba el código de barras de al menos un arma.").max(500),
  entregarCertificados: z.boolean().optional(),
  observaciones: opcional(2000),
});
/** Fichero que entrega multer (FileInterceptor, en memoria). */
export type ArchivoSubido = { buffer: Buffer; originalname?: string; size?: number; mimetype?: string };
export const CatalogoMarcaBody = z.object({ nombre: texto(160).min(2), pais: opcional(80) });
export const CatalogoModeloBody = z.object({ marcaId: uuid, nombre: texto(160).min(1) });
export const CatalogoCalibreBody = z.object({ nombre: texto(80).min(1), cip: z.boolean().optional() });
export const CatalogoEstadoBody = z.object({ activo: z.boolean(), nombre: opcional(160), pais: opcional(80), cip: z.boolean().optional() });

/* ======================================================================== */

const tenantDe = (req: any): string => {
  const t = req?.user?.tenantId;
  if (!t) throw new ForbiddenException("Sesión sin institución.");
  return t;
};
const usuarioDe = (req: any): string | null => req?.user?.sub ?? null;
const tiene = (req: any, p: string) => (req?.user?.roles ?? []).includes("SUPERADMIN") || (req?.user?.permisos ?? []).includes(p);

const OT_CERRADA = ["cerrada", "anulada"];

type Db = Pick<PrismaService, "$queryRawUnsafe" | "$executeRawUnsafe">;

/** Fila de arma de la OT tal como la necesitan las reglas y la pantalla. */
interface FilaArma {
  id: string;
  orden: number;
  tipo: TipoArma;
  serie_normalizada: string | null;
  sin_serie: boolean;
  accesorios: string | null;
  lote: string | null;
  ubicacion: string | null;
  clase: EstadoArma["clase"];
  permisibilidad: EstadoArma["permisibilidad"];
  camino: EstadoArma["camino"];
  acunacion_numero: string | null;
  acunacion_anio: number | null;
  acunada_at: Date | null;
  entrega_id: string | null;
  resolucion_arma_id: string | null;
  arma_id: string;
  serie: string | null;
  marca: string | null;
  modelo: string | null;
  calibre: string | null;
  pais_origen: string | null;
  muestra_id: string;
  muestra: string;
  codigo_barras: string | null;
  veredicto: string | null;
  ensayos: number;
  pendientes: number;
  aprobados: number;
  certificado: { id: string; numero: string; estado: string; entregadoAt: string | null; vigenteHasta: string | null; vigenteDesde: string | null } | null;
}

const SELECT_ARMAS = `
  SELECT a.id, a.orden, a.tipo, a.serie_normalizada, a.sin_serie, a.accesorios, a.lote, a.ubicacion,
         a.clase, a.permisibilidad, a.camino, a.acunacion_numero, a.acunacion_anio, a.acunada_at,
         a.entrega_id, a.resolucion_arma_id,
         ar.id AS arma_id, ar.serie, ar.marca, ar.modelo, ar.calibre, ar.pais_origen,
         m.id AS muestra_id, m.codigo AS muestra, m.codigo_barras, m.veredicto,
         (SELECT count(*) FROM resultado r WHERE r.muestra_id = m.id AND r.deleted_at IS NULL)::int AS ensayos,
         (SELECT count(*) FROM resultado r WHERE r.muestra_id = m.id AND r.deleted_at IS NULL
                                              AND r.estado IN ('pendiente', 'devuelto'))::int AS pendientes,
         (SELECT count(*) FROM resultado r WHERE r.muestra_id = m.id AND r.deleted_at IS NULL AND r.estado = 'aprobado')::int AS aprobados,
         (SELECT json_build_object('id', c.id, 'numero', COALESCE(c.numero, c.codigo), 'estado', c.estado,
                                   'entregadoAt', c.entregado_at, 'vigenteHasta', ca.vigente_hasta, 'vigenteDesde', ca.vigente_desde)
            FROM certificado c
            LEFT JOIN d11_certificado_arma ca ON ca.certificado_id = c.id
           WHERE c.ot_id = a.ot_id AND c.deleted_at IS NULL AND c.tipo_documento = 'CERTIFICADO_ARMA'
             AND c.estado IN ('en_firma', 'oficial', 'emitido') AND c.muestra_ids @> ARRAY[m.id]
           ORDER BY c.created_at DESC LIMIT 1) AS certificado
    FROM d11_arma_ot a
    JOIN arma ar   ON ar.id = a.arma_id
    JOIN muestra m ON m.id = a.muestra_id AND m.deleted_at IS NULL`;

function estadoDe(a: FilaArma): EstadoArma {
  return {
    clase: a.clase,
    permisibilidad: a.permisibilidad,
    camino: a.camino,
    ensayos: Number(a.ensayos),
    pendientes: Number(a.pendientes),
    aprobados: Number(a.aprobados),
    veredicto: a.veredicto,
    acunada: Boolean(a.acunada_at),
    certificado: a.certificado ? { estado: a.certificado.estado } : null,
    entregada: Boolean(a.entrega_id),
  };
}

/**
 * Delegación Nº 11 · certificación de armas internadas (EP-11, camino A). La
 * OT es la del flujo general (nace de la internación con la D11 como unidad
 * que inspecciona); aquí viven los pasos propios de la D11. Cada arma es una
 * MUESTRA de la OT, con sus ensayos del catálogo (DTCG-PG03), la revisión y
 * aprobación del flujo general y su certificado por arma en el circuito de
 * firma de la matriz. Reglas puras: reglas-d11.ts.
 */
@Injectable()
export class D11Service implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
    private readonly registro: RegistroMuestrasService,
    private readonly puente: PuenteAnalisisService,
    private readonly render: PlantillaRenderService,
    private readonly firmas: FirmaDocumentoService,
  ) {}

  onModuleInit() {
    this.render.registrarContexto("arma", (otId, tenantId, plantilla, doc) => this.contextoCertificado(otId, tenantId, plantilla, doc));
    this.render.registrarVerificacion("CERTIFICADO_ARMA", (certificadoId) => this.verificacionPublica(certificadoId));
  }

  /* ------------------------------------------------------------ comunes --- */

  async config(tenantId: string, db: Db = this.prisma): Promise<ConfigD11> {
    const filas = await db.$queryRawUnsafe<{ codigo: string; valor: string | null; activo: boolean }[]>(
      `SELECT codigo, valor, activo FROM parametro_sistema WHERE tenant_id = $1::uuid AND categoria = 'd11'`,
      tenantId,
    );
    return configD11(filas);
  }

  /** Unidades de la rama de la Delegación Nº 11 (D11 y lo que cuelgue de ella). */
  private async unidadesD11(tenantId: string): Promise<string[]> {
    const filas = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `WITH RECURSIVE rama AS (
         SELECT id FROM unidad WHERE tenant_id = $1::uuid AND codigo = 'D11'
         UNION ALL SELECT u.id FROM unidad u JOIN rama r ON u.padre_id = r.id)
       SELECT id FROM rama`,
      tenantId,
    );
    return filas.map((f) => f.id);
  }

  /** OT de la D11, del tenant y del alcance del usuario (404 si no). */
  private async otD11(req: any, otId: string) {
    const tenantId = tenantDe(req);
    const [ot] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT o.id, o.codigo, o.estado, o.unidad_principal, o.cliente_id, o.numero_ley, o.origen_trabajo, o.con_cobro,
              o.created_at, c.razon_social AS cliente, c.rut AS cliente_rut, u.codigo AS unidad_codigo
         FROM orden_trabajo o
         LEFT JOIN cliente c ON c.id = o.cliente_id
         LEFT JOIN unidad u  ON u.id = o.unidad_principal
        WHERE o.id = $1::uuid AND o.tenant_id = $2::uuid`,
      otId,
      tenantId,
    );
    if (!ot) throw new NotFoundException("OT no encontrada.");
    const rama = await this.unidadesD11(tenantId);
    if (!ot.unidad_principal || !rama.includes(ot.unidad_principal))
      throw new NotFoundException(`La OT ${ot.codigo} no es de la Delegación Nº 11.`);
    await this.alcance.exigirUnidad(req, ot.unidad_principal, `la OT ${ot.codigo}`);
    return ot as {
      id: string;
      codigo: string;
      estado: string;
      unidad_principal: string;
      cliente_id: string;
      numero_ley: string | null;
      origen_trabajo: string | null;
      cliente: string | null;
      cliente_rut: string | null;
    };
  }

  private otAbierta(ot: { codigo: string; estado: string }) {
    if (OT_CERRADA.includes(ot.estado)) throw new ConflictException(`La OT ${ot.codigo} está ${ot.estado}: no admite cambios.`);
  }

  private async expedienteFila(otId: string, db: Db = this.prisma) {
    const [e] = await db.$queryRawUnsafe<any[]>(`SELECT * FROM d11_expediente WHERE ot_id = $1::uuid`, otId);
    return e ?? null;
  }

  private async internacionDe(otId: string) {
    const [i] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, numero, resolucion_numero, resolucion_fecha, estado FROM bpch_internacion WHERE ot_id = $1::uuid`,
      otId,
    );
    return i ?? null;
  }

  private async listadoDe(internacionId: string | null) {
    if (!internacionId) return [];
    return this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, orden, tipo, marca, modelo, calibre, serie, serie_normalizada, accesorios, cantidad
         FROM d11_resolucion_arma WHERE internacion_id = $1::uuid ORDER BY orden`,
      internacionId,
    );
  }

  private armas(otId: string, db: Db = this.prisma, ids?: string[]): Promise<FilaArma[]> {
    return db.$queryRawUnsafe<FilaArma[]>(
      `${SELECT_ARMAS} WHERE a.ot_id = $1::uuid ${ids ? "AND a.id = ANY($2::uuid[])" : ""} ORDER BY a.orden`,
      otId,
      ...(ids ? [ids] : []),
    );
  }

  private async usuarioDeD11(tenantId: string, usuarioId: string, que: string) {
    const rama = await this.unidadesD11(tenantId);
    const [u] = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT u.id FROM usuario u JOIN usuario_rol ur ON ur.usuario_id = u.id
        WHERE u.id = $1::uuid AND u.deleted_at IS NULL AND ur.unidad_id = ANY($2::uuid[]) LIMIT 1`,
      usuarioId,
      rama,
    );
    if (!u) throw new BadRequestException(`El ${que} debe ser personal de la Delegación Nº 11.`);
  }

  /* ----------------------------------------------------------- consulta --- */

  async listar(req: any) {
    const tenantId = tenantDe(req);
    const rama = await this.unidadesD11(tenantId);
    const visibles = await this.alcance.filtroUnidades(req, "arma.ver");
    const unidades = visibles ? rama.filter((u) => visibles.includes(u)) : rama;
    if (!unidades.length) return { data: [] };
    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT o.id, o.codigo, o.estado, o.created_at AS "createdAt", o.numero_ley AS resolucion, o.origen_trabajo AS origen,
              c.razon_social AS cliente, i.numero AS internacion,
              (SELECT count(*) FROM d11_arma_ot a JOIN muestra m ON m.id = a.muestra_id AND m.deleted_at IS NULL WHERE a.ot_id = o.id)::int AS armas,
              (SELECT COALESCE(sum(r.cantidad), 0) FROM d11_resolucion_arma r WHERE r.internacion_id = i.id)::int AS "segunResolucion",
              (SELECT count(*) FROM certificado ce WHERE ce.ot_id = o.id AND ce.deleted_at IS NULL AND ce.tipo_documento = 'CERTIFICADO_ARMA'
                                                    AND ce.estado IN ('oficial', 'emitido'))::int AS certificados,
              e.acta_firmada_at AS "actaFirmadaAt", e.programacion_fecha AS "programadaPara"
         FROM orden_trabajo o
         LEFT JOIN cliente c ON c.id = o.cliente_id
         LEFT JOIN bpch_internacion i ON i.ot_id = o.id
         LEFT JOIN d11_expediente e ON e.ot_id = o.id
        WHERE o.tenant_id = $1::uuid AND o.unidad_principal = ANY($2::uuid[]) AND o.estado <> 'anulada'
        ORDER BY o.created_at DESC
        LIMIT 200`,
      tenantId,
      unidades,
    );
    return { data: filas };
  }

  async expediente(req: any, otId: string) {
    const ot = await this.otD11(req, otId);
    const tenantId = tenantDe(req);
    const [cfg, e, internacion, armas, emisiones, entregas, personal] = await Promise.all([
      this.config(tenantId),
      this.expedienteFila(otId),
      this.internacionDe(otId),
      this.armas(otId),
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT em.id, em.desde, em.hasta, em.cantidad, em.created_at AS "createdAt", u.nombre_completo AS "emitidaPor",
                (SELECT count(*) FROM d11_certificado_arma ca JOIN certificado c ON c.id = ca.certificado_id
                  WHERE ca.emision_id = em.id AND c.estado = 'en_firma')::int AS "enFirma",
                (SELECT count(*) FROM d11_certificado_arma ca JOIN certificado c ON c.id = ca.certificado_id
                  WHERE ca.emision_id = em.id AND c.estado IN ('oficial', 'emitido'))::int AS oficiales,
                (SELECT count(*) FROM d11_certificado_arma ca JOIN certificado c ON c.id = ca.certificado_id
                  WHERE ca.emision_id = em.id AND c.estado IN ('oficial', 'emitido') AND c.entregado_at IS NOT NULL)::int AS entregados,
                (SELECT count(*) FROM d11_certificado_arma ca JOIN certificado c ON c.id = ca.certificado_id
                  WHERE ca.emision_id = em.id AND c.estado IN ('devuelto', 'anulado'))::int AS anulados
           FROM d11_emision em LEFT JOIN usuario u ON u.id = em.created_by
          WHERE em.ot_id = $1::uuid ORDER BY em.created_at`,
        otId,
      ),
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT en.id, en.numero, en.receptor_nombre AS "receptorNombre", en.receptor_documento AS "receptorDocumento", en.fecha,
                en.observaciones, en.created_at AS "createdAt", u.nombre_completo AS "registradaPor",
                (SELECT count(*) FROM d11_arma_ot a WHERE a.entrega_id = en.id)::int AS armas
           FROM d11_entrega en LEFT JOIN usuario u ON u.id = en.created_by
          WHERE en.ot_id = $1::uuid ORDER BY en.created_at`,
        otId,
      ),
      this.prisma.$queryRawUnsafe<{ id: string; nombre: string }[]>(
        `SELECT DISTINCT u.id, u.nombre_completo AS nombre
           FROM usuario u JOIN usuario_rol ur ON ur.usuario_id = u.id
          WHERE u.deleted_at IS NULL AND ur.unidad_id = ANY($1::uuid[])
          ORDER BY u.nombre_completo`,
        await this.unidadesD11(tenantId),
      ),
    ]);
    const listado = await this.listadoDe(internacion?.id ?? null);
    const verificacion =
      listado.length || armas.length
        ? verificarContraResolucion(
            listado.map((l) => ({ ...l, cantidad: Number(l.cantidad) })),
            armas.map((a) => ({ tipo: a.tipo, marca: a.marca ?? "", modelo: a.modelo, calibre: a.calibre, serie: a.serie, accesorios: a.accesorios })),
          )
        : null;
    const estados = armas.map(estadoDe);
    const avance = avanceD11(
      {
        programada: Boolean(e?.programacion_fecha),
        llegada: Boolean(e?.llegada_fecha),
        actaFirmada: Boolean(e?.acta_firmada_at),
        recibidas: e?.acta_cantidad ?? null,
        armas: estados,
      },
      cfg,
    );
    const nombre = (id: string | null) => personal.find((p) => p.id === id)?.nombre ?? null;
    return {
      ot: {
        id: ot.id,
        codigo: ot.codigo,
        estado: ot.estado,
        cliente: ot.cliente,
        clienteRut: ot.cliente_rut,
        resolucion: ot.numero_ley,
        origen: ot.origen_trabajo,
        abierta: !OT_CERRADA.includes(ot.estado),
      },
      internacion: internacion
        ? { id: internacion.id, numero: internacion.numero, resolucion: internacion.resolucion_numero, resolucionFecha: internacion.resolucion_fecha }
        : null,
      listado,
      segunResolucion: listado.length ? totalSegunResolucion(listado.map((l) => ({ ...l, cantidad: Number(l.cantidad) }))) : null,
      expediente: e
        ? {
            programacion: e.programacion_fecha
              ? { fecha: e.programacion_fecha, lugar: e.programacion_lugar, responsableId: e.programacion_responsable, responsable: nombre(e.programacion_responsable), registradaAt: e.programada_at }
              : null,
            llegada: e.llegada_fecha
              ? { fecha: e.llegada_fecha, transportista: e.llegada_transportista, bultos: e.llegada_bultos, avisoPrevio: e.llegada_aviso_previo, observaciones: e.llegada_observaciones, registradaAt: e.llegada_registrada_at }
              : null,
            acta: e.acta_firmada_at
              ? {
                  bultos: e.acta_bultos,
                  cantidad: e.acta_cantidad,
                  segunResolucion: e.acta_segun_resolucion,
                  resultado: e.acta_resultado,
                  ubicacion: e.acta_ubicacion,
                  responsableId: e.acta_responsable,
                  responsable: nombre(e.acta_responsable),
                  observaciones: e.acta_observaciones,
                  firmadaAt: e.acta_firmada_at,
                  firmadaPor: nombre(e.acta_firmada_por) ?? null,
                }
              : null,
          }
        : { programacion: null, llegada: null, acta: null },
      armas: armas.map((a, i) => {
        const est = estados[i];
        const etapa = etapaArma(est, cfg);
        return {
          id: a.id,
          orden: a.orden,
          muestraId: a.muestra_id,
          muestra: a.muestra,
          codigoBarras: a.codigo_barras ?? a.muestra,
          tipo: a.tipo,
          tipoNombre: NOMBRE_TIPO_ARMA[a.tipo] ?? a.tipo,
          marca: a.marca,
          modelo: a.modelo,
          calibre: a.calibre,
          pais: a.pais_origen,
          serie: a.serie,
          sinSerie: a.sin_serie,
          accesorios: a.accesorios,
          lote: a.lote,
          ubicacion: a.ubicacion,
          clase: a.clase,
          claseNombre: a.clase ? NOMBRE_CLASE[a.clase] : null,
          permisibilidad: a.permisibilidad,
          camino: a.camino,
          caminoNombre: a.camino ? NOMBRE_CAMINO[a.camino] : null,
          ensayos: est.ensayos,
          pendientes: est.pendientes,
          aprobados: est.aprobados,
          veredicto: a.veredicto,
          acunacion: a.acunada_at ? { numero: a.acunacion_numero, anio: a.acunacion_anio, fecha: a.acunada_at } : null,
          requiereAcunacion: requiereAcunacion(est, cfg),
          certificado: a.certificado,
          entregada: Boolean(a.entrega_id),
          etapa,
          etapaNombre: NOMBRE_ETAPA_ARMA[etapa],
          puedeAcunar: erroresAcunacion(est, cfg).length === 0,
          puedeCertificar: erroresCertificado(est, cfg).length === 0,
          motivoNoCertifica: erroresCertificado(est, cfg)[0] ?? null,
        };
      }),
      verificacion,
      avance,
      emisiones,
      entregas,
      personal,
      config: { acunacionCip: cfg.acunacionCip, vigenciaAnios: cfg.vigenciaAnios },
      puedo: {
        programar: tiene(req, "arma.programar"),
        registrar: tiene(req, "arma.registrar"),
        catalogo: tiene(req, "arma.catalogo"),
        emitir: tiene(req, "certificado.emitir"),
        aprobar: tiene(req, "resultado.aprobar"),
        entregarCertificados: tiene(req, "certificado.entregar"),
      },
    };
  }

  /* ------------------------------------------------- 11.4 · 11.5 · 11.6 --- */

  async programar(req: any, otId: string, body: unknown) {
    const ot = await this.otD11(req, otId);
    this.otAbierta(ot);
    const d = ProgramacionBody.parse(body ?? {});
    if (d.fecha < hoyChile()) throw new BadRequestException("La fecha de recepción acordada no puede ser anterior a hoy.");
    await this.usuarioDeD11(tenantDe(req), d.responsableId, "responsable de la recepción");
    const e = await this.expedienteFila(otId);
    if (e?.acta_firmada_at) throw new ConflictException("El acta de recepción ya está firmada: la programación no se cambia.");
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO d11_expediente (ot_id, tenant_id, programacion_fecha, programacion_lugar, programacion_responsable, programada_por, programada_at)
       VALUES ($1::uuid, $2::uuid, $3::date, $4, $5::uuid, $6::uuid, now())
       ON CONFLICT (ot_id) DO UPDATE SET programacion_fecha = EXCLUDED.programacion_fecha, programacion_lugar = EXCLUDED.programacion_lugar,
         programacion_responsable = EXCLUDED.programacion_responsable, programada_por = EXCLUDED.programada_por,
         programada_at = now(), updated_at = now()`,
      otId,
      tenantDe(req),
      d.fecha,
      d.lugar,
      d.responsableId,
      usuarioDe(req),
    );
    await this.historial(otId, tenantDe(req), "d11_programacion", { fecha: d.fecha, lugar: d.lugar }, usuarioDe(req));
    return this.expediente(req, otId);
  }

  async llegada(req: any, otId: string, body: unknown) {
    const ot = await this.otD11(req, otId);
    this.otAbierta(ot);
    const d = LlegadaBody.parse(body ?? {});
    const e = await this.expedienteFila(otId);
    if (!e?.programacion_fecha) throw new ConflictException("Primero programe la recepción con el importador (paso 1).");
    if (e.acta_firmada_at) throw new ConflictException("El acta de recepción ya está firmada: la llegada no se cambia.");
    await this.prisma.$executeRawUnsafe(
      `UPDATE d11_expediente SET llegada_fecha = $2::date, llegada_transportista = $3, llegada_bultos = $4, llegada_aviso_previo = $5,
              llegada_observaciones = $6, llegada_registrada_por = $7::uuid, llegada_registrada_at = now(), updated_at = now()
        WHERE ot_id = $1::uuid`,
      otId,
      d.fecha,
      d.transportista,
      d.bultos,
      d.avisoPrevio,
      d.observaciones?.trim() || null,
      usuarioDe(req),
    );
    await this.historial(otId, tenantDe(req), "d11_llegada", { fecha: d.fecha, bultos: d.bultos }, usuarioDe(req));
    return this.expediente(req, otId);
  }

  async acta(req: any, otId: string, body: unknown) {
    const ot = await this.otD11(req, otId);
    this.otAbierta(ot);
    const d = ActaBody.parse(body ?? {});
    const e = await this.expedienteFila(otId);
    if (!e?.llegada_fecha) throw new ConflictException("Primero confirme la llegada de las armas (paso 2).");
    if (e.acta_firmada_at) throw new ConflictException("El acta de recepción ya está firmada.");
    await this.usuarioDeD11(tenantDe(req), d.responsableId, "responsable de la bodega");
    const internacion = await this.internacionDe(otId);
    const listado = await this.listadoDe(internacion?.id ?? null);
    const segun = listado.length ? totalSegunResolucion(listado.map((l) => ({ ...l, cantidad: Number(l.cantidad) }))) : null;
    const resultado = segun === null ? null : resultadoActa(segun, d.cantidad);
    await this.prisma.$executeRawUnsafe(
      `UPDATE d11_expediente SET acta_bultos = $2, acta_cantidad = $3, acta_ubicacion = $4, acta_responsable = $5::uuid,
              acta_observaciones = $6, acta_resultado = $7, acta_segun_resolucion = $8, acta_firmada_por = $9::uuid,
              acta_firmada_at = now(), updated_at = now()
        WHERE ot_id = $1::uuid`,
      otId,
      d.bultos,
      d.cantidad,
      d.ubicacion,
      d.responsableId,
      d.observaciones?.trim() || null,
      resultado,
      segun,
      usuarioDe(req),
    );
    await this.historial(otId, tenantDe(req), "d11_acta", { cantidad: d.cantidad, segunResolucion: segun, resultado }, usuarioDe(req));
    return this.expediente(req, otId);
  }

  /* ------------------------------------------------------ 11.8 · 11.7 ---- */

  /** Carga masiva: lee la planilla del importador y propone el catálogo de cada fila. */
  async leerPlanilla(req: any, archivo: ArchivoSubido | undefined) {
    const tenantId = tenantDe(req);
    if (!archivo?.buffer?.length) throw new BadRequestException("Adjunte la planilla (.xlsx o .csv) en el campo «archivo».");
    let filas: string[][];
    try {
      filas = leerTabla(archivo.originalname ?? "planilla", archivo.buffer);
    } catch (e) {
      if (e instanceof TablaError) throw new BadRequestException(e.message);
      throw new BadRequestException("No se pudo leer el archivo: guárdelo como .xlsx o .csv.");
    }
    const r = mapearPlanilla(filas);
    const [marcas, calibres] = await Promise.all([
      this.prisma.$queryRawUnsafe<{ id: string; nombre: string; pais: string | null }[]>(
        `SELECT id, nombre, pais FROM d11_marca WHERE tenant_id = $1::uuid AND activo`,
        tenantId,
      ),
      this.prisma.$queryRawUnsafe<{ id: string; nombre: string }[]>(`SELECT id, nombre FROM d11_calibre WHERE tenant_id = $1::uuid AND activo`, tenantId),
    ]);
    const k = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
    const modelos = await this.prisma.$queryRawUnsafe<{ id: string; marca_id: string; nombre: string }[]>(
      `SELECT id, marca_id, nombre FROM d11_modelo WHERE tenant_id = $1::uuid AND activo`,
      tenantId,
    );
    return {
      columnas: r.columnas,
      errores: r.errores,
      filas: r.filas.map((f) => {
        const enMarca = marcas.filter((m) => k(m.nombre) === k(f.marca));
        const marca = enMarca.find((m) => !f.pais || k(m.pais) === k(f.pais)) ?? enMarca[0] ?? null;
        const modelo = marca ? modelos.find((m) => m.marca_id === marca.id && k(m.nombre) === k(f.modelo)) ?? null : null;
        const calibre = calibres.find((c) => k(c.nombre) === k(f.calibre)) ?? null;
        return {
          ...f,
          marcaId: marca?.id ?? null,
          modeloId: modelo?.id ?? null,
          calibreId: calibre?.id ?? null,
          pais: f.pais || marca?.pais || "",
        };
      }),
    };
  }

  async registrarArmas(req: any, otId: string, body: unknown) {
    const ot = await this.otD11(req, otId);
    this.otAbierta(ot);
    const tenantId = tenantDe(req);
    const d = RegistroArmasBody.parse(body ?? {});
    const e = await this.expedienteFila(otId);
    if (!e?.acta_firmada_at) throw new ConflictException("Primero firme el acta de recepción (paso 3): las armas se registran contra lo recibido y contado.");
    const cfg = await this.config(tenantId);

    // Catálogo: marcas, modelos y calibres del tenant y activos.
    const ids = (k: "marcaId" | "modeloId" | "calibreId") => [...new Set(d.armas.map((a) => a[k]))];
    const [marcas, modelos, calibres] = await Promise.all([
      this.prisma.$queryRawUnsafe<{ id: string; nombre: string; pais: string | null }[]>(
        `SELECT id, nombre, pais FROM d11_marca WHERE tenant_id = $1::uuid AND activo AND id = ANY($2::uuid[])`,
        tenantId,
        ids("marcaId"),
      ),
      this.prisma.$queryRawUnsafe<{ id: string; nombre: string; marca_id: string }[]>(
        `SELECT id, nombre, marca_id FROM d11_modelo WHERE tenant_id = $1::uuid AND activo AND id = ANY($2::uuid[])`,
        tenantId,
        ids("modeloId"),
      ),
      this.prisma.$queryRawUnsafe<{ id: string; nombre: string }[]>(
        `SELECT id, nombre FROM d11_calibre WHERE tenant_id = $1::uuid AND activo AND id = ANY($2::uuid[])`,
        tenantId,
        ids("calibreId"),
      ),
    ]);
    const internacion = await this.internacionDe(otId);
    const listado = await this.listadoDe(internacion?.id ?? null);
    const yaRegistradas = await this.armas(otId);
    const errores: string[] = [];
    const seriesNuevas = new Map<string, number>();
    const preparadas = d.armas.map((a, i) => {
      const n = `Arma ${i + 1}`;
      const marca = marcas.find((m) => m.id === a.marcaId);
      const modelo = modelos.find((m) => m.id === a.modeloId);
      const calibre = calibres.find((c) => c.id === a.calibreId);
      if (!marca) errores.push(`${n}: la marca no existe o está desactivada.`);
      if (!modelo) errores.push(`${n}: el modelo no existe o está desactivado.`);
      else if (marca && modelo.marca_id !== marca.id) errores.push(`${n}: el modelo ${modelo.nombre} no es de la marca ${marca.nombre}.`);
      if (!calibre) errores.push(`${n}: el calibre no existe o está desactivado.`);
      const serieNorm = normalizarSerie(a.serie);
      if (!serieNorm && !a.sinSerie) errores.push(`${n}: indique el nº de serie o marque «sin número de serie» (numeración IT09).`);
      if (serieNorm && a.sinSerie) errores.push(`${n}: tiene nº de serie y está marcada «sin número de serie».`);
      if (serieNorm) {
        if (seriesNuevas.has(serieNorm)) errores.push(`${n}: el nº de serie se repite (arma ${seriesNuevas.get(serieNorm)}).`);
        seriesNuevas.set(serieNorm, i + 1);
        if (yaRegistradas.some((x) => x.serie_normalizada === serieNorm)) errores.push(`${n}: la serie ${a.serie} ya está registrada en esta OT.`);
      }
      if (a.resolucionArmaId && !listado.some((l) => l.id === a.resolucionArmaId)) errores.push(`${n}: la fila de la resolución indicada no es de esta OT.`);
      return { a, marca, modelo, calibre, serieNorm };
    });
    const recibidas = Number(e.acta_cantidad ?? 0);
    if (yaRegistradas.length + d.armas.length > recibidas)
      errores.push(
        `El acta registra ${recibidas} arma(s) recibidas y contadas; ya hay ${yaRegistradas.length} registradas y se intenta registrar ${d.armas.length} más.`,
      );
    if (errores.length) throw new BadRequestException(errores.join(" "));

    // Métodos del registro (IT05 · clasificación), del catálogo del tenant.
    const metodos = await this.metodosPorCodigo(tenantId, cfg.metodosRegistro);
    if (!metodos.length)
      throw new ConflictException(`No hay métodos activos para el registro del arma (${cfg.metodosRegistro.join(", ")}): revise el parámetro d11.metodos_registro.`);

    const usuario = usuarioDe(req);
    const creadas = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRawUnsafe(`SELECT ot_id FROM d11_expediente WHERE ot_id = $1::uuid FOR UPDATE`, otId);
        const [{ n: orden0 }] = await tx.$queryRawUnsafe<{ n: number }[]>(
          `SELECT COALESCE(max(orden), 0)::int AS n FROM d11_arma_ot WHERE ot_id = $1::uuid`,
          otId,
        );
        const out: { id: string; muestra: string }[] = [];
        for (let i = 0; i < preparadas.length; i += 50) {
          const tramo = preparadas.slice(i, i + 50);
          const r = await this.registro.registrar(
            otId,
            {
              muestras: tramo.map((p) => ({
                nombre: `${NOMBRE_TIPO_ARMA[p.a.tipo]} ${p.marca!.nombre} ${p.modelo!.nombre}${p.a.serie ? ` · serie ${p.a.serie.trim()}` : " · sin serie"}`.slice(0, 200),
                metodoIds: metodos.map((m) => m.id),
              })),
            },
            tenantId,
            req,
            tx as any,
          );
          for (let j = 0; j < tramo.length; j++) {
            const p = tramo[j];
            const m = r.muestras[j];
            const orden = orden0 + i + j + 1;
            await tx.$executeRawUnsafe(
              `UPDATE muestra SET codigo_barras = codigo, numero_lote = $2, ubicacion = $3, fabricante = $4 WHERE id = $1::uuid`,
              m.id,
              p.a.lote?.trim() || null,
              e.acta_ubicacion,
              p.marca!.nombre.slice(0, 120),
            );
            const armaId = await this.fichaArma(tx, tenantId, p, otId, usuario);
            const [fila] = await tx.$queryRawUnsafe<{ id: string }[]>(
              `INSERT INTO d11_arma_ot (tenant_id, ot_id, arma_id, muestra_id, resolucion_arma_id, orden, tipo, serie_normalizada, sin_serie,
                                        accesorios, lote, ubicacion, created_by)
               VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, $7, $8, $9, $10, $11, $12, $13::uuid) RETURNING id`,
              tenantId,
              otId,
              armaId,
              m.id,
              p.a.resolucionArmaId ?? null,
              orden,
              p.a.tipo,
              p.serieNorm,
              Boolean(p.a.sinSerie),
              p.a.accesorios?.trim() || null,
              p.a.lote?.trim() || null,
              e.acta_ubicacion,
              usuario,
            );
            // 11.7 · primer movimiento de la cadena de custodia.
            await tx.$executeRawUnsafe(
              `INSERT INTO d11_arma_movimiento (tenant_id, arma_ot_id, evento, ubicacion, motivo, responsable)
               VALUES ($1::uuid, $2::uuid, 'entrada', $3, $4, $5::uuid)`,
              tenantId,
              fila.id,
              e.acta_ubicacion,
              `Ingreso a bodega con el acta de recepción de la OT ${ot.codigo}`,
              usuario,
            );
            out.push({ id: fila.id, muestra: m.codigo });
          }
        }
        return out;
      },
      { maxWait: 15_000, timeout: 180_000 },
    );
    await this.historial(otId, tenantId, "d11_registro_armas", { armas: creadas.map((c) => c.muestra) }, usuario);
    return { ...(await this.expediente(req, otId)), registradas: creadas };
  }

  /** Ficha registral del arma (tabla SAEC): se reutiliza si ya existe la misma serie y marca. */
  private async fichaArma(
    tx: Db,
    tenantId: string,
    p: { a: z.infer<typeof ArmaBody>; marca?: { id: string; nombre: string }; modelo?: { id: string; nombre: string }; calibre?: { id: string; nombre: string }; serieNorm: string | null },
    otId: string,
    usuario: string | null,
  ): Promise<string> {
    if (p.serieNorm) {
      const [existe] = await tx.$queryRawUnsafe<{ id: string; ot_abierta: string | null }[]>(
        `SELECT ar.id,
                (SELECT o.codigo FROM d11_arma_ot x JOIN orden_trabajo o ON o.id = x.ot_id
                  WHERE x.arma_id = ar.id AND o.estado NOT IN ('cerrada', 'anulada') AND o.id <> $4::uuid LIMIT 1) AS ot_abierta
           FROM arma ar
          WHERE ar.tenant_id = $1::uuid AND ar.deleted_at IS NULL AND ar.serie_borrada = FALSE
            AND (ar.serie_normalizada = $2 OR upper(regexp_replace(COALESCE(ar.serie, ''), '[^A-Za-z0-9]', '', 'g')) = $2)
            AND (ar.marca_id = $3::uuid OR upper(COALESCE(ar.marca, '')) = upper($5))
          LIMIT 1`,
        tenantId,
        p.serieNorm,
        p.marca!.id,
        otId,
        p.marca!.nombre,
      );
      if (existe?.ot_abierta)
        throw new ConflictException(`El arma ${p.marca!.nombre} serie ${p.a.serie} está en otra OT abierta (${existe.ot_abierta}).`);
      if (existe) {
        await tx.$executeRawUnsafe(
          `UPDATE arma SET marca_id = $2::uuid, modelo_id = $3::uuid, calibre_id = $4::uuid, modelo = $5, calibre = $6, pais_origen = $7,
                  serie_normalizada = $8, ot_id = $9::uuid, tipo = $10
            WHERE id = $1::uuid`,
          existe.id,
          p.marca!.id,
          p.modelo!.id,
          p.calibre!.id,
          p.modelo!.nombre,
          p.calibre!.nombre,
          p.a.paisOrigen,
          p.serieNorm,
          otId,
          p.a.tipo === "carabina" ? "fusil" : p.a.tipo,
        );
        return existe.id;
      }
    }
    const [nueva] = await tx.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO arma (tenant_id, ot_id, serie, serie_borrada, marca, modelo, calibre, tipo, estado_registral, estado,
                         pais_origen, marca_id, modelo_id, calibre_id, serie_normalizada, observaciones, created_by)
       VALUES ($1::uuid, $2::uuid, $3, FALSE, $4, $5, $6, $7, 'en_tramite', 'en_custodia', $8, $9::uuid, $10::uuid, $11::uuid, $12, $13, $14::uuid)
       RETURNING id`,
      tenantId,
      otId,
      p.a.serie?.trim() || null,
      p.marca!.nombre,
      p.modelo!.nombre,
      p.calibre!.nombre,
      p.a.tipo === "carabina" ? "fusil" : p.a.tipo,
      p.a.paisOrigen,
      p.marca!.id,
      p.modelo!.id,
      p.calibre!.id,
      p.serieNorm,
      p.a.sinSerie ? "Sin número de serie: numeración IT09 por confirmar (EP-11 11.14)." : null,
      usuario,
    );
    return nueva.id;
  }

  private metodosPorCodigo(tenantId: string, codigos: string[], db: Db = this.prisma) {
    return db.$queryRawUnsafe<{ id: string; codigo: string; nombre: string }[]>(
      `SELECT m.id, m.codigo, m.nombre FROM cat_metodo m
        WHERE m.tenant_id = $1::uuid AND m.codigo = ANY($2::text[]) AND m.deleted_at IS NULL AND m.activo
          AND EXISTS (SELECT 1 FROM cat_analito a WHERE a.metodo_id = m.id AND a.deleted_at IS NULL AND a.activo)
        ORDER BY array_position($2::text[], m.codigo::text)`,
      tenantId,
      codigos,
    );
  }

  /** 11.7 · cambio de ubicación en bodega (movimiento inmutable). */
  async movimiento(req: any, armaOtId: string, body: unknown) {
    const a = await this.armaOt(req, armaOtId);
    const d = MovimientoBody.parse(body ?? {});
    if (a.entrega_id) throw new ConflictException("El arma ya se entregó al importador.");
    await this.prisma.$transaction([
      this.prisma.$executeRawUnsafe(
        `INSERT INTO d11_arma_movimiento (tenant_id, arma_ot_id, evento, ubicacion, motivo, responsable)
         VALUES ($1::uuid, $2::uuid, 'cambio_ubicacion', $3, $4, $5::uuid)`,
        tenantDe(req),
        armaOtId,
        d.ubicacion,
        d.motivo,
        usuarioDe(req),
      ),
      this.prisma.$executeRawUnsafe(`UPDATE d11_arma_ot SET ubicacion = $2, updated_at = now() WHERE id = $1::uuid`, armaOtId, d.ubicacion),
      this.prisma.$executeRawUnsafe(`UPDATE muestra SET ubicacion = $2 WHERE id = $1::uuid`, a.muestra_id, d.ubicacion),
    ]);
    return this.fichaArmaOt(req, armaOtId);
  }

  private async armaOt(req: any, armaOtId: string) {
    const [a] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT a.*, o.codigo AS ot_codigo FROM d11_arma_ot a JOIN orden_trabajo o ON o.id = a.ot_id
        WHERE a.id = $1::uuid AND a.tenant_id = $2::uuid`,
      armaOtId,
      tenantDe(req),
    );
    if (!a) throw new NotFoundException("Arma no encontrada.");
    await this.otD11(req, a.ot_id);
    return a;
  }

  /** Ficha del arma en la OT: ensayos con su forma de captura y la custodia. */
  async fichaArmaOt(req: any, armaOtId: string) {
    const a0 = await this.armaOt(req, armaOtId);
    const cfg = await this.config(tenantDe(req));
    const [a] = await this.armas(a0.ot_id, this.prisma, [armaOtId]);
    const [ensayos, movimientos] = await Promise.all([this.ensayosDe(a.muestra_id), this.movimientos(armaOtId)]);
    const est = estadoDe(a);
    return {
      id: a.id,
      otId: a0.ot_id,
      otCodigo: a0.ot_codigo,
      muestra: a.muestra,
      muestraId: a.muestra_id,
      descripcion: `${NOMBRE_TIPO_ARMA[a.tipo]} ${a.marca ?? ""} ${a.modelo ?? ""}`.trim(),
      serie: a.serie,
      calibre: a.calibre,
      clase: a.clase,
      permisibilidad: a.permisibilidad,
      camino: a.camino,
      caminoNombre: a.camino ? NOMBRE_CAMINO[a.camino] : null,
      veredicto: a.veredicto,
      etapa: etapaArma(est, cfg),
      etapaNombre: NOMBRE_ETAPA_ARMA[etapaArma(est, cfg)],
      ensayos: ensayos.map((e) => {
        const g = grupoEnsayo(e);
        const sufijo = g.split(":")[1];
        return {
          ...e,
          entrada: tipoEntrada(e),
          grupo: g,
          grupoNombre: sufijo ? NOMBRE_GRUPO[sufijo] : e.metodoNombre,
        };
      }),
      movimientos,
    };
  }

  private ensayosDe(muestraId: string, db: Db = this.prisma) {
    return db.$queryRawUnsafe<(EnsayoArma & { metodoNombre: string | null; valor: string | null; veredicto: string | null; unidad: string | null; norma: string | null })[]>(
      `SELECT r.id AS "resultadoId", r.estado, COALESCE(an.nombre, an.codigo, 'Ensayo') AS analito, m.codigo AS "metodoCodigo",
              m.nombre AS "metodoNombre", m.norma, r.tipo_dato AS "tipoDato", r.limite_inf AS "limiteInf", r.limite_sup AS "limiteSup",
              COALESCE(r.valor_texto, r.valor_numerico::text) AS valor, r.veredicto, r.unidad
         FROM resultado r
         LEFT JOIN cat_analito an ON an.id = r.cat_analito_id
         LEFT JOIN cat_metodo m   ON m.id = r.cat_metodo_id
        WHERE r.muestra_id = $1::uuid AND r.deleted_at IS NULL
        ORDER BY m.norma NULLS LAST, m.codigo, an.codigo`,
      muestraId,
    );
  }

  private movimientos(armaOtId: string) {
    return this.prisma.$queryRawUnsafe<any[]>(
      `SELECT mv.id, mv.evento, mv.fecha, mv.ubicacion, mv.motivo, mv.receptor, u.nombre_completo AS responsable, en.numero AS entrega
         FROM d11_arma_movimiento mv
         LEFT JOIN usuario u ON u.id = mv.responsable
         LEFT JOIN d11_entrega en ON en.id = mv.entrega_id
        WHERE mv.arma_ot_id = $1::uuid ORDER BY mv.fecha, mv.created_at`,
      armaOtId,
    );
  }

  /* ------------------------------------------------ 11.11 · 11.12 -------- */

  async clasificar(req: any, otId: string, body: unknown) {
    const ot = await this.otD11(req, otId);
    this.otAbierta(ot);
    const tenantId = tenantDe(req);
    const d = ClasificacionBody.parse(body ?? {});
    const cfg = await this.config(tenantId);
    const armas = await this.armas(otId, this.prisma, d.items.map((x) => x.armaOtId));
    const errores: string[] = [];
    const planes = d.items.map((it) => {
      const a = armas.find((x) => x.id === it.armaOtId);
      if (!a) {
        errores.push("Una de las armas no es de esta OT.");
        return null;
      }
      const c = caminoDe(it, cfg);
      errores.push(...c.errores.map((e) => `${a.muestra}: ${e}`));
      if (a.clase && !d.motivo?.trim()) errores.push(`${a.muestra} ya está clasificada: para reclasificar indique el motivo.`);
      return { it, a, c };
    });
    if (errores.length) throw new BadRequestException(errores.join(" "));
    const metodosUsados = [...new Set(planes.flatMap((p) => p!.c.metodos))];
    const catalogo = await this.metodosPorCodigo(tenantId, metodosUsados);
    const faltan = metodosUsados.filter((c) => !catalogo.some((m) => m.codigo === c));
    if (faltan.length) throw new ConflictException(`Métodos del camino sin analitos activos en el catálogo: ${faltan.join(", ")} (parámetros d11).`);
    const registroIds = (await this.metodosPorCodigo(tenantId, cfg.metodosRegistro)).map((m) => m.id);

    for (const p of planes) {
      const { it, a, c } = p!;
      const ensayos = await this.ensayosDe(a.muestra_id);
      // Reclasificar: solo si los ensayos del camino anterior siguen sin capturar.
      const delCamino = ensayos.filter((e) => !cfg.metodosRegistro.includes(e.metodoCodigo ?? ""));
      if (a.clase && delCamino.some((e) => e.estado !== "pendiente"))
        throw new ConflictException(`${a.muestra}: ya tiene ensayos del camino capturados; no se reclasifica (devuelva los resultados primero).`);
      // IT05 · permisibilidad capturada explícitamente por el armero (0 = permitida, 1 = prohibida).
      const it05 = ensayos.filter((e) => cfg.metodosRegistro.includes(e.metodoCodigo ?? "") && tipoEntrada(e) === "defecto");
      for (const e of it05) {
        if (["revisado_n1", "aprobado"].includes(e.estado))
          throw new ConflictException(`${a.muestra}: la clasificación ya está ${e.estado === "aprobado" ? "aprobada" : "revisada"}.`);
        const valor = it.permisibilidad === "prohibida" ? 1 : 0;
        if (e.estado !== "pendiente" && Number(e.valor) === valor) continue;
        await this.puente.capturarValor(
          e.resultadoId,
          { valor, ...(e.estado !== "pendiente" ? { motivo: d.motivo?.trim() || "Reclasificación del arma (IT05)" } : {}) } as any,
          tenantId,
          req,
        );
      }
      await this.prisma.$transaction(async (tx) => {
        if (a.clase && delCamino.length)
          await tx.$executeRawUnsafe(
            `UPDATE resultado SET deleted_at = now() WHERE muestra_id = $1::uuid AND deleted_at IS NULL AND estado = 'pendiente'
               AND NOT (cat_metodo_id = ANY($2::uuid[]))`,
            a.muestra_id,
            registroIds,
          );
        if (c.metodos.length) {
          await this.puente.generarAnalisis(
            otId,
            { muestraId: a.muestra_id, metodoIds: catalogo.filter((m) => c.metodos.includes(m.codigo)).map((m) => m.id) },
            tenantId,
            req,
            tx as any,
          );
        }
        await tx.$executeRawUnsafe(
          `UPDATE d11_arma_ot SET clase = $2, permisibilidad = $3, camino = $4, clasificada_por = $5::uuid, clasificada_at = now(), updated_at = now()
            WHERE id = $1::uuid`,
          a.id,
          it.clase,
          it.permisibilidad,
          c.camino,
          usuarioDe(req),
        );
      });
    }
    await this.historial(
      otId,
      tenantId,
      "d11_clasificacion",
      { armas: planes.map((p) => ({ muestra: p!.a.muestra, clase: p!.it.clase, permisibilidad: p!.it.permisibilidad, camino: p!.c.camino })) },
      usuarioDe(req),
    );
    return this.expediente(req, otId);
  }

  /* ------------------------------------------- 11.15 · 11.20 (BL-038) ---- */

  async registrarEnsayos(req: any, armaOtId: string, body: unknown) {
    const a = await this.armaOt(req, armaOtId);
    const ot = await this.otD11(req, a.ot_id);
    this.otAbierta(ot);
    if (!a.clase) throw new ConflictException("Primero clasifique el arma y elija su camino (paso 5).");
    const d = EnsayosBody.parse(body ?? {});
    const ensayos = await this.ensayosDe(a.muestra_id);
    const errores = erroresCapturaExplicita(ensayos, d.valores);
    if (errores.length) throw new BadRequestException(errores.join(" "));
    const tenantId = tenantDe(req);
    let capturados = 0;
    for (const v of d.valores) {
      const e = ensayos.find((x) => x.resultadoId === v.resultadoId)!;
      const t = tipoEntrada(e);
      const entrada: Record<string, unknown> =
        t === "atributo"
          ? { atributo: v.atributo }
          : t === "texto"
            ? { valor: String(v.valor).trim() }
            : { valor: Number(String(v.valor).trim().replace(",", ".")) };
      if (v.observacion?.trim()) entrada.observacion = v.observacion.trim();
      if (e.estado !== "pendiente") entrada.motivo = d.motivo?.trim() || undefined;
      await this.puente.capturarValor(e.resultadoId, entrada as any, tenantId, req);
      capturados++;
    }
    return { capturados, ficha: await this.fichaArmaOt(req, armaOtId) };
  }

  /* --------------------------------------------------------- 11.22 IT08 --- */

  async acunar(req: any, otId: string, body: unknown) {
    const ot = await this.otD11(req, otId);
    this.otAbierta(ot);
    const d = AcunacionBody.parse(body ?? {});
    const cfg = await this.config(tenantDe(req));
    const armas = await this.armas(otId, this.prisma, d.items.map((x) => x.armaOtId));
    const errores: string[] = [];
    const cunos = new Set<string>();
    for (const it of d.items) {
      const a = armas.find((x) => x.id === it.armaOtId);
      if (!a) {
        errores.push("Una de las armas no es de esta OT.");
        continue;
      }
      errores.push(...erroresAcunacion(estadoDe(a), cfg).map((e) => `${a.muestra}: ${e}.`));
      const k = `${it.numero.trim().toUpperCase()}/${it.anio}`;
      if (cunos.has(k)) errores.push(`El cuño Nº ${k} se repite.`);
      cunos.add(k);
    }
    if (errores.length) throw new BadRequestException(errores.join(" "));
    await this.prisma.$transaction(
      d.items.map((it) =>
        this.prisma.$executeRawUnsafe(
          `UPDATE d11_arma_ot SET acunacion_numero = $2, acunacion_anio = $3, acunada_por = $4::uuid, acunada_at = now(), updated_at = now()
            WHERE id = $1::uuid AND acunada_at IS NULL`,
          it.armaOtId,
          it.numero.trim(),
          it.anio,
          usuarioDe(req),
        ),
      ),
    );
    await this.historial(otId, tenantDe(req), "d11_acunacion", { armas: d.items.length }, usuarioDe(req));
    return this.expediente(req, otId);
  }

  /* -------------------------------------------- 11.23 certificado por arma */

  private async plantillaCertificado(tenantId: string) {
    const [p] = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM plantilla_informe WHERE tenant_id = $1::uuid AND repid = 'CERTARMA' AND activo AND deleted_at IS NULL
        ORDER BY created_at LIMIT 1`,
      tenantId,
    );
    if (!p) throw new ConflictException("No hay plantilla activa del certificado por arma (CERTARMA): revise Configuración › Plantillas.");
    return p.id;
  }

  /** Condiciones de emisión de cada arma (vista previa del bloque «Emitir certificados»). */
  async condicionesCertificados(req: any, otId: string, body: unknown) {
    await this.otD11(req, otId);
    const d = CertificadosBody.parse(body ?? {});
    const cfg = await this.config(tenantDe(req));
    const armas = await this.armas(otId, this.prisma, d.armaOtIds);
    return armas.map((a) => ({ id: a.id, muestra: a.muestra, faltantes: erroresCertificado(estadoDe(a), cfg) }));
  }

  async emitirCertificados(req: any, otId: string, body: unknown) {
    const ot = await this.otD11(req, otId);
    this.otAbierta(ot);
    const tenantId = tenantDe(req);
    const d = CertificadosBody.parse(body ?? {});
    const cfg = await this.config(tenantId);
    const armas = await this.armas(otId, this.prisma, d.armaOtIds);
    if (armas.length !== new Set(d.armaOtIds).size) throw new BadRequestException("Una de las armas no es de esta OT.");
    const errores = armas.flatMap((a) => erroresCertificado(estadoDe(a), cfg).map((e) => `${a.muestra}: ${e}.`));
    if (errores.length) throw new BadRequestException(errores.join(" "));
    const plantillaId = await this.plantillaCertificado(tenantId);
    const emitidos: { armaOtId: string; certificadoId: string; numero: string; desde: string; hasta: string }[] = [];
    const fallos: string[] = [];
    for (const a of armas) {
      try {
        const r = await this.render.emitir(otId, plantillaId, tenantId, usuarioDe(req) ?? undefined, {
          tipoDocumento: "CERTIFICADO_ARMA",
          cobertura: { cobertura: "muestra", muestraIds: [a.muestra_id] },
        });
        const desde = hoyChile(new Date(r.certificado.fecha));
        emitidos.push({ armaOtId: a.id, certificadoId: r.certificado.id, numero: r.numero ?? r.certificado.codigo, desde, hasta: vigenciaHasta(desde, cfg.vigenciaAnios) });
      } catch (e: any) {
        fallos.push(`${a.muestra}: ${e?.message ?? "no se pudo emitir"}`);
      }
    }
    let emision: any = null;
    const rango = rangoEmision(emitidos.map((x) => x.numero));
    if (rango) {
      emision = await this.prisma.$transaction(async (tx) => {
        const [em] = await tx.$queryRawUnsafe<any[]>(
          `INSERT INTO d11_emision (tenant_id, ot_id, desde, hasta, cantidad, created_by) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid) RETURNING id`,
          tenantId,
          otId,
          rango.desde,
          rango.hasta,
          rango.cantidad,
          usuarioDe(req),
        );
        for (const x of emitidos)
          await tx.$executeRawUnsafe(
            `INSERT INTO d11_certificado_arma (tenant_id, arma_ot_id, certificado_id, emision_id, vigente_desde, vigente_hasta)
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::date, $6::date) ON CONFLICT (certificado_id) DO NOTHING`,
            tenantId,
            x.armaOtId,
            x.certificadoId,
            em.id,
            x.desde,
            x.hasta,
          );
        return { id: em.id, ...rango };
      });
      await this.historial(otId, tenantId, "d11_certificados", { desde: rango.desde, hasta: rango.hasta, cantidad: rango.cantidad }, usuarioDe(req));
    }
    if (!emitidos.length) throw new ConflictException(`No se emitió ningún certificado. ${fallos.join(" ")}`);
    return { emision, emitidos: emitidos.length, fallos, expediente: await this.expediente(req, otId) };
  }

  /** Firma de un rango: el responsable del paso actual firma todos sus certificados en firma. */
  async firmarEmision(req: any, emisionId: string) {
    const [em] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, ot_id FROM d11_emision WHERE id = $1::uuid AND tenant_id = $2::uuid`,
      emisionId,
      tenantDe(req),
    );
    if (!em) throw new NotFoundException("Emisión no encontrada.");
    await this.otD11(req, em.ot_id);
    const certs = await this.prisma.$queryRawUnsafe<{ id: string; numero: string }[]>(
      `SELECT c.id, COALESCE(c.numero, c.codigo) AS numero FROM d11_certificado_arma ca JOIN certificado c ON c.id = ca.certificado_id
        WHERE ca.emision_id = $1::uuid AND c.estado = 'en_firma' ORDER BY c.numero`,
      emisionId,
    );
    if (!certs.length) throw new ConflictException("No hay certificados en firma en este rango.");
    let firmados = 0;
    const fallos: string[] = [];
    for (const c of certs) {
      try {
        await this.firmas.firmar(c.id, req, "Firma del rango de certificados por arma");
        firmados++;
      } catch (e: any) {
        fallos.push(`${c.numero}: ${e?.message ?? "no se pudo firmar"}`);
      }
    }
    if (!firmados) throw new ForbiddenException(fallos[0] ?? "No le corresponde firmar estos certificados.");
    return { firmados, fallos, expediente: await this.expediente(req, em.ot_id) };
  }

  /** Contexto de la plantilla CERTARMA: datos del arma, vigencia y QR del código de verificación. */
  private async contextoCertificado(otId: string, tenantId: string | undefined, plantilla: { repid: string }, doc?: DocumentoEnRender) {
    if (plantilla.repid !== "CERTARMA") return null;
    if (!doc?.muestraIds || doc.muestraIds.length !== 1)
      throw new ConflictException("El certificado por arma cubre una sola arma: emítalo desde BPCH · SAEC › Certificación de armas.");
    const [a] = await this.prisma.$queryRawUnsafe<any[]>(
      `${SELECT_ARMAS} WHERE a.ot_id = $1::uuid AND a.muestra_id = $2::uuid`,
      otId,
      doc.muestraIds[0],
    );
    if (!a) throw new ConflictException("La muestra no es un arma registrada en la Delegación Nº 11.");
    const [extra] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT c.razon_social AS importador, o.numero_ley AS resolucion, o.tenant_id FROM orden_trabajo o
         LEFT JOIN cliente c ON c.id = o.cliente_id WHERE o.id = $1::uuid`,
      otId,
    );
    const cfg = await this.config(tenantId ?? extra?.tenant_id);
    const desde = hoyChile(doc.fecha);
    const hasta = vigenciaHasta(desde, cfg.vigenciaAnios);
    const qr = await QRCode.toDataURL(doc.urlVerificacion, { margin: 1, width: 132, errorCorrectionLevel: "M" });
    const veredicto = a.veredicto === "cumple" ? "Cumple" : a.veredicto === "no_cumple" ? "No cumple" : "Pendiente";
    return {
      datos: {
        tipo: NOMBRE_TIPO_ARMA[a.tipo as TipoArma] ?? a.tipo,
        clase: a.clase ? NOMBRE_CLASE[a.clase as keyof typeof NOMBRE_CLASE] : "",
        marca: a.marca ?? "",
        modelo: a.modelo ?? "",
        calibre: a.calibre ?? "",
        pais: a.pais_origen ?? "",
        serie: a.serie ?? "Sin número de serie",
        accesorios: a.accesorios ?? "—",
        importador: extra?.importador ?? "",
        resolucion: extra?.resolucion ?? "",
        muestra: a.muestra,
        camino: a.camino ? NOMBRE_CAMINO[a.camino as keyof typeof NOMBRE_CAMINO] : "",
        resultado: a.acunada_at ? `${veredicto} · acuñada BPCH` : veredicto,
        acunacion: a.acunada_at ? `Nº ${a.acunacion_numero}/${a.acunacion_anio}` : "No corresponde",
        vigente_desde: fmtFecha(desde),
        vigente_hasta: fmtFecha(hasta),
        url_verificacion: doc.urlVerificacion,
      },
      bloques: {
        qr_verificacion: `<div class="foto esquema"><img src="${qr}" alt="Código QR de verificación"><span>Escanee el código para verificar el certificado</span></div>`,
      },
    };
  }

  /** Verificación pública del certificado por arma: arma con la serie oculta y vigencia. Sin datos personales. */
  private async verificacionPublica(certificadoId: string) {
    const [c] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT c.fecha, c.muestra_ids, c.tenant_id, ca.vigente_desde, ca.vigente_hasta,
              ar.tipo, ar.marca, ar.modelo, ar.calibre, ar.serie, a.tipo AS tipo_ot
         FROM certificado c
         LEFT JOIN d11_certificado_arma ca ON ca.certificado_id = c.id
         LEFT JOIN d11_arma_ot a ON a.muestra_id = c.muestra_ids[1]
         LEFT JOIN arma ar ON ar.id = a.arma_id
        WHERE c.id = $1::uuid`,
      certificadoId,
    );
    if (!c) return null;
    const cfg = await this.config(c.tenant_id);
    const desde = c.vigente_desde ? String(c.vigente_desde instanceof Date ? c.vigente_desde.toISOString() : c.vigente_desde).slice(0, 10) : hoyChile(new Date(c.fecha));
    const hasta = c.vigente_hasta
      ? String(c.vigente_hasta instanceof Date ? c.vigente_hasta.toISOString() : c.vigente_hasta).slice(0, 10)
      : vigenciaHasta(desde, cfg.vigenciaAnios);
    const tipo = (c.tipo_ot ?? c.tipo) as TipoArma;
    return {
      arma: c.marca
        ? { tipo: NOMBRE_TIPO_ARMA[tipo] ?? tipo, marca: c.marca, modelo: c.modelo, calibre: c.calibre, serie: enmascararSerie(c.serie) }
        : null,
      vigenteDesde: fmtFecha(desde),
      vigenteHasta: fmtFecha(hasta),
      vigente: certificadoVigente(hasta, hoyChile()),
    };
  }

  /* ---------------------------------------------- etiquetas (11.7) -------- */

  async etiquetas(req: any, otId: string, ids?: string[]) {
    const ot = await this.otD11(req, otId);
    const armas = await this.armas(otId, this.prisma, ids?.length ? ids : undefined);
    if (!armas.length) throw new NotFoundException("No hay armas registradas para etiquetar.");
    const fichas = armas
      .map(
        (a) => `<div class="etiqueta">
  <div class="cab"><b>${escapeHtml(ot.codigo)}</b><span>BPCH · Delegación Nº 11</span></div>
  ${svgCode128(a.codigo_barras ?? a.muestra)}
  <div class="txt">${escapeHtml(NOMBRE_TIPO_ARMA[a.tipo] ?? a.tipo)} ${escapeHtml(a.marca ?? "")} ${escapeHtml(a.modelo ?? "")}</div>
  <div class="txt">Serie ${escapeHtml(a.serie ?? "sin serie")} · ${escapeHtml(a.calibre ?? "")}</div>
</div>`,
      )
      .join("\n");
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Etiquetas ${escapeHtml(ot.codigo)}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;margin:12px;color:#111}
  .barra{margin-bottom:10px} .barra button{font-size:13px;padding:6px 12px}
  .hoja{display:grid;grid-template-columns:repeat(auto-fill,minmax(70mm,1fr));gap:6mm}
  .etiqueta{border:1px dashed #888;padding:3mm;break-inside:avoid;page-break-inside:avoid}
  .etiqueta svg{display:block;max-width:100%;height:auto}
  .cab{display:flex;justify-content:space-between;font-size:11px;margin-bottom:2mm}
  .txt{font-size:10.5px;margin-top:1mm}
  @media print{.barra{display:none} body{margin:0}}
</style></head><body>
<div class="barra"><button type="button" onclick="window.print()">Imprimir etiquetas</button> ${armas.length} etiqueta(s) · ${escapeHtml(fmtFechaHora(new Date()))}</div>
<div class="hoja">
${fichas}
</div></body></html>`;
  }

  /* ---------------------------------------------- 11.27 · entrega -------- */

  async entregar(req: any, otId: string, body: unknown) {
    const ot = await this.otD11(req, otId);
    this.otAbierta(ot);
    const tenantId = tenantDe(req);
    const d = EntregaBody.parse(body ?? {});
    if (d.fecha > hoyChile()) throw new BadRequestException("La fecha de entrega no puede ser futura.");
    if (d.entregarCertificados && !tiene(req, "certificado.entregar"))
      throw new ForbiddenException("Registrar la entrega de los certificados exige el permiso certificado.entregar.");
    const cfg = await this.config(tenantId);
    const armas = await this.armas(otId);
    const codigos = [...new Set(d.codigos.map((c) => c.trim().toUpperCase()).filter(Boolean))];
    const errores: string[] = [];
    const elegidas = codigos.map((c) => {
      const a = armas.find((x) => (x.codigo_barras ?? x.muestra).toUpperCase() === c || x.muestra.toUpperCase() === c);
      if (!a) errores.push(`El código ${c} no es un arma de la OT ${ot.codigo}.`);
      else if (a.entrega_id) errores.push(`${a.muestra} ya se entregó.`);
      else {
        const etapa = etapaArma(estadoDe(a), cfg);
        if (etapa === "prohibida") errores.push(`${a.muestra} es prohibida: su destino lo decide la DGMN (no se entrega al importador).`);
        else if (!["certificada", "no_cumple"].includes(etapa))
          errores.push(`${a.muestra} aún no se puede entregar (${NOMBRE_ETAPA_ARMA[etapa].toLowerCase()}).`);
      }
      return a;
    });
    if (errores.length) throw new BadRequestException(errores.join(" "));
    const usuario = usuarioDe(req);
    const entrega = await this.prisma.$transaction(async (tx) => {
      const anio = anioChile();
      const [c] = await tx.$queryRawUnsafe<{ ultimo: number }[]>(
        `INSERT INTO bpch_correlativo (tenant_id, tipo, anio, ultimo) VALUES ($1::uuid, 'GE', $2, 1)
         ON CONFLICT (tenant_id, tipo, anio) DO UPDATE SET ultimo = bpch_correlativo.ultimo + 1, updated_at = now()
         RETURNING ultimo`,
        tenantId,
        anio,
      );
      const numero = `GE-${anio}-${String(Number(c.ultimo)).padStart(4, "0")}`;
      const [en] = await tx.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO d11_entrega (tenant_id, ot_id, numero, receptor_nombre, receptor_documento, fecha, observaciones, created_by)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::date, $7, $8::uuid) RETURNING id`,
        tenantId,
        otId,
        numero,
        d.receptorNombre,
        d.receptorDocumento?.trim() || null,
        d.fecha,
        d.observaciones?.trim() || null,
        usuario,
      );
      for (const a of elegidas) {
        const r = await tx.$executeRawUnsafe(`UPDATE d11_arma_ot SET entrega_id = $2::uuid, updated_at = now() WHERE id = $1::uuid AND entrega_id IS NULL`, a!.id, en.id);
        if (r !== 1) throw new ConflictException(`${a!.muestra} se entregó mientras tanto. Actualice la pantalla.`);
        await tx.$executeRawUnsafe(
          `INSERT INTO d11_arma_movimiento (tenant_id, arma_ot_id, evento, ubicacion, motivo, responsable, receptor, entrega_id)
           VALUES ($1::uuid, $2::uuid, 'salida', NULL, $3, $4::uuid, $5, $6::uuid)`,
          tenantId,
          a!.id,
          `Entrega al importador · guía ${numero}`,
          usuario,
          d.receptorNombre,
          en.id,
        );
        await tx.$executeRawUnsafe(`UPDATE arma SET estado = 'devuelta' WHERE id = $1::uuid`, a!.arma_id);
      }
      return { id: en.id, numero };
    });
    // Certificados oficiales de las armas entregadas: su entrega en el circuito general (cuenta para el cierre).
    const certificadosEntregados: string[] = [];
    const avisos: string[] = [];
    if (d.entregarCertificados)
      for (const a of elegidas) {
        const cert = a!.certificado;
        if (!cert || cert.estado === "en_firma" || cert.entregadoAt) continue;
        try {
          await this.firmas.entregar(cert.id, { medio: "mano", destinatario: d.receptorNombre, observacion: `Guía de entrega ${entrega.numero}` }, req);
          certificadosEntregados.push(cert.numero);
        } catch (e: any) {
          avisos.push(`${cert.numero}: ${e?.message ?? "no se registró la entrega"}`);
        }
      }
    await this.historial(otId, tenantId, "d11_entrega", { guia: entrega.numero, armas: elegidas.length }, usuario);
    return { entrega, certificadosEntregados, avisos, expediente: await this.expediente(req, otId) };
  }

  async guiaEntrega(req: any, entregaId: string) {
    const [en] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT en.*, u.nombre_completo AS registrada_por FROM d11_entrega en LEFT JOIN usuario u ON u.id = en.created_by
        WHERE en.id = $1::uuid AND en.tenant_id = $2::uuid`,
      entregaId,
      tenantDe(req),
    );
    if (!en) throw new NotFoundException("Guía de entrega no encontrada.");
    const ot = await this.otD11(req, en.ot_id);
    const armas = (await this.armas(en.ot_id)).filter((a) => a.entrega_id === en.id);
    const filas = armas
      .map(
        (a, i) =>
          `<tr><td>${i + 1}</td><td>${escapeHtml(a.muestra)}</td><td>${escapeHtml(NOMBRE_TIPO_ARMA[a.tipo] ?? a.tipo)}</td><td>${escapeHtml(a.marca ?? "")}</td>` +
          `<td>${escapeHtml(a.modelo ?? "")}</td><td>${escapeHtml(a.calibre ?? "")}</td><td>${escapeHtml(a.serie ?? "sin serie")}</td>` +
          `<td>${escapeHtml(a.certificado?.numero ?? "—")}</td></tr>`,
      )
      .join("");
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Guía ${escapeHtml(en.numero)}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;margin:18mm;color:#111;font-size:12px}
  h1{font-size:16px;margin:0 0 4px} .sub{color:#444;margin-bottom:12px}
  table{border-collapse:collapse;width:100%;margin-top:10px} th,td{border:1px solid #999;padding:4px 6px;text-align:left}
  th{background:#eef2f6} .meta td{border:none;padding:2px 8px 2px 0}
  .firmas{display:grid;grid-template-columns:1fr 1fr;gap:30mm;margin-top:28mm;text-align:center}
  .firmas div{border-top:1px solid #333;padding-top:4px}
  .barra{margin-bottom:10px} @media print{.barra{display:none} body{margin:12mm}}
</style></head><body>
<div class="barra"><button type="button" onclick="window.print()">Imprimir guía</button></div>
<h1>GUÍA DE ENTREGA DE ARMAS Nº ${escapeHtml(en.numero)}</h1>
<div class="sub">Instituto de Investigaciones y Control · Banco de Pruebas de Chile · Delegación Nº 11</div>
<table class="meta">
  <tr><td><b>OT</b></td><td>${escapeHtml(ot.codigo)}</td><td><b>Resolución DGMN</b></td><td>${escapeHtml(ot.numero_ley ?? "—")}</td></tr>
  <tr><td><b>Importador</b></td><td>${escapeHtml(ot.cliente ?? "—")}</td><td><b>Fecha de entrega</b></td><td>${escapeHtml(fmtFecha(en.fecha))}</td></tr>
  <tr><td><b>Recibe</b></td><td>${escapeHtml(en.receptor_nombre)}${en.receptor_documento ? ` · ${escapeHtml(en.receptor_documento)}` : ""}</td>
      <td><b>Registró</b></td><td>${escapeHtml(en.registrada_por ?? "—")} · ${escapeHtml(fmtFechaHora(en.created_at))}</td></tr>
</table>
<table><thead><tr><th>#</th><th>Código</th><th>Tipo</th><th>Marca</th><th>Modelo</th><th>Calibre</th><th>Nº de serie</th><th>Certificado</th></tr></thead>
<tbody>${filas}</tbody></table>
<p>Total de armas entregadas: <b>${armas.length}</b>.${en.observaciones ? ` Observaciones: ${escapeHtml(en.observaciones)}` : ""}</p>
<div class="firmas"><div>Entrega · Delegación Nº 11</div><div>Recibe · ${escapeHtml(en.receptor_nombre)}</div></div>
</body></html>`;
  }

  /* ------------------------------------------------------- catálogos ----- */

  async catalogos(req: any) {
    const tenantId = tenantDe(req);
    const [marcas, modelos, calibres] = await Promise.all([
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT id, nombre, pais, activo, origen FROM d11_marca WHERE tenant_id = $1::uuid ORDER BY activo DESC, nombre, pais`,
        tenantId,
      ),
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT id, marca_id AS "marcaId", nombre, activo FROM d11_modelo WHERE tenant_id = $1::uuid ORDER BY nombre`,
        tenantId,
      ),
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT id, nombre, cip, activo FROM d11_calibre WHERE tenant_id = $1::uuid ORDER BY activo DESC, nombre`,
        tenantId,
      ),
    ]);
    return { marcas, modelos, calibres, puedeEditar: tiene(req, "arma.catalogo"), puedeAgregar: tiene(req, "arma.registrar") || tiene(req, "arma.catalogo") };
  }

  private duplicado(e: any, que: string): never {
    if (String(e?.message ?? "").includes("duplicate key") || e?.code === "P2010" || e?.meta?.code === "23505")
      throw new ConflictException(`${que} ya existe en el catálogo.`);
    throw e;
  }

  async crearMarca(req: any, body: unknown) {
    const d = CatalogoMarcaBody.parse(body ?? {});
    try {
      const [m] = await this.prisma.$queryRawUnsafe<any[]>(
        `INSERT INTO d11_marca (tenant_id, nombre, pais, created_by) VALUES ($1::uuid, $2, $3, $4::uuid) RETURNING id, nombre, pais, activo, origen`,
        tenantDe(req),
        d.nombre,
        d.pais?.trim() || null,
        usuarioDe(req),
      );
      return m;
    } catch (e) {
      this.duplicado(e, `La marca ${d.nombre}${d.pais ? ` (${d.pais})` : ""}`);
    }
  }

  async crearModelo(req: any, body: unknown) {
    const d = CatalogoModeloBody.parse(body ?? {});
    const [marca] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id FROM d11_marca WHERE id = $1::uuid AND tenant_id = $2::uuid AND activo`,
      d.marcaId,
      tenantDe(req),
    );
    if (!marca) throw new BadRequestException("La marca no existe o está desactivada.");
    try {
      const [m] = await this.prisma.$queryRawUnsafe<any[]>(
        `INSERT INTO d11_modelo (tenant_id, marca_id, nombre, created_by) VALUES ($1::uuid, $2::uuid, $3, $4::uuid)
         RETURNING id, marca_id AS "marcaId", nombre, activo`,
        tenantDe(req),
        d.marcaId,
        d.nombre,
        usuarioDe(req),
      );
      return m;
    } catch (e) {
      this.duplicado(e, `El modelo ${d.nombre}`);
    }
  }

  async crearCalibre(req: any, body: unknown) {
    const d = CatalogoCalibreBody.parse(body ?? {});
    try {
      const [c] = await this.prisma.$queryRawUnsafe<any[]>(
        `INSERT INTO d11_calibre (tenant_id, nombre, cip, created_by) VALUES ($1::uuid, $2, $3, $4::uuid) RETURNING id, nombre, cip, activo`,
        tenantDe(req),
        d.nombre,
        Boolean(d.cip),
        usuarioDe(req),
      );
      return c;
    } catch (e) {
      this.duplicado(e, `El calibre ${d.nombre}`);
    }
  }

  async editarCatalogo(req: any, tabla: "marca" | "modelo" | "calibre", id: string, body: unknown) {
    const d = CatalogoEstadoBody.parse(body ?? {});
    const t = { marca: "d11_marca", modelo: "d11_modelo", calibre: "d11_calibre" }[tabla];
    const sets = ["activo = $3", "updated_at = now()"];
    const args: unknown[] = [id, tenantDe(req), d.activo];
    if (d.nombre?.trim()) {
      args.push(d.nombre.trim());
      sets.push(`nombre = $${args.length}`);
    }
    if (tabla === "marca" && d.pais !== undefined) {
      args.push(d.pais?.trim() || null);
      sets.push(`pais = $${args.length}`);
    }
    if (tabla === "calibre" && d.cip !== undefined) {
      args.push(d.cip);
      sets.push(`cip = $${args.length}`);
    }
    try {
      const filas = await this.prisma.$queryRawUnsafe<any[]>(
        `UPDATE ${t} SET ${sets.join(", ")} WHERE id = $1::uuid AND tenant_id = $2::uuid RETURNING *`,
        ...args,
      );
      if (!filas.length) throw new NotFoundException("No existe en el catálogo.");
      return filas[0];
    } catch (e) {
      if (e instanceof NotFoundException) throw e;
      this.duplicado(e, "Ese nombre");
    }
  }

  /* ---------------------------------------------------------- historial -- */

  private historial(otId: string, tenantId: string, tipo: string, detalle: unknown, usuarioId: string | null) {
    return this.prisma.$executeRawUnsafe(
      `INSERT INTO ot_historial (tenant_id, ot_id, tipo, detalle, usuario_id) VALUES ($1::uuid, $2::uuid, $3, $4::jsonb, $5::uuid)`,
      tenantId,
      otId,
      tipo,
      JSON.stringify(detalle ?? {}),
      usuarioId,
    );
  }
}
