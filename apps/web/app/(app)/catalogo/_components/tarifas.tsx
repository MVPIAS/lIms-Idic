/**
 * Piezas comunes de las tarifas (frente f5): Tablas maestras › Tarifas HH,
 * Perfiles HH, Tarifas HM y Servicios primarios (API /tarifas/*).
 * Se leen con `tarifa.ver` y se mantienen con `catalogo.gestionar` de alcance
 * global; no se borran: se desactivan (casilla «Activa»).
 */
import { clp, fechaDia } from "@/lib/format";
import type { PermisosCrud } from "@/lib/permisosRecurso";

export const PERMISOS_TARIFA: PermisosCrud = { ver: "tarifa.ver", crear: "catalogo.gestionar", editar: "catalogo.gestionar" };

export const migasTarifa = (titulo: string) => [{ label: "Tablas maestras", href: "/catalogo" }, { label: "Tarifas" }, { label: titulo }];

/** «01-01-2026 → 31-12-2026» o «01-01-2026 → sin término». */
export const vigencia = (_v: any, row: any) => (
  <span>
    {fechaDia(row.vigenteDesde)} → {row.vigenteHasta ? fechaDia(row.vigenteHasta) : <span style={{ color: "var(--muted)" }}>sin término</span>}
  </span>
);

export const valorClp = (v: any) => (v == null || v === "" ? "—" : clp(v));

export const AYUDA_TARIFA =
  "Valores en pesos chilenos (CLP) con vigencia. Para cambiar un valor desde una fecha, cree otra fila con la nueva fecha de inicio y ponga término a la anterior. No se borran: se desactivan.";
