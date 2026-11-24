/**
 * Clientes persona natural (armas usadas · Delegación Nº 11) · reglas PURAS,
 * probadas en persona-natural.spec.ts.
 *
 * Hoy la ficha de cliente es de empresa (razón social). La persona natural va a
 * la oficina de la D11 y quien recepciona crea la OT en el LIMS; la D11 es la
 * MANTENEDORA de estas personas (crea y edita: permiso
 * cliente.persona_natural.gestionar con ámbito D11). Se guardan en `cliente`
 * con es_persona_natural = true, nombres y apellidos aparte (la razón social es
 * «nombres apellidos») y tipo de cliente «persona_natural». Son los datos que el
 * software de armas del BPCH guarda en armas_propietarios (apps/api/documentacion/integracion-armas-bpch).
 */
import { z } from "zod";
import { validaRut } from "../common/rut.validator";

export const TIPO_PERSONA_NATURAL = "persona_natural";

const opcional = (max: number) => z.preprocess((v) => (v === "" || v === null ? undefined : v), z.string().trim().max(max).optional());

export const PersonaNaturalSchema = z.object({
  rut: z.string().refine((r) => validaRut(r), { message: "RUT chileno inválido (no pasa módulo 11)" }),
  nombres: z.string({ required_error: "Indique los nombres." }).trim().min(1, "Indique los nombres.").max(120),
  apellidos: z.string({ required_error: "Indique los apellidos." }).trim().min(1, "Indique los apellidos.").max(120),
  email: z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().email("Correo no válido").max(160).optional()),
  telefono: opcional(40),
  domicilio: opcional(300),
  comuna: opcional(80),
  region: opcional(80),
});
export const PersonaNaturalEditarSchema = PersonaNaturalSchema.omit({ rut: true }).partial();

export type PersonaNatural = z.infer<typeof PersonaNaturalSchema>;

/** RUT normalizado para comparar (sin puntos, con guion y DV en mayúscula). */
export function rutNormal(rut: string): string {
  const s = String(rut ?? "").replace(/[.\s]/g, "").toUpperCase();
  if (s.includes("-")) return s;
  return s.length > 1 ? `${s.slice(0, -1)}-${s.slice(-1)}` : s;
}

/** Razón social de la ficha: «Nombres Apellidos». */
export function razonSocialPersona(nombres: string, apellidos: string): string {
  return `${nombres.trim()} ${apellidos.trim()}`.replace(/\s+/g, " ").slice(0, 200);
}

/**
 * ¿Se puede crear? Si ya existe un cliente con ese RUT: si es persona natural,
 * se edita esa ficha; si es empresa, no se duplica.
 */
export function conflictoRut(existente: { es_persona_natural: boolean } | null): string | null {
  if (!existente) return null;
  return existente.es_persona_natural
    ? "Ya existe una persona natural con ese RUT: edítela en lugar de crearla de nuevo."
    : "Ese RUT ya está registrado como cliente empresa; no se puede registrar como persona natural.";
}
