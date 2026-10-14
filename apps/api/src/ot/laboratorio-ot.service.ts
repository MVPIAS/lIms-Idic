import { BadRequestException, Global, Injectable, Module } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import {
  Deduccion,
  PistaLaboratorio,
  TIPOS_UNIDAD_OPERATIVA,
  deducirLaboratorio,
  mensajeLaboratorioRequerido,
} from "./laboratorio-ot";

/** Cliente con el que se escribe: el servicio o la transacción en curso. */
type Sql = Pick<PrismaService, "$queryRawUnsafe" | "$executeRawUnsafe">;

export interface UnidadResumen {
  id: string;
  codigo: string;
  nombre: string;
  tipo: string | null;
}

export interface PistasEntrada {
  cotizacionId?: string | null;
  centroCostoId?: string | null;
  catElementoIds?: string[];
  catMetodoIds?: string[];
  catEnsayoIds?: string[];
}

/** Roles que pueden recibir trabajo asignado dentro de un laboratorio. */
export const ROLES_ASIGNABLES = ["ANALISTA", "ANALISTA_SR", "REVISOR", "TECNICO", "METROLOGO", "INSPECTOR", "JEFE_LAB"];

/** familia del catálogo (CODSUCDEL) → unidad cuyo codsucdel la contiene ("3009/3008"). */
const SQL_FAMILIA_A_UNIDAD = `
  SELECT DISTINCT u.id
    FROM cat_familia f
    JOIN unidad u ON u.tenant_id = f.tenant_id AND u.activa
     AND f.codsucdel = ANY(string_to_array(regexp_replace(COALESCE(u.codsucdel, ''), '[\\s,;]', '/', 'g'), '/'))
   WHERE f.id = ANY($1::uuid[])`;

/**
 * Laboratorio responsable de la OT (unidad_principal): catálogo de unidades
 * elegibles, deducción desde catálogo/cotización, validación, cambio con
 * historial y personal asignable. Reglas puras en laboratorio-ot.ts.
 *
 * @Global: lo usan OtController, CotizacionService (al aceptar) y el puente de
 * captura (al generar análisis de una OT que aún no tiene laboratorio).
 */
@Injectable()
export class LaboratorioOtService {
  constructor(private readonly prisma: PrismaService) {}

  /** Unidades que pueden ser responsables de una OT (para el selector). */
  async laboratorios(tenantId: string | undefined): Promise<(UnidadResumen & { codsucdel: string | null })[]> {
    return this.prisma.$queryRawUnsafe(
      `SELECT u.id, u.codigo, u.nombre, u.tipo, u.codsucdel
         FROM unidad u
        WHERE u.activa
          AND ($1::uuid IS NULL OR u.tenant_id = $1::uuid)
          AND (u.tipo IN ('LABORATORIO','SUCURSAL','DELEGACION')
               OR (u.tipo = 'SECCION' AND COALESCE(u.codsucdel, '') <> ''))
        ORDER BY CASE u.tipo WHEN 'LABORATORIO' THEN 0 WHEN 'SECCION' THEN 1 WHEN 'DELEGACION' THEN 2 ELSE 3 END, u.codigo`,
      tenantId ?? null,
    );
  }

  /** La unidad existe, está activa, es del tenant y es operativa; si no, 400. */
  async validarUnidad(tenantId: string, unidadId: string): Promise<UnidadResumen> {
    const u = await this.prisma.unidad.findFirst({
      where: { id: unidadId, tenantId },
      select: { id: true, codigo: true, nombre: true, tipo: true, activa: true },
    });
    if (!u) throw new BadRequestException("El laboratorio indicado no existe.");
    if (!u.activa) throw new BadRequestException(`La unidad ${u.codigo} está inactiva.`);
    if (u.tipo && !(TIPOS_UNIDAD_OPERATIVA as readonly string[]).includes(u.tipo))
      throw new BadRequestException(
        `${u.codigo} · ${u.nombre} no puede ser responsable de una OT (es ${u.tipo.toLowerCase()}). Elija un laboratorio, sección técnica, sucursal o delegación.`,
      );
    return { id: u.id, codigo: u.codigo, nombre: u.nombre, tipo: u.tipo };
  }

  async unidadPorCodigo(tenantId: string, codigo: string): Promise<UnidadResumen | null> {
    const u = await this.prisma.unidad.findFirst({
      where: { tenantId, codigo, activa: true },
      select: { id: true, codigo: true, nombre: true, tipo: true },
    });
    return u ?? null;
  }

  /** Reúne las pistas del catálogo / cotización y deduce (reglas en laboratorio-ot.ts). */
  async deducir(tenantId: string, e: PistasEntrada): Promise<Deduccion & { unidad: UnidadResumen | null }> {
    const pistas: PistaLaboratorio[] = [];
    const ensayoIds = new Set<string>(e.catEnsayoIds ?? []);
    const centros = new Set<string>(e.centroCostoId ? [e.centroCostoId] : []);

    if (e.cotizacionId) {
      const cot = await this.prisma.cotizacion.findFirst({
        where: { id: e.cotizacionId, tenantId },
        select: { centroCostoId: true, lineas: { select: { catEnsayoId: true } } },
      });
      if (cot?.centroCostoId) centros.add(cot.centroCostoId);
      for (const l of cot?.lineas ?? []) if (l.catEnsayoId) ensayoIds.add(l.catEnsayoId);
    }

    if (centros.size) {
      const ccs = await this.prisma.centroCosto.findMany({
        where: { id: { in: [...centros] }, tenantId },
        select: { unidadId: true },
      });
      for (const c of ccs) if (c.unidadId) pistas.push({ unidadId: c.unidadId, fuente: "centro_costo" });
    }

    if (e.catMetodoIds?.length) {
      const ms = await this.prisma.catMetodo.findMany({
        where: { id: { in: e.catMetodoIds }, tenantId },
        select: { ensayoId: true },
      });
      const deMetodos = ms.map((m) => m.ensayoId).filter((x): x is string => Boolean(x));
      const familias = await this.familiasDeEnsayos(deMetodos);
      for (const id of await this.unidadesDeFamilias(familias)) pistas.push({ unidadId: id, fuente: "metodo" });
    }

    if (ensayoIds.size) {
      const familias = await this.familiasDeEnsayos([...ensayoIds]);
      for (const id of await this.unidadesDeFamilias(familias)) pistas.push({ unidadId: id, fuente: "ensayo" });
    }

    if (e.catElementoIds?.length) {
      const els = await this.prisma.catElemento.findMany({
        where: { id: { in: e.catElementoIds }, tenantId },
        select: { familiaId: true },
      });
      const familias = els.map((x) => x.familiaId).filter((x): x is string => Boolean(x));
      for (const id of await this.unidadesDeFamilias(familias)) pistas.push({ unidadId: id, fuente: "elemento" });
    }

    const d = deducirLaboratorio(pistas);
    const unidad = d.unidadId
      ? await this.prisma.unidad.findUnique({
          where: { id: d.unidadId },
          select: { id: true, codigo: true, nombre: true, tipo: true },
        })
      : null;
    return { ...d, unidad };
  }

  /**
   * Laboratorio con el que nace una OT: el indicado (validado) o el deducido.
   * Si no hay ninguno, 400 pidiendo que se elija.
   */
  async resolverParaAlta(tenantId: string, indicado: string | null | undefined, pistas: PistasEntrada): Promise<UnidadResumen> {
    if (indicado) return this.validarUnidad(tenantId, indicado);
    const d = await this.deducir(tenantId, pistas);
    if (d.unidad) return d.unidad;
    throw new BadRequestException(mensajeLaboratorioRequerido(d));
  }

  private async familiasDeEnsayos(ids: string[]): Promise<string[]> {
    if (!ids.length) return [];
    const es = await this.prisma.catEnsayo.findMany({ where: { id: { in: ids } }, select: { familiaId: true } });
    return es.map((x) => x.familiaId).filter((x): x is string => Boolean(x));
  }

  private async unidadesDeFamilias(familias: string[]): Promise<string[]> {
    if (!familias.length) return [];
    const filas = await this.prisma.$queryRawUnsafe<{ id: string }[]>(SQL_FAMILIA_A_UNIDAD, [...new Set(familias)]);
    return filas.map((f) => f.id);
  }

  /** Anota un hecho en el historial de la OT. */
  async anotar(sql: Sql, d: { tenantId: string; otId: string; tipo: string; detalle: Record<string, unknown>; usuarioId?: string | null }) {
    await sql.$executeRawUnsafe(
      `INSERT INTO ot_historial (tenant_id, ot_id, tipo, detalle, usuario_id) VALUES ($1::uuid, $2::uuid, $3, $4::jsonb, $5::uuid)`,
      d.tenantId,
      d.otId,
      d.tipo,
      JSON.stringify(d.detalle ?? {}),
      d.usuarioId ?? null,
    );
  }

  /**
   * Fija (o cambia) el laboratorio responsable y lo deja en el historial.
   * `sql` permite hacerlo dentro de la transacción del alta.
   */
  async fijar(
    sql: Sql,
    d: { tenantId: string; otId: string; unidad: UnidadResumen; usuarioId?: string | null; anterior?: UnidadResumen | null; motivo?: string | null; origen: string },
  ) {
    await sql.$executeRawUnsafe(
      `UPDATE orden_trabajo SET unidad_principal = $2::uuid, unidad_asignada_por = $3::uuid, unidad_asignada_at = now(), updated_at = now()
        WHERE id = $1::uuid`,
      d.otId,
      d.unidad.id,
      d.usuarioId ?? null,
    );
    await this.anotar(sql, {
      tenantId: d.tenantId,
      otId: d.otId,
      tipo: "laboratorio",
      usuarioId: d.usuarioId,
      detalle: {
        origen: d.origen,
        desde: d.anterior ? { id: d.anterior.id, codigo: d.anterior.codigo, nombre: d.anterior.nombre } : null,
        hacia: { id: d.unidad.id, codigo: d.unidad.codigo, nombre: d.unidad.nombre },
        ...(d.motivo ? { motivo: d.motivo } : {}),
      },
    });
  }

  /** Personal de la unidad al que se le puede asignar trabajo (rol vigente en ESA unidad). */
  async personalDeUnidad(unidadId: string): Promise<{ id: string; nombre: string; username: string; roles: string[] }[]> {
    const filas = await this.prisma.$queryRawUnsafe<{ id: string; nombre: string; username: string; roles: string[] }[]>(
      `SELECT u.id, u.nombre_completo AS nombre, u.username::text AS username,
              array_agg(DISTINCT r.codigo ORDER BY r.codigo) AS roles
         FROM usuario_rol ur
         JOIN usuario u ON u.id = ur.usuario_id AND u.deleted_at IS NULL AND COALESCE(u.estado, 'activo') = 'activo'
         JOIN rol r ON r.id = ur.rol_id
        WHERE ur.unidad_id = $1::uuid
          AND r.codigo = ANY($2::text[])
          AND (ur.vigente_desde IS NULL OR ur.vigente_desde <= now())
          AND (ur.vigente_hasta IS NULL OR ur.vigente_hasta > now())
        GROUP BY u.id, u.nombre_completo, u.username
        ORDER BY u.nombre_completo`,
      unidadId,
      ROLES_ASIGNABLES,
    );
    return filas;
  }
}

@Global()
@Module({ providers: [LaboratorioOtService], exports: [LaboratorioOtService] })
export class LaboratorioOtModule {}
