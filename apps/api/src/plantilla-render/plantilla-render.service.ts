import { portadaDesdeEncargo } from "../ot/encargo/reglas-encargo";
import { nombreItemInspeccion } from "../especificacion-tecnica/reglas-et";
import { observacionConDecision } from "../laboratorio/veredicto-decidido";
import { etiquetaVeredicto } from "../laboratorio/veredicto";
import { Injectable, NotFoundException, ConflictException, BadRequestException } from "@nestjs/common";
import { createHash } from "crypto";
import { PrismaService } from "../common/prisma.service";
import { nuevoCodigoVerificacion } from "../common/codigo-verificacion";
import { renderizar, tablaMuestras, tablaInspeccion, type FilaMuestra, type FilaInspeccion } from "./template.engine";
import { condicionFinal, faltantesDocumentoFinal, TEXTO_CONDICION } from "../bpch/comun/reglas-bpch";
import { fmtFecha, fmtFechaHora } from "./html.util";
import { atencionInforme } from "./atencion";
import { antecedentesInforme, datosRecepcionInforme } from "./antecedentes-informe";
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
  NOMBRE_TIPO_DOCUMENTO,
  numeroVersion,
  pasosDesdeMatriz,
  tipoDocumentoPorDefecto,
  type PasoNuevo,
} from "./reglas-emision";
import { configEfectiva, configPorTipo, type ConfigInforme } from "./config-informe";
import { NumeracionService } from "./numeracion.service";
import { numeroGeneral } from "./numeracion";
import {
  documentoEnConflicto,
  erroresCobertura,
  motivoNoEmitido,
  normalizarCobertura,
  type CoberturaDoc,
} from "./cobertura-documento";
import { etiquetaDe, hechosCobertura, resultadosCubiertos } from "./cobertura-ot";
import { otEsBpch, vistaCabecera } from "../bpch/cabecera/cabecera-ot";
import { faltantesParaEmitirInspeccion } from "../bpch/cabecera/reglas-cabecera";
import { escapeHtml } from "./html.util";
import { camposDeLaboratorio } from "../recepcion/reglas-recepcion";
import {
  armarInforme,
  filaInspeccion,
  filasMetodos,
  modalidadInicial,
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
  bloqueProductoTerminado,
  bloqueReferencias,
  bloqueResultados,
  completarCuerpo,
  type DatosPortada,
  type FotoInforme,
  type IdentificacionMuestra,
} from "./bloques-informe";
import { anioChile } from "../common/fecha-chile";
import { leerCondicion2 } from "../laboratorio/requisito-compuesto";
import { urlVerificacionBase } from "../common/url-verificacion";

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
  /** Documento que se renderiza: qué muestras cubre y su código de verificación (certificado por arma, D11). */
  documento?: DocumentoEnRender,
) => Promise<{ datos?: Record<string, unknown>; bloques?: Record<string, string> } | null>;

export interface DocumentoEnRender {
  /** Muestras que cubre el documento (null = toda la OT). */
  muestraIds: string[] | null;
  numero: string;
  codigoVerificacion: string;
  urlVerificacion: string;
  fecha: Date;
}

/** Datos públicos extra de la verificación de un tipo de documento (sin datos personales). */
export type VerificacionExtra = (certificadoId: string) => Promise<Record<string, unknown> | null>;

/** Opciones de emisión: tipo de documento de la matriz y documento al que reemplaza. */
export interface OpcionesEmision {
  tipoDocumento?: string;
  /** Reemisión: id del documento devuelto o anulado que se sustituye (nueva versión). */
  reemplazaId?: string;
  /** Informe de cumplimiento o de solo resultados (por defecto, el sugerido). */
  modalidad?: Modalidad;
  datosInforme?: DatosInforme;
  /**
   * Qué cubre el documento (docs/FLUJO_DOCUMENTOS_POR_OT.md): toda la OT (por
   * defecto), una muestra, un producto (sus muestras) o un laboratorio.
   */
  cobertura?: { cobertura?: string | null; muestraIds?: string[] | null; unidadId?: string | null } | null;
}

/** Subconjunto de la OT que imprime un documento (null = todo). */
export interface FiltroDocumento {
  muestraIds: Set<string> | null;
  resultadoIds: Set<string> | null;
  /** Texto de la cobertura ({{documento.cobertura}}). */
  etiqueta: string | null;
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
    private readonly numeracion: NumeracionService,
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

  /**
   * Condiciones de emisión aportadas por otros módulos (p. ej. el CRB solo si el
   * lote del LRB cumple): cada validador devuelve los faltantes de su tipo.
   */
  private readonly validadores: ((otId: string, tipoDocumento: string, tenantId: string) => Promise<string[]>)[] = [];
  registrarValidadorEmision(v: (otId: string, tipoDocumento: string, tenantId: string) => Promise<string[]>) {
    this.validadores.push(v);
  }

  /** Verificación pública: datos extra por tipo de documento (p. ej. vigencia del certificado por arma). */
  private readonly verificaciones = new Map<string, VerificacionExtra>();
  registrarVerificacion(tipoDocumento: string, extra: VerificacionExtra) {
    this.verificaciones.set(tipoDocumento, extra);
  }

  /** URL de verificación de un código (la que se imprime y la del QR). */
  urlVerificacionDe(codigo: string): string {
    return `${this.baseVerificacion}/${codigo}`;
  }

  /** URL pública de verificación; configurable por despliegue. */
  private get baseVerificacion(): string {
    return urlVerificacionBase();
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
  async contexto(otId: string, tenantId?: string, filtro: FiltroDocumento | null = null) {
    const ot = await this.prisma.ordenTrabajo.findUnique({
      where: { id: otId },
      include: { cliente: true },
    });
    if (!ot) throw new NotFoundException(`OT ${otId} no encontrada`);
    if (tenantId && ot.tenantId !== tenantId) throw new NotFoundException(`OT ${otId} no encontrada`);

    // Un documento por muestra, producto o laboratorio imprime solo lo que cubre.
    const todasMuestras = await this.prisma.muestra.findMany({
      where: { otId, deletedAt: null },
      include: { tipoMuestra: true },
      orderBy: { codigo: "asc" },
    });
    const todosResultados = await this.prisma.resultado.findMany({
      where: { otId, deletedAt: null },
      include: {
        analito: true,
        muestra: true,
        catAnalito: { select: { nombre: true, unidad: true } },
        catMetodo: { select: { nombre: true, norma: true } },
      },
      orderBy: [{ fecha: "asc" }, { id: "asc" }],
    });
    const resultados = filtro?.resultadoIds ? todosResultados.filter((r) => filtro.resultadoIds!.has(r.id)) : todosResultados;
    const conResultado = new Set(resultados.map((r) => r.muestraId));
    const muestras = filtro?.muestraIds
      ? todasMuestras.filter((m) => filtro.muestraIds!.has(m.id))
      : filtro?.resultadoIds
        ? todasMuestras.filter((m) => conResultado.has(m.id))
        : todasMuestras;

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
    const derivados = await this.derivadosDe(otId);
    // B-033: los ítems del checklist sin ensayo del catálogo se imprimen con su punto de la E.T.
    const puntosSinEnsayo = [...new Set(resultados.filter((r) => !r.catMetodoId && !r.catAnalitoId && !r.analitoId && r.etPuntoId).map((r) => r.etPuntoId!))];
    const nombrePunto = new Map<string, string>(
      puntosSinEnsayo.length
        ? (await this.prisma.$queryRawUnsafe<{ id: string; punto: string; caracteristica: string; requisito: string | null }[]>(
            `SELECT id, punto, caracteristica, requisito FROM especificacion_tecnica_punto WHERE id = ANY($1::uuid[])`,
            puntosSinEnsayo,
          )).map((p) => [p.id, nombreItemInspeccion(p)])
        : [],
    );
    // B-032: nombre del revisor que decidió el veredicto a mano (se anota en la observación).
    const decisores = [...new Set(resultados.map((r) => r.veredictoDecididoPor).filter((x): x is string => !!x))];
    const nombreDecisor = new Map(
      decisores.length
        ? (await this.prisma.usuario.findMany({ where: { id: { in: decisores } }, select: { id: true, nombreCompleto: true } })).map((u) => [u.id, u.nombreCompleto])
        : [],
    );
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
        ensayo: r.catAnalito?.nombre ?? r.analito?.nombre ?? (r.etPuntoId ? nombrePunto.get(r.etPuntoId) ?? null : null),
        metodoNombre: r.catMetodo?.nombre ?? null,
        metodoNorma: r.catMetodo?.norma ?? null,
        unidad: r.unidad ?? r.catAnalito?.unidad ?? r.analito?.unidad ?? legado?.unidad ?? null,
        limiteInf: legado ? txt(legado.limiteInf) : r.limiteInf,
        nominal: legado ? txt(legado.nominal) : r.nominal,
        limiteSup: legado ? txt(legado.limiteSup) : r.limiteSup,
        requisito: r.requisito,
        especOrigen: legado ? "catalogo" : r.especOrigen,
        condicion2: legado ? null : leerCondicion2(r.condicion2),
        valorCondicion2: num(r.valorCondicion2),
        derivadoA: derivados.get(r.id) ?? null,
        tipoDato: r.tipoDato,
        valorNumerico: num(r.valorNumerico),
        valorTexto: r.valorTexto,
        resultadoFinal: num(r.resultadoFinal),
        promedio: num(r.promedio),
        desviacion: num(r.desviacion),
        cv: num(r.cv),
        nReplicas: replicas,
        observacion: observacionConDecision(r.observacion, r.veredictoMotivo, r.veredictoDecididoPor ? nombreDecisor.get(r.veredictoDecididoPor) : null),
        veredicto: r.veredicto,
        fechaEnsayo: r.fechaEnsayo ?? null,
        selloNumero: (r.muestra as any)?.selloNumero ?? null,
        seccion: u?.seccion ?? null,
        componente: u?.componente ?? null,
        orden: u?.orden ?? null,
      };
    });

    const bpch = await this.cabeceraBpch(otId, muestras);
    const identificacion = await this.identificacionMuestras(ot.tenantId, ot.unidadPrincipal, muestras, ot.clienteId);
    // «Atención»: el solicitante de la OT o, si no lo trae, el contacto principal del cliente (D02-30).
    const contactoPrincipal = ot.solicitante?.trim() || ot.cliente?.contactoNombre?.trim() || !ot.clienteId
      ? null
      : await this.prisma.contacto.findFirst({
          where: { clienteId: ot.clienteId, principal: true, deletedAt: null },
          select: { nombre: true, cargo: true },
          orderBy: { createdAt: "asc" },
        });
    const atencion = atencionInforme({ solicitanteOt: ot.solicitante, fichaCliente: ot.cliente, contactoPrincipal });
    const organigrama = await this.organigramaDe(ot.unidadPrincipal);
    // Punto 1 del Informe de Ensayos (Alimentos, Anexo 02-02): muestreo, recepción, análisis, temperatura.
    const antecedentes = antecedentesInforme(muestras, resultados.map((r) => r.fechaEnsayo), ot, ot.cliente);
    return { ot, cliente: ot.cliente, muestras, resultados, limitePorAnalito, paraInforme, bpch, identificacion, cobertura: filtro?.etiqueta ?? null, atencion, organigrama, antecedentes };
  }

  /** Ensayos de la OT derivados a otro laboratorio por orden interna (lims_lab_de_resultado). */
  private async derivadosDe(otId: string): Promise<Map<string, { laboratorio: string; ordenInterna: string | null }>> {
    try {
      const f = await this.prisma.$queryRawUnsafe<{ id: string; codigo: string; oi: string | null }[]>(
        `SELECT r.id, u.codigo, l.oi_numero AS oi
           FROM resultado r CROSS JOIN LATERAL lims_lab_de_resultado(r.id) l JOIN unidad u ON u.id = l.unidad_id
          WHERE r.ot_id = $1::uuid AND r.deleted_at IS NULL AND l.derivado AND l.unidad_id IS DISTINCT FROM l.principal_id`,
        otId,
      );
      return new Map(f.map((x) => [x.id, { laboratorio: x.codigo, ordenInterna: x.oi }]));
    } catch {
      return new Map(); // BD sin align_r1g_recorrido.sql
    }
  }

  /**
   * Laboratorio, sección y departamento de la OT para el membrete
   * ({{unidad.nombre}}, {{seccion.nombre}}, {{departamento.nombre}}; B-026 / B-075).
   */
  private async organigramaDe(unidadId: string | null) {
    const vacio = { codigo: "", nombre: "" };
    const r = { unidad: vacio, seccion: vacio, departamento: vacio };
    if (!unidadId) return r;
    try {
      const filas = await this.prisma.$queryRawUnsafe<{ codigo: string; nombre: string; tipo: string; nivel: number }[]>(
        `WITH RECURSIVE cadena AS (
           SELECT id, padre_id, codigo, nombre, tipo, 0 AS nivel FROM unidad WHERE id = $1::uuid
           UNION ALL
           SELECT u.id, u.padre_id, u.codigo, u.nombre, u.tipo, c.nivel + 1 FROM unidad u JOIN cadena c ON u.id = c.padre_id WHERE c.nivel < 20)
         SELECT codigo, nombre, tipo, nivel FROM cadena ORDER BY nivel`,
        unidadId,
      );
      const de = (tipo: string) => filas.find((f) => f.tipo === tipo);
      const f0 = filas[0];
      return {
        unidad: f0 ? { codigo: f0.codigo, nombre: f0.nombre } : vacio,
        seccion: de("SECCION") ? { codigo: de("SECCION")!.codigo, nombre: de("SECCION")!.nombre } : vacio,
        departamento: de("DEPARTAMENTO") ? { codigo: de("DEPARTAMENTO")!.codigo, nombre: de("DEPARTAMENTO")!.nombre } : vacio,
      };
    } catch {
      return r;
    }
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
      identificacionCliente: string | null; datosRecepcion?: unknown; ubicacion?: string | null;
      temperaturaRecepcion?: unknown; fechaTomaMuestra?: Date | null; formularioMuestreo?: string | null }[],
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
        // Temperatura de llegada, toma y formulario de muestreo (EP-02 1.1-1.2).
        datos.push(...datosRecepcionInforme(m));
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
    // B-087: sin estructura escrita, el ensayo de una submuestra va con el componente que ya
    // sabe la submuestra (desglose de la E.T.); no hay que escribirlo a mano.
    const deSubmuestra = await this.prisma.$queryRaw<{ id: string; componente: string }[]>`
      SELECT r.id, m.et_componente AS componente
        FROM resultado r JOIN muestra m ON m.id = r.muestra_id
       WHERE COALESCE(r.ot_id, m.ot_id) = ${otId}::uuid AND r.deleted_at IS NULL
         AND m.parent_muestra_id IS NOT NULL AND COALESCE(m.et_componente, '') <> ''`;
    for (const f of deSubmuestra) {
      const u = mapa.get(f.id);
      if (!u) mapa.set(f.id, { seccion: null, componente: f.componente, orden: null });
      else if (!u.componente) mapa.set(f.id, { ...u, componente: f.componente });
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
        // «Atención» de los cuerpos sembrados ({{ot.solicitante}}): OT o contacto principal del cliente.
        solicitante: ctx.atencion,
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
      atencion: ctx.atencion,
      // Muestreo, recepción, análisis, temperatura, formulario y contacto ({{antecedentes.*}}).
      antecedentes: ctx.antecedentes,
      fecha: fmtFecha(cert.fecha),
      fecha_hora: fmtFechaHora(cert.fecha),
      // Documentos BPCH: cabecera del expediente (vacía en las demás OT).
      bpch: ctx.bpch ?? {},
      // Qué cubre el documento (vacío si cubre toda la OT).
      documento: { cobertura: ctx.cobertura ?? "" },
      anio: String(anioChile(cert.fecha)),
      n_muestras: String(muestras.length),
      n_resultados: String(resultados.length),
      laboratorio: ot.subdireccionAsignada ?? "",
      unidad: ctx.organigrama.unidad,
      seccion: ctx.organigrama.seccion,
      departamento: ctx.organigrama.departamento,

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
  sugerencias(ctx: Awaited<ReturnType<PlantillaRenderService["contexto"]>>, cfg: ConfigInforme, encargo: Record<string, string | null> = {}) {
    const { ot } = ctx;
    const unaMuestra = ctx.muestras.length === 1 ? ctx.muestras[0] : null;
    return {
      modalidad: modalidadInicial(cfg, ctx.paraInforme),
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
              // Datos del encargo de la OT (contrato o lote, BL-161) precargan la portada.
              ...encargo,
            }
          : null,
    };
  }

  /** Portada del IVC desde los datos del encargo de la OT (ot_encargo, frente r4d). */
  private async portadaEncargo(otId: string): Promise<Record<string, string | null>> {
    const f = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT contrato, to_char(contrato_fecha, 'YYYY-MM-DD') AS "contratoFecha", proyecto, proveedor, fabricante,
              pais_origen AS "paisOrigen", item, cantidad::float8 AS cantidad, unidad_cantidad AS "unidadCantidad"
         FROM ot_encargo WHERE ot_id = $1::uuid`,
      otId,
    ).catch(() => []);
    return portadaDesdeEncargo(f[0] ?? null, (d) => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`);
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
    opciones: { modalidad?: Modalidad; datos?: DatosInforme; filtro?: FiltroDocumento | null } = {},
  ) {
    const plantilla = await this.prisma.plantillaInforme.findUnique({ where: { id: plantillaId } });
    if (!plantilla) throw new NotFoundException(`Plantilla ${plantillaId} no encontrada`);
    if (tenantId && plantilla.tenantId !== tenantId)
      throw new NotFoundException(`Plantilla ${plantillaId} no encontrada`);

    const ctx = await this.contexto(otId, tenantId, opciones.filtro ?? null);
    const cfg = await this.configDePlantilla(plantilla.id, plantilla.tipo);
    const modalidad = opciones.modalidad ?? modalidadInicial(cfg, ctx.paraInforme);
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
      producto_terminado: bloqueProductoTerminado((datosDoc as any).productoTerminado, cfg),
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
      const extra = await proveedor(
        otId,
        tenantId,
        { id: plantilla.id, repid: plantilla.repid },
        {
          muestraIds: opciones.filtro?.muestraIds ? [...opciones.filtro.muestraIds] : null,
          numero: cert.numero,
          codigoVerificacion: cert.codigoVerificacion,
          urlVerificacion: this.urlVerificacionDe(cert.codigoVerificacion),
          fecha: cert.fecha,
        },
      );
      if (!extra) continue;
      if (extra.datos && !(clave in datos)) datos[clave] = extra.datos;
      for (const [k, v] of Object.entries(extra.bloques ?? {})) if (!(k in bloques)) bloques[k] = v;
    }
    const { html: cuerpoRenderizado, faltantes } = renderizar(cuerpo, datos, bloques);

    if (faltantes.length)
      avisos.push(`Placeholders sin dato en el expediente (se emiten vacíos): ${faltantes.join(", ")}.`);
    if (ctx.resultados.length === 0)
      avisos.push("La OT no tiene resultados registrados: la tabla de resultados sale vacía.");
    if (ctx.cobertura)
      avisos.push(`Documento de una parte de la OT: ${ctx.cobertura}. Imprime solo sus muestras y resultados.`);
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
   * Cobertura del documento validada contra la OT (docs/FLUJO_DOCUMENTOS_POR_OT.md):
   * qué muestras y resultados imprime, con qué laboratorio se resuelven sus
   * firmas y su número, y la primera muestra (para {MUESTRA} del número).
   */
  async resolverCobertura(otId: string, tenantId: string, pedida: OpcionesEmision["cobertura"]) {
    const cob = normalizarCobertura(pedida);
    const hechos = await hechosCobertura(this.prisma, otId, tenantId);
    const errores = erroresCobertura(cob, { muestras: hechos.muestras, laboratorios: hechos.laboratorios.map((l) => l.id) });
    const etiqueta = cob.cobertura === "ot" ? null : etiquetaDe(cob, hechos);
    const resultadoIds = resultadosCubiertos(cob, hechos);
    const filtro: FiltroDocumento | null =
      cob.cobertura === "ot"
        ? null
        : { muestraIds: cob.cobertura === "laboratorio" ? null : new Set(cob.muestraIds), resultadoIds, etiqueta };
    const primera =
      cob.cobertura === "muestra" || cob.cobertura === "producto"
        ? hechos.muestras.find((m) => cob.muestraIds.includes(m.id))
        : cob.cobertura === "laboratorio"
          ? hechos.muestras.find((m) => [...(resultadoIds ?? [])].some((r) => hechos.muestraDe.get(r) === m.id))
          : hechos.muestras[0];
    return {
      cob,
      hechos,
      errores,
      etiqueta,
      filtro,
      resultadoIds,
      /** Unidad con que se resuelven firmas y número: la cubierta si es por laboratorio. */
      unidadDocumento: cob.cobertura === "laboratorio" ? cob.unidadId : hechos.principal,
      muestraCodigo: primera?.codigo ?? null,
    };
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
    opciones: { modalidad?: Modalidad; datos?: DatosInforme; cobertura?: OpcionesEmision["cobertura"]; tipoDocumento?: string } = {},
  ) {
    const fecha = new Date();
    if (opciones.tipoDocumento && !(TIPOS_DOCUMENTO as readonly string[]).includes(opciones.tipoDocumento))
      throw new BadRequestException(`tipoDocumento inválido. Valores: ${TIPOS_DOCUMENTO.join(", ")}`);
    const cob = tenantId ? await this.resolverCobertura(otId, tenantId, opciones.cobertura) : null;
    if (cob?.errores.length) throw new BadRequestException(cob.errores.join(" "));
    const cert = {
      numero: await this.numeroBorrador(otId, plantillaId, tenantId, fecha, cob, opciones.tipoDocumento ?? null),
      codigoVerificacion: "SIN EMITIR",
      fecha,
    };
    const { plantilla, ctx, cuerpoRenderizado, hash, avisos, usaDefecto, modalidad } = await this.render(
      otId,
      plantillaId,
      tenantId,
      cert,
      { modalidad: opciones.modalidad, datos: opciones.datos, filtro: cob?.filtro ?? null },
    );

    const sello: Sello = {
      numero: cert.numero,
      codigoVerificacion: cert.codigoVerificacion,
      hash,
      fecha: fmtFecha(fecha),
      urlVerificacion: this.baseVerificacion,
      borrador: true,
      // B-026 / B-075: la vista previa muestra las firmas del circuito que tendrá el documento
      // (matriz de firmas de su tipo y laboratorio), no las líneas fijas de la plantilla.
      firmas: await this.firmasPrevistas(otId, plantillaId, tenantId, cob, opciones.tipoDocumento ?? null),
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

  /**
   * Firmas que tendrá el documento según la matriz (todas pendientes), para la
   * vista previa. Si la matriz no resuelve pasos, undefined: se dejan las de la plantilla.
   */
  private async firmasPrevistas(
    otId: string,
    plantillaId: string,
    tenantId: string | undefined,
    cob: { unidadDocumento: string | null } | null,
    indicado: string | null,
  ): Promise<FirmaEstampada[] | undefined> {
    try {
      const [ot, plantilla] = await Promise.all([
        this.prisma.ordenTrabajo.findFirst({ where: { id: otId, ...(tenantId ? { tenantId } : {}) }, select: { unidadPrincipal: true, tenantId: true, origenTrabajo: true } }),
        this.prisma.plantillaInforme.findFirst({ where: { id: plantillaId }, select: { tipo: true, repid: true, tipoDocumento: true } }),
      ]);
      if (!ot || !plantilla) return undefined;
      const unidad = cob ? cob.unidadDocumento : ot.unidadPrincipal;
      if (!unidad) return undefined;
      const deUnidad = await this.tipoDocumentoDeUnidad(unidad);
      const { tipo } = tipoDocumentoPorDefecto({ indicado, tipoPlantilla: plantilla.tipo, repid: plantilla.repid, tipoDePlantilla: plantilla.tipoDocumento, tipoUnidad: deUnidad?.tipo ?? null });
      const res = await this.matriz.resolver(tipo, unidad, ot.tenantId, { otInterna: esOtInterna(ot.origenTrabajo) });
      if (!res.pasos.length) return undefined;
      return res.pasos.map((p) => ({
        accion: p.accion,
        rol: p.rol.nombre,
        unidad: p.unidad?.codigo ?? null,
        nombre: p.responsables.map((r) => r.nombre).filter(Boolean).join(" / ") || null,
        pendiente: true,
      }));
    } catch {
      return undefined;
    }
  }

  /**
   * Número que se imprime en la vista previa: el que tendría el documento con
   * la numeración de su laboratorio, marcado «BORRADOR» (no reserva nada).
   */
  private async numeroBorrador(
    otId: string,
    plantillaId: string,
    tenantId: string | undefined,
    fecha: Date,
    cob: { unidadDocumento: string | null; muestraCodigo: string | null } | null = null,
    /** Tipo elegido en la pantalla; sin él, el de la plantilla o la unidad (igual que al emitir). */
    indicado: string | null = null,
  ): Promise<string> {
    const general = `CERT-${anioChile(fecha)}-XXXX`;
    try {
      const [ot, plantilla, primera] = await Promise.all([
        this.prisma.ordenTrabajo.findFirst({ where: { id: otId, ...(tenantId ? { tenantId } : {}) }, select: { codigo: true, unidadPrincipal: true, tenantId: true } }),
        this.prisma.plantillaInforme.findFirst({ where: { id: plantillaId }, select: { tipo: true, repid: true, tipoDocumento: true } }),
        this.prisma.muestra.findFirst({ where: { otId, deletedAt: null }, orderBy: { codigo: "asc" }, select: { codigo: true } }),
      ]);
      if (!ot || !plantilla) return general;
      const unidad = cob ? cob.unidadDocumento : ot.unidadPrincipal;
      const deUnidad = await this.tipoDocumentoDeUnidad(unidad);
      const { tipo } = tipoDocumentoPorDefecto({ indicado, tipoPlantilla: plantilla.tipo, repid: plantilla.repid, tipoDePlantilla: plantilla.tipoDocumento, tipoUnidad: deUnidad?.tipo ?? null });
      const p = await this.numeracion.proximo({
        tenantId: ot.tenantId,
        unidadId: unidad,
        tipo,
        fecha,
        ot: ot.codigo,
        muestra: cob ? cob.muestraCodigo : primera?.codigo ?? null,
        numInforme: await this.numeroInformeInspeccion(otId),
      });
      return p.numero ? `${p.numero} (BORRADOR)` : general;
    } catch {
      return general;
    }
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
    return numeroGeneral(anio, n);
  }

  /** Número del Informe de Inspección vigente de la OT (para {NUM_INFORME}). */
  private async numeroInformeInspeccion(otId: string, db: any = this.prisma): Promise<string | null> {
    const inf = await db.certificado.findFirst({
      where: { otId, tipoDocumento: "INFORME_INSPECCION", deletedAt: null, estado: { in: ["oficial", "emitido", "en_firma"] } },
      orderBy: { createdAt: "desc" },
      select: { numero: true, codigo: true },
    });
    return inf?.numero ?? inf?.codigo ?? null;
  }

  /**
   * Número oficial del documento (docs/FLUJO_NUMERACION_DOCUMENTOS.md): el de
   * la regla del laboratorio y tipo de documento (numeracion_documento); si no
   * hay regla o al formato le falta un dato, la numeración general
   * CERT-AAAA-NNNN, con un aviso.
   */
  private async numeroOficial(
    tx: any,
    d: { tenantId: string; unidadId: string | null; tipoDocumento: string; fecha: Date; otId: string; otCodigo: string; muestraCodigo: string | null },
  ): Promise<{ numero: string; aviso: string | null; formato: string | null }> {
    const numInforme = await this.numeroInformeInspeccion(d.otId, tx);
    const r = await this.numeracion.reservar(
      tx,
      {
        tenantId: d.tenantId,
        unidadId: d.unidadId,
        tipo: d.tipoDocumento,
        fecha: d.fecha,
        ot: d.otCodigo,
        muestra: d.muestraCodigo,
        numInforme,
      },
      // Un documento tampoco puede repetir el número de un oficio (B-003).
      async (numero) =>
        Boolean(await tx.certificado.findFirst({ where: { tenantId: d.tenantId, OR: [{ numero }, { codigo: numero }] }, select: { id: true } })) ||
        (await tx.$queryRawUnsafe(`SELECT 1 FROM oficio WHERE tenant_id = $1::uuid AND numero = $2 LIMIT 1`, d.tenantId, numero) as unknown[]).length > 0,
    );
    if (r.numero) return { numero: r.numero, aviso: null, formato: r.regla.formato };
    const numero = await this.siguienteNumero(tx, d.tenantId, anioChile(d.fecha));
    const aviso = r.regla
      ? `Al formato de numeración «${r.regla.formato}» le faltan datos (${(r.faltan ?? []).join(", ")}): se usó la numeración general ${numero}.`
      : null;
    return { numero, aviso, formato: null };
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
      select: { id: true, repid: true, nombre: true, tipo: true, tipoDocumento: true },
    });
    if (!plantilla) throw new NotFoundException(`Plantilla ${plantillaId} no encontrada`);

    if (opts.tipoDocumento && !(TIPOS_DOCUMENTO as readonly string[]).includes(opts.tipoDocumento))
      throw new BadRequestException(`tipoDocumento inválido. Valores: ${TIPOS_DOCUMENTO.join(", ")}`);
    // Cobertura del documento (toda la OT, una muestra, un producto o un laboratorio):
    // decide qué resultados deben estar aprobados, con qué laboratorio se firma y numera.
    const cober = await this.resolverCobertura(otId, ot.tenantId, opts.cobertura);
    const unidadDoc = cober.unidadDocumento;
    // Tipo de documento: el indicado, el propio de la plantilla o el de la unidad
    // de la OT (heredado por la rama: BPCH, sucursales y D11 → informe de inspección).
    const deUnidad = await this.tipoDocumentoDeUnidad(unidadDoc);
    const { tipo: tipoDocumento, origen: tipoDocumentoOrigen } = tipoDocumentoPorDefecto({
      indicado: opts.tipoDocumento,
      tipoPlantilla: plantilla.tipo,
      repid: plantilla.repid,
      tipoDePlantilla: plantilla.tipoDocumento,
      tipoUnidad: deUnidad?.tipo ?? null,
    });
    const faltantes: string[] = [];

    if (ot.estado === "anulada" || ot.estado === "cerrada")
      faltantes.push(`La OT ${ot.codigo} está ${ot.estado}: no admite nuevos documentos.`);
    faltantes.push(...cober.errores);
    // Cobertura a medio elegir (p. ej. «Un laboratorio» sin laboratorio): solo se
    // pide lo que falta elegir; lo demás se evalúa al completarla (recorrido MP-02, D02-07).
    const coberturaIncompleta = cober.errores.length > 0;

    // 1. Resultados aprobados (los que cubre el documento) y con veredicto.
    const todos = await this.prisma.resultado.findMany({
      where: { otId, deletedAt: null },
      select: {
        id: true,
        estado: true,
        veredicto: true,
        muestra: { select: { codigo: true } },
        analito: { select: { nombre: true } },
        catAnalito: { select: { nombre: true } },
      },
    });
    const resultados = cober.resultadoIds ? todos.filter((r) => cober.resultadoIds!.has(r.id)) : todos;
    if (!coberturaIncompleta)
      faltantes.push(
        ...faltantesParaEmitir(
          resultados.map((r) => ({
            estado: r.estado,
            veredicto: r.veredicto,
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
    if (!unidadDoc) {
      if (!coberturaIncompleta)
        faltantes.push(
        `La OT ${ot.codigo} no tiene laboratorio responsable asignado: no se puede saber quién debe firmar el documento.`,
      );
    } else {
      // Documento por laboratorio: firma ese laboratorio (Alimentos: LQA, LMB o LES).
      const res = await this.matriz.resolver(tipoDocumento, unidadDoc, ot.tenantId, { otInterna });
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

    // 4a. Informe de Inspección del BPCH (EP-10 10.11): la cabecera de inspección
    // con lugar y fecha (registrada en la OT o en su expediente; en Producción
    // Nacional, la del programa). La Delegación Nº 11 tiene su propio proceso.
    if (tipoDocumento === "INFORME_INSPECCION" && (await otEsBpch(this.prisma, ot.unidadPrincipal)))
      faltantes.push(...faltantesParaEmitirInspeccion(await vistaCabecera(this.prisma, otId)));

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

    // 4c. Condiciones de otros módulos (CRB / Informe de Rechazo del LRB: formularios/).
    for (const v of this.validadores) faltantes.push(...(await v(otId, tipoDocumento, ot.tenantId)));

    // 5. Documento vigente de la misma plantilla que se solape con este (salvo el
    // que se reemplaza): varios por OT si cubren muestras, productos o laboratorios distintos.
    const otro = documentoEnConflicto(
      cober.cob,
      cober.hechos.documentos.filter((d) => d.plantillaId === plantillaId && d.id !== opts.reemplazaId),
    );
    if (otro)
      faltantes.push(
        otro.noEmitido
          ? `Ya se registró que el documento ${otro.numero} (${otro.etiqueta ?? "esta cobertura"}) no se emite.`
          : `Ya existe el documento ${otro.numero} (${otro.estado === "en_firma" ? "en firma" : "oficial"}${otro.etiqueta ? ` · ${otro.etiqueta}` : ""}) con esta plantilla. ` +
              (cober.cob.cobertura === "ot" && otro.cobertura === "ot"
                ? "Para corregirlo, anúlelo (o pida que lo devuelvan) y reemítalo como nueva versión."
                : "Elija otra muestra, producto o laboratorio, o corrija ese documento."),
      );

    // Número oficial que tendrá (orientativo: no se reserva hasta emitir).
    const muestraCodigo = cober.muestraCodigo;
    const prox = await this.numeracion.proximo({
      tenantId: ot.tenantId,
      unidadId: unidadDoc,
      tipo: tipoDocumento,
      fecha: new Date(),
      ot: ot.codigo,
      muestra: muestraCodigo,
      numInforme: await this.numeroInformeInspeccion(otId),
    });
    const numeracion = {
      numero: prox.numero,
      formato: prox.formato,
      porConfirmar: prox.porConfirmar,
      general: !prox.numero,
      aviso: prox.formato && !prox.numero
        ? `Al formato «${prox.formato}» le faltan datos (${prox.faltan.join(", ")}): se usará la numeración general CERT-AAAA-NNNN.`
        : null,
    };

    return {
      puedeEmitir: faltantes.length === 0,
      faltantes,
      numeracion,
      muestraCodigo,
      cobertura: { ...cober.cob, etiqueta: cober.etiqueta, unidadDocumento: unidadDoc },
      tipoDocumento,
      tipoDocumentoOrigen,
      tipoDocumentoUnidad: tipoDocumentoOrigen === "unidad" ? deUnidad?.unidadCodigo ?? null : null,
      ot: { id: ot.id, codigo: ot.codigo, unidadId: unidadDoc },
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
    const encargo = formato.portada === "ivc" ? await this.portadaEncargo(ctx.ot.id) : {};
    return { formato, ...this.sugerencias(ctx, formato, encargo), cobertura: await this.coberturaSugerida(ctx.ot.unidadPrincipal) };
  }

  /**
   * Cobertura que se propone al emitir (documento_cobertura_unidad): la de la
   * unidad de la OT o la de su ancestro más cercano; si no hay, toda la OT.
   */
  async coberturaSugerida(unidadId: string | null): Promise<{ cobertura: string; porConfirmar: boolean; fuente: string | null }> {
    const porDefecto = { cobertura: "ot", porConfirmar: false, fuente: null };
    if (!unidadId) return porDefecto;
    try {
      const f = await this.prisma.$queryRawUnsafe<{ cobertura: string; por_confirmar: boolean; fuente: string | null }[]>(
        `WITH RECURSIVE cadena AS (
           SELECT id, padre_id, 0 AS nivel FROM unidad WHERE id = $1::uuid
           UNION ALL
           SELECT u.id, u.padre_id, c.nivel + 1 FROM unidad u JOIN cadena c ON u.id = c.padre_id WHERE c.nivel < 20)
         SELECT d.cobertura, d.por_confirmar, d.fuente FROM cadena c JOIN documento_cobertura_unidad d ON d.unidad_id = c.id
          ORDER BY c.nivel LIMIT 1`,
        unidadId,
      );
      return f[0] ? { cobertura: f[0].cobertura, porConfirmar: f[0].por_confirmar, fuente: f[0].fuente } : porDefecto;
    } catch {
      return porDefecto;
    }
  }

  /** ¿El laboratorio trabaja en la OT (responsable, destino de una orden interna u «otros laboratorios»)? */
  async laboratorioTrabajaEnOt(otId: string, tenantId: string, unidadId: string): Promise<boolean> {
    const h = await hechosCobertura(this.prisma, otId, tenantId);
    return h.laboratorios.some((l) => l.id === unidadId);
  }

  /**
   * Cobertura de los documentos de la OT para la pantalla de emisión: cada
   * muestra (con su producto) y cada laboratorio que trabaja en la OT, sus
   * resultados aprobados, sus documentos y lo que falta cubrir para cerrar.
   */
  async coberturaOt(otId: string, tenantId: string) {
    const h = await hechosCobertura(this.prisma, otId, tenantId);
    const docsDe = (pred: (d: (typeof h.documentos)[number]) => boolean) =>
      h.documentos
        .filter((d) => d.estado !== "anulado" || d.noEmitido)
        .filter(pred)
        .map((d) => ({ id: d.id, numero: d.numero, estado: d.noEmitido ? "no_emitido" : d.estado, cobertura: d.cobertura, etiqueta: d.etiqueta }));
    return {
      muestras: h.muestras.map((m) => ({
        id: m.id,
        codigo: m.codigo,
        nombre: m.nombre,
        elementoId: m.elementoId,
        elementoNombre: m.elementoNombre ?? null,
        resultados: m.resultados,
        aprobados: m.aprobados,
        documentos: docsDe((d) => d.cobertura === "ot" || d.muestraIds.includes(m.id)),
      })),
      laboratorios: h.laboratorios.map((l) => ({
        id: l.id,
        codigo: l.codigo,
        nombre: l.nombre,
        principal: l.principal,
        resultados: l.resultados,
        aprobados: l.aprobados,
        documentos: docsDe((d) => d.cobertura === "ot" || d.unidadId === l.id),
      })),
      pendientes: h.pendientes,
    };
  }

  /**
   * Registra que un documento NO se emite (LPN: «la muestra no forma película»,
   * EP-01 5.1): reserva su número oficial (no se reutiliza) y lo deja anulado
   * con el motivo, cubriendo su muestra, producto o laboratorio para el cierre.
   */
  async registrarNoEmitido(
    otId: string,
    plantillaId: string,
    tenantId: string,
    usuarioId: string | null,
    p: { motivo: string; tipoDocumento?: string; cobertura?: OpcionesEmision["cobertura"] },
  ) {
    const m = motivoNoEmitido(p.motivo);
    if (m) throw new BadRequestException(m);
    const cober = await this.resolverCobertura(otId, tenantId, p.cobertura);
    if (cober.cob.cobertura === "ot")
      throw new BadRequestException("El registro de «no emitido» es para un documento de una muestra, un producto o un laboratorio.");
    if (cober.errores.length) throw new BadRequestException(cober.errores.join(" "));
    const ot = await this.prisma.ordenTrabajo.findFirst({ where: { id: otId, tenantId }, select: { codigo: true, estado: true } });
    if (!ot) throw new NotFoundException(`OT ${otId} no encontrada`);
    if (ot.estado === "anulada" || ot.estado === "cerrada") throw new ConflictException(`La OT ${ot.codigo} está ${ot.estado}.`);
    const plantilla = await this.prisma.plantillaInforme.findFirst({ where: { id: plantillaId, tenantId }, select: { id: true, tipo: true, nombre: true, repid: true, tipoDocumento: true } });
    if (!plantilla) throw new NotFoundException(`Plantilla ${plantillaId} no encontrada`);
    const otro = documentoEnConflicto(cober.cob, cober.hechos.documentos.filter((d) => d.plantillaId === plantillaId));
    if (otro) throw new ConflictException(`Ya existe el documento ${otro.numero}${otro.etiqueta ? ` (${otro.etiqueta})` : ""} con esta plantilla.`);
    if (p.tipoDocumento && !(TIPOS_DOCUMENTO as readonly string[]).includes(p.tipoDocumento))
      throw new BadRequestException(`tipoDocumento inválido. Valores: ${TIPOS_DOCUMENTO.join(", ")}`);
    const deUnidad = await this.tipoDocumentoDeUnidad(cober.unidadDocumento);
    const { tipo: tipoDocumento } = tipoDocumentoPorDefecto({ indicado: p.tipoDocumento, tipoPlantilla: plantilla.tipo, repid: plantilla.repid, tipoDePlantilla: plantilla.tipoDocumento, tipoUnidad: deUnidad?.tipo ?? null });
    const fecha = new Date();
    const motivo = p.motivo.trim();
    return this.prisma.$transaction(async (tx) => {
      const { numero } = await this.numeroOficial(tx, {
        tenantId,
        unidadId: cober.unidadDocumento,
        tipoDocumento,
        fecha,
        otId,
        otCodigo: ot.codigo,
        muestraCodigo: cober.muestraCodigo,
      });
      // Cuerpo mínimo sellado: el número queda registrado con su motivo y no se imprime.
      const cuerpo = `<p><b>${escapeHtml(numero)}</b> · ${escapeHtml(plantilla.nombre)} · OT ${escapeHtml(ot.codigo)}</p>` +
        `<p>Documento NO EMITIDO (${escapeHtml(cober.etiqueta ?? "")}). Motivo: ${escapeHtml(motivo)}</p>`;
      const cert = await tx.certificado.create({
        data: {
          tenantId,
          otId,
          codigo: numero,
          numero,
          tipo: plantilla.tipo,
          tipoDocumento,
          unidadId: cober.unidadDocumento,
          version: 1,
          plantillaId,
          hashSha256: createHash("sha256").update(cuerpo, "utf8").digest("hex"),
          documentoHtml: cuerpo,
          emitidoPor: usuarioId,
          fecha,
          estado: "anulado",
          anuladoAt: fecha,
          anuladoPor: usuarioId,
          anuladoMotivo: `No emitido: ${motivo}`,
        },
        select: { id: true, numero: true, estado: true },
      });
      await tx.$executeRawUnsafe(
        `UPDATE certificado SET cobertura = $2, muestra_ids = $3::uuid[], unidad_cobertura = $4::uuid, cobertura_etiqueta = $5, no_emitido = TRUE
          WHERE id = $1::uuid`,
        cert.id,
        cober.cob.cobertura,
        cober.cob.muestraIds,
        cober.cob.unidadId,
        cober.etiqueta,
      );
      return { ...cert, noEmitido: true, motivo, cobertura: cober.etiqueta };
    });
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
      // La nueva versión cubre lo mismo que la devuelta (muestra, producto o laboratorio).
      const cob = await this.prisma.$queryRawUnsafe<{ cobertura: string; muestra_ids: string[]; unidad_cobertura: string | null }[]>(
        `SELECT cobertura, muestra_ids, unidad_cobertura FROM certificado WHERE id = $1::uuid`,
        previo.id,
      ).catch(() => []);
      opts = {
        ...opts,
        tipoDocumento: opts.tipoDocumento ?? previo.tipoDocumento ?? undefined,
        modalidad: opts.modalidad ?? doc.modalidad ?? undefined,
        datosInforme: opts.datosInforme ?? doc.datos ?? undefined,
        cobertura: cob[0] ? { cobertura: cob[0].cobertura, muestraIds: cob[0].muestra_ids ?? [], unidadId: cob[0].unidad_cobertura } : opts.cobertura,
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
    const cober = await this.resolverCobertura(otId, tenantId, opts.cobertura);

    const fecha = new Date();
    const codigoVerificacion = nuevoCodigoVerificacion();
    const anterior = previo;

    // La transacción cubre: reservar correlativo -> renderizar con ese número
    // -> insertar documento y pasos de firma. El render va dentro porque el
    // CUERPO IMPRIME el número, así que el hash depende de él.
    const emitido = await this.prisma.$transaction(async (tx) => {
      const version = anterior ? anterior.version + 1 : 1;
      const oficial = anterior
        ? null
        : await this.numeroOficial(tx, {
            tenantId,
            unidadId: cond.ot.unidadId,
            tipoDocumento: cond.tipoDocumento,
            fecha,
            otId,
            otCodigo: cond.ot.codigo,
            muestraCodigo: cond.muestraCodigo,
          });
      const numero = anterior ? numeroVersion(anterior.numero ?? anterior.codigo, version) : oficial!.numero;

      const { plantilla, ctx, cuerpoRenderizado, hash, avisos, usaDefecto, modalidad } = await this.render(
        otId,
        plantillaId,
        tenantId,
        { numero, codigoVerificacion, fecha },
        { modalidad: opts.modalidad, datos: opts.datosInforme, filtro: cober.filtro },
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
      // Cobertura (align_r1b_documentos_ot.sql): qué parte de la OT cubre este documento.
      await tx.$executeRawUnsafe(
        `UPDATE certificado SET cobertura = $2, muestra_ids = $3::uuid[], unidad_cobertura = $4::uuid, cobertura_etiqueta = $5
          WHERE id = $1::uuid`,
        cert.id,
        cober.cob.cobertura,
        cober.cob.muestraIds,
        cober.cob.unidadId,
        cober.etiqueta,
      );

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

      if (oficial?.aviso) avisos.push(oficial.aviso);
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
      cobertura: cond.cobertura,
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
      select: { numero: true, codigo: true, unidadId: true, emitidoPor: true, ot: { select: { unidadPrincipal: true } }, firmas: { select: { responsables: true } } },
    });
    if (!cert) throw new NotFoundException(`Certificado ${certificadoId} no encontrado`);
    const responsables = cert.firmas.flatMap((f) => (Array.isArray(f.responsables) ? (f.responsables as any[]) : []).map((r) => r?.usuarioId)).filter(Boolean);
    return {
      etiqueta: cert.numero ?? cert.codigo,
      unidadId: cert.unidadId ?? cert.ot?.unidadPrincipal ?? null,
      // B-002 (frente c1): quien lo emitió y el laboratorio responsable de la OT también lo abren.
      otUnidadId: cert.ot?.unidadPrincipal ?? null,
      emitidoPor: cert.emitidoPor ?? null,
      responsables: responsables as string[],
    };
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
    // Datos públicos propios del tipo (certificado por arma: arma con la serie
    // oculta y vigencia). Nunca datos personales.
    const tipo = cert.tipoDocumento ?? null;
    const extraFn = tipo ? this.verificaciones.get(tipo) : undefined;
    const extra = extraFn ? await extraFn(cert.id).catch(() => null) : null;

    return {
      valido: integro,
      estado: cert.estado,
      numero: cert.numero ?? cert.codigo,
      fecha: fmtFecha(cert.oficialAt ?? cert.fecha),
      otCodigo: cert.ot?.codigo ?? null,
      hash: cert.hashSha256 ?? null,
      tipoDocumento: tipo,
      tipoDocumentoNombre: tipo ? NOMBRE_TIPO_DOCUMENTO[tipo] ?? tipo : null,
      ...(extra ?? {}),
      ...(integro ? {} : { motivo: "El sello de integridad del documento no coincide" }),
    };
  }
}
