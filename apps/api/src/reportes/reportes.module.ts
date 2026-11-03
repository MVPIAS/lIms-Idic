import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { AuthGuard } from "@nestjs/passport";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { PrismaClient } from "@prisma/client";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { AlcanceService } from "../rbac/alcance.service";
import { condicionAlcance } from "./alcance-reportes";
import { ReportesGestionController } from "./reportes-gestion.controller";
import { diaChile, esFechaCalendario, fechaHoraChile, hoyChile, partesChile, SQL_HOY, SQL_ZONA } from "../common/fecha-chile";
import { completarSerie, mesesEntre, porcentaje, tendencia } from "./tendencias";
import { libroXlsx, type Celda, type Hoja } from "../common/xlsx-escritura";
import { etiquetaCampo, etiquetasCampos, LIMITE_EXPORTACION, puedeEditarPlantilla, puedeExportar } from "./exportacion";
import { AGREGADOS, GRAFICOS, tablaDinamica, type Agregado, type DefResumen, type TipoGrafico } from "./tabla-dinamica";

// ===========================================================================
// Módulo REPORTES · KPIs (contrato §4.5.3) + exportación con filtros (§4.6.6 /
// §4.6.7 / respaldo §4.8.4).
//
// SOLO LECTURA: agrega datos ya existentes en tablas del núcleo Prisma
// (orden_trabajo, muestra, resultado, cotizacion, certificado, cat_metodo,
// cat_ensayo). No crea ni modifica ninguna tabla. Igual patrón de aislamiento
// por tenant y SQL crudo parametrizado que saec.module.ts: NUNCA se interpola
// entrada del usuario en el SQL — los nombres de columna que sí van al texto de
// la consulta salen SIEMPRE de whitelists internas (ENTIDADES), jamás del query
// string, y todos los valores viajan como parámetros posicionales ($1, $2…).
//
// ALCANCE POR LABORATORIO (AlcanceService + alcance-reportes.ts): cada cifra se
// calcula solo con las unidades que ve quien consulta (jefaturas: su rama;
// perfiles globales: todo). Muestras, resultados y documentos cuentan por la OT
// a la que pertenecen; las cotizaciones, por la unidad de su OT o de su centro
// de costo.
// ===========================================================================

// --- catálogo de entidades exportables (whitelist estricta) ----------------

interface EntidadDef {
  /** Nombre real de la tabla física. */
  tabla: string;
  /** Alias expuesto -> columna física. Solo estas columnas pueden pedirse. */
  columnas: Record<string, string>;
  /** Columna de fecha sobre la que aplican los filtros desde/hasta. */
  fechaCol: string;
  /** true si la tabla tiene borrado lógico (deleted_at). */
  softDelete: boolean;
  /** Nombre legible para la interfaz y el Excel. */
  etiqueta?: string;
  /** Permiso adicional para exportarla (además de reporte.ver). */
  permiso?: string;
}

/**
 * Whitelist por entidad. Es la ÚNICA fuente de nombres de columna que llegan al
 * texto SQL; el parámetro `campos` del cliente se valida contra estas claves y
 * se traduce a la columna física antes de tocar la consulta.
 *
 * orden_trabajo y cotizacion NO tienen columna deleted_at en el schema Prisma;
 * muestra, resultado y certificado sí.
 */
const ENTIDADES: Record<string, EntidadDef> = {
  ot: {
    tabla: "orden_trabajo",
    fechaCol: "created_at",
    softDelete: false,
    columnas: {
      codigo: "codigo",
      estado: "estado",
      estado_ot: "estado_ot",
      fase_registro: "fase_registro",
      prioridad: "prioridad",
      solicitante: "solicitante",
      origen_trabajo: "origen_trabajo",
      tipo_trabajo: "tipo_trabajo",
      numero_ley: "numero_ley",
      fecha_recepcion: "fecha_recepcion",
      fecha_compromiso: "fecha_compromiso",
      fecha_cierre: "fecha_cierre",
      dias_atraso: "dias_atraso",
      estado_envio: "estado_envio",
      created_at: "created_at",
    },
  },
  muestra: {
    tabla: "muestra",
    fechaCol: "created_at",
    softDelete: true,
    columnas: {
      codigo: "codigo",
      nombre: "nombre",
      estado: "estado",
      ubicacion: "ubicacion",
      codigo_barras: "codigo_barras",
      created_at: "created_at",
    },
  },
  resultado: {
    tabla: "resultado",
    fechaCol: "fecha",
    softDelete: true,
    columnas: {
      veredicto: "veredicto",
      estado: "estado",
      valor_numerico: "valor_numerico",
      valor_texto: "valor_texto",
      unidad: "unidad",
      promedio: "promedio",
      limite_inf: "limite_inf",
      nominal: "nominal",
      limite_sup: "limite_sup",
      fecha: "fecha",
    },
  },
  cotizacion: {
    tabla: "cotizacion",
    fechaCol: "created_at",
    softDelete: false,
    columnas: {
      codigo: "codigo",
      estado: "estado",
      fecha_emision: "fecha_emision",
      expira_at: "expira_at",
      neto: "neto",
      iva_monto: "iva_monto",
      total: "total",
      forma_pago: "forma_pago",
      created_at: "created_at",
    },
  },
  // Facturas en el exportador (EP-00 9.4, BL-174, frente r4c): cuentan por la unidad de su OT.
  // Solo para quien ve facturación (Finanzas, Comercial, Planificación, Dirección).
  factura: {
    tabla: "factura",
    permiso: "factura.ver",
    fechaCol: "created_at",
    softDelete: true,
    columnas: {
      numero: "numero",
      codigo: "codigo",
      estado: "estado",
      origen: "origen",
      fecha_emision: "fecha_emision",
      fecha_vencimiento: "fecha_vencimiento",
      moneda: "moneda",
      neto: "neto",
      iva_monto: "iva_monto",
      total: "total",
      saldo: "saldo",
      created_at: "created_at",
    },
  },
  certificado: {
    tabla: "certificado",
    fechaCol: "created_at",
    softDelete: true,
    columnas: {
      codigo: "codigo",
      numero: "numero",
      tipo: "tipo",
      estado: "estado",
      codigo_verificacion: "codigo_verificacion",
      fecha: "fecha",
      created_at: "created_at",
    },
  },
  // §4.6.6: equipos, consumibles y actividades (frente documental).
  equipo: {
    tabla: "equipo",
    etiqueta: "Equipos",
    fechaCol: "created_at",
    softDelete: true,
    columnas: {
      codigo: "codigo",
      nombre: "nombre",
      fabricante: "fabricante",
      modelo: "modelo",
      serie: "serie",
      ubicacion: "ubicacion",
      unidad: "(SELECT u.codigo FROM unidad u WHERE u.id = equipo.unidad_id)",
      estado: "estado",
      fecha_ultima_calibracion: "fecha_ultima_calibracion",
      proxima_calibracion: "proxima_calibracion",
      created_at: "created_at",
    },
  },
  consumible_lote: {
    tabla: "lote_consumible",
    etiqueta: "Consumibles · lotes y stock",
    fechaCol: "fecha_recepcion",
    softDelete: false,
    columnas: {
      consumible_codigo: "(SELECT c.codigo FROM consumible c WHERE c.id = lote_consumible.consumible_id)",
      consumible: "(SELECT c.nombre FROM consumible c WHERE c.id = lote_consumible.consumible_id)",
      tipo: "(SELECT c.tipo FROM consumible c WHERE c.id = lote_consumible.consumible_id)",
      unidad_medida: "(SELECT c.unidad_medida FROM consumible c WHERE c.id = lote_consumible.consumible_id)",
      numero_lote: "numero_lote",
      fecha_recepcion: "fecha_recepcion",
      fecha_vencimiento: "fecha_vencimiento",
      cantidad_inicial: "cantidad_inicial",
      cantidad_actual: "cantidad_actual",
      estado: "estado",
    },
  },
  consumible_movimiento: {
    tabla: "movimiento_consumible",
    etiqueta: "Consumibles · movimientos",
    fechaCol: "created_at",
    softDelete: false,
    columnas: {
      fecha: "created_at",
      tipo: "tipo",
      cantidad: "cantidad",
      consumible: "(SELECT c.nombre FROM lote_consumible l JOIN consumible c ON c.id = l.consumible_id WHERE l.id = movimiento_consumible.lote_id)",
      numero_lote: "(SELECT l.numero_lote FROM lote_consumible l WHERE l.id = movimiento_consumible.lote_id)",
      muestra: "(SELECT m.codigo FROM muestra m WHERE m.id = movimiento_consumible.muestra_id)",
      metodo: "(SELECT cm.nombre FROM cat_metodo cm WHERE cm.id = movimiento_consumible.cat_metodo_id)",
      motivo: "motivo",
    },
  },
  actividad: {
    tabla: "audit_log",
    etiqueta: "Actividades (bitácora)",
    permiso: "audit.ver",
    fechaCol: "ocurrido_at",
    softDelete: false,
    columnas: {
      fecha: "ocurrido_at",
      usuario: "username",
      accion: "accion",
      entidad: "entidad_tipo",
      codigo: "entidad_codigo",
      motivo: "motivo",
    },
  },
};

const ETIQUETA_FORMATO: Record<string, string> = {
  ot: "Órdenes de trabajo",
  muestra: "Muestras",
  resultado: "Resultados",
  cotizacion: "Cotizaciones",
  factura: "Facturas",
  certificado: "Certificados",
};
const etiquetaEntidad = (k: string) => ENTIDADES[k]?.etiqueta ?? ETIQUETA_FORMATO[k] ?? k;

/** Valor de celda para el Excel: números como números, fechas legibles. */
function celdaXlsx(v: unknown): Celda {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "bigint") return Number(v);
  if (v instanceof Date) {
    // Ordenable en Excel: «aaaa-mm-dd» (fecha) o «aaaa-mm-dd HH:MM» en hora de Chile.
    if (esFechaCalendario(v)) return diaChile(v);
    const p = partesChile(v);
    return `${diaChile(v)} ${String(p.hora).padStart(2, "0")}:${String(p.minuto).padStart(2, "0")}`;
  }
  if (typeof v === "object") {
    const n = Number(String(v));
    return String(v) !== "" && Number.isFinite(n) && /^-?\d/.test(String(v)) ? n : JSON.stringify(v);
  }
  return String(v);
}

/** Lee la definición del resumen (tabla dinámica + gráfico) desde el query string o una plantilla. */
function leerResumen(r: any, campos: string[]): DefResumen | null {
  const filas = typeof r?.filas === "string" ? r.filas.trim() : "";
  if (!filas) return null;
  const columnas = typeof r?.columnas === "string" && r.columnas.trim() ? r.columnas.trim() : null;
  const valor = typeof r?.valor === "string" && r.valor.trim() ? r.valor.trim() : null;
  const agregado = (r?.agregado ?? "conteo") as Agregado;
  const grafico = (r?.grafico ?? "columna") as TipoGrafico;
  for (const [c, que] of [[filas, "filas"], [columnas, "columnas"], [valor, "valor"]] as const)
    if (c && !campos.includes(c)) throw new BadRequestException(`El campo de ${que} del resumen («${c}») debe estar entre las columnas exportadas.`);
  if (!AGREGADOS.includes(agregado)) throw new BadRequestException(`Agregado inválido. Válidos: ${AGREGADOS.join(", ")}.`);
  if (!GRAFICOS.includes(grafico)) throw new BadRequestException(`Gráfico inválido. Válidos: ${GRAFICOS.join(", ")}.`);
  if (agregado !== "conteo" && !valor) throw new BadRequestException("Para sumar, promediar o buscar mínimo/máximo indique el campo de valor.");
  return { filas, columnas, valor, agregado, grafico };
}

// ===========================================================================
// Base común: tenant + filtro de fechas parametrizado
// ===========================================================================

abstract class ReportesBase {
  protected prisma = new PrismaClient();

  constructor(protected readonly alcance: AlcanceService) {}

  /** Unidades visibles de quien consulta (null = todas). */
  protected unidades(req: any): Promise<string[] | null> {
    return this.alcance.filtroUnidades(req);
  }

  protected tenantId(req: any): string {
    const id = req?.user?.tenantId;
    if (!id) throw new NotFoundException("Tenant no resuelto en el token");
    return id;
  }

  /**
   * Añade `AND col >= $desde` / `AND col <= $hasta` a la consulta, con los
   * valores como parámetros posicionales. `col` es un nombre controlado (viene
   * de las constantes del módulo, nunca del usuario). `hasta` se interpreta como
   * fin de día inclusivo (< hasta + 1 día) para no perder el último día.
   */
  protected rangoFechas(col: string, desde: string | undefined, hasta: string | undefined, args: any[]): string {
    let sql = "";
    if (desde) {
      if (!/^\d{4}-\d{2}-\d{2}/.test(desde)) throw new BadRequestException("Parámetro 'desde' con formato inválido (YYYY-MM-DD)");
      args.push(desde);
      sql += ` AND ${col} >= $${args.length}::timestamptz`;
    }
    if (hasta) {
      if (!/^\d{4}-\d{2}-\d{2}/.test(hasta)) throw new BadRequestException("Parámetro 'hasta' con formato inválido (YYYY-MM-DD)");
      args.push(hasta);
      sql += ` AND ${col} < ($${args.length}::date + interval '1 day')`;
    }
    return sql;
  }
}

// ===========================================================================
// Reportes KPI predefinidos + configurador/exportador
// ===========================================================================

@ApiTags("reportes")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("reportes")
export class ReportesController extends ReportesBase {
  constructor(alcance: AlcanceService) {
    super(alcance);
  }

  // --- §4.5.3 · Productividad ---------------------------------------------
  @Get("productividad")
  @RequierePermiso("reporte.ver")
  async productividad(
    @Query("desde") desde?: string,
    @Query("hasta") hasta?: string,
    @Req() req?: any,
  ) {
    const tenantId = this.tenantId(req);
    const unidades = await this.unidades(req);

    const argsOt: any[] = [tenantId];
    const rangoOt = this.rangoFechas("created_at", desde, hasta, argsOt) + condicionAlcance("orden_trabajo", "orden_trabajo", unidades, argsOt);

    const porEstado = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT estado, COUNT(*)::int AS total
         FROM orden_trabajo
        WHERE tenant_id = $1::uuid ${rangoOt}
        GROUP BY estado ORDER BY total DESC`,
      ...argsOt,
    );
    const porMes = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS mes, COUNT(*)::int AS total
         FROM orden_trabajo
        WHERE tenant_id = $1::uuid ${rangoOt}
        GROUP BY 1 ORDER BY 1`,
      ...argsOt,
    );
    const totalOt = porEstado.reduce((s, r) => s + Number(r.total), 0);

    const argsMu: any[] = [tenantId];
    const rangoMu = this.rangoFechas("created_at", desde, hasta, argsMu) + condicionAlcance("muestra", "muestra", unidades, argsMu);
    const muestras = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::int AS total
         FROM muestra
        WHERE tenant_id = $1::uuid AND deleted_at IS NULL ${rangoMu}`,
      ...argsMu,
    );

    const argsCert: any[] = [tenantId];
    const rangoCert = this.rangoFechas("created_at", desde, hasta, argsCert) + condicionAlcance("certificado", "certificado", unidades, argsCert);
    const certificados = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE estado IN ('emitido', 'oficial'))::int AS emitidos
         FROM certificado
        WHERE tenant_id = $1::uuid AND deleted_at IS NULL ${rangoCert}`,
      ...argsCert,
    );

    return {
      rango: { desde: desde ?? null, hasta: hasta ?? null },
      totales: {
        ordenesTrabajo: totalOt,
        muestras: Number(muestras[0]?.total ?? 0),
        certificados: Number(certificados[0]?.total ?? 0),
        certificadosEmitidos: Number(certificados[0]?.emitidos ?? 0),
      },
      otPorEstado: porEstado,
      otPorMes: porMes,
    };
  }

  // --- §4.5.3 · Conformidad (tasa de cumplimiento) ------------------------
  @Get("conformidad")
  @RequierePermiso("reporte.ver")
  async conformidad(
    @Query("desde") desde?: string,
    @Query("hasta") hasta?: string,
    @Req() req?: any,
  ) {
    const tenantId = this.tenantId(req);
    const unidades = await this.unidades(req);

    const argsG: any[] = [tenantId];
    const rangoG = this.rangoFechas("r.fecha", desde, hasta, argsG) + condicionAlcance("resultado", "r", unidades, argsG);
    const globalRows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT COALESCE(r.veredicto, 'pendiente') AS veredicto, COUNT(*)::int AS total
         FROM resultado r
        WHERE r.tenant_id = $1::uuid AND r.deleted_at IS NULL ${rangoG}
        GROUP BY 1`,
      ...argsG,
    );
    const global = this.resumenVeredicto(globalRows);

    const argsM: any[] = [tenantId];
    const rangoM = this.rangoFechas("r.fecha", desde, hasta, argsM) + condicionAlcance("resultado", "r", unidades, argsM);
    const porMetodo = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT cm.codigo AS metodo_codigo, cm.nombre AS metodo_nombre,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE r.veredicto = 'cumple')::int    AS cumple,
              COUNT(*) FILTER (WHERE r.veredicto = 'no_cumple')::int AS no_cumple,
              COUNT(*) FILTER (WHERE r.veredicto IS NULL OR r.veredicto = 'pendiente')::int AS pendiente
         FROM resultado r
         JOIN cat_metodo cm ON cm.id = r.cat_metodo_id
        WHERE r.tenant_id = $1::uuid AND r.deleted_at IS NULL ${rangoM}
        GROUP BY cm.id, cm.codigo, cm.nombre
        ORDER BY total DESC`,
      ...argsM,
    );

    const argsE: any[] = [tenantId];
    const rangoE = this.rangoFechas("r.fecha", desde, hasta, argsE) + condicionAlcance("resultado", "r", unidades, argsE);
    const porEnsayo = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT ce.codigo AS ensayo_codigo, ce.nombre AS ensayo_nombre,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE r.veredicto = 'cumple')::int    AS cumple,
              COUNT(*) FILTER (WHERE r.veredicto = 'no_cumple')::int AS no_cumple,
              COUNT(*) FILTER (WHERE r.veredicto IS NULL OR r.veredicto = 'pendiente')::int AS pendiente
         FROM resultado r
         JOIN cat_metodo cm ON cm.id = r.cat_metodo_id
         JOIN cat_ensayo ce ON ce.id = cm.ensayo_id
        WHERE r.tenant_id = $1::uuid AND r.deleted_at IS NULL ${rangoE}
        GROUP BY ce.id, ce.codigo, ce.nombre
        ORDER BY total DESC`,
      ...argsE,
    );

    return {
      rango: { desde: desde ?? null, hasta: hasta ?? null },
      global,
      porMetodo: porMetodo.map((m) => ({ ...m, tasaCumplimiento: this.tasa(m.cumple, m.cumple + m.no_cumple) })),
      porEnsayo: porEnsayo.map((e) => ({ ...e, tasaCumplimiento: this.tasa(e.cumple, e.cumple + e.no_cumple) })),
    };
  }

  private resumenVeredicto(rows: any[]) {
    const r = { total: 0, cumple: 0, no_cumple: 0, pendiente: 0 };
    for (const x of rows) {
      const n = Number(x.total);
      r.total += n;
      if (x.veredicto === "cumple") r.cumple += n;
      else if (x.veredicto === "no_cumple") r.no_cumple += n;
      else r.pendiente += n;
    }
    const evaluados = r.cumple + r.no_cumple;
    return {
      ...r,
      tasaCumplimiento: this.tasa(r.cumple, evaluados),
      tasaNoCumple: this.tasa(r.no_cumple, evaluados),
    };
  }

  /** Porcentaje 0–100 con 1 decimal; null si no hay denominador. */
  private tasa(num: number, den: number): number | null {
    if (!den) return null;
    return Math.round((num / den) * 1000) / 10;
  }

  // --- §4.5.7 · Tendencias (histórico por mes y laboratorio) + tiempo real ---
  /**
   * Series mensuales (hora de Chile) por laboratorio de: OT ingresadas, muestras
   * registradas, % No cumple de los resultados evaluados y días de respuesta de
   * las OT cerradas; cada serie con media móvil de 3 meses, pendiente de la recta,
   * sentido (sube / baja / estable) y aviso si el último mes es atípico. Además,
   * la foto «ahora» (OT abiertas, vencidas, resultados por revisar). Respeta el
   * alcance por laboratorio. Por defecto, los últimos 12 meses.
   */
  @Get("tendencias")
  @RequierePermiso("reporte.ver")
  async tendencias(@Query("desde") desde?: string, @Query("hasta") hasta?: string, @Req() req?: any) {
    const tenantId = this.tenantId(req);
    const unidades = await this.unidades(req);
    const h = hasta && /^\d{4}-\d{2}-\d{2}$/.test(hasta) ? hasta : hoyChile();
    let d = desde && /^\d{4}-\d{2}-\d{2}$/.test(desde) ? desde : null;
    if (!d) {
      const y = Number(h.slice(0, 4));
      const m = Number(h.slice(5, 7));
      d = m === 12 ? `${y}-01-01` : `${y - 1}-${String(m + 1).padStart(2, "0")}-01`;
    }
    if (d > h) throw new BadRequestException("La fecha «desde» es posterior a «hasta».");
    const meses = mesesEntre(d, h);
    if (meses.length > 60) throw new BadRequestException("El periodo de tendencias es de 60 meses como máximo.");
    const mes = (col: string) => `to_char(${col} AT TIME ZONE ${SQL_ZONA}, 'YYYY-MM')`;
    const rango = (col: string, args: any[]) => {
      args.push(d, h);
      return ` AND (${col} AT TIME ZONE ${SQL_ZONA})::date BETWEEN $${args.length - 1}::date AND $${args.length}::date`;
    };

    const aOt: any[] = [tenantId];
    const fOt = rango("o.created_at", aOt) + condicionAlcance("orden_trabajo", "o", unidades, aOt);
    const ots = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT ${mes("o.created_at")} AS mes, o.unidad_principal AS unidad, COUNT(*)::int AS n
         FROM orden_trabajo o WHERE o.tenant_id = $1::uuid AND o.estado <> 'anulada' ${fOt} GROUP BY 1, 2`,
      ...aOt,
    );
    const aMu: any[] = [tenantId];
    const fMu = rango("m.created_at", aMu) + condicionAlcance("muestra", "m", unidades, aMu);
    const mus = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT ${mes("m.created_at")} AS mes, (SELECT o.unidad_principal FROM orden_trabajo o WHERE o.id = m.ot_id) AS unidad, COUNT(*)::int AS n
         FROM muestra m WHERE m.tenant_id = $1::uuid AND m.deleted_at IS NULL ${fMu} GROUP BY 1, 2`,
      ...aMu,
    );
    const aRe: any[] = [tenantId];
    const fRe = rango("r.fecha", aRe) + condicionAlcance("resultado", "r", unidades, aRe);
    const res = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT ${mes("r.fecha")} AS mes,
              (SELECT o.unidad_principal FROM orden_trabajo o WHERE o.id = COALESCE(r.ot_id, (SELECT m.ot_id FROM muestra m WHERE m.id = r.muestra_id))) AS unidad,
              COUNT(*) FILTER (WHERE r.veredicto IN ('cumple', 'no_cumple'))::int AS evaluados,
              COUNT(*) FILTER (WHERE r.veredicto = 'no_cumple')::int AS no_cumple
         FROM resultado r WHERE r.tenant_id = $1::uuid AND r.deleted_at IS NULL AND r.fecha IS NOT NULL ${fRe} GROUP BY 1, 2`,
      ...aRe,
    );
    const aCi: any[] = [tenantId];
    const fCi = rango("o.fecha_cierre", aCi) + condicionAlcance("orden_trabajo", "o", unidades, aCi);
    const cie = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT ${mes("o.fecha_cierre")} AS mes, o.unidad_principal AS unidad, COUNT(*)::int AS n,
              SUM(EXTRACT(EPOCH FROM (o.fecha_cierre - COALESCE(o.fecha_recepcion, o.created_at))) / 86400.0)::float8 AS dias
         FROM orden_trabajo o WHERE o.tenant_id = $1::uuid AND o.fecha_cierre IS NOT NULL ${fCi} GROUP BY 1, 2`,
      ...aCi,
    );

    const ids = [...new Set([...ots, ...mus, ...res, ...cie].map((x) => x.unidad).filter(Boolean))] as string[];
    const labs = ids.length
      ? await this.prisma.$queryRawUnsafe<{ id: string; codigo: string; nombre: string }[]>(
          `SELECT id, codigo, nombre FROM unidad WHERE id = ANY($1::uuid[]) ORDER BY codigo`,
          ids,
        )
      : [];
    const serieDe = (unidad: string | null) => {
      const de = (xs: any[]) => (unidad ? xs.filter((x) => x.unidad === unidad) : xs);
      const sumaPorMes = (xs: any[], campo: string) => {
        const m = new Map<string, number>();
        for (const x of xs) m.set(x.mes, (m.get(x.mes) ?? 0) + Number(x[campo] ?? 0));
        return m;
      };
      const filas = (m: Map<string, number>) => [...m].map(([k, v]) => ({ mes: k, valor: v }));
      const ev = sumaPorMes(de(res), "evaluados");
      const nc = sumaPorMes(de(res), "no_cumple");
      const cn = sumaPorMes(de(cie), "n");
      const cd = sumaPorMes(de(cie), "dias");
      const serie = (valores: (number | null)[]) => ({ valores, ...tendencia(valores) });
      return {
        ot: serie(completarSerie(meses, filas(sumaPorMes(de(ots), "n")), 0)),
        muestras: serie(completarSerie(meses, filas(sumaPorMes(de(mus), "n")), 0)),
        pctNoCumple: serie(meses.map((x) => porcentaje(nc.get(x) ?? 0, ev.get(x) ?? 0))),
        evaluados: completarSerie(meses, filas(ev), 0),
        diasRespuesta: serie(meses.map((x) => (cn.get(x) ? Math.round(((cd.get(x) ?? 0) / cn.get(x)!) * 10) / 10 : null))),
        cerradas: completarSerie(meses, filas(cn), 0),
      };
    };

    // Foto «ahora» (tiempo real).
    const aAh: any[] = [tenantId];
    const fAh = condicionAlcance("orden_trabajo", "o", unidades, aAh);
    const [ahora] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*) FILTER (WHERE o.estado NOT IN ('cerrada', 'anulada'))::int AS ot_abiertas,
              COUNT(*) FILTER (WHERE o.estado NOT IN ('cerrada', 'anulada') AND o.fecha_compromiso < ${SQL_HOY})::int AS ot_vencidas,
              COUNT(*) FILTER (WHERE (o.created_at AT TIME ZONE ${SQL_ZONA})::date = ${SQL_HOY})::int AS ot_hoy
         FROM orden_trabajo o WHERE o.tenant_id = $1::uuid ${fAh}`,
      ...aAh,
    );
    const aAr: any[] = [tenantId];
    const fAr = condicionAlcance("resultado", "r", unidades, aAr);
    const [pend] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*) FILTER (WHERE r.estado = 'capturado')::int AS por_revisar
         FROM resultado r JOIN orden_trabajo o ON o.id = r.ot_id
        WHERE r.tenant_id = $1::uuid AND r.deleted_at IS NULL AND o.estado NOT IN ('cerrada', 'anulada') ${fAr}`,
      ...aAr,
    );

    return {
      rango: { desde: d, hasta: h },
      meses,
      generado: fechaHoraChile(new Date()),
      ahora: {
        otAbiertas: Number(ahora?.ot_abiertas ?? 0),
        otVencidas: Number(ahora?.ot_vencidas ?? 0),
        otIngresadasHoy: Number(ahora?.ot_hoy ?? 0),
        resultadosPorRevisar: Number(pend?.por_revisar ?? 0),
      },
      total: serieDe(null),
      laboratorios: labs.map((l) => ({ id: l.id, codigo: l.codigo, nombre: l.nombre, ...serieDe(l.id) })),
    };
  }

  // --- §4.5.3 · Plazos (ingreso -> cierre) --------------------------------
  @Get("plazos")
  @RequierePermiso("reporte.ver")
  async plazos(
    @Query("desde") desde?: string,
    @Query("hasta") hasta?: string,
    @Req() req?: any,
  ) {
    const tenantId = this.tenantId(req);
    const unidades = await this.unidades(req);

    const args: any[] = [tenantId];
    const rango = this.rangoFechas("created_at", desde, hasta, args) + condicionAlcance("orden_trabajo", "orden_trabajo", unidades, args);

    // Métricas agregadas sobre OT cerradas con fecha de recepción conocida.
    const resumen = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::int AS cerradas,
              AVG(EXTRACT(EPOCH FROM (fecha_cierre - fecha_recepcion)) / 86400.0)::float8 AS dias_promedio,
              MIN(EXTRACT(EPOCH FROM (fecha_cierre - fecha_recepcion)) / 86400.0)::float8 AS dias_min,
              MAX(EXTRACT(EPOCH FROM (fecha_cierre - fecha_recepcion)) / 86400.0)::float8 AS dias_max,
              COUNT(*) FILTER (WHERE fecha_compromiso IS NOT NULL)::int AS con_compromiso,
              COUNT(*) FILTER (WHERE fecha_compromiso IS NOT NULL AND fecha_cierre::date <= fecha_compromiso)::int AS dentro_plazo
         FROM orden_trabajo
        WHERE tenant_id = $1::uuid AND fecha_cierre IS NOT NULL AND fecha_recepcion IS NOT NULL ${rango}`,
      ...args,
    );
    const r = resumen[0] ?? {};
    const conCompromiso = Number(r.con_compromiso ?? 0);

    // Detalle por OT (acotado) para la tabla de la UI.
    const argsD: any[] = [tenantId];
    const rangoD = this.rangoFechas("created_at", desde, hasta, argsD) + condicionAlcance("orden_trabajo", "orden_trabajo", unidades, argsD);
    const detalle = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT codigo, estado, fecha_recepcion, fecha_cierre, fecha_compromiso,
              (EXTRACT(EPOCH FROM (fecha_cierre - fecha_recepcion)) / 86400.0)::float8 AS dias,
              CASE WHEN fecha_compromiso IS NULL THEN NULL
                   ELSE (fecha_cierre::date <= fecha_compromiso) END AS dentro_plazo
         FROM orden_trabajo
        WHERE tenant_id = $1::uuid AND fecha_cierre IS NOT NULL AND fecha_recepcion IS NOT NULL ${rangoD}
        ORDER BY fecha_cierre DESC
        LIMIT 200`,
      ...argsD,
    );

    return {
      rango: { desde: desde ?? null, hasta: hasta ?? null },
      resumen: {
        otCerradas: Number(r.cerradas ?? 0),
        diasPromedio: r.dias_promedio != null ? Math.round(Number(r.dias_promedio) * 10) / 10 : null,
        diasMin: r.dias_min != null ? Math.round(Number(r.dias_min) * 10) / 10 : null,
        diasMax: r.dias_max != null ? Math.round(Number(r.dias_max) * 10) / 10 : null,
        conCompromiso,
        dentroPlazo: Number(r.dentro_plazo ?? 0),
        pctDentroPlazo: this.tasa(Number(r.dentro_plazo ?? 0), conCompromiso),
      },
      detalle,
    };
  }

  // --- §4.5.3 · Comercial (cotizaciones) ----------------------------------
  @Get("comercial")
  @RequierePermiso("reporte.comercial.ver")
  async comercial(
    @Query("desde") desde?: string,
    @Query("hasta") hasta?: string,
    @Req() req?: any,
  ) {
    const tenantId = this.tenantId(req);
    const unidades = await this.unidades(req);

    const argsE: any[] = [tenantId];
    const rangoE = this.rangoFechas("created_at", desde, hasta, argsE) + condicionAlcance("cotizacion", "cotizacion", unidades, argsE);
    const porEstado = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT estado, COUNT(*)::int AS total, COALESCE(SUM(total), 0)::float8 AS monto
         FROM cotizacion
        WHERE tenant_id = $1::uuid ${rangoE}
        GROUP BY estado ORDER BY total DESC`,
      ...argsE,
    );

    const argsM: any[] = [tenantId];
    const rangoM = this.rangoFechas("created_at", desde, hasta, argsM) + condicionAlcance("cotizacion", "cotizacion", unidades, argsM);
    const porMes = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS mes,
              COUNT(*)::int AS total, COALESCE(SUM(total), 0)::float8 AS monto
         FROM cotizacion
        WHERE tenant_id = $1::uuid ${rangoM}
        GROUP BY 1 ORDER BY 1`,
      ...argsM,
    );

    const totales = porEstado.reduce(
      (acc, r) => {
        acc.cantidad += Number(r.total);
        acc.monto += Number(r.monto);
        if (r.estado === "aceptada") { acc.aceptadas += Number(r.total); acc.montoAceptado += Number(r.monto); }
        return acc;
      },
      { cantidad: 0, monto: 0, aceptadas: 0, montoAceptado: 0 },
    );

    return {
      rango: { desde: desde ?? null, hasta: hasta ?? null },
      totales: { ...totales, tasaAceptacion: this.tasa(totales.aceptadas, totales.cantidad) },
      porEstado,
      porMes,
    };
  }

  // --- §4.6.6 / §4.6.7 · Configurador de tabla + export CSV ---------------
  /** Descripción de la whitelist para que la UI pinte los checkboxes. */
  // Solo las entidades que quien consulta puede exportar (mismo criterio que /tabla),
  // con la etiqueta legible de cada columna y el tope de filas por descarga.
  @Get("entidades")
  @RequierePermiso("reporte.ver")
  entidades(@Req() req: any) {
    return Object.fromEntries(
      Object.entries(ENTIDADES)
        .filter(([, def]) => puedeExportar(req?.user, def.permiso))
        .map(([k, def]) => [
          k,
          {
            tabla: def.tabla,
            fechaCol: def.fechaCol,
            campos: Object.keys(def.columnas),
            etiquetas: Object.fromEntries(Object.keys(def.columnas).map((c) => [c, etiquetaCampo(k, c)])),
            etiqueta: etiquetaEntidad(k),
            permiso: def.permiso ?? null,
            limite: LIMITE_EXPORTACION,
          },
        ]),
    );
  }

  @Get("tabla")
  @RequierePermiso("reporte.ver")
  @Header("Cache-Control", "no-store")
  async tabla(
    @Res({ passthrough: true }) res: Response,
    @Query("entidad") entidad?: string,
    @Query("campos") campos?: string,
    @Query("desde") desde?: string,
    @Query("hasta") hasta?: string,
    @Query("formato") formato?: string,
    @Query("limit") limit?: string,
    @Req() req?: any,
    @Query("resumenFilas") resumenFilas?: string,
    @Query("resumenColumnas") resumenColumnas?: string,
    @Query("resumenValor") resumenValor?: string,
    @Query("resumenAgregado") resumenAgregado?: string,
    @Query("grafico") grafico?: string,
    @Query("titulo") titulo?: string,
  ) {
    const tenantId = this.tenantId(req);

    const def = ENTIDADES[String(entidad ?? "")];
    if (!def) {
      throw new BadRequestException(
        `entidad inválida. Válidas: ${Object.keys(ENTIDADES).join(", ")}`,
      );
    }
    // Entidades con permiso propio (facturas: factura.ver; bitácora: audit.ver).
    if (!puedeExportar(req?.user, def.permiso))
      throw new ForbiddenException(`Exportar ${etiquetaEntidad(String(entidad))} exige el permiso ${def.permiso}.`);

    // Resolución de columnas: SOLO claves de la whitelist. Si no se piden campos,
    // se devuelven todos los de la entidad (orden estable del objeto).
    const solicitados = (campos ?? "")
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    const claves = solicitados.length ? solicitados : Object.keys(def.columnas);

    const invalidos = claves.filter((c) => !(c in def.columnas));
    if (invalidos.length) {
      throw new BadRequestException(
        `campos no permitidos para '${entidad}': ${invalidos.join(", ")}. Permitidos: ${Object.keys(def.columnas).join(", ")}`,
      );
    }

    // `col AS "alias"` — el nombre físico y el alias salen ambos de la whitelist,
    // nunca del texto del cliente.
    const selectList = claves.map((k) => `${def.columnas[k]} AS "${k}"`).join(", ");

    const args: any[] = [tenantId];
    const softClause = def.softDelete ? "AND deleted_at IS NULL" : "";
    const rango =
      this.rangoFechas(def.fechaCol, desde, hasta, args) + condicionAlcance(def.tabla, def.tabla, await this.unidades(req), args);
    const max = Math.min(LIMITE_EXPORTACION, Math.max(1, parseInt(limit ?? String(LIMITE_EXPORTACION)) || LIMITE_EXPORTACION));

    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT ${selectList}
         FROM ${def.tabla}
        WHERE tenant_id = $1::uuid ${softClause} ${rango}
        ORDER BY ${def.fechaCol} DESC
        LIMIT ${max}`,
      ...args,
    );
    // Total real con los mismos filtros: la pantalla avisa si la descarga se corta en el tope.
    const total =
      filas.length < max
        ? filas.length
        : Number(
            (
              await this.prisma.$queryRawUnsafe<any[]>(
                `SELECT count(*)::int AS n FROM ${def.tabla} WHERE tenant_id = $1::uuid ${softClause} ${rango}`,
                ...args,
              )
            )[0]?.n ?? filas.length,
          );
    const encabezados = etiquetasCampos(String(entidad), claves);

    if ((formato ?? "").toLowerCase() === "xlsx") {
      const resumen = leerResumen(
        { filas: resumenFilas, columnas: resumenColumnas, valor: resumenValor, agregado: resumenAgregado, grafico },
        claves,
      );
      const libro = this.libro(String(entidad), claves, filas, resumen, { desde, hasta, titulo, total });
      const stamp = hoyChile();
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="reporte_${entidad}_${stamp}.xlsx"`);
      return new StreamableFile(libro);
    }

    if ((formato ?? "").toLowerCase() === "csv") {
      const csv = toCsv(claves, filas, encabezados);
      const stamp = hoyChile();
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="reporte_${entidad}_${stamp}.csv"`);
      // BOM para que Excel (Windows) detecte UTF-8 y no rompa acentos.
      return "﻿" + csv;
    }

    return {
      entidad,
      campos: claves,
      etiquetas: encabezados,
      rango: { desde: desde ?? null, hasta: hasta ?? null },
      // total = filas que cumplen los filtros; devueltas = las que trae esta respuesta.
      meta: { total, devueltas: filas.length, limit: max, limiteExportacion: LIMITE_EXPORTACION },
      data: filas,
    };
  }

  /**
   * §4.6.6/§4.6.7 · Libro Excel: hoja «Datos» con autofiltro y, si se pide un
   * resumen, hoja «Resumen» con la tabla dinámica y su gráfico nativo, más una
   * hoja «Filtros» con lo que se exportó y cuándo.
   */
  private libro(
    entidad: string,
    claves: string[],
    filas: any[],
    resumen: DefResumen | null,
    meta: { desde?: string; hasta?: string; titulo?: string; total?: number },
  ): Buffer {
    const encabezados = etiquetasCampos(entidad, claves);
    const et = (c: string) => etiquetaCampo(entidad, c);
    const datos: Celda[][] = [encabezados, ...filas.map((f) => claves.map((k) => celdaXlsx(f[k])))];
    const anchos = encabezados.map((k, j) => Math.min(50, Math.max(k.length + 2, ...datos.slice(1, 200).map((f) => String(f[j] ?? "").length + 1))));
    const hojas: Hoja[] = [];
    if (resumen) {
      const t = tablaDinamica(filas, resumen);
      const conCols = !!resumen.columnas;
      // Cabecera de la tabla cruzada con nombres legibles.
      t.matriz[0][0] = conCols ? `${et(resumen.filas)} \\ ${et(resumen.columnas!)}` : et(resumen.filas);
      const tituloGrafico = (meta.titulo?.trim() || `${etiquetaEntidad(entidad)} por ${et(resumen.filas).toLowerCase()}`).slice(0, 120);
      hojas.push({
        nombre: "Resumen",
        filas: t.matriz,
        anchos: t.matriz[0].map((_c, j) => (j === 0 ? 30 : 14)),
        grafico:
          resumen.grafico !== "ninguno" && t.grupos > 0
            ? {
                tipo: resumen.grafico as "columna" | "barra" | "linea" | "torta",
                titulo: tituloGrafico,
                desde: 1,
                hasta: t.grupos,
                categorias: 0,
                // Torta: una sola serie (el total de cada grupo).
                series: resumen.grafico === "torta" ? [conCols ? t.series + 1 : 1] : conCols ? Array.from({ length: t.series }, (_x, i) => i + 1) : [1],
              }
            : undefined,
      });
    }
    hojas.push({ nombre: "Datos", filas: datos, autoFiltro: true, anchos });
    hojas.push({
      nombre: "Filtros",
      filas: [
        ["Parámetro", "Valor"],
        ["Entidad", etiquetaEntidad(entidad)],
        ["Desde", meta.desde ?? "(sin límite)"],
        ["Hasta", meta.hasta ?? "(sin límite)"],
        ["Filas exportadas", filas.length],
        ...(meta.total !== undefined && meta.total > filas.length
          ? ([["Aviso", `Se exportan las primeras ${filas.length.toLocaleString("es-CL")} de ${meta.total.toLocaleString("es-CL")} filas; acote los filtros para obtener el resto.`]] as Celda[][])
          : []),
        ["Columnas", encabezados.join(", ")],
        ...(resumen
          ? ([
              ["Resumen · filas", et(resumen.filas)],
              ["Resumen · columnas", resumen.columnas ? et(resumen.columnas) : "—"],
              ["Resumen · valor", resumen.valor ? `${resumen.agregado} de ${et(resumen.valor)}` : "cantidad de registros"],
              ["Gráfico", resumen.grafico ?? "columna"],
            ] as Celda[][])
          : []),
        ["Generado (hora de Chile)", fechaHoraChile(new Date())],
      ],
      anchos: [26, 70],
    });
    return libroXlsx(hojas);
  }

  // --- §4.6.6/§4.6.7 · Plantillas de exportación guardadas -------------------

  private plantillaDto(p: any) {
    return {
      id: p.id,
      nombre: p.nombre,
      descripcion: p.descripcion,
      entidad: p.entidad,
      campos: p.campos ?? [],
      filtros: p.filtros ?? {},
      resumen: p.resumen ?? null,
      compartida: p.compartida,
      creadoPor: p.creado_por_nombre ?? null,
      propia: false,
      editable: false,
      creadoEn: p.creado_en,
    };
  }

  private validarPlantilla(b: any) {
    const nombre = typeof b?.nombre === "string" ? b.nombre.trim() : "";
    if (!nombre || nombre.length > 120) throw new BadRequestException("Indique un nombre (máx. 120 caracteres).");
    const def = ENTIDADES[String(b?.entidad ?? "")];
    if (!def) throw new BadRequestException(`entidad inválida. Válidas: ${Object.keys(ENTIDADES).join(", ")}`);
    const campos: string[] = Array.isArray(b?.campos) ? b.campos.map(String) : [];
    if (!campos.length) throw new BadRequestException("Elija al menos una columna.");
    const malos = campos.filter((c) => !(c in def.columnas));
    if (malos.length) throw new BadRequestException(`campos no permitidos: ${malos.join(", ")}`);
    const f = b?.filtros ?? {};
    const filtros: Record<string, unknown> = {};
    if (f.ultimosDias !== undefined && f.ultimosDias !== null && f.ultimosDias !== "") {
      const n = Number(f.ultimosDias);
      if (!Number.isInteger(n) || n < 1 || n > 3660) throw new BadRequestException("«Últimos días» debe ser un entero entre 1 y 3660.");
      filtros.ultimosDias = n;
    }
    for (const k of ["desde", "hasta"]) {
      if (f[k]) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(f[k]))) throw new BadRequestException(`Filtro ${k} con formato inválido (AAAA-MM-DD).`);
        filtros[k] = String(f[k]);
      }
    }
    const resumen = b?.resumen ? leerResumen(b.resumen, campos) : null;
    const descripcion = typeof b?.descripcion === "string" ? b.descripcion.trim().slice(0, 500) || null : null;
    return { nombre, entidad: String(b.entidad), campos, filtros, resumen, descripcion, compartida: b?.compartida !== false };
  }

  @Get("plantillas")
  @RequierePermiso("reporte.ver")
  async plantillas(@Req() req: any) {
    const tenantId = this.tenantId(req);
    const yo = req?.user?.sub ?? null;
    const f = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT p.*, u.nombre_completo AS creado_por_nombre FROM reporte_plantilla p LEFT JOIN usuario u ON u.id = p.creado_por
        WHERE p.tenant_id = $1::uuid AND p.deleted_at IS NULL AND (p.compartida OR p.creado_por = $2::uuid)
        ORDER BY p.nombre`,
      tenantId,
      yo,
    );
    // editable: misma regla que plantillaPropia (quien la creó o Administración).
    return f.map((p) => ({ ...this.plantillaDto(p), propia: p.creado_por === yo, editable: puedeEditarPlantilla(req?.user, p.creado_por) }));
  }

  @Post("plantillas")
  @RequierePermiso("reporte.ver")
  async crearPlantilla(@Body() b: any, @Req() req: any) {
    const tenantId = this.tenantId(req);
    const v = this.validarPlantilla(b);
    try {
      const r = await this.prisma.$queryRawUnsafe<any[]>(
        `INSERT INTO reporte_plantilla (tenant_id, nombre, descripcion, entidad, campos, filtros, resumen, compartida, creado_por)
         VALUES ($1::uuid, $2, $3, $4, $5::text[], $6::jsonb, $7::jsonb, $8, $9::uuid) RETURNING *`,
        tenantId, v.nombre, v.descripcion, v.entidad, v.campos, JSON.stringify(v.filtros), v.resumen ? JSON.stringify(v.resumen) : null, v.compartida, req?.user?.sub ?? null,
      );
      return { ...this.plantillaDto(r[0]), propia: true, editable: true };
    } catch (e: any) {
      if (/23505/.test(String(e?.message ?? ""))) throw new ConflictException("Ya existe una plantilla con ese nombre.");
      throw e;
    }
  }

  private async plantillaPropia(id: string, req: any) {
    const tenantId = this.tenantId(req);
    const f = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM reporte_plantilla WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL`, id, tenantId);
    if (!f.length) throw new NotFoundException("Plantilla no encontrada.");
    if (!puedeEditarPlantilla(req?.user, f[0].creado_por))
      throw new ForbiddenException("Solo quien creó la plantilla (o Administración) puede cambiarla.");
    return f[0];
  }

  @Patch("plantillas/:id")
  @RequierePermiso("reporte.ver")
  async editarPlantilla(@Param("id", new ParseUUIDPipe()) id: string, @Body() b: any, @Req() req: any) {
    const p = await this.plantillaPropia(id, req);
    const v = this.validarPlantilla({ ...this.plantillaDto(p), ...b });
    try {
      const r = await this.prisma.$queryRawUnsafe<any[]>(
        `UPDATE reporte_plantilla SET nombre = $2, descripcion = $3, entidad = $4, campos = $5::text[], filtros = $6::jsonb,
                resumen = $7::jsonb, compartida = $8, actualizado_en = now() WHERE id = $1::uuid RETURNING *`,
        id, v.nombre, v.descripcion, v.entidad, v.campos, JSON.stringify(v.filtros), v.resumen ? JSON.stringify(v.resumen) : null, v.compartida,
      );
      return { ...this.plantillaDto(r[0]), propia: r[0].creado_por === req?.user?.sub, editable: true };
    } catch (e: any) {
      if (/23505/.test(String(e?.message ?? ""))) throw new ConflictException("Ya existe una plantilla con ese nombre.");
      throw e;
    }
  }

  @Delete("plantillas/:id")
  @RequierePermiso("reporte.ver")
  async borrarPlantilla(@Param("id", new ParseUUIDPipe()) id: string, @Req() req: any) {
    await this.plantillaPropia(id, req);
    await this.prisma.$executeRawUnsafe(`UPDATE reporte_plantilla SET deleted_at = now() WHERE id = $1::uuid`, id);
    return { ok: true };
  }
}

// --- serialización CSV (RFC 4180) ------------------------------------------

/** Convierte un valor de celda a texto plano para CSV. */
function celda(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Escapa según RFC 4180: entrecomilla si hay coma, comilla o salto de línea. */
function escapar(s: string): string {
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(claves: string[], filas: any[], encabezados: string[] = claves): string {
  const lineas = [encabezados.map(escapar).join(",")];
  for (const fila of filas) {
    lineas.push(claves.map((k) => escapar(celda(fila[k]))).join(","));
  }
  return lineas.join("\r\n");
}

@Module({
  // ReportesGestionController (frente r4c) va antes: «gestion.xlsx» no debe caer en otra ruta.
  controllers: [ReportesGestionController, ReportesController],
})
export class ReportesModule {}
