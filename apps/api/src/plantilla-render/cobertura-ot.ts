/**
 * Hechos de cobertura de los documentos de una OT (lectura de BD). Los usan la
 * emisión (qué resultados cubre un documento), la pantalla de emisión (qué
 * muestra o laboratorio tiene ya su documento) y el cierre (qué falta cubrir).
 * Reglas puras en cobertura-documento.ts; contrato en docs/FLUJO_DOCUMENTOS_POR_OT.md.
 */
import type { PrismaService } from "../common/prisma.service";
import { laboratoriosDeResultados, unidadesPosiblesOt } from "../laboratorio/planillas-ot";
import { etiquetaCobertura, normalizarCobertura, pendientesCobertura, type CoberturaDoc, type MuestraCobertura } from "./cobertura-documento";

export interface DocumentoCobertura extends CoberturaDoc {
  id: string;
  numero: string;
  estado: string;
  noEmitido: boolean;
  plantillaId: string | null;
  tipoDocumento: string | null;
  etiqueta: string | null;
}

export interface HechosCobertura {
  principal: string | null;
  muestras: (MuestraCobertura & { nombre: string | null; resultados: number; aprobados: number })[];
  laboratorios: { id: string; codigo: string; nombre: string; principal: boolean; resultados: number; aprobados: number }[];
  /** Laboratorio de cada resultado de la OT (resultado → unidad). */
  laboratorioDe: Map<string, string | null>;
  /** Muestra de cada resultado. */
  muestraDe: Map<string, string>;
  documentos: DocumentoCobertura[];
  pendientes: string[];
}

export async function hechosCobertura(prisma: PrismaService | any, otId: string, tenantId: string): Promise<HechosCobertura> {
  const ot = await prisma.ordenTrabajo.findFirst({ where: { id: otId, tenantId }, select: { unidadPrincipal: true } });
  const principal: string | null = ot?.unidadPrincipal ?? null;
  const [muestras, posibles, resultados, docs] = await Promise.all([
    prisma.$queryRawUnsafe(
      `SELECT m.id, m.codigo, m.nombre, m.cat_elemento_id AS "elementoId", e.nombre AS "elementoNombre"
         FROM muestra m LEFT JOIN cat_elemento e ON e.id = m.cat_elemento_id
        WHERE m.ot_id = $1::uuid AND m.deleted_at IS NULL ORDER BY m.codigo`,
      otId,
    ) as Promise<{ id: string; codigo: string; nombre: string | null; elementoId: string | null; elementoNombre: string | null }[]>,
    unidadesPosiblesOt(prisma, otId, principal, tenantId),
    prisma.$queryRawUnsafe(
      `SELECT r.id, r.estado, r.muestra_id AS "muestraId" FROM resultado r JOIN muestra m ON m.id = r.muestra_id
        WHERE COALESCE(r.ot_id, m.ot_id) = $1::uuid AND r.deleted_at IS NULL AND m.deleted_at IS NULL`,
      otId,
    ) as Promise<{ id: string; estado: string; muestraId: string }[]>,
    prisma.$queryRawUnsafe(
      `SELECT c.id, COALESCE(c.numero, c.codigo) AS numero, c.estado, c.cobertura, c.muestra_ids AS "muestraIds",
              c.unidad_cobertura AS "unidadId", c.no_emitido AS "noEmitido", c.plantilla_id AS "plantillaId",
              c.tipo_documento AS "tipoDocumento", c.cobertura_etiqueta AS etiqueta
         FROM certificado c WHERE c.ot_id = $1::uuid AND c.deleted_at IS NULL ORDER BY c.created_at`,
      otId,
    ) as Promise<any[]>,
  ]);
  const labMap = await laboratoriosDeResultados(prisma, otId, tenantId, posibles.map((u: any) => u.id), principal);
  const laboratorioDe = new Map<string, string | null>([...labMap.entries()].map(([id, v]) => [id, v.unidadId]));
  const muestraDe = new Map(resultados.map((r) => [r.id, r.muestraId]));
  const cuenta = (filtro: (r: { id: string; estado: string; muestraId: string }) => boolean) => {
    const rs = resultados.filter(filtro);
    return { resultados: rs.length, aprobados: rs.filter((r) => r.estado === "aprobado").length };
  };
  const ms = muestras.map((m) => ({ ...m, ...cuenta((r) => r.muestraId === m.id) }));
  const labs = posibles.map((u: any) => ({ ...u, ...cuenta((r) => laboratorioDe.get(r.id) === u.id) }));
  const documentos: DocumentoCobertura[] = docs.map((d) => ({
    id: d.id,
    numero: d.numero,
    estado: d.estado,
    noEmitido: Boolean(d.noEmitido),
    plantillaId: d.plantillaId,
    tipoDocumento: d.tipoDocumento,
    etiqueta: d.etiqueta,
    ...normalizarCobertura({ cobertura: d.cobertura, muestraIds: d.muestraIds ?? [], unidadId: d.unidadId }),
  }));
  const pendientes = pendientesCobertura({
    muestras: ms.map((m) => ({ id: m.id, codigo: m.codigo, conResultados: m.resultados > 0 })),
    laboratorios: labs.map((l: any) => ({ id: l.id, codigo: l.codigo, conResultados: l.resultados > 0 })),
    documentos,
  });
  return { principal, muestras: ms, laboratorios: labs, laboratorioDe, muestraDe, documentos, pendientes };
}

/** Resultados que cubre un documento (null = todos los de la OT). */
export function resultadosCubiertos(c: CoberturaDoc, h: Pick<HechosCobertura, "laboratorioDe" | "muestraDe">): Set<string> | null {
  if (c.cobertura === "ot") return null;
  const ids = new Set<string>();
  if (c.cobertura === "laboratorio") {
    for (const [id, lab] of h.laboratorioDe) if (lab === c.unidadId) ids.add(id);
  } else {
    for (const [id, m] of h.muestraDe) if (c.muestraIds.includes(m)) ids.add(id);
  }
  return ids;
}

/** Etiqueta legible con los nombres reales de la OT. */
export function etiquetaDe(c: CoberturaDoc, h: Pick<HechosCobertura, "muestras" | "laboratorios">): string {
  const lab = h.laboratorios.find((l) => l.id === c.unidadId);
  return etiquetaCobertura(c, { muestras: new Map(h.muestras.map((m) => [m.id, m])), laboratorio: lab ? lab.codigo : null });
}
