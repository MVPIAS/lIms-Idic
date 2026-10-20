import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PUBLIC_KEY } from "../auth/public.decorator";
import { PrismaService } from "../common/prisma.service";
import { AlcanceService } from "./alcance.service";

/**
 * Alcance por laboratorio del CATÁLOGO (frente L · C9).
 *
 * `catalogo.gestionar`, `metodo.crear` y `metodo.aprobar` los tienen tanto los
 * roles transversales (Calidad, Administración) como las jefaturas de
 * laboratorio, sección y departamento. El permiso por sí solo no dice DÓNDE
 * vale: sin esta guarda, cualquier jefe cambiaba el precio o el método de otro
 * laboratorio.
 *
 * ESCRITURAS (POST, PUT, PATCH, DELETE) cuya ruta exige alguno de esos permisos:
 *   · con alcance GLOBAL para el permiso (rol transversal): pasa, como hoy;
 *   · con alcance acotado: solo si la ruta declara su recurso con
 *     @RecursoDeLaboratorio(tipo) y el laboratorio del registro (y el del
 *     registro padre que indique el cuerpo, al crear o mover) está en su
 *     alcance. El laboratorio de un ensayo es el de su familia del catálogo
 *     (cat_familia.codsucdel ⊂ unidad.codsucdel); los métodos, analitos,
 *     especificaciones, paneles y pasos heredan el de su ensayo;
 *   · las tablas comunes de todo el instituto (grandes grupos, grupos,
 *     familias, elementos, tipos de muestra, parámetros, listas de precio,
 *     formatos…) no declaran recurso: las mantiene quien tiene el permiso con
 *     alcance global (Calidad, Administración).
 * Una ruta que solo valida (no escribe) se marca con @SinAlcanceDeEscritura().
 *
 * DETALLE por id (GET /:id) de una ruta con @RecursoDeLaboratorio: quien no
 * tiene alcance global para el permiso de la ruta (`muestra.ver`) solo abre
 * los registros de SU laboratorio y los que no tienen laboratorio (comunes).
 * Los listados del catálogo siguen siendo comunes (los usa la cascada de
 * registro de muestras y el cotizador); ocultar precios es de la fase 1.
 */
export const PERMISOS_SIN_LABORATORIO = ["catalogo.gestionar", "metodo.crear", "metodo.aprobar"];

export type TipoRecursoLaboratorio = "cat_ensayo" | "cat_metodo" | "cat_analito" | "cat_especificacion" | "cat_panel" | "paso_metodo";

export const RECURSO_LABORATORIO_KEY = "recurso_laboratorio";
export const SIN_ALCANCE_ESCRITURA_KEY = "sin_alcance_escritura";

/** La ruta lee o escribe registros con laboratorio (vía su ensayo y familia del catálogo). */
export const RecursoDeLaboratorio = (tipo: TipoRecursoLaboratorio) => SetMetadata(RECURSO_LABORATORIO_KEY, tipo);
/** La ruta usa el verbo POST pero no escribe (p. ej. validar una fórmula). */
export const SinAlcanceDeEscritura = () => SetMetadata(SIN_ALCANCE_ESCRITURA_KEY, true);

/** Unidades de una familia del catálogo (mismo criterio que planillas-ot.ts y orden-interna.ts). */
const UNIDADES_DE_FAMILIA = `
  SELECT u.id::text AS id FROM cat_familia f
    JOIN unidad u ON u.tenant_id = f.tenant_id
                 AND f.codsucdel = ANY(string_to_array(regexp_replace(COALESCE(u.codsucdel, ''), '[\\s,;]', '/', 'g'), '/'))
   WHERE f.id = ANY($1::uuid[])`;

/**
 * Familia del catálogo de cada tipo de registro (por id). La cadena es la del
 * catálogo v2: especificación → analito → método → ensayo → familia.
 */
const FAMILIA_DE: Record<TipoRecursoLaboratorio | "cat_familia", string> = {
  cat_familia: `SELECT f.id FROM cat_familia f WHERE f.id = $1::uuid`,
  cat_ensayo: `SELECT e.familia_id AS id FROM cat_ensayo e WHERE e.id = $1::uuid`,
  cat_metodo: `SELECT e.familia_id AS id FROM cat_metodo m LEFT JOIN cat_ensayo e ON e.id = m.ensayo_id WHERE m.id = $1::uuid`,
  cat_analito: `SELECT e.familia_id AS id FROM cat_analito a LEFT JOIN cat_metodo m ON m.id = a.metodo_id
                  LEFT JOIN cat_ensayo e ON e.id = m.ensayo_id WHERE a.id = $1::uuid`,
  cat_especificacion: `SELECT e.familia_id AS id FROM cat_especificacion s LEFT JOIN cat_analito a ON a.id = s.analito_id
                  LEFT JOIN cat_metodo m ON m.id = a.metodo_id LEFT JOIN cat_ensayo e ON e.id = m.ensayo_id WHERE s.id = $1::uuid`,
  cat_panel: `SELECT e.familia_id AS id FROM cat_panel p LEFT JOIN cat_metodo m ON m.id = p.metodo_id
                  LEFT JOIN cat_ensayo e ON e.id = m.ensayo_id WHERE p.id = $1::uuid`,
  paso_metodo: `SELECT e.familia_id AS id FROM paso_metodo pm LEFT JOIN cat_metodo m ON m.id = pm.cat_metodo_id
                  LEFT JOIN cat_ensayo e ON e.id = m.ensayo_id WHERE pm.id = $1::uuid`,
};

/** Campo del cuerpo que fija el registro padre (al crear o al moverlo) y su tipo. */
const PADRE_EN_CUERPO: Record<TipoRecursoLaboratorio, { campo: string; tipo: TipoRecursoLaboratorio | "cat_familia" }> = {
  cat_ensayo: { campo: "familiaId", tipo: "cat_familia" },
  cat_metodo: { campo: "ensayoId", tipo: "cat_ensayo" },
  cat_analito: { campo: "metodoId", tipo: "cat_metodo" },
  cat_especificacion: { campo: "analitoId", tipo: "cat_analito" },
  cat_panel: { campo: "metodoId", tipo: "cat_metodo" },
  paso_metodo: { campo: "catMetodoId", tipo: "cat_metodo" },
};

const ESCRITURA = ["POST", "PUT", "PATCH", "DELETE"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Guard global, registrado en app.module.ts después de AmbitoUnidadGuard. */
@Injectable()
export class AlcanceCatalogoGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly alcance: AlcanceService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== "http") return true;
    const req = ctx.switchToHttp().getRequest();
    if (!req?.user?.sub) return true;
    const destino = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, destino)) return true;
    const metodo = String(req.method).toUpperCase();
    const tipo = this.reflector.getAllAndOverride<TipoRecursoLaboratorio>(RECURSO_LABORATORIO_KEY, destino);
    const id = req.params?.id && UUID.test(String(req.params.id)) ? String(req.params.id) : null;

    if (metodo === "GET") {
      if (tipo && id) await this.exigirLectura(req, tipo, id);
      return true;
    }
    if (!ESCRITURA.includes(metodo)) return true;
    if (this.reflector.getAllAndOverride<boolean>(SIN_ALCANCE_ESCRITURA_KEY, destino)) return true;

    const exigidos: string[] = (req.__permisosRuta ?? []).filter((p: string) => PERMISOS_SIN_LABORATORIO.includes(p));
    if (exigidos.length === 0) return true;

    const alc = await this.alcance.alcancePermisos(req, exigidos);
    if (alc.esGlobal) return true;

    if (!tipo) {
      throw new ForbiddenException(
        "Fuera de su alcance: esta tabla es común a todo el instituto y solo la mantienen Calidad y Administración.",
      );
    }
    const visibles = new Set(alc.unidadIds);
    const exigir = async (tipoRegistro: TipoRecursoLaboratorio | "cat_familia", idRegistro: string, que: string) => {
      const unidades = await this.unidadesDe(tipoRegistro, idRegistro);
      if (unidades === null) throw new NotFoundException(`No existe ${que}`);
      if (!unidades.some((u) => visibles.has(u))) {
        throw new ForbiddenException(
          `Fuera de su alcance: ${que} es de un laboratorio que usted no tiene asignado (o de ninguno); lo mantienen su laboratorio, Calidad o Administración.`,
        );
      }
    };

    if (id) await exigir(tipo, id, "el registro del catálogo");
    else if (metodo !== "POST") throw new ForbiddenException("Fuera de su alcance: registro sin identificar");

    const padre = PADRE_EN_CUERPO[tipo];
    const valor = req.body?.[padre.campo];
    if (typeof valor === "string" && UUID.test(valor)) await exigir(padre.tipo, valor, "el registro del que depende");
    else if (!id) {
      // Alta sin registro padre: no se puede saber de qué laboratorio es.
      throw new ForbiddenException(
        "Fuera de su alcance: un registro sin laboratorio solo lo dan de alta Calidad y Administración.",
      );
    }
    return true;
  }

  /** Detalle: un registro con laboratorio solo dentro del alcance del permiso de la ruta. */
  private async exigirLectura(req: any, tipo: TipoRecursoLaboratorio, id: string) {
    const alc = await this.alcance.alcancePermisos(req, req.__permisosRuta ?? []);
    if (alc.esGlobal) return;
    const unidades = await this.unidadesDe(tipo, id);
    // Inexistente: lo responde el controlador (404). Sin laboratorio: común.
    if (unidades === null || unidades.length === 0) return;
    if (!unidades.some((u) => alc.unidadIds.includes(u))) {
      throw new ForbiddenException("Fuera de su alcance: el registro del catálogo es de un laboratorio que usted no tiene asignado.");
    }
  }

  /** Unidades del laboratorio del registro; null si el registro no existe. */
  private async unidadesDe(tipo: TipoRecursoLaboratorio | "cat_familia", id: string): Promise<string[] | null> {
    const fam = await this.prisma.$queryRawUnsafe<{ id: string | null }[]>(FAMILIA_DE[tipo], id);
    if (fam.length === 0) return null;
    const familias = fam.map((f) => f.id).filter((x): x is string => !!x);
    if (familias.length === 0) return [];
    const us = await this.prisma.$queryRawUnsafe<{ id: string }[]>(UNIDADES_DE_FAMILIA, familias);
    return us.map((u) => u.id);
  }
}
