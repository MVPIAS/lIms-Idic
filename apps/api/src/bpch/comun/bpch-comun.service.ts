import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../common/prisma.service";
import { DEV_TENANT } from "../../common/base-crud.service";
import { AlcanceService } from "../../rbac/alcance.service";
import { descendientes } from "../../rbac/alcance";
import { RegistroMuestrasService } from "../../flujo-real/flujo-real.module";
import { CENTROS_REPARTO_TASA, condicionFinal, REPARTO_TASA_POR_DEFECTO, TEXTO_CONDICION, type CentroRepartoTasa } from "./reglas-bpch";
import { cambiaInspeccion, erroresInspectores, exigeInspectores, iniciales, SQL_INSPECTORES_UNIDAD, type PrevioInspeccion } from "../cabecera/reglas-cabecera";

/** Cliente con el que se escribe: el servicio o la transacción en curso. */
export type Sql = Pick<PrismaService, "$queryRawUnsafe" | "$executeRawUnsafe">;

export const tenantDe = (req: any): string => req?.user?.tenantId ?? DEV_TENANT;
export const usuarioDe = (req: any): string | null => req?.user?.sub ?? null;

/** Plantillas de los documentos BPCH (repid), la primera es la propuesta. */
export const PLANTILLAS_BPCH = {
  INFORME_INSPECCION: ["SCCII"],
  CERTIFICADO_CONFORMIDAD: ["SCCCC", "SCCDG"],
  INFORME_INCUMPLIMIENTO: ["SCCID", "SCCIN"],
} as const;

export interface DocumentoOt {
  id: string;
  numero: string | null;
  tipoDocumento: string | null;
  estado: string;
  plantillaRepid: string | null;
  entregadoAt: Date | null;
  entregaDestinatario: string | null;
  entregaMedio: string | null;
  version: number;
}

/**
 * Piezas comunes de los procesos BPCH (internación, reinspección): parámetros,
 * unidades de inspección, alcance del expediente, panel de ensayos del
 * catálogo y estado de la OT. La OT ligada y los correlativos de expediente
 * los crea OtDesdeProcesoService, el mismo para todos los procesos BPCH. El
 * estado de la OT (lotes, veredicto, documentos y factura) muestra el avance.
 */
@Injectable()
export class BpchComunService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
    private readonly registro: RegistroMuestrasService,
  ) {}

  /** Parámetros BPCH (Administración › Parámetros del sistema). */
  async parametros(tenantId: string) {
    const filas = await this.prisma.$queryRawUnsafe<{ categoria: string; codigo: string; etiqueta: string; valor: string | null; orden: number }[]>(
      `SELECT categoria, codigo, etiqueta, valor, orden FROM parametro_sistema
        WHERE tenant_id = $1::uuid AND activo AND categoria IN ('bpch_tasa', 'bpch_motivo_reinspeccion')
        ORDER BY categoria, orden`,
      tenantId,
    );
    const num = (codigo: string, defecto: number | null) => {
      const v = filas.find((f) => f.categoria === "bpch_tasa" && f.codigo === codigo)?.valor;
      const n = v == null ? NaN : Number(String(v).replace(",", "."));
      return Number.isFinite(n) ? n : defecto;
    };
    return {
      tasaPct: num("tasa_pct", null),
      ivaPct: num("iva_pct", null),
      // Reparto de la tasa por centro de costo (COM-03): si falta la fila, rige el 85 / 10 / 5 del IDIC.
      reparto: Object.fromEntries(
        CENTROS_REPARTO_TASA.map((c) => [c.codigo, num(c.parametro, REPARTO_TASA_POR_DEFECTO[c.codigo])]),
      ) as Record<CentroRepartoTasa, number>,
      motivosReinspeccion: filas.filter((f) => f.categoria === "bpch_motivo_reinspeccion").map((f) => ({ codigo: f.codigo, etiqueta: f.etiqueta })),
    };
  }

  /** Unidades que inspeccionan: la rama del Banco de Pruebas de Chile (SCC, sucursales, delegación). */
  async unidadesInspeccion(tenantId: string) {
    const arbol = await this.alcance.arbol(tenantId);
    const raiz = arbol.porCodigo.get("BPCH");
    if (!raiz) return [];
    const ids = descendientes(arbol, raiz.id, false);
    return ids
      .map((id) => arbol.porId.get(id)!)
      .filter((u) => u && u.activa !== false && ["SUCURSAL", "DELEGACION", "SECCION", "LABORATORIO"].includes(u.tipo ?? ""))
      .map((u) => ({ id: u.id, codigo: u.codigo, nombre: u.nombre, tipo: u.tipo }))
      .sort((a, b) => a.codigo.localeCompare(b.codigo));
  }

  async validarUnidadInspeccion(tenantId: string, unidadId: string) {
    const us = await this.unidadesInspeccion(tenantId);
    const u = us.find((x) => x.id === unidadId);
    if (!u) throw new BadRequestException("La unidad que inspecciona debe ser una sucursal, delegación o sección del Banco de Pruebas de Chile.");
    return u;
  }

  /** Id de la Sección Certificación de la Conformidad (tramita todas las internaciones). */
  private async sccId(tenantId: string): Promise<string | null> {
    const arbol = await this.alcance.arbol(tenantId);
    return arbol.porCodigo.get("SCC")?.id ?? null;
  }

  /**
   * Unidades con las que se filtran los expedientes del usuario: null = todos
   * (alcance global). Un expediente es visible si la unidad que inspecciona
   * está en su alcance, o si tiene en su alcance la Sección Certificación de la
   * Conformidad (carril SCC del IDIC-PG 24: tramita las internaciones de todas
   * las sucursales).
   */
  async filtroExpedientes(req: any): Promise<string[] | null> {
    const filtro = await this.alcance.filtroUnidades(req);
    if (filtro === null) return null;
    const scc = await this.sccId(tenantDe(req));
    if (scc && filtro.includes(scc)) return null;
    return filtro;
  }

  async exigirExpediente(req: any, unidadInspeccionId: string, que: string) {
    const f = await this.filtroExpedientes(req);
    if (f !== null && !f.includes(unidadInspeccionId))
      throw new ForbiddenException(`Fuera de su alcance: ${que} lo inspecciona una unidad que usted no tiene asignada`);
  }

  /** El cliente existe en el tenant. */
  async cliente(tenantId: string, clienteId: string) {
    const c = await this.prisma.cliente.findFirst({ where: { id: clienteId, tenantId }, select: { id: true, razonSocial: true, rut: true } });
    if (!c) throw new BadRequestException("La empresa indicada no existe en el maestro de clientes.");
    return c;
  }

  /** Elemento del catálogo del tenant (o 400). */
  async catElemento(tenantId: string, id: string | null | undefined) {
    if (!id) return null;
    const e = await this.prisma.$queryRawUnsafe<{ id: string; codigo: string; nombre: string }[]>(
      `SELECT id, codigo, nombre FROM cat_elemento WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL`,
      id,
      tenantId,
    );
    if (!e[0]) throw new BadRequestException("El elemento del catálogo indicado no existe.");
    return e[0];
  }

  /** Panel de ensayos del elemento del catálogo (cat_panel → métodos con analitos). */
  async panel(tenantId: string, catElementoId: string) {
    return this.prisma.$queryRawUnsafe<any[]>(
      `SELECT m.id, m.codigo, m.nombre, m.norma, e.nombre AS ensayo, p.inspec_tipo AS "tipoInspeccion",
              (SELECT count(*) FROM cat_analito a WHERE a.metodo_id = m.id AND a.deleted_at IS NULL AND a.activo)::int AS analitos
         FROM cat_panel p
         JOIN cat_metodo m ON m.id = p.metodo_id AND m.deleted_at IS NULL AND m.activo
         LEFT JOIN cat_ensayo e ON e.id = m.ensayo_id
        WHERE p.tenant_id = $1::uuid AND p.elemento_id = $2::uuid AND p.deleted_at IS NULL AND p.activo
        ORDER BY p.orden NULLS LAST, m.codigo`,
      tenantId,
      catElementoId,
    );
  }

  /**
   * Registra un lote como muestra de la OT con sus ensayos (mismo servicio que
   * la pestaña «Muestras» del expediente) y le anota la identificación del lote.
   */
  async registrarLote(
    req: any,
    otId: string,
    d: { nombre: string; metodoIds: string[]; catElementoId?: string | null; lote?: string | null },
    /** Transacción del expediente: la muestra, sus ensayos y el enlace con el lote van juntos. */
    tx: any,
  ) {
    const r = await this.registro.registrar(
      otId,
      { muestras: [{ nombre: d.nombre.slice(0, 200), metodoIds: d.metodoIds, ...(d.catElementoId ? { catElementoId: d.catElementoId } : {}) }] },
      tenantDe(req),
      req,
      tx,
      // F002: el expediente ya pasó por exigirExpediente (la SCC opera las OT de las sucursales).
      { alcanceVerificado: true },
    );
    const m = r.muestras[0];
    if (d.lote) await tx.$executeRawUnsafe(`UPDATE muestra SET numero_lote = $2 WHERE id = $1::uuid`, m.id, d.lote.slice(0, 80));
    return m;
  }

  /**
   * Estado de la OT ligada: lotes con su veredicto, condición final, documentos
   * (por tipo de la matriz) y factura. Es lo que la pantalla del expediente
   * muestra como avance del flujo general.
   */
  async estadoOt(otId: string | null) {
    if (!otId) return null;
    const [ot] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT o.id, o.codigo, o.estado, o.fecha_cierre AS "fechaCierre", o.con_cobro AS "conCobro", o.unidad_principal AS "unidadId",
              u.codigo AS "unidadCodigo", u.nombre AS "unidadNombre"
         FROM orden_trabajo o LEFT JOIN unidad u ON u.id = o.unidad_principal WHERE o.id = $1::uuid`,
      otId,
    );
    if (!ot) return null;
    const muestras = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT m.id, m.codigo, m.nombre, m.numero_lote AS lote, m.veredicto,
              -- Lote 4: los «No ejecutado» (cierre por incumplimiento) no cuentan como ensayos por hacer.
              count(r.id) FILTER (WHERE r.estado <> 'no_ejecutado')::int AS ensayos,
              count(r.id) FILTER (WHERE r.estado = 'no_ejecutado')::int AS "noEjecutados",
              count(r.id) FILTER (WHERE r.estado = 'aprobado')::int AS aprobados,
              count(r.id) FILTER (WHERE r.estado IN ('capturado','revisado_n1','aprobado'))::int AS capturados
         FROM muestra m LEFT JOIN resultado r ON r.muestra_id = m.id AND r.deleted_at IS NULL
        WHERE m.ot_id = $1::uuid AND m.deleted_at IS NULL
        GROUP BY m.id ORDER BY m.codigo`,
      otId,
    );
    const documentos = await this.prisma.$queryRawUnsafe<DocumentoOt[]>(
      `SELECT c.id, c.numero, c.tipo_documento AS "tipoDocumento", c.estado, p.repid AS "plantillaRepid",
              c.entregado_at AS "entregadoAt", c.entrega_destinatario AS "entregaDestinatario", c.entrega_medio AS "entregaMedio",
              COALESCE(c.version, 1) AS version
         FROM certificado c LEFT JOIN plantilla_informe p ON p.id = c.plantilla_id
        WHERE c.ot_id = $1::uuid AND c.deleted_at IS NULL
        ORDER BY c.created_at`,
      otId,
    );
    const facturas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, numero, estado, origen, total::float8 AS total FROM factura
        WHERE ot_id = $1::uuid AND deleted_at IS NULL AND estado <> 'anulada' ORDER BY created_at`,
      otId,
    );
    const condicion = condicionFinal(muestras.map((m) => m.veredicto));
    const vigente = (tipo: string) =>
      documentos.filter((d) => d.tipoDocumento === tipo && ["en_firma", "oficial", "emitido", "devuelto"].includes(d.estado)).slice(-1)[0] ?? null;
    return {
      ot,
      muestras,
      condicion,
      condicionTexto: TEXTO_CONDICION[condicion],
      resultados: {
        total: muestras.reduce((s, m) => s + m.ensayos, 0),
        aprobados: muestras.reduce((s, m) => s + m.aprobados, 0),
        capturados: muestras.reduce((s, m) => s + m.capturados, 0),
        noEjecutados: muestras.reduce((s, m) => s + (m.noEjecutados ?? 0), 0),
      },
      documentos,
      informeInspeccion: vigente("INFORME_INSPECCION"),
      certificado: vigente("CERTIFICADO_CONFORMIDAD"),
      incumplimiento: vigente("INFORME_INCUMPLIMIENTO"),
      facturas,
    };
  }

  /** Plantillas disponibles para los documentos BPCH (por tipo de documento). */
  async plantillas(tenantId: string) {
    const repids = Object.values(PLANTILLAS_BPCH).flat();
    const filas = await this.prisma.$queryRawUnsafe<{ id: string; repid: string; nombre: string }[]>(
      `SELECT id, repid, nombre FROM plantilla_informe
        WHERE tenant_id = $1::uuid AND deleted_at IS NULL AND activo AND repid = ANY($2::text[])
        ORDER BY repid, nombre`,
      tenantId,
      repids,
    );
    const out: Record<string, { id: string; repid: string; nombre: string }[]> = {};
    for (const [tipo, lista] of Object.entries(PLANTILLAS_BPCH))
      out[tipo] = (lista as readonly string[]).flatMap((r) => filas.filter((f) => f.repid === r));
    return out;
  }

  /** OT del tenant (o 404). */
  async ot(tenantId: string, otId: string) {
    const ot = await this.prisma.ordenTrabajo.findFirst({
      where: { id: otId, tenantId },
      select: { id: true, codigo: true, estado: true, clienteId: true, unidadPrincipal: true, origenTrabajo: true },
    });
    if (!ot) throw new NotFoundException("La OT indicada no existe.");
    return ot;
  }
  /* ------------------------------------------------ BPCH-48 · inspectores --- */

  /** Personas con rol INSPECTOR (o alias) vigente en la unidad o en sus ancestras (las que se pueden elegir). */
  async inspectoresDeUnidad(unidadId: string | null): Promise<{ id: string; nombre: string; iniciales: string }[]> {
    if (!unidadId) return [];
    const filas = await this.prisma.$queryRawUnsafe<{ id: string; nombre: string }[]>(SQL_INSPECTORES_UNIDAD, unidadId);
    return filas.map((f) => ({ ...f, iniciales: iniciales(f.nombre) }));
  }

  private async nombresUsuarios(ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const f = await this.prisma.$queryRawUnsafe<{ id: string; nombre: string }[]>(
      `SELECT id, nombre_completo AS nombre FROM usuario WHERE id = ANY($1::uuid[])`,
      ids,
    );
    return new Map(f.map((x) => [x.id, x.nombre]));
  }

  /**
   * BPCH-48 (respuesta IDIC 17-11-2026): valida modalidad e inspectores de una
   * inspección (en terreno, dos; trabajo administrativo, uno) elegidos entre las
   * personas con rol INSPECTOR de la unidad o sus ancestras (se conservan los ya
   * elegidos antes), y arma el texto con sus iniciales que imprimen los
   * documentos. Lo que la petición no trae (undefined) se conserva. Un registro
   * anterior a BPCH-48 (inspección registrada sin modalidad ni personas) se
   * guarda sin exigirlos mientras no se toquen (exigeInspectores), y conserva su
   * texto libre de inspectores.
   */
  async resolverInspectores(
    unidadId: string | null,
    d: { modalidad?: string | null; inspectorIds?: string[] | null },
    previo: PrevioInspeccion = {},
  ): Promise<{ errores: string[]; modalidad: string | null; ids: string[] | null; texto: string | null }> {
    const previos = [...(previo.inspectorIds ?? [])];
    const modalidad = d.modalidad === undefined ? previo.modalidad ?? null : d.modalidad ?? null;
    const tocaIds = d.inspectorIds !== undefined && cambiaInspeccion(previo, { inspectorIds: d.inspectorIds });
    const ids = [...new Set(tocaIds ? d.inspectorIds ?? [] : previos)];
    if (!exigeInspectores(previo, d))
      return { errores: [], modalidad, ids: ids.length ? ids : null, texto: tocaIds ? null : previo.inspectores ?? null };
    const validos = new Set([...(await this.inspectoresDeUnidad(unidadId)).map((i) => i.id), ...previos]);
    const errores = erroresInspectores({ modalidad, inspectorIds: ids }, validos);
    if (!tocaIds && previo.inspectores && ids.length) return { errores, modalidad, ids, texto: previo.inspectores };
    const nombres = await this.nombresUsuarios(ids);
    return { errores, modalidad, ids: ids.length ? ids : null, texto: ids.length ? ids.map((i) => iniciales(nombres.get(i))).join(" · ") : null };
  }

  /** Lo que la pantalla necesita para elegir inspectores (y el texto libre de registros anteriores). */
  async fichaInspectores(unidadId: string | null, fila: { modalidad?: string | null; inspector_ids?: string[] | null; inspectores?: string | null }) {
    const elegidos = (fila.inspector_ids ?? []) as string[];
    const disponibles = await this.inspectoresDeUnidad(unidadId);
    const fuera = elegidos.filter((i) => !disponibles.some((x) => x.id === i));
    const nombres = await this.nombresUsuarios(fuera);
    return {
      modalidad: fila.modalidad ?? null,
      inspectorIds: elegidos,
      inspectoresDisponibles: [
        ...disponibles.map((x) => ({ ...x, sinRol: false })),
        ...fuera.map((id) => ({ id, nombre: nombres.get(id) ?? "(usuario)", iniciales: iniciales(nombres.get(id)), sinRol: true })),
      ],
      inspectoresTextoAnterior: !elegidos.length && fila.inspectores ? fila.inspectores : null,
    };
  }
}

