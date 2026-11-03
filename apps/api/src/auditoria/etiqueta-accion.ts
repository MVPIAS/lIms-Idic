/**
 * Texto de la «Acción» de la bitácora (audit_log.accion) · regla PURA, probada
 * en etiqueta-accion.spec.ts.
 *
 * AuditInterceptor guarda en `accion` el verbo HTTP traducido (crear,
 * modificar, eliminar), «vencer» (tareas automáticas) o, en un POST con
 * sub-acción, el último segmento de la ruta (firmar, aprobar, lotes, valor,
 * solicitudes-laboratorio…). Aquí cada código se traduce a un texto en español
 * y se agrupa en pocas familias, que son las que ofrece el filtro «Acción».
 */
export type GrupoAccion = "crear" | "modificar" | "eliminar" | "vencer" | "flujo";

export const GRUPOS_ACCION: { valor: GrupoAccion; etiqueta: string }[] = [
  { valor: "crear", etiqueta: "Creación" },
  { valor: "modificar", etiqueta: "Modificación" },
  { valor: "eliminar", etiqueta: "Eliminación / anulación" },
  { valor: "vencer", etiqueta: "Vencimiento automático" },
  { valor: "flujo", etiqueta: "Paso del flujo (firma, aprobación, envío…)" },
];

/** Sub-acciones conocidas: [texto, familia]. */
const ACCIONES: Record<string, [string, GrupoAccion]> = {
  crear: ["Creación", "crear"],
  modificar: ["Modificación", "modificar"],
  eliminar: ["Eliminación / anulación", "eliminar"],
  vencer: ["Vencimiento automático", "vencer"],
  anular: ["Anulación", "eliminar"],
  "anular-ocurrencia": ["Anulación de ocurrencia", "eliminar"],
  "anular-orden-cliente": ["Anulación de la orden del cliente", "eliminar"],
  descartar: ["Descarte", "eliminar"],
  quitar: ["Retiro de un elemento", "eliminar"],
  desactivar: ["Desactivación", "modificar"],
  activar: ["Activación", "modificar"],
  archivar: ["Archivo", "modificar"],
  desarchivar: ["Desarchivo", "modificar"],
  bloquear: ["Bloqueo", "modificar"],
  desbloquear: ["Desbloqueo", "modificar"],
  "cambiar-password": ["Cambio de contraseña", "modificar"],
  "reset-password": ["Restablecimiento de contraseña", "modificar"],
  estado: ["Cambio de estado", "modificar"],
  reclasificar: ["Reclasificación", "modificar"],
  restaurar: ["Restauración", "modificar"],
  reabrir: ["Reapertura", "modificar"],
  duplicar: ["Duplicado", "crear"],
  "nueva-version": ["Nueva versión", "crear"],
  generar: ["Generación", "crear"],
  "generar-ot": ["Generación de OT", "crear"],
  "generar-analisis": ["Generación de análisis", "crear"],
  "desde-cotizacion": ["OT desde cotización", "crear"],
  importar: ["Importación", "crear"],
  registrar: ["Registro", "crear"],
  "registrar-opi": ["Registro de OPI", "crear"],
  instanciar: ["Creación desde plantilla", "crear"],
  convertir: ["Conversión", "crear"],
  firmar: ["Firma", "flujo"],
  "devolver-firma": ["Devolución de la firma", "flujo"],
  "enviar-a-firma": ["Envío a firma", "flujo"],
  aprobar: ["Aprobación", "flujo"],
  rechazar: ["Rechazo", "flujo"],
  revisar: ["Revisión", "flujo"],
  validar: ["Validación", "flujo"],
  "validar-formula": ["Validación de fórmula", "flujo"],
  "validacion-laboratorio": ["Validación del laboratorio", "flujo"],
  vb: ["Visto bueno", "flujo"],
  emitir: ["Emisión", "flujo"],
  "emitir-informe": ["Emisión del informe", "flujo"],
  reemitir: ["Reemisión", "flujo"],
  publicar: ["Publicación", "flujo"],
  cerrar: ["Cierre", "flujo"],
  "cerrar-panel": ["Cierre del panel", "flujo"],
  "cierre-tecnico": ["Cierre técnico", "flujo"],
  concluir: ["Conclusión", "flujo"],
  completar: ["Completado", "flujo"],
  aceptar: ["Aceptación", "flujo"],
  ganar: ["Cotización ganada", "flujo"],
  perder: ["Cotización perdida", "flujo"],
  devolver: ["Devolución", "flujo"],
  devolucion: ["Devolución", "flujo"],
  enviar: ["Envío", "flujo"],
  "enviar-cliente": ["Envío al cliente", "flujo"],
  "enviar-correo": ["Envío de correo", "flujo"],
  correo: ["Envío de correo", "flujo"],
  despachar: ["Despacho", "flujo"],
  entregar: ["Entrega", "flujo"],
  entrega: ["Entrega", "flujo"],
  recibir: ["Recepción", "flujo"],
  "dar-por-recibido": ["Recepción confirmada", "flujo"],
  recepcion: ["Recepción", "flujo"],
  "recepcion-dco": ["Recepción en el DCO", "flujo"],
  "recepcion-informe-dco": ["Recepción del informe en el DCO", "flujo"],
  "remitir-dco": ["Remisión al DCO", "flujo"],
  "remitir-facturacion": ["Remisión a facturación", "flujo"],
  asignar: ["Asignación", "flujo"],
  "asignar-ensayos": ["Asignación de ensayos", "flujo"],
  aplicar: ["Aplicación", "flujo"],
  calcular: ["Cálculo", "flujo"],
  ejecutar: ["Ejecución", "flujo"],
  "ejecutar-accion": ["Ejecución de acción", "flujo"],
  escalar: ["Escalamiento", "flujo"],
  responder: ["Respuesta", "flujo"],
  respuesta: ["Respuesta", "flujo"],
  "responder-requerimiento": ["Respuesta al requerimiento", "flujo"],
  "sin-respuesta": ["Marcado sin respuesta", "flujo"],
  resolver: ["Resolución", "flujo"],
  retirar: ["Retiro", "flujo"],
  descontar: ["Descuento de stock", "flujo"],
  movimiento: ["Movimiento de stock", "flujo"],
  "notificar-plazo": ["Aviso de plazo", "flujo"],
  "no-emitido": ["Marcado no emitido", "flujo"],
  previsualizar: ["Vista previa", "flujo"],
  "vista-previa": ["Vista previa", "flujo"],
  probar: ["Prueba", "flujo"],
  leer: ["Lectura", "flujo"],
  leido: ["Marcado como leído", "flujo"],
  leidos: ["Marcados como leídos", "flujo"],
  reanalisis: ["Reanálisis", "flujo"],
  peritaje: ["Peritaje", "flujo"],
  dictamen: ["Dictamen", "flujo"],
  veredicto: ["Veredicto", "flujo"],
  "pronunciamiento-sac": ["Pronunciamiento SAC", "flujo"],
};

/** «solicitudes-laboratorio» → «solicitudes laboratorio». */
function legible(codigo: string): string {
  return codigo.replace(/[-_]+/g, " ").trim();
}

/** Texto y familia de un código de acción. Lo desconocido es el alta de un sub-registro (POST /…/lotes). */
export function accionLegible(accion: string | null | undefined): { etiqueta: string; grupo: GrupoAccion } {
  const a = String(accion ?? "").trim();
  const conocida = ACCIONES[a] ?? ACCIONES[a.toLowerCase()];
  if (conocida) return { etiqueta: conocida[0], grupo: conocida[1] };
  if (!a) return { etiqueta: "—", grupo: "modificar" };
  return { etiqueta: `Registro de ${legible(a)}`, grupo: "crear" };
}

export const esGrupoAccion = (v: string): v is GrupoAccion => GRUPOS_ACCION.some((g) => g.valor === v);

/** Códigos de `existentes` que pertenecen a la familia `grupo`. */
export function accionesDelGrupo(grupo: GrupoAccion, existentes: string[]): string[] {
  return existentes.filter((a) => accionLegible(a).grupo === grupo);
}
