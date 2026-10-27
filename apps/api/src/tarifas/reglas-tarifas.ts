/**
 * Reglas de las tarifas (frente f5): esquemas de alta y edición y validaciones
 * puras, probadas en reglas-tarifas.spec.ts.
 */
import { z } from "zod";
import { diaChile } from "../common/fecha-chile";

export const MSJ_SIN_BORRADO =
  "Las tarifas no se borran (pueden haberse usado en costeos y cotizaciones): edítela y márquela inactiva.";

export const mensajeDuplicado = (que: string, conVigencia = true) =>
  `Ya existe ${que}: edite la fila existente${conVigencia ? " o use otra fecha de inicio" : ""}.`;

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD");
const vacioANulo = (v: unknown) => (v === "" ? null : v);
const texto = (max: number) => z.preprocess(vacioANulo, z.string().trim().max(max).nullable().optional());
const valorClp = z.coerce.number({ invalid_type_error: "El valor debe ser un número." }).min(0, "El valor no puede ser negativo.").max(999_999_999_999);
/** «si»/«no» del formulario o boolean. */
const activo = z.preprocess((v) => (v === "si" || v === "true" ? true : v === "no" || v === "false" ? false : v), z.boolean());

/** desde ≤ hasta (fechas AAAA-MM-DD o Date). */
export function erroresVigencia(desde: unknown, hasta: unknown): string[] {
  const iso = (v: unknown) => (v instanceof Date ? diaChile(v) : v == null || v === "" ? null : String(v).slice(0, 10));
  const d = iso(desde);
  const h = iso(hasta);
  if (!d) return ["Indique la fecha de inicio de la vigencia."];
  if (h && h < d) return [`La vigencia termina (${h}) antes de empezar (${d}).`];
  return [];
}

/** Convierte las fechas AAAA-MM-DD a Date (columnas DATE de Prisma); null se mantiene. */
const aFechas = <T extends Record<string, any>>(d: T): T => {
  const out: any = { ...d };
  for (const k of ["vigenteDesde", "vigenteHasta"]) if (typeof out[k] === "string") out[k] = new Date(`${out[k]}T00:00:00Z`);
  return out;
};

const conVigencia = <T extends z.ZodRawShape>(shape: T) => {
  const base = z.object({ ...shape, vigenteDesde: fecha, vigenteHasta: z.preprocess(vacioANulo, fecha.nullable().optional()), activo: activo.default(true) });
  const crear = base
    .superRefine((d, ctx) => erroresVigencia(d.vigenteDesde, d.vigenteHasta).forEach((message) => ctx.addIssue({ code: "custom", message, path: ["vigenteHasta"] })))
    .transform(aFechas);
  const editar = base
    .partial()
    .superRefine((d, ctx) => {
      if (d.vigenteDesde && d.vigenteHasta) erroresVigencia(d.vigenteDesde, d.vigenteHasta).forEach((message) => ctx.addIssue({ code: "custom", message, path: ["vigenteHasta"] }));
    })
    .transform(aFechas);
  return { crear, editar };
};

const hh = conVigencia({
  // Categoría A, B, C… del Sistema Comercial (hrshombre).
  categoria: z.string().trim().min(1, "Indique la categoría.").max(20).transform((s) => s.toUpperCase()),
  descripcion: texto(200),
  valorHoraClp: valorClp,
});

const hmBase = conVigencia({
  // Código del equipo en el Sistema Comercial (EQ###) y/o el equipo de «Equipos y calibración».
  codigo: z.preprocess(vacioANulo, z.string().trim().max(20).transform((s) => s.toUpperCase()).nullable().optional()),
  equipoId: z.preprocess(vacioANulo, z.string().uuid().nullable().optional()),
  descripcion: texto(200),
  valorHoraClp: valorClp,
});
const hm = {
  crear: hmBase.crear.refine((d: any) => !!d.codigo || !!d.equipoId, { message: "Indique el código del equipo (EQ###) o elija el equipo.", path: ["codigo"] }),
  editar: hmBase.editar,
};

const servicioPrimario = conVigencia({
  codigo: z.string().trim().min(1, "Indique el código.").max(40).transform((s) => s.toUpperCase()),
  descripcion: texto(2000),
  precioClp: z.preprocess(vacioANulo, valorClp.nullable().optional()),
  centroCostoId: z.preprocess(vacioANulo, z.string().uuid().nullable().optional()),
});

const perfilBase = z.object({
  perfil: z.string().trim().min(1, "Indique el perfil (p. ej. civil o militar).").max(40),
  // Ajuste sobre el valor base de la hora: −100 % … +1000 %.
  ajustePct: z.preprocess(vacioANulo, z.coerce.number().min(-100).max(1000).nullable().optional()),
  descripcion: texto(2000),
  activo: activo.default(true),
});
const perfil = { crear: perfilBase, editar: perfilBase.partial() };

export const esquemasTarifa = { hh, hm, servicioPrimario, perfil };
