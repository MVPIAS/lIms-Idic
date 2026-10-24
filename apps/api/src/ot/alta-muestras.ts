/**
 * Muestras que se registran junto con la OT en «Registrar OT» · LIMS IDIC.
 * Reglas PURAS (sin BD), probadas en alta-muestras.spec.ts.
 *
 * B-001 (recorrido MP-01 D01-02 / MP-05 D05-02): la OT y sus muestras se
 * registran en una sola operación. Quien tiene `ot.crear` registra la OT con
 * sus elementos y métodos; si algo falla, no queda una OT sin muestras.
 *
 * B-011 (D01-16, D03-11): la descripción automática de la muestra nunca es
 * «<laboratorio> [códigos de método]». El catálogo heredado tiene un elemento
 * genérico por laboratorio («Lab. Quimico Central», «Lab.Textil»…) en el
 * subgrupo «Sub Grupo IDIC»: no es un producto. Con un elemento genérico, la
 * descripción la escribe quien registra.
 */

/** Subgrupo del catálogo heredado que agrupa los elementos «laboratorio» (no productos). */
export const SUBGRUPO_GENERICO = "sub grupo idic";

/** ¿El elemento es el genérico de un laboratorio (no un producto)? */
export function esElementoGenerico(subgrupoNombre: string | null | undefined): boolean {
  return (subgrupoNombre ?? "").trim().toLowerCase() === SUBGRUPO_GENERICO;
}

export interface ElementoAlta {
  id: string;
  nombre: string;
  generico: boolean;
}

export interface LineaAlta {
  /** Descripción escrita por quien registra (manda sobre la automática). */
  nombre?: string | null;
  catElementoId?: string | null;
  metodoIds: string[];
}

export interface MuestraAlta {
  nombre: string;
  catElementoId?: string;
  metodoIds: string[];
}

/**
 * Descripción de cada muestra y producto que se guarda: la escrita, o el
 * nombre del producto; un elemento genérico de laboratorio no es producto ni
 * descripción. Devuelve los errores (descripción que falta) sin crear nada.
 */
export function muestrasDeAlta(
  lineas: LineaAlta[],
  elementos: Map<string, ElementoAlta>,
): { muestras: MuestraAlta[]; errores: string[] } {
  const errores: string[] = [];
  const muestras = lineas.map((l, i) => {
    const el = l.catElementoId ? elementos.get(l.catElementoId) : undefined;
    if (l.catElementoId && !el) errores.push(`Muestra ${i + 1}: el elemento indicado no existe en el catálogo.`);
    const escrita = (l.nombre ?? "").trim();
    const automatica = el && !el.generico ? el.nombre.trim() : "";
    const nombre = (escrita || automatica).slice(0, 200);
    if (!nombre)
      errores.push(
        `Muestra ${i + 1}: escriba la descripción de la muestra (el elemento «${el?.nombre ?? "sin elemento"}» es el del laboratorio, no un producto).`,
      );
    return {
      nombre,
      ...(el && !el.generico ? { catElementoId: el.id } : {}),
      metodoIds: [...new Set(l.metodoIds)],
    };
  });
  return { muestras, errores };
}
