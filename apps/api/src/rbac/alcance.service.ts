import { ForbiddenException, Global, Injectable, Module } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import {
  Arbol,
  AsignacionAlcance,
  JefaturaAlcance,
  calcularAlcance,
  construirArbol,
  esVigente,
  perfilDe,
} from "./alcance";
import { Perfil, ROLES_SIEMPRE_GLOBALES, codigoCanonico } from "./rbac.constants";

/** Usuario tal como lo deja JwtStrategy en req.user. */
export interface UsuarioReq {
  sub: string;
  tenantId?: string;
  roles?: string[];
}

export interface AsignacionDetalle extends AsignacionAlcance {
  id: string;
  rolId: string;
  rolNombre: string;
  unidad: { id: string; codigo: string; nombre: string; tipo: string | null } | null;
}

export interface ContextoAlcance {
  usuarioId: string;
  esGlobal: boolean;
  /** Unidades visibles; vacío cuando esGlobal (= todas). */
  unidadIds: string[];
  perfil: Perfil;
  asignaciones: AsignacionDetalle[];
  asignacionesVigentes: AsignacionDetalle[];
  jefaturas: (JefaturaAlcance & { rol: string })[];
}

const TTL_ARBOL_MS = 30_000;

/**
 * Alcance por unidad (laboratorio) del usuario. Reutilizable por cualquier
 * módulo: AlcanceModule es @Global y exporta este servicio.
 *
 *   const filtro = await alcance.filtroUnidades(req); // null = sin filtro (global)
 *   where: filtro ? { unidadPrincipal: { in: filtro } } : {}
 *
 * Se calcula EN VIVO desde la BD (vigencias y cambios de estructura se aplican
 * sin re-login) y se memoiza por request (req.__alcance). El árbol de unidades
 * se cachea 30 s por tenant y se invalida al editar unidades.
 */
@Injectable()
export class AlcanceService {
  private cacheArbol = new Map<string, { exp: number; arbol: Arbol }>();

  constructor(private readonly prisma: PrismaService) {}

  invalidarArbol() {
    this.cacheArbol.clear();
  }

  async arbol(tenantId?: string): Promise<Arbol> {
    const clave = tenantId ?? "*";
    const c = this.cacheArbol.get(clave);
    if (c && c.exp > Date.now()) return c.arbol;
    const filas = await this.prisma.unidad.findMany({
      where: tenantId ? { tenantId } : {},
      select: { id: true, padreId: true, codigo: true, nombre: true, tipo: true, activa: true },
    });
    const arbol = construirArbol(filas);
    this.cacheArbol.set(clave, { exp: Date.now() + TTL_ARBOL_MS, arbol });
    return arbol;
  }

  async asignacionesDe(usuarioId: string): Promise<AsignacionDetalle[]> {
    const filas = await this.prisma.usuarioRol.findMany({
      where: { usuarioId },
      include: {
        rol: { select: { id: true, codigo: true, nombre: true, nivel: true, alcance: true, aliasDe: true } },
        unidad: { select: { id: true, codigo: true, nombre: true, tipo: true } },
      },
      orderBy: { vigenteDesde: "asc" },
    });
    return filas.map((f) => ({
      id: f.id,
      rolId: f.rolId,
      rolCodigo: f.rol.codigo,
      rolNombre: f.rol.nombre,
      aliasDe: f.rol.aliasDe,
      alcance: f.rol.alcance,
      nivel: f.rol.nivel,
      unidadId: f.unidadId,
      unidad: f.unidad ?? null,
      vigenteDesde: f.vigenteDesde,
      vigenteHasta: f.vigenteHasta,
    }));
  }

  async jefaturasDe(usuarioId: string): Promise<(JefaturaAlcance & { rol: string })[]> {
    const filas = await this.prisma.unidadJefe.findMany({
      where: { usuarioId },
      select: { unidadId: true, rol: true },
    });
    return filas;
  }

  async contexto(usuarioId: string, tenantId?: string, rolesJwt: string[] = []): Promise<ContextoAlcance> {
    const [arbol, asignaciones, jefaturas] = await Promise.all([
      this.arbol(tenantId),
      this.asignacionesDe(usuarioId),
      this.jefaturasDe(usuarioId),
    ]);
    const ahora = new Date();
    const vigentes = asignaciones.filter((a) => esVigente(a, ahora));
    let { esGlobal, unidadIds } = calcularAlcance(vigentes, jefaturas, arbol, ahora);
    // Un SUPERADMIN del token (p. ej. el admin creado por CLI) ve todo aunque
    // su asignación aún no esté en BD.
    if (rolesJwt.some((r) => ROLES_SIEMPRE_GLOBALES.includes(codigoCanonico(r)))) {
      esGlobal = true;
      unidadIds = [];
    }
    return {
      usuarioId,
      esGlobal,
      unidadIds,
      perfil: perfilDe(vigentes, jefaturas, arbol, ahora),
      asignaciones,
      asignacionesVigentes: vigentes,
      jefaturas,
    };
  }

  /** Contexto del usuario autenticado, memoizado en el request. */
  async paraRequest(req: any): Promise<ContextoAlcance> {
    if (req?.__alcance) return req.__alcance;
    const u: UsuarioReq | undefined = req?.user;
    if (!u?.sub) {
      return {
        usuarioId: "",
        esGlobal: false,
        unidadIds: [],
        perfil: "LECTOR",
        asignaciones: [],
        asignacionesVigentes: [],
        jefaturas: [],
      };
    }
    const ctx = await this.contexto(u.sub, u.tenantId, u.roles ?? []);
    if (req) req.__alcance = ctx;
    return ctx;
  }

  /** null = sin filtro (global); string[] = solo esas unidades (puede ser vacío). */
  async filtroUnidades(req: any): Promise<string[] | null> {
    const ctx = await this.paraRequest(req);
    return ctx.esGlobal ? null : ctx.unidadIds;
  }

  async puedeVerUnidad(req: any, unidadId: string | null | undefined): Promise<boolean> {
    const ctx = await this.paraRequest(req);
    if (ctx.esGlobal) return true;
    return !!unidadId && ctx.unidadIds.includes(unidadId);
  }

  /** Lanza 403 si la unidad queda fuera del alcance del usuario. */
  async exigirUnidad(req: any, unidadId: string | null | undefined, que = "el recurso") {
    if (!(await this.puedeVerUnidad(req, unidadId))) {
      throw new ForbiddenException(`Fuera de su alcance: ${que} pertenece a una unidad que usted no tiene asignada`);
    }
  }
}

@Global()
@Module({ providers: [AlcanceService], exports: [AlcanceService] })
export class AlcanceModule {}
