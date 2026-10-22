/**
 * Acceso a datos común de los formularios especializados, la preparación de
 * muestras y la documentación del trabajo: la OT con su laboratorio y alcance,
 * los parámetros de la operación, el registro (con versión y bitácora) y los
 * equipos del laboratorio con su aptitud. Todo SQL va con parámetros
 * posicionales; nunca se interpola entrada del usuario.
 */
import { ForbiddenException, HttpException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { AlcanceResultadoService } from "../rbac/alcance-resultado.service";
import { PuenteAnalisisService, type OpcionesCapturaVariante } from "../flujo-real/flujo-real.module";
import type { Variante } from "./variantes";

export const tenantDe = (req: any): string => req?.user?.tenantId;
export const usuarioDe = (req: any): string | null => req?.user?.sub ?? null;

export interface OtFormulario {
  id: string;
  codigo: string;
  estado: string;
  tenantId: string;
  unidadPrincipal: string | null;
  laboratorio: string | null;
  cliente: string | null;
  fechaOt: string | null;
  atencion: string | null;
}

export interface Registro {
  id: string;
  otId: string;
  muestraId: string | null;
  resultadoId: string | null;
  unidadId: string | null;
  variante: string;
  clave: string;
  datos: any;
  estado: string;
  veredicto: string | null;
  resumen: string | null;
  version: number;
  creadoPor: string | null;
  actualizadoPor: string | null;
  actualizadoPorNombre: string | null;
  createdAt: string;
  updatedAt: string;
}

const COLS = `r.id, r.ot_id AS "otId", r.muestra_id AS "muestraId", r.resultado_id AS "resultadoId", r.unidad_id AS "unidadId",
  r.variante, r.clave, r.datos, r.estado, r.veredicto, r.resumen, r.version, r.creado_por AS "creadoPor",
  r.actualizado_por AS "actualizadoPor", u.nombre_completo AS "actualizadoPorNombre", r.created_at AS "createdAt", r.updated_at AS "updatedAt"`;

export interface EquipoLab {
  id: string;
  codigo: string;
  nombre: string;
  serie: string | null;
  unidadCodigo: string | null;
  proximaCalibracion: string | null;
  apto: boolean;
  motivo: string | null;
}

@Injectable()
export class FormulariosDatos {
  constructor(
    readonly prisma: PrismaService,
    private readonly alcanceResultado: AlcanceResultadoService,
    private readonly puente: PuenteAnalisisService,
  ) {}

  /** OT del tenant con su laboratorio responsable (404 si no existe). */
  async ot(otId: string, tenantId: string): Promise<OtFormulario> {
    const f = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT o.id, o.codigo, o.estado, o.tenant_id AS "tenantId", o.unidad_principal AS "unidadPrincipal", u.codigo AS laboratorio,
              c.razon_social AS cliente, to_char(COALESCE(o.fecha_recepcion, o.created_at::date), 'YYYY-MM-DD') AS "fechaOt",
              COALESCE(NULLIF(o.solicitante, ''), (SELECT ct.nombre FROM contacto ct WHERE ct.cliente_id = o.cliente_id AND ct.deleted_at IS NULL ORDER BY ct.principal DESC NULLS LAST, ct.created_at LIMIT 1)) AS atencion
         FROM orden_trabajo o
         LEFT JOIN unidad u ON u.id = o.unidad_principal
         LEFT JOIN cliente c ON c.id = o.cliente_id
        WHERE o.id = $1::uuid AND o.tenant_id = $2::uuid`,
      otId,
      tenantId,
    );
    if (!f[0]) throw new NotFoundException(`Orden de trabajo ${otId} no encontrada`);
    return f[0];
  }

  /** Qué parte de la OT ve o trabaja el usuario con el permiso (403 si ninguna). */
  vista(req: any, ot: OtFormulario, permiso: string) {
    return this.alcanceResultado.alcanceEnOt(req, { id: ot.id, codigo: ot.codigo, unidadPrincipal: ot.unidadPrincipal }, permiso);
  }

  /** 403 si el usuario no trabaja el laboratorio indicado en esta OT con el permiso. */
  async exigirLab(req: any, ot: OtFormulario, permiso: string, unidadId: string | null, que: string) {
    const v = await this.vista(req, ot, permiso);
    if (v.todo || (unidadId && v.labs.has(unidadId))) return v;
    throw new ForbiddenException(`Fuera de su alcance: ${que} es de un laboratorio que usted no tiene asignado.`);
  }

  async params(tenantId: string, categoria: string) {
    return this.prisma.$queryRawUnsafe<{ codigo: string; etiqueta: string; valor: string | null; activo: boolean; orden: number }[]>(
      `SELECT codigo, etiqueta, valor, activo, orden FROM parametro_sistema WHERE tenant_id = $1::uuid AND categoria = $2 ORDER BY orden, codigo`,
      tenantId,
      categoria,
    );
  }

  async param(tenantId: string, categoria: string, codigo: string, porDefecto: string): Promise<string> {
    const f = await this.prisma.$queryRawUnsafe<{ valor: string | null }[]>(
      `SELECT valor FROM parametro_sistema WHERE tenant_id = $1::uuid AND categoria = $2 AND codigo = $3 AND activo`,
      tenantId,
      categoria,
      codigo,
    );
    const v = f[0]?.valor;
    return v == null || v.trim() === "" ? porDefecto : v;
  }

  async registro(otId: string, variante: string, clave: string): Promise<Registro | null> {
    const f = await this.prisma.$queryRawUnsafe<Registro[]>(
      `SELECT ${COLS} FROM registro_especializado r LEFT JOIN usuario u ON u.id = r.actualizado_por
        WHERE r.ot_id = $1::uuid AND r.variante = $2 AND r.clave = $3`,
      otId,
      variante,
      clave,
    );
    return f[0] ?? null;
  }

  async registros(otId: string, variante: string): Promise<Registro[]> {
    return this.prisma.$queryRawUnsafe<Registro[]>(
      `SELECT ${COLS} FROM registro_especializado r LEFT JOIN usuario u ON u.id = r.actualizado_por
        WHERE r.ot_id = $1::uuid AND r.variante = $2 ORDER BY r.clave`,
      otId,
      variante,
    );
  }

  /**
   * Crea o actualiza un registro (versión + 1) y deja el evento en la bitácora,
   * con los datos anteriores si cambiaron (nada se borra). Una transacción.
   */
  async guardar(
    p: {
      tenantId: string;
      otId: string;
      variante: string;
      clave: string;
      muestraId?: string | null;
      resultadoId?: string | null;
      unidadId?: string | null;
      datos: unknown;
      estado: string;
      veredicto?: string | null;
      resumen?: string | null;
    },
    ev: { accion: string; motivo?: string | null; usuarioId: string | null },
  ): Promise<Registro> {
    return this.prisma.$transaction(async (tx) => {
      const previo = await tx.$queryRawUnsafe<{ id: string; datos: any; estado: string; version: number }[]>(
        `SELECT id, datos, estado, version FROM registro_especializado WHERE ot_id = $1::uuid AND variante = $2 AND clave = $3 FOR UPDATE`,
        p.otId,
        p.variante,
        p.clave,
      );
      const antes = previo[0] ?? null;
      const datosJson = JSON.stringify(p.datos ?? {});
      let id: string;
      let version: number;
      if (antes) {
        version = antes.version + 1;
        await tx.$executeRawUnsafe(
          `UPDATE registro_especializado
              SET datos = $2::jsonb, estado = $3, veredicto = $4, resumen = $5, version = $6,
                  muestra_id = COALESCE($7::uuid, muestra_id), resultado_id = COALESCE($8::uuid, resultado_id), unidad_id = COALESCE($9::uuid, unidad_id),
                  actualizado_por = $10::uuid, updated_at = now()
            WHERE id = $1::uuid`,
          antes.id,
          datosJson,
          p.estado,
          p.veredicto ?? null,
          p.resumen ?? null,
          version,
          p.muestraId ?? null,
          p.resultadoId ?? null,
          p.unidadId ?? null,
          ev.usuarioId,
        );
        id = antes.id;
      } else {
        version = 1;
        const ins = await tx.$queryRawUnsafe<{ id: string }[]>(
          `INSERT INTO registro_especializado (tenant_id, ot_id, muestra_id, resultado_id, unidad_id, variante, clave, datos, estado, veredicto, resumen, version, creado_por, actualizado_por)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, $7, $8::jsonb, $9, $10, $11, 1, $12::uuid, $12::uuid) RETURNING id`,
          p.tenantId,
          p.otId,
          p.muestraId ?? null,
          p.resultadoId ?? null,
          p.unidadId ?? null,
          p.variante,
          p.clave,
          datosJson,
          p.estado,
          p.veredicto ?? null,
          p.resumen ?? null,
          ev.usuarioId,
        );
        id = ins[0].id;
      }
      const cambiaron = antes && JSON.stringify(antes.datos) !== datosJson;
      await tx.$executeRawUnsafe(
        `INSERT INTO registro_especializado_evento (tenant_id, registro_id, accion, version, estado_antes, estado_despues, datos_antes, motivo, usuario_id)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::jsonb, $8, $9::uuid)`,
        p.tenantId,
        id,
        ev.accion,
        version,
        antes?.estado ?? null,
        p.estado,
        cambiaron ? JSON.stringify(antes!.datos) : null,
        ev.motivo ?? null,
        ev.usuarioId,
      );
      const f = await tx.$queryRawUnsafe<Registro[]>(
        `SELECT ${COLS} FROM registro_especializado r LEFT JOIN usuario u ON u.id = r.actualizado_por WHERE r.id = $1::uuid`,
        id,
      );
      return f[0];
    });
  }

  /** Bitácora de un registro (sin los datos anteriores completos: se dice si cambiaron). */
  async eventos(registroId: string) {
    return this.prisma.$queryRawUnsafe<any[]>(
      `SELECT e.id, e.accion, e.version, e.estado_antes AS "estadoAntes", e.estado_despues AS "estadoDespues",
              (e.datos_antes IS NOT NULL) AS "cambioDatos", e.motivo, e.created_at AS "createdAt", u.nombre_completo AS "usuarioNombre"
         FROM registro_especializado_evento e LEFT JOIN usuario u ON u.id = e.usuario_id
        WHERE e.registro_id = $1::uuid ORDER BY e.created_at DESC, e.version DESC LIMIT 200`,
      registroId,
    );
  }

  /** Equipos de los laboratorios indicados (y los comunes) con su aptitud de calibración. */
  async equipos(tenantId: string, unidadIds: string[]): Promise<EquipoLab[]> {
    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT e.id, e.codigo, e.nombre, e.serie, e.estado, u.codigo AS "unidadCodigo",
              to_char(e.proxima_calibracion, 'YYYY-MM-DD') AS "proximaCalibracion",
              (e.estado = 'operativo' AND e.proxima_calibracion IS NOT NULL AND e.proxima_calibracion >= CURRENT_DATE) AS apto,
              (e.proxima_calibracion IS NOT NULL AND e.proxima_calibracion < CURRENT_DATE) AS vencida
         FROM equipo e LEFT JOIN unidad u ON u.id = e.unidad_id
        WHERE e.tenant_id = $1::uuid AND e.deleted_at IS NULL AND (e.unidad_id IS NULL OR e.unidad_id = ANY($2::uuid[]))
        ORDER BY (e.unidad_id IS NULL), e.codigo LIMIT 300`,
      tenantId,
      unidadIds,
    );
    return filas.map((e) => ({
      id: e.id,
      codigo: e.codigo,
      nombre: e.nombre,
      serie: e.serie,
      unidadCodigo: e.unidadCodigo,
      proximaCalibracion: e.proximaCalibracion,
      apto: !!e.apto,
      motivo: e.apto
        ? null
        : e.estado === "en_calibracion"
          ? "En calibración"
          : e.estado === "fuera_servicio"
            ? "Fuera de servicio"
            : e.estado !== "operativo"
              ? `No operativo (${e.estado})`
              : e.vencida
                ? `Calibración vencida el ${String(e.proximaCalibracion).split("-").reverse().join("-")}`
                : "Sin calibración registrada",
    }));
  }

  /** Ensayos de la OT con método, muestra y estado (para llevar el valor de una variante). */
  async ensayosOt(otId: string) {
    return this.prisma.$queryRawUnsafe<any[]>(
      `SELECT r.id, r.muestra_id AS "muestraId", m.codigo AS "muestraCodigo", m.nombre AS "muestraNombre", r.estado, r.veredicto,
              r.valor_texto AS "valorTexto", cm.codigo AS "metodoCodigo", cm.nombre AS "metodo",
              COALESCE(ca.nombre, cm.nombre) AS ensayo
         FROM resultado r JOIN muestra m ON m.id = r.muestra_id AND m.deleted_at IS NULL
         LEFT JOIN cat_metodo cm ON cm.id = r.cat_metodo_id
         LEFT JOIN cat_analito ca ON ca.id = r.cat_analito_id
        WHERE COALESCE(r.ot_id, m.ot_id) = $1::uuid AND r.deleted_at IS NULL
        ORDER BY m.codigo, cm.codigo, ca.nombre`,
      otId,
    );
  }

  /** Muestras de la OT. */
  async muestras(otId: string) {
    return this.prisma.$queryRawUnsafe<{ id: string; codigo: string; nombre: string | null }[]>(
      `SELECT id, codigo, nombre FROM muestra WHERE ot_id = $1::uuid AND deleted_at IS NULL ORDER BY codigo`,
      otId,
    );
  }

  /**
   * Lleva el valor decidido por el formulario al resultado estándar (que sigue
   * el camino normal: revisión, aprobación, informe). Lo revisado o aprobado no
   * se toca: se informa como pendiente de reabrir.
   */
  async llevar(
    req: any,
    tenantId: string,
    destino: { id: string; estado: string; ensayo?: string | null; muestraCodigo?: string | null },
    variante: Variante,
    registro: OpcionesCapturaVariante["registro"],
    motivo: string | null,
  ): Promise<{ id: string; ok: boolean; motivo?: string }> {
    if (registro.veredicto === "pendiente") return { id: destino.id, ok: false, motivo: "El formulario aún no tiene veredicto para este ensayo." };
    try {
      await this.puente.capturarValor(
        destino.id,
        { motivo: motivo ?? undefined } as any,
        tenantId,
        req,
        { variante, registro },
      );
      return { id: destino.id, ok: true };
    } catch (e) {
      const m = e instanceof HttpException ? (e.getResponse() as any)?.message ?? e.message : (e as Error).message;
      return { id: destino.id, ok: false, motivo: `${destino.muestraCodigo ?? ""} ${destino.ensayo ?? ""}: ${Array.isArray(m) ? m.join(" ") : m}`.trim() };
    }
  }
}
