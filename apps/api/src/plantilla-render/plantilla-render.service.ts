import { etiquetaVeredicto } from "../laboratorio/veredicto";
import { Injectable, NotFoundException, ConflictException, BadRequestException } from "@nestjs/common";
import { createHash } from "crypto";
import { PrismaService } from "../common/prisma.service";
import { nuevoCodigoVerificacion } from "../common/codigo-verificacion";
import { renderizar, tablaMuestras, tablaInspeccion, type FilaMuestra, type FilaInspeccion } from "./template.engine";
import { condicionFinal, faltantesDocumentoFinal, TEXTO_CONDICION } from "../bpch/comun/reglas-bpch";
import { fmtFecha, fmtFechaHora } from "./html.util";
import { cuerpoPorDefecto, documentoCompleto, type FirmaEstampada, type Sello } from "./plantilla-defecto";
import { generarPdf } from "./pdf.renderer";
import { QcService } from "../qc/qc.module";
import { FirmasMatrizService } from "../rbac/firmas-matriz.controller";
import { esOtInterna } from "../rbac/firmas-resolver";
import { TIPOS_DOCUMENTO } from "../rbac/rbac.constants";
import {
  esOficial,
  esVigente,
  faltantesParaEmitir,
  numeroVersion,
  pasosDesdeMatriz,
  tipoDocumentoPorDefecto,
  type PasoNuevo,
} from "./reglas-emision";
import { configEfectiva, configPorTipo, type ConfigInforme } from "./config-informe";
import { camposDeLaboratorio } from "../recepcion/reglas-recepcion";
import {
  armarInforme,
  filaInspeccion,
  filasMetodos,
  modalidadSugerida,
  tieneRequisito,
  NOMBRE_MODALIDAD,
  type EstructuraInforme,
  type Modalidad,
  type ResultadoParaInforme,
} from "./filas-informe";
import {
  bloqueAnexo,
  bloqueIdentificacion,
  bloqueMetodos,
  bloqueTermograma,
  bloqueConclusion,
  bloquePortadaIvc,
  bloqueReferencias,
  bloqueResultados,
  completarCuerpo,
  type DatosPortada,
  type FotoInforme,
  type IdentificacionMuestra,
} from "./bloques-informe";

/** Fotos como máximo en el anexo fotográfico de un documento. */
export const MAX_FOTOS_INFORME = 24;

/** Datos propios del documento, elegidos al emitir (certificado.datos_informe). */
export interface DatosInforme {
  conclusion?: string | null;
  portada?: DatosPortada | null;
}

/**
 * Contexto adicional de un proceso (p. ej. BPCH · prototipos) para las
 * plantillas: datos bajo su propia clave (`{{prototipo.elemento}}`) y bloques
 * HTML ya escapados por quien los genera. Puede lanzar una excepción para
 * impedir usar una plantilla propia del proceso en una OT que no le corresponde.
 */
export type ProveedorContexto = (
  otId: string,
  tenantId: string | undefined,
  plantilla: { id: string; repid: string },
) => Promise<{ datos?: Record<string, unknown>; bloques?: Record<string, string> } | null>;

/** Opciones de emisión: tipo de documento de la matriz y documento al que reemplaza. */
export interface OpcionesEmision {
  tipoDocumento?: string;
  /** Reemisión: id del documento devuelto o anulado que se sustituye (nueva versión). */
  reemplazaId?: string;
  /** Informe de cumplimiento o de solo resultados (por defecto, el sugerido). */
  modalidad?: Modalidad;
  datosInforme?: DatosInforme;
}

/**
 * Emisión real de informes/certificados del LIMS IDIC.
 *
 * Reúne el expediente (OT + cliente + muestras + resultados + límites), rellena
 * el CUERPO de la plantilla (`plantilla_informe.cuerpo_html`, ver
 * `packages/db/align_certificado.sql`), sella el documento con SHA-256, le
 * asigna un correlativo por tenant y año y registra el `Certificado`.
 *
 * ---------------------------------------------------------------------------
 * QUÉ SE SELLA (anti-repudio)
 * ---------------------------------------------------------------------------
 * `hash_sha256 = sha256(documento_html)`, donde `documento_html` es el CUERPO
 * renderizado, guardado tal cual en la fila del certificado. La verificación es
 * reproducible en cualquier momento aunque los resultados de la OT cambien
 * después: no se re-renderiza nada, se rehashea lo guardado.
 *
 * El pie con el hash y el código de verificación NO entra en lo sellado (sería
 * circular: un texto no puede contener su propio hash). El pie lo añade la capa
 * de presentación (`documentoCompleto` / `generarPdf`).
 */
@Injectable()
export class PlantillaRenderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly qc: QcService,
    private readonly matriz: FirmasMatrizService,
  ) {}

  /** Proveedores de contexto adicional registrados por otros módulos (clave → proveedor). */
  private readonly proveedores = new Map<string, ProveedorContexto>();

  /**
   * Registra un proveedor de contexto adicional. `clave` es el nombre con que
   * sus datos llegan a la plantilla y no puede pisar las claves del motor.
   */
  registrarContexto(clave: string, proveedor: ProveedorContexto) {
    this.proveedores.set(clave, proveedor);
  }

  /** URL pública de verificación; configurable por despliegue. */
  private get baseVerificacion(): string {
    return (process.env.URL_VERIFICACION ?? "https://verificar.idic.cl/c").replace(/\/+$/, "");
  }

  /* ====================================================================== */
  /* Contexto                                                               */
  /* ====================================================================== */

  /**
   * Ensambla el contexto de datos de una OT para rellenar la plantilla.
   * Aislamiento por tenant: 404 (no 403) para no revelar OTs de otro tenant.
   *
   * `paraInforme` son los resultados ya normalizados para el informe
   * (filas-informe.ts): el ensayo y el método salen del catálogo v2
   * (`cat_analito`, `cat_metodo`) o, en los resultados antiguos, del analito
   * legado; el requisito, de la especificación que guarda el propio resultado
   * (la de la orden si se editó, la copiada del catálogo si no). Solo los
   * resultados antiguos sin especificación propia caen a `norma_limite`.
   */
  async contexto(otId: string, tenantId?: string) {
    const ot = await this.prisma.ordenTrabajo.findUnique({
      where: { id: otId },
      include: { cliente: true },
    });
    if (!ot) throw new NotFoundException(`OT ${otId} no encontrada`);
    if (tenantId && ot.tenantId !== tenantId) throw new NotFoundException(`OT ${otId} no encontrada`);

    const muestras = await this.prisma.muestra.findMany({
      where: { otId, deletedAt: null },
      include: { tipoMuestra: true },
      orderBy: { codigo: "asc" },
    });
    const resultados = await this.prisma.resultado.findMany({
      where: { otId, deletedAt: null },
      include: {
        analito: true,
        muestra: true,
        catAnalito: { select: { nombre: true, unidad: true } },
        catMetodo: { select: { nombre: true, norma: true } },
      },
      orderBy: [{ fecha: "asc" }, { id: "asc" }],
    });

    // Límites de norma de los analitos LEGADOS, en UNA consulta (no N+1). Los
    // resultados del puente (cat_analito_id) traen su propia especificación.
    const analitoIds = [
      ...new Set(
        resultados
          .filter((r) => !r.catAnalitoId && !tieneRequisito(r))
          .map((r) => r.analitoId)
          .filter((x): x is string => x !== null),
      ),
    ];
    const limites = analitoIds.length
      ? await this.prisma.normaLimite.findMany({ where: { analitoId: { in: analitoIds } } })
      : [];
    const limitePorAnalito = new Map<string, (typeof limites)[number]>();
    for (const l of limites) if (!limitePorAnalito.has(l.analitoId)) limitePorAnalito.set(l.analitoId, l);

    const ubicaciones = await this.ubicaciones(otId);
    const txt = (v: unknown) => (v === null || v === undefined ? null : String(v));
    const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(String(v)));
    const paraInforme: ResultadoParaInforme[] = resultados.map((r) => {
      const legado = !r.catAnalitoId && !tieneRequisito(r) && r.analitoId ? limitePorAnalito.get(r.analitoId) : undefined;
      const u = ubicaciones.get(r.id);
      const replicas = Array.isArray(r.replicas) ? (r.replicas as unknown[]).length : 0;
      return {
        id: r.id,
        muestraId: r.muestraId,
        muestraCodigo: r.muestra?.codigo ?? "",
        muestraNombre: r.muestra?.nombre ?? null,
        ensayo: r.catAnalito?.nombre ?? r.analito?.nombre ?? null,
        metodoNombre: r.catMetodo?.nombre ?? null,
        metodoNorma: r.catMetodo?.norma ?? null,
        unidad: r.unidad ?? r.catAnalito?.unidad ?? r.analito?.unidad ?? legado?.unidad ?? null,
        limiteInf: legado ? txt(legado.limiteInf) : r.limiteInf,
        nominal: legado ? txt(legado.nominal) : r.nominal,
        limiteSup: legado ? txt(legado.limiteSup) : r.limiteSup,
        requisito: r.requisito,
        especOrigen: legado ? "catalogo" : r.especOrigen,
        tipoDato: r.tipoDato,
        valorNumerico: num(r.valorNumerico),
        valorTexto: r.valorTexto,
        resultadoFinal: num(r.resultadoFinal),
        promedio: num(r.promedio),
        desviacion: num(r.desviacion),
        cv: num(r.cv),
        nReplicas: replicas,
        observacion: r.observacion,
        veredicto: r.veredicto,
        fechaEnsayo: r.fechaEnsayo ?? null,
        seccion: u?.seccion ?? null,
        componente: u?.componente ?? null,
        orden: u?.orden ?? null,
      };
    });

    const bpch = await this.cabeceraBpch(otId, muestras);
    const identificacion = await this.identificacionMuestras(ot.tenantId, ot.unidadPrincipal, muestras, ot.clienteId);
    return { ot, cliente: ot.cliente, muestras, resultados, limitePorAnalito, paraInforme, bpch, identificacion };
  }

  /**
   * Identificación de las muestras para {{identificacion_muestras}}: Nº interno,
   * producto, cliente (si no es el de la OT), identificación del cliente y los
   * datos propios de la recepción con la etiqueta que les da el laboratorio
   * (Catálogo › Parámetros · recepcion_campo).
   */
  private async identificacionMuestras(
    tenantId: string,
    unidadId: string | null,
    muestras: { codigo: string; nombre: string | null; numeroInterno?: bigint | null; catElementoId: string | null; clienteId: string | null;
      identificacionCliente: string | null; datosRecepcion?: unknown; ubicacion?: string | null }[],
    clienteOt: string | null = null,
  ): Promise<IdentificacionMuestra[]> {
    try {
      const elementos = [...new Set(muestras.map((m) => m.catElementoId).filter((x): x is string => !!x))];
      const clientes = [...new Set(muestras.map((m) => m.clienteId).filter((x): x is string => !!x))];
      const [prod, cli, lab, campos] = await Promise.all([
        elementos.length ? this.prisma.catElemento.findMany({ where: { id: { in: elementos } }, select: { id: true, nombre: true } }) : [],
        clientes.length ? this.prisma.cliente.findMany({ where: { id: { in: clientes } }, select: { id: true, razonSocial: true } }) : [],
        unidadId ? this.prisma.$queryRawUnsafe<{ codigo: string }[]>(`SELECT codigo FROM unidad WHERE id = $1::uuid`, unidadId) : [],
        this.prisma.$queryRawUnsafe<{ codigo: string; etiqueta: string; orden: number; valor: string | null; activo: boolean }[]>(
          `SELECT codigo, etiqueta, orden, valor, activo FROM parametro_sistema WHERE tenant_id = $1::uuid AND categoria = 'recepcion_campo'`,
          tenantId,
        ),
      ]);
      const defs = camposDeLaboratorio(campos, lab[0]?.codigo ?? null);
      const nombreProd = new Map(prod.map((x) => [x.id, x.nombre]));
      const nombreCli = new Map(cli.map((x) => [x.id, x.razonSocial]));
      return muestras.map((m) => {
        const d = (m.datosRecepcion ?? {}) as Record<string, unknown>;
        const datos = defs
          .filter((c) => c.tipo !== "casilla" && !["clase_custodia", "ubicacion"].includes(c.codigo))
          .map((c) => {
            const v = d[c.codigo];
            if (v === null || v === undefined || v === "") return null;
            const valor = c.tipo === "lista" ? c.opciones.find((o) => o.valor === v)?.etiqueta ?? String(v) : String(v);
            return { etiqueta: c.etiqueta, valor };
          })
          .filter((x): x is { etiqueta: string; valor: string } => !!x);
        return {
          codigo: m.codigo,
          nombre: m.nombre,
          numeroInterno: m.numeroInterno != null ? String(m.numeroInterno) : null,
          producto: m.catElementoId ? nombreProd.get(m.catElementoId) ?? null : null,
          // El cliente de la muestra solo se imprime si no es el de la OT (p. ej. el importador).
          cliente: m.clienteId && m.clienteId !== clienteOt ? nombreCli.get(m.clienteId) ?? null : null,
          identificacionCliente: m.identificacionCliente,
          datos,
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * Cabecera de los documentos del Banco de Pruebas de Chile ({{bpch.*}}):
   * vista v_bpch_cabecera_ot (internación, reinspección…) + condición final
   * calculada con el veredicto de cada lote + Nº del Informe de Inspección.
   * Si la OT no es de un proceso BPCH (o la base no tiene la vista), null.
   */
  private async cabeceraBpch(otId: string, muestras: { veredicto: string | null }[]) {
    try {
      const filas = await this.prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT * FROM v_bpch_cabecera_ot WHERE ot_id = $1::uuid LIMIT 1`,
        otId,
      );
      if (!filas[0]) return null;
      const informe = await this.prisma.certificado.findFirst({
        where: { otId, tipoDocumento: "INFORME_INSPECCION", deletedAt: null, estado: { in: ["oficial", "emitido", "en_firma"] } },
        orderBy: { createdAt: "desc" },
        select: { numero: true, codigo: true },
      });
      const condicion = condicionFinal(muestras.map((m) => m.veredicto));
      const datos: Record<string, string> = {};
      for (const [k, v] of Object.entries(filas[0])) datos[k] = v === null || v === undefined ? "" : String(v);
      return {
        ...datos,
        condicion_final: TEXTO_CONDICION[condicion],
        informe_inspeccion: informe?.numero ?? informe?.codigo ?? "",
      };
    } catch {
      return null; // BD sin align_bpch_internacion_reinspeccion.sql
    }
  }

  /** Sección / componente / orden de cada resultado de la OT (resultado_informe). */
  private async ubicaciones(otId: string) {
    const mapa = new Map<string, { seccion: string | null; componente: string | null; orden: number | null }>();
    try {
      const filas = await this.prisma.$queryRaw<
        { resultado_id: string; seccion: string | null; componente: string | null; orden: number | null }[]
      >`SELECT resultado_id, seccion, componente, orden FROM resultado_informe WHERE ot_id = ${otId}::uuid`;
      for (const f of filas) mapa.set(f.resultado_id, { seccion: f.seccion, componente: f.componente, orden: f.orden });
    } catch {
      /* BD sin align_informe_ensayo.sql: sin estructura propia */
    }
    return mapa;
  }

  /** Formato efectivo del informe de una plantilla (tipo + config_informe). */
  async configDePlantilla(plantillaId: string, tipo: string): Promise<ConfigInforme> {
    try {
      const filas = await this.prisma.$queryRaw<{ config_informe: unknown }[]>`
        SELECT config_informe FROM plantilla_informe WHERE id = ${plantillaId}::uuid`;
      return configEfectiva(tipo, filas[0]?.config_informe ?? null);
    } catch {
      return configPorTipo(tipo);
    }
  }

  /** Fotos de la OT elegidas para el informe, en su orden. */
  private async fotosDelInforme(
    otId: string,
    est: EstructuraInforme,
    muestras: { id: string; codigo: string }[],
  ): Promise<FotoInforme[]> {
    try {
      const filas = await this.prisma.$queryRaw<
        { mime: string; datos: string; pie: string | null; resultado_id: string | null; muestra_id: string | null }[]
      >`SELECT mime, datos, pie, resultado_id, muestra_id FROM ot_foto
         WHERE ot_id = ${otId}::uuid AND en_informe AND deleted_at IS NULL AND tipo <> 'termograma'
         ORDER BY orden, created_at LIMIT ${MAX_FOTOS_INFORME}`;
      const codigo = new Map(muestras.map((m) => [m.id, m.codigo]));
      return filas.map((f) => {
        const p = f.resultado_id ? est.puntoDe[f.resultado_id] : undefined;
        const deMuestra = f.muestra_id ? codigo.get(f.muestra_id) : undefined;
        return {
          mime: f.mime,
          datos: f.datos,
          pie: f.pie,
          punto: p?.punto ?? null,
          titulo: p?.titulo ?? (deMuestra ? `Muestra ${deMuestra}` : null),
        };
      });
    } catch {
      return [];
    }
  }

  /** Termogramas de la OT marcados para el informe ({{termograma}}), en su orden. */
  private async termogramasDelInforme(otId: string, muestras: { id: string; codigo: string }[]): Promise<FotoInforme[]> {
    try {
      const filas = await this.prisma.$queryRaw<{ mime: string; datos: string; pie: string | null; muestra_id: string | null }[]>`
        SELECT mime, datos, pie, muestra_id FROM ot_foto
         WHERE ot_id = ${otId}::uuid AND en_informe AND deleted_at IS NULL AND tipo = 'termograma'
         ORDER BY orden, created_at LIMIT ${MAX_FOTOS_INFORME}`;
      const codigo = new Map(muestras.map((m) => [m.id, m.codigo]));
      return filas.map((f) => ({
        mime: f.mime,
        datos: f.datos,
        pie: f.pie,
        punto: null,
        titulo: f.muestra_id && codigo.get(f.muestra_id) ? `Muestra ${codigo.get(f.muestra_id)}` : null,
      }));
    } catch {
      return [];
    }
  }

  /** Aplana el contexto a las rutas que ven las plantillas: {{cliente.razonSocial}}, {{ot.codigo}}… */
  private datosPlantilla(
    ctx: Awaited<ReturnType<PlantillaRenderService["contexto"]>>,
    plantilla: { repid: string; nombre: string; tipo: string; version: string },
    cert: { numero: string; codigoVerificacion: string; fecha: Date },
    est: EstructuraInforme,
  ) {
    const { ot, cliente, muestras, resultados } = ctx;
    const veredictoOt = est.modalidad === "cumplimiento" ? etiquetaVeredicto(est.veredictoOt) : "";
    return {
      // --- rutas punteadas (las que usan los cuerpos sembrados) ---
      ot: {
        ...ot,
        fechaRecepcion: fmtFecha(ot.fechaRecepcion),
        fechaCompromiso: fmtFecha(ot.fechaCompromiso),
        fechaCierre: fmtFecha(ot.fechaCierre),
      },
      cliente: cliente ?? {},
      plantilla,
      certificado: {
        numero: cert.numero,
        codigo_verificacion: cert.codigoVerificacion,
        codigoVerificacion: cert.codigoVerificacion,
        fecha: fmtFecha(cert.fecha),
        tipo: plantilla.tipo,
      },
      informe: {
        modalidad: est.modalidad,
        modalidad_texto: NOMBRE_MODALIDAD[est.modalidad],
        cumplimiento: est.modalidad === "cumplimiento",
        veredicto_ot: veredictoOt,
      },
      veredicto_ot: veredictoOt,
      fecha: fmtFecha(cert.fecha),
      fecha_hora: fmtFechaHora(cert.fecha),
      // Documentos BPCH: cabecera del expediente (vacía en las demás OT).
      bpch: ctx.bpch ?? {},
      anio: String(cert.fecha.getFullYear()),
      n_muestras: String(muestras.length),
      n_resultados: String(resultados.length),
      laboratorio: ot.subdireccionAsignada ?? "",

      // --- alias planos heredados: los escalares del motor anterior, para que
      // un cuerpo escrito contra la API vieja siga rellenándose ---
      cliente_nombre: cliente?.razonSocial ?? "",
      rut: cliente?.rut ?? "",
      fecha_emision: fmtFecha(cert.fecha),
      ot_codigo: ot.codigo,
    };
  }

  /** Filas de {{tabla_inspeccion}}: inspección, mínimo, máximo, resultado, unidad y condición. */
  private filasInspeccion(ctx: Awaited<ReturnType<PlantillaRenderService["contexto"]>>): FilaInspeccion[] {
    return ctx.resultados.map((r) => filaInspeccion(r, r.analitoId ? ctx.limitePorAnalito.get(r.analitoId) : undefined));
  }

  private filasMuestras(ctx: Awaited<ReturnType<PlantillaRenderService["contexto"]>>): FilaMuestra[] {
    return ctx.muestras.map((m) => ({
      codigo: m.codigo,
      nombre: m.nombre ?? "",
      tipo: m.tipoMuestra?.nombre ?? "",
      estado: m.estado,
    }));
  }

  /**
   * Lo que se propone al emitir: modalidad por defecto (cumplimiento si algún
   * ensayo tiene requisito) y la portada del IVC con lo que ya sabe la OT.
   */
  sugerencias(ctx: Awaited<ReturnType<PlantillaRenderService["contexto"]>>, cfg: ConfigInforme) {
    const { ot } = ctx;
    const unaMuestra = ctx.muestras.length === 1 ? ctx.muestras[0] : null;
    return {
      modalidad: modalidadSugerida(ctx.paraInforme),
      conRequisito: ctx.paraInforme.filter(tieneRequisito).length,
      totalEnsayos: ctx.paraInforme.length,
      portada:
        cfg.portada === "ivc"
          ? {
              proposito: "Verificación de calidad de una muestra representativa del lote de producción.",
              opiOc: ot.opiNumero ?? ot.ocNumero ?? null,
              fechaOpi: ot.opiFecha ? fmtFecha(ot.opiFecha) : null,
              contrato: null,
              fechaContrato: null,
              proyecto: null,
              proveedor: null,
              item: unaMuestra?.nombre ?? null,
              cantidad: null,
              fabricante: null,
              paisOrigen: null,
            }
          : null,
    };
  }

  /* ====================================================================== */
  /* Render                                                                 */
  /* ====================================================================== */

  /**
   * Núcleo del renderizado. Devuelve el CUERPO (lo que se sella) y su hash.
   * `avisos[]` reporta plantilla sin cuerpo, placeholders sin dato y lo que el
   * informe no puede mostrar bien (ensayos sin nombre, requisitos ausentes).
   *
   * La modalidad (cumplimiento / solo resultados), la conclusión libre y la
   * portada son del DOCUMENTO: las elige quien emite. Sin modalidad, se usa la
   * sugerida (cumplimiento si algún ensayo tiene requisito).
   */
  private async render(
    otId: string,
    plantillaId: string,
    tenantId: string | undefined,
    cert: { numero: string; codigoVerificacion: string; fecha: Date },
    opciones: { modalidad?: Modalidad; datos?: DatosInforme } = {},
  ) {
    const plantilla = await this.prisma.plantillaInforme.findUnique({ where: { id: plantillaId } });
    if (!plantilla) throw new NotFoundException(`Plantilla ${plantillaId} no encontrada`);
    if (tenantId && plantilla.tenantId !== tenantId)
      throw new NotFoundException(`Plantilla ${plantillaId} no encontrada`);

    const ctx = await this.contexto(otId, tenantId);
    const cfg = await this.configDePlantilla(plantilla.id, plantilla.tipo);
    const modalidad = opciones.modalidad ?? modalidadSugerida(ctx.paraInforme);
    const datosDoc = opciones.datos ?? {};
    const est = armarInforme(ctx.paraInforme, cfg, modalidad);
    const avisos: string[] = [];

    // 1. Cuerpo: el de la plantilla; si es una cáscara, el de su tipo + aviso.
    let cuerpo = plantilla.cuerpoHtml?.trim() ?? "";
    const usaDefecto = cuerpo === "";
    if (usaDefecto) {
      cuerpo = cuerpoPorDefecto(plantilla.tipo);
      avisos.push(
        `La plantilla ${plantilla.repid} · "${plantilla.nombre}" (${plantilla.tipo}) no tiene cuerpo cargado: ` +
          `se ha usado la plantilla POR DEFECTO del tipo ${plantilla.tipo}. Cargue el formato real en ` +
          `plantilla_informe.cuerpo_html para emitir con la maqueta oficial.`,
      );
    }
    cuerpo = completarCuerpo(cuerpo, cfg);

    // 2. Datos + bloques generados.
    const datos: Record<string, unknown> = this.datosPlantilla(ctx, plantilla, cert, est);
    const fotos = cfg.anexoFotografico ? await this.fotosDelInforme(otId, est, ctx.muestras) : [];
    const bloques: Record<string, string> = {
      tabla_resultados: bloqueResultados(est, cfg),
      tabla_muestras: tablaMuestras(this.filasMuestras(ctx)),
      referencias: bloqueReferencias(est, cfg),
      anexo_fotografico: bloqueAnexo(fotos, cfg),
      conclusion: bloqueConclusion(cfg, datosDoc.conclusion),
      // Mismo contenido sin el título «Conclusión»: para plantillas que numeran su sección (PG09A2-LME).
      conclusion_texto: bloqueConclusion(cfg, datosDoc.conclusion, false),
      portada:
        cfg.portada === "ivc"
          ? bloquePortadaIvc(datosDoc.portada ?? {}, {
              numero: cert.numero,
              ot: ctx.ot.codigo,
              fechaOt: fmtFecha(ctx.ot.fechaRecepcion ?? ctx.ot.createdAt),
              fecha: fmtFecha(cert.fecha),
            })
          : "",
      tabla_inspeccion: tablaInspeccion(this.filasInspeccion(ctx)),
      tabla_metodos: bloqueMetodos(filasMetodos(ctx.paraInforme)),
      termograma: bloqueTermograma(await this.termogramasDelInforme(otId, ctx.muestras)),
      identificacion_muestras: bloqueIdentificacion(ctx.identificacion),
    };
    // Contexto de otros módulos: nunca pisa una clave del motor.
    for (const [clave, proveedor] of this.proveedores) {
      const extra = await proveedor(otId, tenantId, { id: plantilla.id, repid: plantilla.repid });
      if (!extra) continue;
      if (extra.datos && !(clave in datos)) datos[clave] = extra.datos;
      for (const [k, v] of Object.entries(extra.bloques ?? {})) if (!(k in bloques)) bloques[k] = v;
    }
    const { html: cuerpoRenderizado, faltantes } = renderizar(cuerpo, datos, bloques);

    if (faltantes.length)
      avisos.push(`Placeholders sin dato en el expediente (se emiten vacíos): ${faltantes.join(", ")}.`);
    if (ctx.resultados.length === 0)
      avisos.push("La OT no tiene resultados registrados: la tabla de resultados sale vacía.");
    const sinNombre = ctx.paraInforme.filter((r) => !r.ensayo || !r.ensayo.trim()).length;
    if (sinNombre)
      avisos.push(`${sinNombre} ensayo(s) sin nombre en el catálogo: se imprimen como «Ensayo sin nombre en el catálogo».`);
    if (modalidad === "cumplimiento") {
      const sinReq = ctx.paraInforme.filter((r) => !tieneRequisito(r)).length;
      if (sinReq)
        avisos.push(
          `${sinReq} de ${ctx.paraInforme.length} ensayo(s) sin requisito: en el informe de cumplimiento salen como «No especificado» (informativo).`,
        );
    }

    // 3. Sello: hash del CUERPO (no del documento con pie -> sería circular).
    const hash = createHash("sha256").update(cuerpoRenderizado, "utf8").digest("hex");

    return { plantilla, ctx, cuerpoRenderizado, hash, avisos, usaDefecto, modalidad, fotos: fotos.length };
  }

  /** Título legible del documento (metadatos del PDF y <title>). */
  private titulo(numero: string, plantillaNombre: string, otCodigo: string): string {
    return `${numero} · ${plantillaNombre} · OT ${otCodigo}`;
  }

  /**
   * Previsualiza el documento relleno SIN emitir: no consume correlativo ni
   * escribe nada. El número va marcado como borrador para que un PDF/impresión
   * de la previsualización no pueda confundirse con un certificado válido
   * (además de la marca de agua en el PDF).
   */
  async previsualizar(
    otId: string,
    plantillaId: string,
    tenantId?: string,
    opciones: { modalidad?: Modalidad; datos?: DatosInforme } = {},
  ) {
    const fecha = new Date();
    const cert = {
      numero: `CERT-${fecha.getFullYear()}-XXXX`,
      codigoVerificacion: "SIN EMITIR",
      fecha,
    };
    const { plantilla, ctx, cuerpoRenderizado, hash, avisos, usaDefecto, modalidad } = await this.render(
      otId,
      plantillaId,
      tenantId,
      cert,
      opciones,
    );

    const sello: Sello = {
      numero: cert.numero,
      codigoVerificacion: cert.codigoVerificacion,
      hash,
      fecha: fmtFecha(fecha),
      urlVerificacion: this.baseVerificacion,
      borrador: true,
    };

    return {
      plantilla: plantilla.repid,
      plantillaNombre: plantilla.nombre,
      tipo: plantilla.tipo,
      modalidad,
      usaPlantillaPorDefecto: usaDefecto,
      avisos,
      hash,
      html: documentoCompleto(
        cuerpoRenderizado,
        sello,
        this.titulo(cert.numero, plantilla.nombre, ctx.ot.codigo),
      ),
    };
  }

  /* ====================================================================== */
  /* Correlativo                                                            */
  /* ====================================================================== */

  /**
   * Reserva el siguiente correlativo del tenant/año DENTRO de la transacción `tx`.
   *
   * GARANTÍA DE UNICIDAD
   * --------------------
   * `INSERT ... ON CONFLICT (tenant_id, anio) DO UPDATE SET ultimo = ultimo + 1
   * RETURNING ultimo` es atómico en PostgreSQL: la rama DO UPDATE toma un lock
   * de fila EXCLUSIVO sobre el contador. Dos emisiones simultáneas del mismo
   * tenant/año se serializan en ese lock — la segunda se bloquea hasta el commit
   * de la primera y lee el valor ya incrementado. Nunca devuelven el mismo NNNN.
   *
   * Frente a `SELECT max(...)` + `INSERT` (el patrón de `common/codigo.ts`, que
   * la auditoría §5.15 marca como condición de carrera) aquí no hay ventana
   * read-then-write, y además cubre el caso "la fila del contador aún no existe",
   * que un `SELECT ... FOR UPDATE` no puede bloquear (no hay fila que bloquear).
   *
   * Al ir en la misma transacción que el INSERT del certificado, un fallo
   * posterior revierte también el contador. Defensa en profundidad:
   * UNIQUE(tenant_id, codigo) + ux_certificado_numero rechazan el duplicado
   * aunque alguien inserte por fuera de aquí.
   */
  private async siguienteNumero(tx: any, tenantId: string, anio: number): Promise<string> {
    const filas = await tx.$queryRaw<Array<{ ultimo: number }>>`
      INSERT INTO certificado_correlativo (tenant_id, anio, ultimo, updated_at)
      VALUES (${tenantId}::uuid, ${anio}, 1, now())
      ON CONFLICT (tenant_id, anio)
      DO UPDATE SET ultimo = certificado_correlativo.ultimo + 1, updated_at = now()
      RETURNING ultimo
    `;
    const n = Number(filas[0]?.ultimo ?? 0);
    if (!n) throw new ConflictException("No se pudo reservar el correlativo del certificado");
    // padStart(4) da CERT-2026-0001; a partir de 10000 crece a 5 dígitos sin
    // romper nada (el contador es INTEGER, no hay orden lexicográfico).
    return `CERT-${anio}-${String(n).padStart(4, "0")}`;
  }


  /* ====================================================================== */
  /* Condiciones de emisión                                                 */
  /* ====================================================================== */

  /**
   * Comprueba, SIN escribir nada, si la OT puede emitir este documento:
   *   1. todos los resultados de la OT aprobados (reglas-emision.faltantesParaEmitir);
   *   2. control de calidad aprobado (QcService.verificarGate);
   *   3. laboratorio responsable de la OT (unidad_principal) para resolver la matriz;
   *   4. matriz de firmas con responsables para cada paso obligatorio;
   *   5. que no haya ya un documento vigente (en firma u oficial) de la misma plantilla.
   * Devuelve la lista de lo que falta (vacía = se puede emitir) y los pasos de firma.
   */
  /**
   * Tipo de documento por defecto de la unidad (`unidad.tipo_documento_defecto`),
   * el de la propia unidad o el del ancestro más cercano que lo tenga.
   */
  private async tipoDocumentoDeUnidad(unidadId: string | null): Promise<{ tipo: string; unidadCodigo: string } | null> {
    if (!unidadId) return null;
    try {
      const filas = await this.prisma.$queryRawUnsafe<{ tipo: string; codigo: string }[]>(
        `WITH RECURSIVE cadena AS (
           SELECT id, padre_id, codigo, tipo_documento_defecto, 0 AS nivel FROM unidad WHERE id = $1::uuid
           UNION ALL
           SELECT u.id, u.padre_id, u.codigo, u.tipo_documento_defecto, c.nivel + 1
             FROM unidad u JOIN cadena c ON u.id = c.padre_id WHERE c.nivel < 20)
         SELECT tipo_documento_defecto AS tipo, codigo FROM cadena
          WHERE tipo_documento_defecto IS NOT NULL ORDER BY nivel LIMIT 1`,
        unidadId,
      );
      return filas[0] ? { tipo: filas[0].tipo, unidadCodigo: filas[0].codigo } : null;
    } catch {
      return null; // BD sin align_correcciones_manuales.sql: se usa el de la plantilla
    }
  }

  async condicionesEmision(otId: string, plantillaId: string, tenantId: string | undefined, opts: OpcionesEmision = {}) {
    const ot = await this.prisma.ordenTrabajo.findFirst({
      where: { id: otId, ...(tenantId ? { tenantId } : {}) },
      select: { id: true, codigo: true, estado: true, unidadPrincipal: true, tenantId: true, origenTrabajo: true },
    });
    if (!ot) throw new NotFoundException(`OT ${otId} no encontrada`);
    const plantilla = await this.prisma.plantillaInforme.findFirst({
      where: { id: plantillaId, ...(tenantId ? { tenantId } : {}) },
      select: { id: true, repid: true, nombre: true, tipo: true },
    });
    if (!plantilla) throw new NotFoundException(`Plantilla ${plantillaId} no encontrada`);

    if (opts.tipoDocumento && !(TIPOS_DOCUMENTO as readonly string[]).includes(opts.tipoDocumento))
      throw new BadRequestException(`tipoDocumento inválido. Valores: ${TIPOS_DOCUMENTO.join(", ")}`);
    // Tipo de documento: el indicado, el propio de la plantilla o el de la unidad
    // de la OT (heredado por la rama: BPCH, sucursales y D11 → informe de inspección).
    const deUnidad = await this.tipoDocumentoDeUnidad(ot.unidadPrincipal);
    const { tipo: tipoDocumento, origen: tipoDocumentoOrigen } = tipoDocumentoPorDefecto({
      indicado: opts.tipoDocumento,
      tipoPlantilla: plantilla.tipo,
      tipoUnidad: deUnidad?.tipo ?? null,
    });
    const faltantes: string[] = [];

    if (ot.estado === "anulada" || ot.estado === "cerrada")
      faltantes.push(`La OT ${ot.codigo} está ${ot.estado}: no admite nuevos documentos.`);

    // 1. Resultados aprobados.
    const resultados = await this.prisma.resultado.findMany({
      where: { otId, deletedAt: null },
      select: {
        estado: true,
        muestra: { select: { codigo: true } },
        analito: { select: { nombre: true } },
        catAnalito: { select: { nombre: true } },
      },
    });
    faltantes.push(
      ...faltantesParaEmitir(
        resultados.map((r) => ({
          estado: r.estado,
          muestra: r.muestra?.codigo ?? null,
          analito: r.analito?.nombre ?? r.catAnalito?.nombre ?? null,
        })),
        plantilla.tipo,
      ),
    );

    // 2. Control de calidad (el mismo gate de antes, convertido en mensaje).
    try {
      await this.qc.verificarGate(otId, ot.tenantId);
    } catch (e: any) {
      faltantes.push(String(e?.message ?? e));
    }

    // 3 y 4. Laboratorio responsable y matriz de firmas. En una OT interna no
    // hay oficialización (la aprobación administrativa del Jefe de Departamento
    // no aplica): esos pasos se omiten y se informa por qué.
    let pasos: PasoNuevo[] = [];
    let pasosOmitidos: { orden: number; accion: string; rolNombre: string; unidadCodigo: string | null; motivo: string }[] = [];
    const otInterna = esOtInterna(ot.origenTrabajo);
    if (!ot.unidadPrincipal) {
      faltantes.push(
        `La OT ${ot.codigo} no tiene laboratorio responsable asignado: no se puede saber quién debe firmar el documento.`,
      );
    } else {
      const res = await this.matriz.resolver(tipoDocumento, ot.unidadPrincipal, ot.tenantId, { otInterna });
      const r = pasosDesdeMatriz(res);
      pasos = r.pasos;
      pasosOmitidos = (res.omitidos ?? []).map((p) => ({
        orden: p.orden,
        accion: p.accion,
        rolNombre: p.rol.nombre,
        unidadCodigo: p.unidad?.codigo ?? null,
        motivo: p.motivo,
      }));
      faltantes.push(...r.errores);
    }

    // 4b. Documento final de una inspección BPCH: el Certificado de Conformidad
    // solo si la condición final es CUMPLE, el Informe de Incumplimiento solo
    // si es NO CUMPLE, y ambos con el Informe de Inspección ya oficial.
    if (tipoDocumento === "CERTIFICADO_CONFORMIDAD" || tipoDocumento === "INFORME_INCUMPLIMIENTO") {
      const [lotes, informe] = await Promise.all([
        this.prisma.muestra.findMany({ where: { otId, deletedAt: null }, select: { veredicto: true } }),
        this.prisma.certificado.findFirst({
          where: { otId, tipoDocumento: "INFORME_INSPECCION", deletedAt: null, estado: { in: ["oficial", "emitido"] } },
          select: { id: true },
        }),
      ]);
      faltantes.push(
        ...faltantesDocumentoFinal({
          tipoDocumento,
          condicion: condicionFinal(lotes.map((m) => m.veredicto)),
          informeInspeccionOficial: Boolean(informe),
          // El prototipo dictamina sobre los ensayos de su OT (IT10): sin Informe
          // de Inspección previo. Integración de los frentes G1 y G2 (18-10-2026).
          exigeInformePrevio: ot.origenTrabajo !== "PROTOTIPO",
        }),
      );
    }

    // 5. Documento vigente de la misma plantilla (salvo el que se reemplaza).
    const vigentes = await this.prisma.certificado.findMany({
      where: { otId, plantillaId, deletedAt: null, ...(opts.reemplazaId ? { NOT: { id: opts.reemplazaId } } : {}) },
      select: { id: true, numero: true, codigo: true, estado: true },
    });
    const otro = vigentes.find((c) => esVigente(c.estado));
    if (otro)
      faltantes.push(
        `Ya existe el documento ${otro.numero ?? otro.codigo} (${otro.estado === "en_firma" ? "en firma" : "oficial"}) con esta plantilla. ` +
          "Para corregirlo, anúlelo (o pida que lo devuelvan) y reemítalo como nueva versión.",
      );

    return {
      puedeEmitir: faltantes.length === 0,
      faltantes,
      tipoDocumento,
      tipoDocumentoOrigen,
      tipoDocumentoUnidad: tipoDocumentoOrigen === "unidad" ? deUnidad?.unidadCodigo ?? null : null,
      ot: { id: ot.id, codigo: ot.codigo, unidadId: ot.unidadPrincipal },
      plantilla,
      resultados: { total: resultados.length, aprobados: resultados.filter((r) => r.estado === "aprobado").length },
      pasos,
      otInterna,
      pasosOmitidos,
    };
  }

  /**
   * Formato y datos que se proponen para el documento: formato de la
   * plantilla, modalidad sugerida y portada (IVC). Solo lee.
   */
  async propuestaDocumento(otId: string, plantillaId: string, tenantId?: string) {
    const plantilla = await this.prisma.plantillaInforme.findFirst({
      where: { id: plantillaId, ...(tenantId ? { tenantId } : {}) },
      select: { id: true, tipo: true },
    });
    if (!plantilla) throw new NotFoundException(`Plantilla ${plantillaId} no encontrada`);
    const ctx = await this.contexto(otId, tenantId);
    const formato = await this.configDePlantilla(plantilla.id, plantilla.tipo);
    return { formato, ...this.sugerencias(ctx, formato) };
  }

  /* ====================================================================== */
  /* Emisión                                                                */
  /* ====================================================================== */

  /**
   * Emite el documento: comprueba las condiciones, rellena la plantilla, sella
   * con SHA-256, reserva el correlativo y registra el Certificado EN FIRMA con
   * los pasos que resuelve la matriz de firmas para su tipo y laboratorio. El
   * documento no es oficial hasta que firma el último paso (FirmaDocumentoService).
   *
   * El correlativo lo genera el SISTEMA (RF F02.1): ya no lo aporta el llamador.
   * Una REEMISIÓN (opts.reemplazaId) no consume correlativo: conserva el número
   * con el sufijo de versión (CERT-2026-0007-V2) y anula el documento devuelto.
   */
  async emitir(otId: string, plantillaId: string, tenantId: string, usuarioId?: string, opts: OpcionesEmision = {}) {
    let previo: {
      id: string;
      numero: string | null;
      codigo: string;
      version: number;
      estado: string;
      plantillaId: string | null;
      otId: string;
      tipoDocumento: string | null;
    } | null = null;
    if (opts.reemplazaId) {
      previo = await this.prisma.certificado.findFirst({
        where: { id: opts.reemplazaId, tenantId, deletedAt: null },
        select: { id: true, numero: true, codigo: true, version: true, estado: true, plantillaId: true, otId: true, tipoDocumento: true },
      });
      if (!previo) throw new NotFoundException(`Documento ${opts.reemplazaId} no encontrado`);
      if (previo.estado !== "devuelto" && previo.estado !== "anulado")
        throw new ConflictException(
          `Solo se reemite un documento devuelto o anulado; ${previo.numero ?? previo.codigo} está ${previo.estado}.`,
        );
      if (!previo.plantillaId)
        throw new ConflictException(`El documento ${previo.numero ?? previo.codigo} no tiene plantilla: emita uno nuevo.`);
      // La nueva versión es del mismo expediente y la misma plantilla.
      otId = previo.otId;
      plantillaId = previo.plantillaId;
      // La nueva versión conserva la modalidad y los datos del documento
      // (conclusión, portada) salvo que quien reemite indique otros.
      const doc = await this.datosDeDocumento(previo.id);
      opts = {
        ...opts,
        tipoDocumento: opts.tipoDocumento ?? previo.tipoDocumento ?? undefined,
        modalidad: opts.modalidad ?? doc.modalidad ?? undefined,
        datosInforme: opts.datosInforme ?? doc.datos ?? undefined,
      };
      const masNueva = await this.prisma.certificado.findFirst({
        where: { reemplazaId: previo.id, deletedAt: null },
        select: { numero: true, codigo: true },
      });
      if (masNueva)
        throw new ConflictException(`El documento ya fue reemitido como ${masNueva.numero ?? masNueva.codigo}.`);
    }

    // GATE (contrato 4.3.7 / 4.3.8 + flujo estándar): resultados aprobados, QC,
    // laboratorio y matriz de firmas. Se aborta con 409 ANTES de reservar
    // correlativo ni escribir nada, con el detalle de lo que falta.
    const cond = await this.condicionesEmision(otId, plantillaId, tenantId, opts);
    if (!cond.puedeEmitir) {
      throw new ConflictException(`No se puede emitir el documento. ${cond.faltantes.join(" ")}`);
    }

    const fecha = new Date();
    const anio = fecha.getFullYear();
    const codigoVerificacion = nuevoCodigoVerificacion();
    const anterior = previo;

    // La transacción cubre: reservar correlativo -> renderizar con ese número
    // -> insertar documento y pasos de firma. El render va dentro porque el
    // CUERPO IMPRIME el número, así que el hash depende de él.
    const emitido = await this.prisma.$transaction(async (tx) => {
      const version = anterior ? anterior.version + 1 : 1;
      const numero = anterior
        ? numeroVersion(anterior.numero ?? anterior.codigo, version)
        : await this.siguienteNumero(tx, tenantId, anio);

      const { plantilla, ctx, cuerpoRenderizado, hash, avisos, usaDefecto, modalidad } = await this.render(
        otId,
        plantillaId,
        tenantId,
        { numero, codigoVerificacion, fecha },
        { modalidad: opts.modalidad, datos: opts.datosInforme },
      );

      const cert = await tx.certificado.create({
        data: {
          tenantId,
          otId,
          codigo: numero, // UNIQUE(tenant_id, codigo): cierre duro de la unicidad
          numero,
          tipo: plantilla.tipo,
          tipoDocumento: cond.tipoDocumento,
          unidadId: cond.ot.unidadId,
          version,
          reemplazaId: anterior?.id ?? null,
          plantillaId,
          hashSha256: hash,
          codigoVerificacion,
          documentoHtml: cuerpoRenderizado, // sha256(documentoHtml) == hashSha256
          urlVerificacion: `${this.baseVerificacion}/${codigoVerificacion}`,
          emitidoPor: usuarioId ?? null,
          fecha,
          estado: "en_firma",
        },
      });
      // Modalidad y datos propios del documento (columnas de align_informe_ensayo.sql).
      const datosJson = JSON.stringify(opts.datosInforme ?? {});
      await tx.$executeRaw`UPDATE certificado SET modalidad = ${modalidad}, datos_informe = ${datosJson}::jsonb
                            WHERE id = ${cert.id}::uuid`;

      await tx.documentoFirma.createMany({
        data: cond.pasos.map((p) => ({
          tenantId,
          certificadoId: cert.id,
          orden: p.orden,
          accion: p.accion,
          rolCodigo: p.rolCodigo,
          rolNombre: p.rolNombre,
          unidadId: p.unidadId,
          unidadCodigo: p.unidadCodigo,
          unidadNombre: p.unidadNombre,
          obligatorio: p.obligatorio,
          descripcion: p.descripcion,
          responsables: p.responsables as any,
        })),
      });

      // Reemisión desde un documento devuelto: el devuelto queda anulado; la
      // nueva versión apunta a él por reemplaza_id.
      if (anterior && anterior.estado === "devuelto") {
        await tx.certificado.update({
          where: { id: anterior.id },
          data: {
            estado: "anulado",
            anuladoAt: fecha,
            anuladoPor: usuarioId ?? null,
            anuladoMotivo: `Sustituido por la versión ${version} (${numero}).`,
          },
        });
        await tx.documentoFirma.updateMany({
          where: { certificadoId: anterior.id, estado: "pendiente" },
          data: { estado: "anulado" },
        });
      }

      return { cert, plantilla, otCodigo: ctx.ot.codigo, cuerpoRenderizado, hash, avisos, usaDefecto, modalidad };
    });

    const sello = await this.selloDe(emitido.cert.id);

    return {
      certificado: emitido.cert,
      numero: emitido.cert.numero,
      codigoVerificacion,
      hash: emitido.hash,
      urlVerificacion: emitido.cert.urlVerificacion,
      estado: emitido.cert.estado,
      tipoDocumento: cond.tipoDocumento,
      modalidad: emitido.modalidad,
      pasos: cond.pasos,
      pasosOmitidos: cond.pasosOmitidos,
      usaPlantillaPorDefecto: emitido.usaDefecto,
      avisos: emitido.avisos,
      html: documentoCompleto(
        emitido.cuerpoRenderizado,
        sello,
        this.titulo(sello.numero, emitido.plantilla.nombre, emitido.otCodigo),
      ),
    };
  }

  /** Modalidad y datos guardados de un documento (NULL en los anteriores a esta versión). */
  async datosDeDocumento(certificadoId: string): Promise<{ modalidad: Modalidad | null; datos: DatosInforme | null }> {
    try {
      const f = await this.prisma.$queryRaw<{ modalidad: string | null; datos_informe: unknown }[]>`
        SELECT modalidad, datos_informe FROM certificado WHERE id = ${certificadoId}::uuid`;
      const m = f[0]?.modalidad;
      return {
        modalidad: m === "cumplimiento" || m === "solo_resultados" ? m : null,
        datos: (f[0]?.datos_informe as DatosInforme) ?? null,
      };
    } catch {
      return { modalidad: null, datos: null };
    }
  }

  /**
   * Sello de presentación de un documento: número, código, hash, ESTADO del
   * circuito y FIRMAS (firmadas y pendientes). Lo usan el PDF y el HTML.
   */
  async selloDe(certificadoId: string): Promise<Sello> {
    const cert = await this.prisma.certificado.findUnique({
      where: { id: certificadoId },
      include: { firmas: { orderBy: [{ orden: "asc" }, { createdAt: "asc" }] } },
    });
    if (!cert) throw new NotFoundException(`Certificado ${certificadoId} no encontrado`);
    const firmas: FirmaEstampada[] = cert.firmas
      .filter((f) => f.estado === "firmado" || f.estado === "pendiente")
      .map((f) => ({
        accion: f.accion,
        rol: f.rolNombre ?? f.rolCodigo,
        unidad: f.unidadCodigo,
        nombre:
          f.estado === "firmado"
            ? f.firmanteNombre
            : (Array.isArray(f.responsables) ? (f.responsables as any[]) : [])
                .map((r) => r?.nombre)
                .filter(Boolean)
                .join(" / "),
        cargo: f.estado === "firmado" ? [f.firmanteGrado, f.firmanteCargo].filter(Boolean).join(" ") || null : null,
        fecha: f.firmadoAt ? fmtFechaHora(f.firmadoAt) : null,
        imagen: f.imagenData
          ? { data: f.imagenData, mime: f.imagenData.startsWith("/9j/") ? "image/jpeg" : "image/png" }
          : null,
        pendiente: f.estado !== "firmado",
      }));
    return {
      numero: cert.numero ?? cert.codigo,
      codigoVerificacion: cert.codigoVerificacion ?? "—",
      hash: cert.hashSha256 ?? "",
      fecha: fmtFecha(cert.oficialAt ?? cert.fecha),
      urlVerificacion: cert.urlVerificacion ?? this.baseVerificacion,
      estadoDocumento: esOficial(cert.estado) ? undefined : cert.estado,
      motivoEstado:
        cert.estado === "anulado" ? cert.anuladoMotivo : cert.estado === "devuelto" ? cert.devueltoMotivo : null,
      firmas: firmas.length ? firmas : undefined,
    };
  }

  /* ====================================================================== */
  /* Descarga                                                               */
  /* ====================================================================== */

  /**
   * Unidad del documento (la suya o la del laboratorio de la OT) y quiénes son
   * responsables de algún paso de su firma: lo que decide quién lo puede abrir.
   */
  async alcanceDocumento(certificadoId: string, tenantId?: string) {
    const cert = await this.prisma.certificado.findFirst({
      where: { id: certificadoId, deletedAt: null, ...(tenantId ? { tenantId } : {}) },
      select: { numero: true, codigo: true, unidadId: true, ot: { select: { unidadPrincipal: true } }, firmas: { select: { responsables: true } } },
    });
    if (!cert) throw new NotFoundException(`Certificado ${certificadoId} no encontrado`);
    const responsables = cert.firmas.flatMap((f) => (Array.isArray(f.responsables) ? (f.responsables as any[]) : []).map((r) => r?.usuarioId)).filter(Boolean);
    return { etiqueta: cert.numero ?? cert.codigo, unidadId: cert.unidadId ?? cert.ot?.unidadPrincipal ?? null, responsables: responsables as string[] };
  }

  /** Carga un certificado validando tenant (404 en cross-tenant, no 403). */
  private async certificadoDelTenant(certificadoId: string, tenantId?: string) {
    const cert = await this.prisma.certificado.findUnique({
      where: { id: certificadoId },
      include: { plantilla: true, ot: true },
    });
    if (!cert || cert.deletedAt) throw new NotFoundException(`Certificado ${certificadoId} no encontrado`);
    if (tenantId && cert.tenantId !== tenantId)
      throw new NotFoundException(`Certificado ${certificadoId} no encontrado`);
    return cert;
  }

  /**
   * PDF del certificado emitido, generado a partir del HTML SELLADO que se
   * guardó al emitir. No se re-renderiza: el PDF de hoy y el de dentro de un año
   * son el mismo documento aunque la OT haya cambiado.
   */
  async pdf(certificadoId: string, tenantId?: string) {
    const cert = await this.certificadoDelTenant(certificadoId, tenantId);
    if (!cert.documentoHtml)
      throw new NotFoundException(
        `El certificado ${cert.numero ?? cert.codigo} se emitió antes de que se guardara el documento sellado y no puede regenerarse. Emita uno nuevo.`,
      );

    const sello = await this.selloDe(cert.id);
    const titulo = this.titulo(sello.numero, cert.plantilla?.nombre ?? "Informe", cert.ot?.codigo ?? "");
    const buffer = await generarPdf(cert.documentoHtml, sello, titulo);
    // Nombre de fichero seguro: el correlativo es [A-Z0-9-], sin ruta ni comillas.
    const nombre = `${sello.numero.replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`;
    return { buffer, nombre };
  }

  /** Mismo documento en HTML imprimible (`@media print` A4), por si se prefiere al PDF. */
  async html(certificadoId: string, tenantId?: string) {
    const cert = await this.certificadoDelTenant(certificadoId, tenantId);
    if (!cert.documentoHtml)
      throw new NotFoundException(`El certificado ${cert.numero ?? cert.codigo} no tiene documento sellado.`);
    const sello = await this.selloDe(cert.id);
    return documentoCompleto(
      cert.documentoHtml,
      sello,
      this.titulo(sello.numero, cert.plantilla?.nombre ?? "Informe", cert.ot?.codigo ?? ""),
    );
  }

  /* ====================================================================== */
  /* Verificación pública                                                   */
  /* ====================================================================== */

  /**
   * Valida un certificado impreso por su código de verificación (endpoint
   * PÚBLICO, sin token).
   *
   * Devuelve SOLO lo que ya está impreso en el papel que tiene delante quien
   * verifica: número, fecha, código de OT y hash. Nunca cliente, RUT, resultados
   * ni ids internos — el endpoint es anónimo y no debe convertirse en un oráculo
   * de datos del expediente.
   *
   * `valido:false` sin más detalle para un código inexistente: no se distingue
   * "no existe" de "mal tecleado" (no se confirma la existencia de correlativos).
   *
   * El hash se RECALCULA sobre el documento sellado en lugar de leer la columna:
   * así el endpoint detecta también una manipulación de `hash_sha256` en la BD.
   */
  async verificar(codigo: string) {
    const limpio = codigo.trim().toUpperCase();
    if (!/^[0-9A-Z-]{5,24}$/.test(limpio)) return { valido: false as const };

    const cert = await this.prisma.certificado.findFirst({
      where: { codigoVerificacion: limpio, deletedAt: null },
      include: { ot: { select: { codigo: true } } },
    });
    if (!cert) return { valido: false as const };

    // Solo vale un documento OFICIAL (firmado en todos los pasos de la matriz)
    // o uno emitido antes del circuito ('emitido'). En firma, devuelto o
    // anulado: el papel existe pero no tiene validez.
    if (!esOficial(cert.estado))
      return {
        valido: false as const,
        estado: cert.estado,
        numero: cert.numero ?? cert.codigo,
        fecha: fmtFecha(cert.fecha),
        motivo:
          cert.estado === "en_firma"
            ? "El documento está en proceso de firma: todavía no es oficial."
            : cert.estado === "devuelto"
              ? "El documento fue devuelto sin firmar."
              : "El documento fue anulado.",
      };

    const hashReal = cert.documentoHtml
      ? createHash("sha256").update(cert.documentoHtml, "utf8").digest("hex")
      : null;
    const integro = hashReal !== null && hashReal === cert.hashSha256;

    return {
      valido: integro,
      estado: cert.estado,
      numero: cert.numero ?? cert.codigo,
      fecha: fmtFecha(cert.oficialAt ?? cert.fecha),
      otCodigo: cert.ot?.codigo ?? null,
      hash: cert.hashSha256 ?? null,
      ...(integro ? {} : { motivo: "El sello de integridad del documento no coincide" }),
    };
  }
}
