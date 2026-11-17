/**
 * EP-07 7.3 · Registro y análisis de documentos DGMN / AF (SAC-PG01-IT08):
 * checklist de documentos legales por inspección de Producción Nacional.
 * Reglas IT08 §4.a: defecto CRÍTICO = no presentar documentos, diferencias de
 * nombre/RUT o de productos, documentos no vigentes; MENOR = otras diferencias;
 * más de 6 menores (desde el 7.º) equivalen a crítico (BPCH-44). El resultado se traslada a los defectos
 * crítico/menor del ensayo «Rev. Doc. Legal» de la OT. Reglas PURAS, probadas
 * en revision-documental.spec.ts.
 */
import { z } from "zod";

export const DOCUMENTOS_IT08 = [
  { clave: "raf_linea", nombre: "RAF DGMN de la línea fija o móvil", aplica: "si" },
  { clave: "raf_listado", nombre: "RAF DGMN con su listado de productos", aplica: "si" },
  { clave: "inspeccion_linea", nombre: "Resolución de inspección en línea de producción", aplica: "si_corresponde" },
  { clave: "almacenamiento", nombre: "Resolución de almacenamiento de sustancias peligrosas", aplica: "si" },
  { clave: "otro", nombre: "Otro documento legal", aplica: "segun_trabajo" },
] as const;
export type ClaveDocumento = (typeof DOCUMENTOS_IT08)[number]["clave"];

/**
 * Máximo de defectos menores que aún permite «Cumple»: con MÁS de 6 (desde el
 * 7.º) la revisión no cumple. Respuesta IDIC BPCH-44 (17-11-2026), que sigue al
 * formulario oficial («> 6») y no a la IT08 §4 («≥ 6»).
 */
export const MENORES_MAXIMOS = 6;

export const ItemRevision = z.object({
  clave: z.enum(DOCUMENTOS_IT08.map((d) => d.clave) as [ClaveDocumento, ...ClaveDocumento[]]),
  aplica: z.boolean(),
  estado: z.enum(["conforme", "pendiente", "no_conforme"]).nullable().optional(),
  defecto: z.enum(["critico", "menor"]).nullable().optional(),
  /** Nombre del documento cuando la clave es «otro». */
  nombre: z.string().trim().max(160).nullable().optional(),
  observacion: z.string().trim().max(1000).nullable().optional(),
});
export type ItemRevision = z.infer<typeof ItemRevision>;
export const RevisionBody = z.object({ items: z.array(ItemRevision).min(1).max(10) });

export interface EvaluacionRevision {
  criticos: number;
  menores: number;
  resultado: "pendiente" | "conforme" | "no_conforme";
  faltantes: string[];
}

export function evaluarRevision(items: ItemRevision[]): EvaluacionRevision {
  const faltantes: string[] = [];
  const porClave = new Map(items.map((i) => [i.clave, i]));
  let criticos = 0;
  let menores = 0;
  let pendiente = false;
  for (const d of DOCUMENTOS_IT08) {
    const i = porClave.get(d.clave);
    if (d.aplica === "si" && !i?.aplica) {
      faltantes.push(`«${d.nombre}» siempre aplica.`);
      continue;
    }
    if (!i?.aplica) continue;
    if (d.clave === "otro" && !i.nombre?.trim()) faltantes.push("Indique el nombre del otro documento legal.");
    if (!i.estado) {
      faltantes.push(`Marque el estado de «${d.nombre}».`);
      continue;
    }
    if (i.estado === "pendiente") pendiente = true;
    if (i.estado === "no_conforme") {
      if (!i.defecto) faltantes.push(`«${d.nombre}» no conforme: indique si el defecto es crítico o menor.`);
      if (!i.observacion?.trim()) faltantes.push(`«${d.nombre}» no conforme: describa la diferencia.`);
      if (i.defecto === "critico") criticos++;
      if (i.defecto === "menor") menores++;
    }
  }
  return { criticos, menores, resultado: resultadoRevision(criticos, menores, pendiente), faltantes };
}

/** Veredicto de la revisión: un crítico o más de 6 menores → no conforme (BPCH-44). */
export function resultadoRevision(criticos: number, menores: number, pendiente = false): EvaluacionRevision["resultado"] {
  if (pendiente) return "pendiente";
  return criticos > 0 || menores > MENORES_MAXIMOS ? "no_conforme" : "conforme";
}

/** ¿El analito del ensayo «Rev. Doc. Legal» es el de defectos críticos o el de menores? */
export function tipoDefectoAnalito(nombre: string | null | undefined): "critico" | "menor" | null {
  const n = String(nombre ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  if (n.includes("critic")) return "critico";
  if (n.includes("menor")) return "menor";
  return null;
}
