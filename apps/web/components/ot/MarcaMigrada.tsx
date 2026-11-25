/**
 * Marca de OT migrada del sistema anterior (StarLIMS/LINKS), para distinguirla
 * de las OT creadas en el LIMS desde la puesta en producción.
 * Datos: orden_trabajo.origen_registro / migrada_desde / migrada_en
 * (packages/db/align_ot_migradas.sql). Solo pantalla: nunca en documentos
 * oficiales (informes, certificados, PDF, Excel).
 */

import { fechaDia } from "@/lib/format";

/** Clase de la fila sombreada en las tablas (globals.css · tr.fila-migrada). */
export const CLASE_FILA_MIGRADA = "fila-migrada";

/** Marca normalizada: folio original y fecha de carga. */
export interface Migracion {
  desde: string | null;
  en: string | null;
}

/**
 * Marca de una OT tal como llega de la API: la fila de GET /ot y GET /ot/:id
 * (origenRegistro, migradaDesde, migradaEn) o un elemento de Mi bandeja /
 * una fila de la Zona de informes (`migrada` / `_migrada` = { desde, en }).
 */
export function migracionDe(r: any): Migracion | null {
  if (!r) return null;
  if (r.origenRegistro === "MIGRACION") return { desde: r.migradaDesde ?? null, en: r.migradaEn ?? null };
  const m = r.migrada ?? r._migrada;
  if (m && typeof m === "object") return { desde: m.desde ?? null, en: m.en ?? null };
  return null;
}

/** «Migrada desde el sistema anterior (OT 24001) el 01-12-2026». */
export function textoMigrada(m: Migracion): string {
  return `Migrada desde el sistema anterior${m.desde ? ` (OT ${m.desde})` : ""}${m.en ? ` el ${fechaDia(m.en)}` : ""}`;
}

/** Etiqueta «Migrada» con el detalle en el tooltip. No pinta nada si la OT es nueva. */
export function EtiquetaMigrada({ ot, style }: { ot: any; style?: React.CSSProperties }) {
  const m = migracionDe(ot);
  if (!m) return null;
  const t = textoMigrada(m);
  return (
    <span className="pill migrada" title={t} aria-label={t} style={style}>
      Migrada
    </span>
  );
}

/** Aviso del detalle de la OT. */
export function AvisoMigrada({ ot }: { ot: any }) {
  const m = migracionDe(ot);
  if (!m) return null;
  return (
    <div className="alert migrada" role="note">
      <b>OT migrada.</b> {textoMigrada(m)}. Se conserva como histórico: sus datos vienen del sistema anterior y no se registraron en este LIMS.
    </div>
  );
}

/** Opciones del filtro «Origen» (valor = parámetro `origen` de la API). */
export const ORIGENES_REGISTRO: { valor: "" | "LIMS" | "MIGRACION"; texto: string }[] = [
  { valor: "", texto: "Todas" },
  { valor: "LIMS", texto: "Nuevas" },
  { valor: "MIGRACION", texto: "Migradas" },
];
