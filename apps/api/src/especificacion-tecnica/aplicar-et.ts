/**
 * Aplica la E.T. del cliente a los ensayos de una muestra · LIMS IDIC.
 *
 * La E.T. que rige es la de la muestra (muestra.et_id) o, si no tiene, la de
 * su OT (orden_trabajo.et_id). Cada ensayo toma el requisito de su punto
 * (reglas-et.ts › puntoDeEnsayo) y queda marcado «E.T. <código> v<n> · punto
 * <p>» (espec_origen = et), con la segunda condición, el plan de clases y la
 * clase de defecto. La copia del catálogo (espec_catalogo) se conserva.
 *
 *   · Al GENERAR los ensayos (soloNuevos): se aplica a los recién creados; la
 *     E.T. elegida manda sobre el catálogo.
 *   · «Aplicar requisitos de la E.T. → veredicto»: a los ensayos que aún se
 *     pueden corregir (no revisados ni aprobados). Cambiar un valor que vino
 *     del catálogo es de la jefatura (misma regla que la especificación de la
 *     orden): sin resultado.aprobar ese ensayo se omite con el motivo.
 *   · Si el ensayo ya tiene valor, se recalcula su veredicto con el requisito
 *     nuevo (desde sus lecturas, réplicas o valor).
 */
import { Prisma } from "@prisma/client";
import { calcularCaptura, CapturaError, type EntradaCaptura } from "../laboratorio/captura-estandar";
import { planEdicion, type Especificacion, type TipoDato } from "../laboratorio/especificacion";
import { factorDe } from "../laboratorio/factor";
import { motivoNoCapturable } from "../laboratorio/flujo-resultado";
import { conTraza } from "../laboratorio/traza";
import { criterioIndeterminado } from "../laboratorio/veredicto";
import { especDePunto, fuenteDe, puntoDeEnsayo, type PuntoEt } from "./reglas-et";

type Db = any;

export interface ResumenAplicacion {
  etId: string;
  codigo: string;
  version: number;
  aplicados: number;
  sinPunto: number;
  omitidos: { resultadoId: string; ensayo: string; motivo: string }[];
}

/** Puntos de una E.T., con los nombres de columna del DTO. */
export async function puntosDeEt(db: Db, etId: string): Promise<PuntoEt[]> {
  return db.$queryRawUnsafe(
    `SELECT id, orden, punto, componente, caracteristica, cat_metodo_id AS "catMetodoId", cat_analito_id AS "catAnalitoId",
            laboratorio_id AS "laboratorioId", tipo, limite_inf AS "limiteInf", nominal, limite_sup AS "limiteSup", unidad, requisito,
            cond2_etiqueta AS "cond2Etiqueta", cond2_inf::float8 AS "cond2Inf", cond2_sup::float8 AS "cond2Sup", cond2_unidad AS "cond2Unidad",
            plan_n AS "planN", plan_c AS "planC", plan_m::float8 AS "planM", plan_mm::float8 AS "planMM",
            clase_defecto AS "claseDefecto", observacion
       FROM especificacion_tecnica_punto WHERE et_id = $1::uuid ORDER BY orden, punto`,
    etId,
  );
}

/** E.T. que rige la muestra: la suya o la de su OT. */
export async function etDeMuestra(db: Db, muestraId: string) {
  const f = await db.$queryRawUnsafe(
    `SELECT m.id AS "muestraId", m.et_componente AS componente, et.id, et.codigo, et.version
       FROM muestra m
       LEFT JOIN orden_trabajo o ON o.id = m.ot_id
       JOIN especificacion_tecnica et ON et.id = COALESCE(m.et_id, o.et_id)
      WHERE m.id = $1::uuid`,
    muestraId,
  );
  return (f[0] ?? null) as { muestraId: string; componente: string | null; id: string; codigo: string; version: number } | null;
}

const esCatalogo = (e: Especificacion) => (["limiteInf", "nominal", "limiteSup", "requisito"] as const).some((k) => e[k] != null && String(e[k]).trim() !== "");

/** Entrada de captura reconstruida desde lo guardado, para recalcular el veredicto. */
export function entradaGuardada(r: any): EntradaCaptura | null {
  const lect = Array.isArray(r.lecturas) && r.lecturas.length ? (r.lecturas as Record<string, number>[]) : null;
  const rep = Array.isArray(r.replicas) ? (r.replicas as unknown[]).map(Number).filter((x) => Number.isFinite(x)) : [];
  const vars = r.variables && typeof r.variables === "object" && !Array.isArray(r.variables) ? (r.variables as Record<string, number>) : undefined;
  const v2 = r.valorCondicion2 != null ? Number(r.valorCondicion2) : null;
  if (lect) return { lecturas: lect, variables: vars, valorCondicion2: v2 };
  if (rep.length) return { replicas: rep, variables: vars, valorCondicion2: v2 };
  if (r.valorTexto != null && String(r.valorTexto).trim() !== "" && r.valorNumerico == null) return { valor: String(r.valorTexto), valorCondicion2: v2 };
  if (r.valorNumerico != null) return { valor: Number(r.valorNumerico), valorCondicion2: v2 };
  return null;
}

export async function aplicarEtAMuestra(
  db: Db,
  tenantId: string,
  muestraId: string,
  opts: { soloNuevos?: boolean; usuarioId?: string | null; esJefatura?: boolean } = {},
): Promise<ResumenAplicacion | null> {
  const et = await etDeMuestra(db, muestraId);
  if (!et) return null;
  const puntos = await puntosDeEt(db, et.id);
  const resumen: ResumenAplicacion = { etId: et.id, codigo: et.codigo, version: et.version, aplicados: 0, sinPunto: 0, omitidos: [] };
  if (!puntos.length) return resumen;
  const resultados: any[] = await db.resultado.findMany({
    where: { muestraId, deletedAt: null },
    include: { catAnalito: { select: { nombre: true } } },
  });
  const porMetodo = new Map<string, number>();
  for (const r of resultados) if (r.catMetodoId) porMetodo.set(r.catMetodoId, (porMetodo.get(r.catMetodoId) ?? 0) + 1);
  const ld = await db.$queryRawUnsafe(
    `SELECT valor FROM parametro_sistema WHERE tenant_id = $1::uuid AND categoria = 'captura_ld' AND codigo = 'indeterminado' AND activo`,
    tenantId,
  );
  const criterioLd = criterioIndeterminado(ld[0]?.valor);

  for (const r of resultados) {
    const nombre = r.catAnalito?.nombre ?? "ensayo";
    if (opts.soloNuevos && (r.estado !== "pendiente" || r.especOrigen !== "catalogo" || r.etPuntoId)) continue;
    const p = puntoDeEnsayo(puntos, r, et.componente, r.catMetodoId ? porMetodo.get(r.catMetodoId) ?? 0 : 0);
    if (!p) {
      resumen.sinPunto++;
      continue;
    }
    const bloqueo = motivoNoCapturable(r.estado);
    if (bloqueo) {
      resumen.omitidos.push({ resultadoId: r.id, ensayo: nombre, motivo: bloqueo });
      continue;
    }
    const espec = especDePunto(p);
    const actual: Especificacion = {
      limiteInf: r.limiteInf, nominal: r.nominal, limiteSup: r.limiteSup, unidad: r.unidad, requisito: r.requisito, tipoDato: r.tipoDato,
    };
    const catalogo = (r.especCatalogo ?? actual) as Especificacion;
    const pedido: Especificacion = {
      limiteInf: espec.limiteInf, nominal: espec.nominal, limiteSup: espec.limiteSup,
      unidad: espec.unidad ?? r.unidad ?? null, requisito: espec.requisito, tipoDato: espec.tipoDato,
    };
    const plan = planEdicion(actual, catalogo, pedido);
    const mismoPunto = r.etPuntoId === p.id;
    if (mismoPunto && !plan.campos.length) continue;
    // Cambiar lo que vino del catálogo es de la jefatura (salvo al generar el ensayo desde una E.T. ya elegida).
    if (!opts.soloNuevos && plan.requiereJefatura && esCatalogo(catalogo) && !opts.esJefatura) {
      resumen.omitidos.push({
        resultadoId: r.id,
        ensayo: nombre,
        motivo: "Cambia un requisito que vino del catálogo: lo aplica la jefatura del laboratorio.",
      });
      continue;
    }
    // Veredicto con el requisito nuevo, si el ensayo ya tiene valor.
    let veredicto = r.veredicto;
    let valorCondicion2 = r.valorCondicion2;
    const entrada = r.estado === "pendiente" ? null : entradaGuardada(r);
    if (entrada && espec.tipoDato === "atributo") veredicto = r.tipoDato === "atributo" ? r.veredicto : "pendiente";
    else if (entrada) {
      try {
        const c = calcularCaptura(
          {
            tipoDato: espec.tipoDato as TipoDato, limiteInf: espec.limiteInf, nominal: espec.nominal, limiteSup: espec.limiteSup,
            formula: r.formula, factor: factorDe(r.factorValor, r.factorOperacion, r.factorDescripcion), criterioLd,
            planClases: espec.planClases, condicion2: espec.condicion2,
          },
          entrada,
        );
        veredicto = c.veredicto;
        valorCondicion2 = c.valorCondicion2;
      } catch (e) {
        if (!(e instanceof CapturaError)) throw e;
        veredicto = "pendiente";
      }
    }
    const fuente = fuenteDe(et.codigo, et.version, p.punto);
    await conTraza(db, { usuarioId: opts.usuarioId ?? null, motivo: `Requisito de la ${fuente}`, origen: "especificacion" }, (tx: any) =>
      tx.resultado.update({
        where: { id: r.id },
        data: {
          limiteInf: espec.limiteInf,
          nominal: espec.nominal,
          limiteSup: espec.limiteSup,
          unidad: espec.unidad ?? r.unidad ?? null,
          requisito: espec.requisito,
          tipoDato: espec.tipoDato,
          especOrigen: "et",
          especFuente: fuente,
          etPuntoId: p.id ?? null,
          condicion2: espec.condicion2 ? (espec.condicion2 as any) : Prisma.DbNull,
          planClases: espec.planClases ? (espec.planClases as any) : Prisma.DbNull,
          valorCondicion2: espec.condicion2 ? valorCondicion2 ?? null : null,
          // La clase la trae el punto; una que ya fijó la jefatura no se pisa.
          ...(r.claseDefectoPor ? {} : { claseDefecto: espec.claseDefecto }),
          ...(r.especCatalogo ? {} : { especCatalogo: actual as any }),
          especEditadaPor: opts.usuarioId ?? null,
          especEditadaAt: new Date(),
          veredicto,
        },
      }),
    );
    resumen.aplicados++;
  }
  return resumen;
}
