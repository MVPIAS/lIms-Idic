import { ForbiddenException, Global, Injectable, Module } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import {
  AlcancePermiso,
  Arbol,
  AsignacionAlcance,
  JefaturaAlcance,
  alcanceDePermisos,
  calcularAlcance,
  construirArbol,
  entraEnAmbito,
  esVigente,
  perfilDe,
  resolverAmbito,
} from "./alcance";
import { Perfil, ROLES_SIEMPRE_GLOBALES, codigoCanonico, definicionAmbito } from "./rbac.constants";

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
  /** Permisos del rol de la asignación. */
  permisos: string[];
}

export interface ContextoAlcance {
  usuarioId: string;
  /**
   * Alcance que rige en este contexto. En un request (paraRequest) es el de los
   * permisos que exige la ruta (alcance por asignación); fuera de un request,
   * o en rutas sin permiso, la unión de todas las asignaciones.
   */
  esGlobal: boolean;
  /** Unidades visibles; vacío cuando esGlobal (= todas). */
  unidadIds: string[];
  /** Unión de todas las asignaciones (alcance «por usuario»): bandeja, perfil, /me/alcance. */
  usuario: { esGlobal: boolean; unidadIds: string[] };
  /** Permisos que exige la ruta (vacío fuera de un request o en rutas sin permiso). */
  permisosRuta: string[];
  /** Rol SUPERADMIN en el token: todo vale en todas partes. */
  superadmin: boolean;
  perfil: Perfil;
  asignaciones: AsignacionDetalle[];
  asignacionesVigentes: AsignacionDetalle[];
  jefaturas: (JefaturaAlcance & { rol: string })[];
}

const TTL_ARBOL_MS = 30_000;

/** Lista normalizada de permisos (uno, varios o ninguno). */
const lista = (p?: string | readonly string[] | null): string[] => (p ? ([] as string[]).concat(p as any) : []);

/**
 * Alcance por unidad (laboratorio) del usuario. Reutilizable por cualquier
 * módulo: AlcanceModule es @Global y exporta este servicio.
 *
 *   const filtro = await alcance.filtroUnidades(req); // null = sin filtro (global)
 *   where: filtro ? { unidadPrincipal: { in: filtro } } : {}
 *
 * ALCANCE POR ASIGNACIÓN: PermisoGuard deja en el request los permisos que
 * exige la ruta y el filtro vale con el alcance de las asignaciones cuyo rol
 * los concede (docs/ADMIN_ROLES.md › «Alcance por asignación»). Cuando una
 * acción exige un permiso distinto del de la ruta (p. ej. la transición de un
 * flujo), se pasa explícito: `filtroUnidades(req, "resultado.aprobar")`.
 *
 * Se calcula EN VIVO desde la BD (vigencias y cambios de estructura se aplican
 * sin re-login) y se memoiza por request. El árbol de unidades se cachea 30 s
 * por tenant y se invalida al editar unidades.
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
        rol: {
          select: {
            id: true,
            codigo: true,
            nombre: true,
            nivel: true,
            alcance: true,
            aliasDe: true,
            rolPermisos: { select: { permiso: { select: { codigo: true } } } },
          },
        },
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
      permisos: (f.rol.rolPermisos ?? []).map((rp) => rp.permiso.codigo),
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
    const superadmin = rolesJwt.some((r) => codigoCanonico(r) === "SUPERADMIN");
    if (rolesJwt.some((r) => ROLES_SIEMPRE_GLOBALES.includes(codigoCanonico(r)))) {
      esGlobal = true;
      unidadIds = [];
    }
    return {
      usuarioId,
      esGlobal,
      unidadIds,
      usuario: { esGlobal, unidadIds },
      permisosRuta: [],
      superadmin,
      perfil: perfilDe(vigentes, jefaturas, arbol, ahora),
      asignaciones,
      asignacionesVigentes: vigentes,
      jefaturas,
    };
  }

  /** Contexto base del usuario autenticado (unión de asignaciones), memoizado en el request. */
  private async base(req: any): Promise<ContextoAlcance> {
    if (req?.__alcanceBase) return req.__alcanceBase;
    const u: UsuarioReq | undefined = req?.user;
    if (!u?.sub) {
      return {
        usuarioId: "",
        esGlobal: false,
        unidadIds: [],
        usuario: { esGlobal: false, unidadIds: [] },
        permisosRuta: [],
        superadmin: false,
        perfil: "LECTOR",
        asignaciones: [],
        asignacionesVigentes: [],
        jefaturas: [],
      };
    }
    const ctx = await this.contexto(u.sub, u.tenantId, u.roles ?? []);
    if (req) req.__alcanceBase = ctx;
    return ctx;
  }

  /**
   * Alcance de una lista de permisos (todos exigidos) para el usuario del
   * request. Lista vacía = unión de todas sus asignaciones.
   */
  async alcancePermisos(req: any, permisos: string | readonly string[] | null | undefined): Promise<AlcancePermiso> {
    const ctx = await this.base(req);
    const ps = lista(permisos);
    const clave = ps.slice().sort().join(",");
    const memo: Map<string, AlcancePermiso> | undefined = req ? (req.__alcancePorPermiso ??= new Map()) : undefined;
    const hit = memo?.get(clave);
    if (hit) return hit;
    const arbol = await this.arbol(req?.user?.tenantId);
    let r = alcanceDePermisos(ctx.asignacionesVigentes, ctx.jefaturas, arbol, ps, new Date(), ctx.superadmin);
    // Ruta sin permiso: rige la unión de siempre (ctx.usuario); de la cuenta
    // por asignación se conservan los roles globales y las unidades propias,
    // que usan los ámbitos estrictos.
    if (ps.length === 0) r = { ...r, esGlobal: ctx.usuario.esGlobal, unidadIds: ctx.usuario.unidadIds };
    memo?.set(clave, r);
    return r;
  }

  /** Contexto del usuario autenticado, con el alcance de los permisos que exige la ruta. */
  async paraRequest(req: any): Promise<ContextoAlcance> {
    const base = await this.base(req);
    const permisosRuta: string[] = lista(req?.__permisosRuta);
    if (permisosRuta.length === 0) return base;
    const a = await this.alcancePermisos(req, permisosRuta);
    return { ...base, esGlobal: a.esGlobal, unidadIds: a.unidadIds, permisosRuta };
  }

  /** Permisos con los que se evalúa el alcance: los indicados o los de la ruta. */
  private permisosDe(req: any, permiso?: string | readonly string[] | null): string[] {
    const ps = lista(permiso);
    return ps.length ? ps : lista(req?.__permisosRuta);
  }

  /**
   * null = sin filtro (global); string[] = solo esas unidades (puede ser vacío).
   * Sin `permiso`, vale el de la ruta (alcance por asignación).
   */
  async filtroUnidades(req: any, permiso?: string | readonly string[] | null): Promise<string[] | null> {
    const a = await this.alcancePermisos(req, this.permisosDe(req, permiso));
    return a.esGlobal ? null : a.unidadIds;
  }

  async puedeVerUnidad(req: any, unidadId: string | null | undefined, permiso?: string | readonly string[] | null): Promise<boolean> {
    const a = await this.alcancePermisos(req, this.permisosDe(req, permiso));
    if (a.esGlobal) return true;
    return !!unidadId && a.unidadIds.includes(unidadId);
  }

  /** Lanza 403 si la unidad queda fuera del alcance del usuario (para el permiso de la ruta o el indicado). */
  async exigirUnidad(req: any, unidadId: string | null | undefined, que = "el recurso", permiso?: string | readonly string[] | null) {
    if (!(await this.puedeVerUnidad(req, unidadId, permiso))) {
      throw new ForbiddenException(`Fuera de su alcance: ${que} pertenece a una unidad que usted no tiene asignada`);
    }
  }

  /**
   * ¿El usuario entra en el ámbito `codigo` (rama del organigrama) con estos
   * permisos? null = el ámbito no se puede evaluar (la raíz no existe en esta
   * instalación). `extra` añade unidades sueltas al ámbito.
   */
  async entraEnAmbito(
    req: any,
    codigo: string,
    permisos?: string | readonly string[] | null,
    extra: readonly string[] = [],
  ): Promise<{ entra: boolean; nombre: string } | null> {
    const arbol = await this.arbol(req?.user?.tenantId);
    const ambito = resolverAmbito(arbol, definicionAmbito(codigo), extra);
    if (!ambito) return null;
    const a = await this.alcancePermisos(req, this.permisosDe(req, permisos));
    return { entra: entraEnAmbito(a, ambito), nombre: ambito.nombre };
  }
}

@Global()
@Module({ providers: [AlcanceService], exports: [AlcanceService] })
export class AlcanceModule {}
