import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Module,
  NotFoundException,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { AuthGuard } from "@nestjs/passport";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { PrismaClient } from "@prisma/client";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";

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
};

// ===========================================================================
// Base común: tenant + filtro de fechas parametrizado
// ===========================================================================

abstract class ReportesBase {
  protected prisma = new PrismaClient();

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
  // --- §4.5.3 · Productividad ---------------------------------------------
  @Get("productividad")
  @RequierePermiso("ot.ver")
  async productividad(
    @Query("desde") desde?: string,
    @Query("hasta") hasta?: string,
    @Req() req?: any,
  ) {
    const tenantId = this.tenantId(req);

    const argsOt: any[] = [tenantId];
    const rangoOt = this.rangoFechas("created_at", desde, hasta, argsOt);

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
    const rangoMu = this.rangoFechas("created_at", desde, hasta, argsMu);
    const muestras = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::int AS total
         FROM muestra
        WHERE tenant_id = $1::uuid AND deleted_at IS NULL ${rangoMu}`,
      ...argsMu,
    );

    const argsCert: any[] = [tenantId];
    const rangoCert = this.rangoFechas("created_at", desde, hasta, argsCert);
    const certificados = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE estado = 'emitido')::int AS emitidos
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
  @RequierePermiso("resultado.ver")
  async conformidad(
    @Query("desde") desde?: string,
    @Query("hasta") hasta?: string,
    @Req() req?: any,
  ) {
    const tenantId = this.tenantId(req);

    const argsG: any[] = [tenantId];
    const rangoG = this.rangoFechas("r.fecha", desde, hasta, argsG);
    const globalRows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT COALESCE(r.veredicto, 'pendiente') AS veredicto, COUNT(*)::int AS total
         FROM resultado r
        WHERE r.tenant_id = $1::uuid AND r.deleted_at IS NULL ${rangoG}
        GROUP BY 1`,
      ...argsG,
    );
    const global = this.resumenVeredicto(globalRows);

    const argsM: any[] = [tenantId];
    const rangoM = this.rangoFechas("r.fecha", desde, hasta, argsM);
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
    const rangoE = this.rangoFechas("r.fecha", desde, hasta, argsE);
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

  // --- §4.5.3 · Plazos (ingreso -> cierre) --------------------------------
  @Get("plazos")
  @RequierePermiso("ot.ver")
  async plazos(
    @Query("desde") desde?: string,
    @Query("hasta") hasta?: string,
    @Req() req?: any,
  ) {
    const tenantId = this.tenantId(req);

    const args: any[] = [tenantId];
    const rango = this.rangoFechas("created_at", desde, hasta, args);

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
    const rangoD = this.rangoFechas("created_at", desde, hasta, argsD);
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
  @RequierePermiso("ot.ver")
  async comercial(
    @Query("desde") desde?: string,
    @Query("hasta") hasta?: string,
    @Req() req?: any,
  ) {
    const tenantId = this.tenantId(req);

    const argsE: any[] = [tenantId];
    const rangoE = this.rangoFechas("created_at", desde, hasta, argsE);
    const porEstado = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT estado, COUNT(*)::int AS total, COALESCE(SUM(total), 0)::float8 AS monto
         FROM cotizacion
        WHERE tenant_id = $1::uuid ${rangoE}
        GROUP BY estado ORDER BY total DESC`,
      ...argsE,
    );

    const argsM: any[] = [tenantId];
    const rangoM = this.rangoFechas("created_at", desde, hasta, argsM);
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
  @Get("entidades")
  @RequierePermiso("ot.ver")
  entidades() {
    return Object.fromEntries(
      Object.entries(ENTIDADES).map(([k, def]) => [
        k,
        { tabla: def.tabla, fechaCol: def.fechaCol, campos: Object.keys(def.columnas) },
      ]),
    );
  }

  @Get("tabla")
  @RequierePermiso("ot.ver")
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
  ) {
    const tenantId = this.tenantId(req);

    const def = ENTIDADES[String(entidad ?? "")];
    if (!def) {
      throw new BadRequestException(
        `entidad inválida. Válidas: ${Object.keys(ENTIDADES).join(", ")}`,
      );
    }

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
    const rango = this.rangoFechas(def.fechaCol, desde, hasta, args);
    const max = Math.min(50000, Math.max(1, parseInt(limit ?? "10000") || 10000));

    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT ${selectList}
         FROM ${def.tabla}
        WHERE tenant_id = $1::uuid ${softClause} ${rango}
        ORDER BY ${def.fechaCol} DESC
        LIMIT ${max}`,
      ...args,
    );

    if ((formato ?? "").toLowerCase() === "csv") {
      const csv = toCsv(claves, filas);
      const stamp = new Date().toISOString().slice(0, 10);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="reporte_${entidad}_${stamp}.csv"`);
      // BOM para que Excel (Windows) detecte UTF-8 y no rompa acentos.
      return "﻿" + csv;
    }

    return {
      entidad,
      campos: claves,
      rango: { desde: desde ?? null, hasta: hasta ?? null },
      meta: { total: filas.length, limit: max },
      data: filas,
    };
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

function toCsv(claves: string[], filas: any[]): string {
  const lineas = [claves.map(escapar).join(",")];
  for (const fila of filas) {
    lineas.push(claves.map((k) => escapar(celda(fila[k]))).join(","));
  }
  return lineas.join("\r\n");
}

@Module({
  controllers: [ReportesController],
})
export class ReportesModule {}
