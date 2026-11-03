/**
 * Exportador a Excel/CSV (§4.6.6/§4.6.7) · reglas puras, probadas en
 * exportacion.spec.ts: etiquetas legibles de las columnas, tope de filas por
 * descarga, qué entidades puede exportar cada perfil y quién edita una
 * plantilla guardada.
 */

/** Tope de filas de una descarga (la vista previa trae menos). */
export const LIMITE_EXPORTACION = 10000;

/** Nombre legible (español) de cada columna exportable, común a todas las entidades. */
const ETIQUETAS: Record<string, string> = {
  codigo: "Código",
  estado: "Estado",
  estado_ot: "Estado de la OT",
  fase_registro: "Fase de registro",
  prioridad: "Prioridad",
  solicitante: "Solicitante",
  origen_trabajo: "Origen del trabajo",
  tipo_trabajo: "Tipo de trabajo",
  numero_ley: "N° de ley",
  fecha_recepcion: "Fecha de recepción",
  fecha_compromiso: "Fecha de compromiso",
  fecha_cierre: "Fecha de cierre",
  dias_atraso: "Días de atraso",
  estado_envio: "Estado de envío",
  created_at: "Fecha de creación",
  nombre: "Nombre",
  ubicacion: "Ubicación",
  codigo_barras: "Código de barras",
  veredicto: "Veredicto",
  valor_numerico: "Valor numérico",
  valor_texto: "Valor (texto)",
  unidad: "Unidad",
  promedio: "Promedio",
  limite_inf: "Límite inferior",
  nominal: "Nominal",
  limite_sup: "Límite superior",
  fecha: "Fecha",
  fecha_emision: "Fecha de emisión",
  expira_at: "Vence el",
  neto: "Neto",
  iva_monto: "IVA",
  total: "Total",
  forma_pago: "Forma de pago",
  numero: "Número",
  origen: "Origen",
  fecha_vencimiento: "Fecha de vencimiento",
  moneda: "Moneda",
  saldo: "Saldo",
  tipo: "Tipo",
  codigo_verificacion: "Código de verificación",
  fabricante: "Fabricante",
  modelo: "Modelo",
  serie: "N° de serie",
  fecha_ultima_calibracion: "Última calibración",
  proxima_calibracion: "Próxima calibración",
  consumible_codigo: "Código del consumible",
  consumible: "Consumible",
  unidad_medida: "Unidad de medida",
  numero_lote: "N° de lote",
  cantidad_inicial: "Cantidad inicial",
  cantidad_actual: "Cantidad actual",
  cantidad: "Cantidad",
  muestra: "Muestra",
  metodo: "Método",
  motivo: "Motivo",
  usuario: "Usuario",
  accion: "Acción",
  entidad: "Entidad",
};

/** Excepciones por entidad cuando el mismo nombre técnico significa otra cosa. */
const ETIQUETAS_ENTIDAD: Record<string, Record<string, string>> = {
  resultado: { unidad: "Unidad de medida" },
  equipo: { unidad: "Laboratorio (unidad)" },
  actividad: { fecha: "Fecha y hora", entidad: "Tipo de registro", codigo: "Código del registro" },
};

/** Etiqueta legible de una columna; si no hay, el nombre técnico con espacios y mayúscula inicial. */
export function etiquetaCampo(entidad: string, campo: string): string {
  const e = ETIQUETAS_ENTIDAD[entidad]?.[campo] ?? ETIQUETAS[campo];
  if (e) return e;
  const s = campo.replace(/_/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : campo;
}

/** Etiquetas de varias columnas, en el mismo orden. */
export const etiquetasCampos = (entidad: string, campos: string[]): string[] => campos.map((c) => etiquetaCampo(entidad, c));

interface Usuario {
  sub?: string;
  roles?: string[];
  permisos?: string[];
}

/** ¿Puede exportar una entidad que exige `permiso` (además de reporte.ver)? */
export function puedeExportar(u: Usuario | undefined, permiso: string | null | undefined): boolean {
  if (!permiso) return true;
  return (u?.roles ?? []).includes("SUPERADMIN") || (u?.permisos ?? []).includes(permiso);
}

/** Quien creó la plantilla y Administración (ADMIN/SUPERADMIN) la cambian o la eliminan. */
export function puedeEditarPlantilla(u: Usuario | undefined, creadoPor: string | null | undefined): boolean {
  const roles = u?.roles ?? [];
  return (!!u?.sub && creadoPor === u.sub) || roles.includes("SUPERADMIN") || roles.includes("ADMIN");
}
