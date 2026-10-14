/**
 * Permiso que exige COMPLETAR una tarea de un flujo (BPM) de una OT · LIMS IDIC.
 * Regla PURA (sin BD), probada en permiso-paso.spec.ts.
 *
 * Antes bastaba `ot.ver` para completar cualquier paso: el perfil de solo
 * lectura hacía avanzar el flujo. Ahora cada paso exige el permiso del trabajo
 * que representa:
 *
 *   1. `config_json.permiso` del paso, si el diseñador lo fijó (manda siempre);
 *   2. si no, según el flujo y la actividad:
 *      · flujos comerciales (código FLU-COM…): generar/remitir la cotización →
 *        `cotizacion.crear`; revisión y firma → `cotizacion.aprobar`;
 *        aceptación del cliente → `cotizacion.aceptar`;
 *      · aprobación / supervisión / jefatura → `resultado.aprobar`;
 *      · control de calidad o revisión → `resultado.revisar`;
 *      · registro, custodia, recepción, muestreo o almacén → `muestra.crear`;
 *      · cualquier otro trabajo de laboratorio → `resultado.crear`.
 *
 * Además, si el paso tiene un rol responsable (`responsable_rol_id`), hay que
 * tener ese rol (lo comprueba el servicio).
 */

export interface PasoParaPermiso {
  actividad: string | null | undefined;
  configJson?: unknown;
}

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function permisoParaCompletar(paso: PasoParaPermiso, codigoFlujo?: string | null): string {
  const cfg = paso.configJson as Record<string, unknown> | null | undefined;
  if (cfg && typeof cfg === "object" && typeof cfg.permiso === "string" && /^[a-z_]+(\.[a-z_]+)+$/.test(cfg.permiso))
    return cfg.permiso;

  const a = sinTildes(paso.actividad ?? "");
  const flujo = (codigoFlujo ?? "").toUpperCase();

  if (flujo.startsWith("FLU-COM") || /cotizaci/.test(a)) {
    if (/acepta/.test(a)) return "cotizacion.aceptar";
    if (/revisi|firma|aprueba|aprobaci/.test(a)) return "cotizacion.aprobar";
    return "cotizacion.crear";
  }
  if (/aprobaci|aprueba|supervis|jefe|jefatura/.test(a)) return "resultado.aprobar";
  if (/control de calidad|revisi/.test(a)) return "resultado.revisar";
  if (/registro|custodia|recepci|muestreo|almacen|ubicacion/.test(a)) return "muestra.crear";
  return "resultado.crear";
}
