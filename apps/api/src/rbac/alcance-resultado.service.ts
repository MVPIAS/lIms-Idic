import { ConflictException, ForbiddenException, Global, Injectable, Module, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { AlcanceService } from "./alcance.service";
import {
  AccionResultado,
  ConfigSegregacion,
  DecisionAlcance,
  LabDeResultado,
  PERMISO_ACCION,
  configSegregacion,
  decidirAccionResultado,
} from "./alcance-resultado";

export interface LabDeResultadoOt extends LabDeResultado {
  id: string;
  otId: string | null;
}

/** Destino de una orden interna (cat_familia → unidad por CODSUCDEL), como lims_lab_de_resultado. */
const UNIDAD_DESTINO = `
  JOIN cat_familia f ON f.id = oi.destino_lab
  JOIN LATERAL (
    SELECT u.id FROM unidad u
     WHERE u.tenant_id = f.tenant_id AND u.activa
       AND f.codsucdel = ANY(string_to_array(regexp_replace(COALESCE(u.codsucdel, ''), '[\\s,;]', '/', 'g'), '/'))
     ORDER BY (u.tipo = 'LABORATORIO') DESC, u.codigo
     LIMIT 1) ud ON TRUE`;

/**
 * Alcance por ensayo dentro de la OT (reglas: alcance-resultado.ts). Lo usan la
 * captura (/flujo/resultado/:id/*), la revisión y aprobación (/resultados/*),
 * la vista de la OT (/flujo/ot/:id/resultados) y las bandejas.
 */
@Injectable()
export class AlcanceResultadoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
  ) {}

  private mapear(f: any): LabDeResultadoOt {
    return {
      id: f.id,
      otId: f.ot_id ?? null,
      unidadId: f.unidad_id ?? null,
      principalId: f.principal_id ?? null,
      derivado: !!f.derivado,
      ordenInternaId: f.orden_interna_id ?? null,
      oiNumero: f.oi_numero ?? null,
      oiEstado: f.oi_estado ?? null,
      unidadCodigo: f.unidad_codigo ?? null,
    };
  }

  /** Laboratorio dueño de cada resultado indicado. */
  async labs(ids: string[]): Promise<Map<string, LabDeResultadoOt>> {
    if (!ids.length) return new Map();
    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT r.id, COALESCE(r.ot_id, m.ot_id) AS ot_id, l.*, u.codigo AS unidad_codigo
         FROM resultado r
         JOIN muestra m ON m.id = r.muestra_id
         JOIN LATERAL lims_lab_de_resultado(r.id) l ON TRUE
         LEFT JOIN unidad u ON u.id = l.unidad_id
        WHERE r.id = ANY($1::uuid[])`,
      ids,
    );
    return new Map(filas.map((f) => [f.id, this.mapear(f)]));
  }

  /** Laboratorio dueño de cada ensayo vivo de la OT. */
  async labsDeOt(otId: string, tenantId: string): Promise<Map<string, LabDeResultadoOt>> {
    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT r.id, COALESCE(r.ot_id, m.ot_id) AS ot_id, l.*, u.codigo AS unidad_codigo
         FROM resultado r
         JOIN muestra m ON m.id = r.muestra_id
         JOIN LATERAL lims_lab_de_resultado(r.id) l ON TRUE
         LEFT JOIN unidad u ON u.id = l.unidad_id
        WHERE COALESCE(r.ot_id, m.ot_id) = $1::uuid AND m.tenant_id = $2::uuid AND r.deleted_at IS NULL`,
      otId,
      tenantId,
    );
    return new Map(filas.map((f) => [f.id, this.mapear(f)]));
  }

  /** Función «¿ve esta unidad con este permiso?» del usuario del request (memoizada por la de alcance). */
  async veUnidad(req: any, permiso: string): Promise<(u: string | null) => boolean> {
    const a = await this.alcance.alcancePermisos(req, [permiso]);
    return (u) => a.esGlobal || (!!u && a.unidadIds.includes(u));
  }

  async decidir(req: any, lab: LabDeResultado, accion: AccionResultado, permiso?: string, ensayo?: string): Promise<DecisionAlcance> {
    const ve = await this.veUnidad(req, permiso ?? PERMISO_ACCION[accion]);
    return decidirAccionResultado(lab, accion, ve, ensayo);
  }

  /** 404 / 403 / 409 si el usuario no puede hacer la acción sobre el resultado. Devuelve su laboratorio. */
  async exigir(req: any, resultadoId: string, accion: AccionResultado, permiso?: string, ensayo?: string): Promise<LabDeResultadoOt> {
    const lab = (await this.labs([resultadoId])).get(resultadoId);
    if (!lab) throw new NotFoundException(`Resultado ${resultadoId} no encontrado`);
    const d = await this.decidir(req, lab, accion, permiso, ensayo);
    if (!d.permitido) {
      if (d.status === 409) throw new ConflictException(d.motivo);
      throw new ForbiddenException(d.motivo);
    }
    return lab;
  }

  /** Laboratorios de destino de las órdenes internas vivas (no anuladas) de la OT. */
  async destinosDeOt(otId: string): Promise<{ id: string; estado: string }[]> {
    return this.prisma.$queryRawUnsafe<{ id: string; estado: string }[]>(
      `SELECT DISTINCT ud.id, oi.estado
         FROM orden_interna oi ${UNIDAD_DESTINO}
        WHERE oi.ot_id = $1::uuid AND oi.deleted_at IS NULL AND oi.estado <> 'anulada'`,
      otId,
    );
  }

  /**
   * Qué parte de la OT ve el usuario con el permiso indicado: toda (alcance sobre
   * el responsable) o solo los ensayos derivados a sus laboratorios. 403 si ninguna.
   */
  async alcanceEnOt(
    req: any,
    ot: { id: string; codigo: string; unidadPrincipal: string | null },
    permiso = "resultado.ver",
  ): Promise<{ todo: boolean; labs: Set<string> }> {
    const ve = await this.veUnidad(req, permiso);
    if (ve(ot.unidadPrincipal)) return { todo: true, labs: new Set() };
    const mios = (await this.destinosDeOt(ot.id)).map((d) => d.id).filter((u) => ve(u));
    if (!mios.length)
      throw new ForbiddenException(`Fuera de su alcance: la OT ${ot.codigo} pertenece a una unidad que usted no tiene asignada`);
    return { todo: false, labs: new Set(mios) };
  }

  /** Revisión ≠ aprobación: configuración del tenant (Catálogo › Parámetros). */
  async segregacion(tenantId: string | null | undefined): Promise<ConfigSegregacion> {
    if (!tenantId) return configSegregacion(null, null);
    const filas = await this.prisma.$queryRawUnsafe<{ codigo: string; valor: string | null }[]>(
      `SELECT codigo, valor FROM parametro_sistema
        WHERE tenant_id = $1::uuid AND categoria = 'segregacion_resultado' AND activo`,
      tenantId,
    );
    const v = (c: string) => filas.find((f) => f.codigo === c)?.valor ?? null;
    return configSegregacion(v("revisor_aprobador"), v("excepciones"));
  }
}

/** @Global: lo usan los módulos de laboratorio y de flujo real (importado en AppModule). */
@Global()
@Module({ providers: [AlcanceResultadoService], exports: [AlcanceResultadoService] })
export class AlcanceResultadoModule {}
