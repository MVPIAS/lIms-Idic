/**
 * Documentación de la API REST (contrato §4.7.4) · reglas PURAS, probadas en
 * openapi.spec.ts.
 *
 * Toma la especificación OpenAPI que genera @nestjs/swagger a partir de los
 * controladores y la deja legible para quien integra otro sistema:
 *   · agrupa cada operación por MÓDULO en español (primer segmento de la ruta),
 *     con título y descripción;
 *   · da un resumen en español a las operaciones que no lo tienen;
 *   · anota el PERMISO que exige cada operación (lo que lee PermisoGuard), en la
 *     descripción y en la extensión `x-permisos`;
 *   · declara la autenticación Bearer (sesión o token de integración).
 */

export interface ModuloApi {
  titulo: string;
  descripcion: string;
}

/**
 * Módulos principales, en el orden en que se muestran. Clave = primer segmento
 * de la ruta tras /api. Lo que no está aquí se agrupa con un título derivado de
 * la ruta («notas-credito» → «Notas credito») al final.
 */
export const MODULOS_API: Record<string, ModuloApi> = {
  auth: { titulo: "Autenticación y sesión", descripcion: "Ingreso, renovación de la sesión, segundo factor y datos del usuario conectado." },
  me: { titulo: "Usuario conectado", descripcion: "Alcance, bandeja de pendientes y preferencias del usuario (o de la cuenta de servicio) que llama." },
  clientes: { titulo: "Clientes", descripcion: "Ficha de clientes, contactos, bloqueos y su historial comercial." },
  contactos: { titulo: "Contactos de clientes", descripcion: "Personas de contacto de cada cliente." },
  cotizaciones: { titulo: "Cotizaciones", descripcion: "Cotizaciones a clientes: alta, consultas al laboratorio, firma, envío y aceptación." },
  oportunidades: { titulo: "Oportunidades (CRM)", descripcion: "Seguimiento comercial previo a la cotización." },
  "listas-precio": { titulo: "Listas de precios", descripcion: "Listas de precios vigentes y sus ítems." },
  "lista-precio-items": { titulo: "Ítems de listas de precios", descripcion: "Servicios y valores de cada lista de precios." },
  tarifas: { titulo: "Tarifas", descripcion: "Tarifas y cálculo de valores de los servicios." },
  ot: { titulo: "Órdenes de trabajo (OT)", descripcion: "Órdenes de trabajo: alta, muestras, análisis programados, estados, plazos y cierre." },
  flujo: { titulo: "Flujo de la OT", descripcion: "Pasos del flujo de trabajo de cada OT y su avance." },
  flujos: { titulo: "Flujos de trabajo", descripcion: "Definición de los flujos de trabajo por laboratorio." },
  "ordenes-internas": { titulo: "Órdenes internas", descripcion: "Órdenes de trabajo entre laboratorios del IDIC." },
  recepcion: { titulo: "Recepción de muestras", descripcion: "Recepción, rotulado y distribución de muestras a los laboratorios." },
  muestras: { titulo: "Muestras", descripcion: "Consulta y trazabilidad de muestras." },
  custodia: { titulo: "Cadena de custodia", descripcion: "Movimientos y responsables de las muestras bajo custodia." },
  muestreo: { titulo: "Muestreo", descripcion: "Planes de muestreo (NCh 44) y tamaños de muestra." },
  resultados: { titulo: "Resultados", descripcion: "Captura, revisión y aprobación de resultados de ensayo." },
  formularios: { titulo: "Formularios de captura", descripcion: "Formularios especializados de captura de resultados por método o laboratorio." },
  laboratorio: { titulo: "Laboratorio", descripcion: "Planillas, corridas y trabajo diario del laboratorio." },
  informes: { titulo: "Informes de ensayo", descripcion: "Emisión, firma y entrega de informes de ensayo." },
  certificados: { titulo: "Certificados", descripcion: "Certificados emitidos y su verificación." },
  "formatos-informe": { titulo: "Formatos de informe", descripcion: "Formatos y plantillas de los informes por laboratorio." },
  plantillas: { titulo: "Plantillas de documentos", descripcion: "Plantillas de los documentos que genera el sistema." },
  firmas: { titulo: "Firmas", descripcion: "Firma electrónica de documentos." },
  "mi-firma": { titulo: "Mi firma", descripcion: "Imagen de firma del usuario conectado." },
  "firmas-matriz": { titulo: "Matriz de firmas", descripcion: "Quién firma cada tipo de documento en cada unidad." },
  oficios: { titulo: "Oficios", descripcion: "Oficios conductores y su despacho." },
  cat: { titulo: "Catálogo técnico", descripcion: "Catálogo de productos y análisis: gran grupo, grupo, ensayos, métodos, analitos, paneles y especificaciones." },
  cascada: { titulo: "Catálogo · consulta en cascada", descripcion: "Consulta encadenada del catálogo para armar una OT o cotización." },
  metodos: { titulo: "Métodos de ensayo", descripcion: "Métodos de ensayo y sus versiones." },
  analitos: { titulo: "Analitos", descripcion: "Analitos y parámetros medidos." },
  limites: { titulo: "Límites y especificaciones", descripcion: "Límites mínimos, nominales y máximos por norma o cliente." },
  "especificaciones-tecnicas": { titulo: "Especificaciones técnicas", descripcion: "Especificaciones técnicas publicadas y sus documentos." },
  "pasos-metodo": { titulo: "Pasos de método", descripcion: "Pasos operativos de cada método." },
  parametros: { titulo: "Parámetros del sistema", descripcion: "Parámetros configurables y listas de valores." },
  qc: { titulo: "Control de calidad (QC)", descripcion: "Controles de calidad internos y sus resultados." },
  spc: { titulo: "Control estadístico (SPC)", descripcion: "Cartas de control y reglas de control estadístico de procesos." },
  calidad: { titulo: "Calidad", descripcion: "Gestión de calidad: resultados, indicadores y registros ISO/IEC 17025." },
  "no-conformidades": { titulo: "No conformidades", descripcion: "Trabajo no conforme, acciones correctivas y cierre." },
  reclamos: { titulo: "Reclamos", descripcion: "Reclamos de clientes y su resolución." },
  apelaciones: { titulo: "Apelaciones", descripcion: "Apelaciones de clientes." },
  encuestas: { titulo: "Encuestas de satisfacción", descripcion: "Encuestas a clientes y su seguimiento." },
  equipos: { titulo: "Equipos", descripcion: "Equipos de laboratorio, calibraciones y estado." },
  mantencion: { titulo: "Mantenciones", descripcion: "Mantenciones programadas y correctivas de equipos." },
  calibraciones: { titulo: "Calibraciones de equipos", descripcion: "Calibraciones de los equipos del laboratorio." },
  instrumentos: { titulo: "Instrumentos", descripcion: "Perfiles de instrumentos e importación de resultados desde equipos." },
  metrologia: { titulo: "Metrología", descripcion: "Calibraciones del Laboratorio de Metrología: OT, hojas de cálculo, certificados e informes técnicos." },
  consumibles: { titulo: "Consumibles", descripcion: "Reactivos y consumibles: inventario, lotes, consumos y alertas de stock." },
  proveedores: { titulo: "Proveedores", descripcion: "Proveedores de bienes y servicios." },
  "ordenes-compra": { titulo: "Órdenes de compra", descripcion: "Órdenes de compra de los clientes y su aprobación." },
  viaticos: { titulo: "Viáticos", descripcion: "Viáticos asociados a servicios en terreno." },
  "solicitud-costeo": { titulo: "Solicitudes de costeo", descripcion: "Solicitudes de costeo de servicios al laboratorio." },
  costeo: { titulo: "Costeo", descripcion: "Costeo de servicios por laboratorio." },
  facturas: { titulo: "Facturación", descripcion: "Facturas emitidas y su estado." },
  "notas-credito": { titulo: "Notas de crédito", descripcion: "Notas de crédito asociadas a facturas." },
  pagos: { titulo: "Pagos", descripcion: "Pagos recibidos y su conciliación." },
  "centros-costo": { titulo: "Centros de costo", descripcion: "Centros de costo institucionales." },
  internaciones: { titulo: "Internaciones", descripcion: "Internación de productos (IDIC-PG 24) y cálculo de la tasa." },
  bpch: { titulo: "BPCH · Banco de Pruebas de Chile", descripcion: "Inspección, certificación, codificación y notificación a la DGMN." },
  saec: { titulo: "SAEC · evidencias y armas", descripcion: "Gestión de evidencias forenses, armas, casos e IBIS." },
  evidencias: { titulo: "Evidencias (SAEC)", descripcion: "Evidencias forenses y su cadena de custodia." },
  "custodia-evidencia": { titulo: "Custodia de evidencias", descripcion: "Movimientos de evidencias." },
  "prestamos-evidencia": { titulo: "Préstamos de evidencias", descripcion: "Préstamos de evidencias y su devolución." },
  armas: { titulo: "Armas (SAEC)", descripcion: "Registro de armas." },
  ibis: { titulo: "IBIS", descripcion: "Importación de resultados XML de IBIS." },
  d11: { titulo: "Delegación Nº 11", descripcion: "Armas y munición de la Delegación Nº 11." },
  municion: { titulo: "Munición", descripcion: "Lotes, solicitudes y movimientos de munición." },
  documentos: { titulo: "Gestor documental", descripcion: "Carpetas, documentos controlados y sus versiones." },
  "numeracion-documentos": { titulo: "Numeración de documentos", descripcion: "Correlativos de informes, certificados y otros documentos." },
  reportes: { titulo: "Reportes", descripcion: "Reportes e indicadores exportables." },
  seguimiento: { titulo: "Seguimiento", descripcion: "Seguimiento de plazos y estados." },
  avisos: { titulo: "Avisos", descripcion: "Avisos y alertas a los usuarios." },
  mensajes: { titulo: "Mensajería interna", descripcion: "Mensajes entre usuarios." },
  mensajeria: { titulo: "Mensajería y correo", descripcion: "Correo saliente y plantillas de mensajes." },
  agenda: { titulo: "Agenda", descripcion: "Eventos y reserva de recursos." },
  usuarios: { titulo: "Administración · usuarios", descripcion: "Usuarios, asignación de roles y estado de las cuentas." },
  roles: { titulo: "Administración · roles", descripcion: "Roles y permisos." },
  permisos: { titulo: "Administración · permisos", descripcion: "Catálogo de permisos." },
  unidades: { titulo: "Administración · estructura", descripcion: "Unidades del organigrama (departamentos, secciones y laboratorios)." },
  "clientes-buscador": { titulo: "Clientes · buscador", descripcion: "Búsqueda rápida de clientes para formularios." },
  "gran-grupos": { titulo: "Gran grupos (catálogo anterior)", descripcion: "Gran grupos del catálogo anterior; el vigente está en Catálogo técnico." },
  grupos: { titulo: "Grupos (catálogo anterior)", descripcion: "Grupos del catálogo anterior; el vigente está en Catálogo técnico." },
  "tipos-muestra": { titulo: "Tipos de muestra", descripcion: "Tipos de muestra que se reciben." },
  personas: { titulo: "Personas", descripcion: "Búsqueda de personas para asignaciones." },
  integracion: { titulo: "Integración", descripcion: "Documentación de esta API y tokens de integración (cuentas de servicio)." },
  auditoria: { titulo: "Auditoría", descripcion: "Bitácora de cambios del sistema (audit_log)." },
  config: { titulo: "Configuración", descripcion: "Configuración general (IBIS, correo y otros)." },
  health: { titulo: "Estado del servicio", descripcion: "Comprobación de que la API está en línea." },
};

/** Título del módulo de un segmento de ruta (mapeado o derivado). */
export function tituloModulo(segmento: string): string {
  const m = MODULOS_API[segmento];
  if (m) return m.titulo;
  const t = segmento.replace(/[-_]+/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "Otros";
}

/** Primer segmento de la ruta tras el prefijo /api. */
export function segmentoDe(ruta: string): string {
  const partes = ruta.split("/").filter(Boolean);
  const i = partes[0] === "api" ? 1 : 0;
  return partes[i] ?? "";
}

const VERBO_CRUD: Record<string, "ver" | "crear" | "editar" | "eliminar"> = {
  get: "ver",
  post: "crear",
  put: "editar",
  patch: "editar",
  delete: "eliminar",
};

/** Permisos exigidos por un método de controlador (misma precedencia que PermisoGuard). */
export function permisosDeRuta(
  verbo: string,
  meta: {
    publica?: boolean;
    metodo?: string[] | null;
    clase?: string[] | null;
    crud?: Partial<Record<"ver" | "crear" | "editar" | "eliminar", string>> | null;
  },
): { publica: boolean; permisos: string[] } {
  if (meta.publica) return { publica: true, permisos: [] };
  if (meta.metodo?.length) return { publica: false, permisos: [...meta.metodo] };
  if (meta.clase?.length) return { publica: false, permisos: [...meta.clase] };
  const accion = VERBO_CRUD[verbo.toLowerCase()];
  const c = accion ? meta.crud?.[accion] : undefined;
  return { publica: false, permisos: c ? [c] : [] };
}

/** Resumen en español para una operación sin `summary`. */
export function resumenAutomatico(verbo: string, ruta: string): string {
  const partes = ruta.split("/").filter(Boolean).filter((p) => p !== "api");
  const ultimo = partes[partes.length - 1] ?? "";
  const esParam = (p: string) => p.startsWith("{") || p.startsWith(":");
  const recursoSeg = [...partes].reverse().find((p) => !esParam(p)) ?? "";
  const recurso = recursoSeg.replace(/[-_]+/g, " ");
  const v = verbo.toLowerCase();
  if (v === "get") return esParam(ultimo) ? `Consultar el detalle (${recurso})` : `Consultar ${recurso}`;
  if (v === "post") {
    // POST /recurso/{id}/accion → acción de negocio con nombre propio.
    if (partes.length > 1 && !esParam(ultimo) && partes.slice(0, -1).some(esParam)) return `Acción «${recurso}»`;
    return `Crear o registrar (${recurso})`;
  }
  if (v === "put" || v === "patch") return `Modificar (${recurso})`;
  if (v === "delete") return `Eliminar o anular (${recurso})`;
  return `${v.toUpperCase()} ${recurso}`;
}

const VERBOS = ["get", "post", "put", "patch", "delete"] as const;

export interface OpcionesDocumento {
  /** Permisos por operationId (`Controlador_metodo`). */
  permisos?: Record<string, { publica: boolean; permisos: string[] }>;
}

/**
 * Deja el documento listo para entregar: módulos en español, resúmenes,
 * permisos y seguridad Bearer. Devuelve un documento NUEVO (no muta el de entrada).
 */
export function enriquecerDocumento<T extends { paths?: Record<string, any>; tags?: any[]; security?: any[] }>(
  doc: T,
  opciones: OpcionesDocumento = {},
): T {
  const salida: any = JSON.parse(JSON.stringify(doc));
  const usados = new Map<string, string>(); // título → segmento
  for (const [ruta, item] of Object.entries<any>(salida.paths ?? {})) {
    const seg = segmentoDe(ruta);
    const titulo = tituloModulo(seg);
    for (const verbo of VERBOS) {
      const op = item?.[verbo];
      if (!op) continue;
      op.tags = [titulo];
      if (!usados.has(titulo)) usados.set(titulo, seg);
      if (!op.summary) op.summary = resumenAutomatico(verbo, ruta);
      // Las rutas @All() llevan el verbo al final del operationId (Controlador_metodo_get).
      const opId: string | undefined = op.operationId;
      const p = opId ? (opciones.permisos?.[opId] ?? opciones.permisos?.[opId.replace(/_(get|post|put|patch|delete)$/, "")]) : undefined;
      if (p) {
        op["x-permisos"] = p.permisos;
        const linea = p.publica
          ? "Acceso público (no requiere autenticación)."
          : p.permisos.length
            ? `Permiso requerido: ${p.permisos.map((x) => `\`${x}\``).join(", ")}.`
            : "Requiere autenticación (sesión o token de integración); sin permiso específico.";
        op.description = op.description ? `${op.description}\n\n${linea}` : linea;
        if (p.publica) op.security = [];
      }
    }
  }
  // Etiquetas: primero los módulos principales en su orden, luego el resto alfabético.
  const orden = Object.keys(MODULOS_API);
  salida.tags = [...usados.entries()]
    .sort(([ta, sa], [tb, sb]) => {
      const ia = orden.indexOf(sa);
      const ib = orden.indexOf(sb);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 1e6 : ia) - (ib === -1 ? 1e6 : ib);
      return ta.localeCompare(tb, "es");
    })
    .map(([titulo, seg]) => ({ name: titulo, description: MODULOS_API[seg]?.descripcion ?? `Rutas /api/${seg}.` }));
  salida.security = [{ bearer: [] }];
  return salida;
}
