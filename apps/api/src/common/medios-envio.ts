/**
 * Medios de envío y de entrega al cliente (frente f5, Mapa de migración v2.1 ·
 * «Maestros y combos»). Antes cada pantalla y cada endpoint tenía su propia
 * lista escrita en el código (seguimiento, entrega de documentos, envío de la
 * cotización, entrega de Metrología) y duplicaban el parámetro del sistema.
 *
 * Ahora la ÚNICA lista es la categoría `medio_envio` de «Parámetros del
 * sistema» (parametro_sistema). Se ofrece lo activo; lo inactivo (p. ej. «fax»)
 * se sigue mostrando con su texto porque puede estar guardado. Los códigos ya
 * guardados (correo, mano, oficio, oficina_partes, libro, courier, plataforma,
 * otro) están todos en la lista (align_f5_correcciones.sql), así que siguen
 * siendo válidos.
 *
 * El medio «correo» es especial en el código (envía el PDF por correo); el resto
 * se registra con su texto.
 */
import { BadRequestException } from "@nestjs/common";
import { z } from "zod";

export const CATEGORIA_MEDIO_ENVIO = "medio_envio";

/** Código de un medio: minúsculas, dígitos y «_», hasta 30 (cabe en todas las columnas entrega_medio). */
export const PATRON_CODIGO_MEDIO = /^[a-z][a-z0-9_]{0,29}$/;

export const MSJ_MEDIO_CODIGO =
  "El código de un medio de envío no cambia (puede estar guardado en OT, documentos y cotizaciones): desactívelo y cree otro.";

/** Esquema zod de un medio recibido por la API; que esté activo lo comprueba `exigirMedioEnvioActivo`. */
export const zMedioEnvio = z
  .string()
  .trim()
  .regex(PATRON_CODIGO_MEDIO, "Medio de envío no válido: elija uno de la lista (Parámetros del sistema › medio_envio).");

interface Db {
  $queryRawUnsafe<T = unknown>(sql: string, ...v: unknown[]): Promise<T>;
}

export interface MedioEnvio {
  codigo: string;
  etiqueta: string;
  activo: boolean;
}

/** Todos los medios de la instalación (activos e inactivos), en su orden. */
export function mediosEnvio(db: Db, tenantId: string): Promise<MedioEnvio[]> {
  return db.$queryRawUnsafe<MedioEnvio[]>(
    `SELECT codigo, etiqueta, activo FROM parametro_sistema
      WHERE tenant_id = $1::uuid AND categoria = $2 ORDER BY orden, codigo`,
    tenantId,
    CATEGORIA_MEDIO_ENVIO,
  );
}

/** Regla pura: el medio está entre los activos de la lista. */
export function errorMedioEnvio(medio: string, lista: MedioEnvio[]): string | null {
  const activos = lista.filter((m) => m.activo);
  if (activos.some((m) => m.codigo === medio)) return null;
  const inactivo = lista.find((m) => m.codigo === medio);
  if (inactivo) return `El medio «${inactivo.etiqueta}» ya no se usa: elija otro de la lista.`;
  return `Medio de envío no válido: elija uno de la lista (${activos.map((m) => m.codigo).join(", ") || "Parámetros del sistema › medio_envio está vacía"}).`;
}

/** 400 si el medio no está activo en «Parámetros del sistema › medio_envio». Devuelve su texto. */
export async function exigirMedioEnvioActivo(db: Db, tenantId: string, medio: string): Promise<string> {
  const lista = await mediosEnvio(db, tenantId);
  const error = errorMedioEnvio(medio, lista);
  if (error) throw new BadRequestException(error);
  return lista.find((m) => m.codigo === medio)!.etiqueta;
}

/** Texto en minúscula para una frase («… registrado (entrega en mano)»). */
export function textoEnFrase(etiqueta: string): string {
  return etiqueta.length > 1 && etiqueta[1] === etiqueta[1].toLowerCase() ? etiqueta[0].toLowerCase() + etiqueta.slice(1) : etiqueta;
}

/**
 * Alta o cambio de código en la categoría `medio_envio` de Parámetros: el código
 * sigue el patrón (cabe en las columnas de entrega).
 */
export function exigirMedioEnvio(categoria: string | undefined, codigo: string | undefined) {
  if (categoria === CATEGORIA_MEDIO_ENVIO && codigo !== undefined && !PATRON_CODIGO_MEDIO.test(codigo))
    throw new BadRequestException("El código de un medio de envío va en minúsculas, sin espacios ni tildes, hasta 30 caracteres (p. ej. oficina_partes).");
}
