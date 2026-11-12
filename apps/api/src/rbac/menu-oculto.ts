/**
 * Módulos heredados fuera del menú (Comercial R1 y Vehículos R10: «revisar módulos
 * heredados que no corresponden al IDIC»). El parámetro del sistema «menu · ocultos»
 * lista las rutas del menú que no se muestran a nadie (una por línea o separadas por
 * coma, p. ej. «/crm, /encuestas»). El administrador lo cambia en Parámetros del sistema
 * sin tocar código; la seguridad sigue en los permisos (esto solo ordena el menú).
 * Función PURA: menu-oculto.spec.ts.
 */
export function rutasMenuOculto(valor: string | null | undefined): string[] {
  const vistos = new Set<string>();
  for (const parte of String(valor ?? "").split(/[\n,;]+/)) {
    let r = parte.trim();
    if (!r) continue;
    if (!r.startsWith("/")) r = `/${r}`;
    r = r.replace(/\/+$/, "");
    // Solo rutas internas simples (sin protocolo, consulta ni espacios).
    if (!/^\/[a-z0-9\-_/]+$/i.test(r) || r === "/inicio") continue;
    vistos.add(r.toLowerCase());
  }
  return [...vistos];
}

/**
 * Módulos del menú que el administrador puede ocultar desde «Parámetros del
 * sistema › Parámetros de la operación › Menú lateral» (F077). Son las rutas de
 * apps/web/lib/navegacion.ts, salvo Mi bandeja, el perfil, la firma y lo
 * imprescindible para administrar (panel, usuarios, roles, estructura,
 * parámetros y permisos). El valor se guarda en mayúsculas (tipo «multiple»);
 * rutasMenuOculto lo pasa a minúsculas al leerlo.
 */
export const OPCIONES_MENU_OCULTO: { valor: string; etiqueta: string }[] = [
  { valor: "/DASHBOARD", etiqueta: "Inicio › Panel de indicadores" },
  { valor: "/CLIENTES", etiqueta: "Comercial › Clientes" },
  { valor: "/CONTACTOS", etiqueta: "Comercial › Contactos" },
  { valor: "/CRM", etiqueta: "Comercial › Oportunidades (CRM)" },
  { valor: "/COTIZACIONES", etiqueta: "Comercial › Cotizaciones" },
  { valor: "/COTIZACIONES/NUEVA", etiqueta: "Comercial › Nueva cotización" },
  { valor: "/COTIZACIONES/AVISOS", etiqueta: "Comercial › Avisos comerciales" },
  { valor: "/COTIZACIONES/VALIDEZ", etiqueta: "Comercial › Validez de cotizaciones" },
  { valor: "/SEGUIMIENTO", etiqueta: "Comercial › Seguimiento y envío" },
  { valor: "/ENCUESTAS", etiqueta: "Comercial › Encuestas de satisfacción" },
  { valor: "/RECLAMOS", etiqueta: "Comercial › Reclamos" },
  { valor: "/BPCH/INTERNACIONES", etiqueta: "Comercial › Internaciones" },
  { valor: "/BPCH/TASA-MENSUAL", etiqueta: "Comercial › Tasa 1,5 % mensual" },
  { valor: "/LISTAS-PRECIO", etiqueta: "Comercial › Listas de precio" },
  { valor: "/LISTA-PRECIO-ITEMS", etiqueta: "Comercial › Ítems de lista" },
  { valor: "/CENTROS-COSTO", etiqueta: "Comercial › Centros de costo" },
  { valor: "/FACTURAS", etiqueta: "Comercial › Facturas" },
  { valor: "/PAGOS", etiqueta: "Comercial › Pagos" },
  { valor: "/NOTAS-CREDITO", etiqueta: "Comercial › Notas de crédito" },
  { valor: "/PROVEEDORES", etiqueta: "Comercial › Proveedores" },
  { valor: "/ORDENES-COMPRA", etiqueta: "Comercial › Órdenes de compra" },
  { valor: "/VIATICOS", etiqueta: "Comercial › Viáticos" },
  { valor: "/OT", etiqueta: "Laboratorio › Órdenes de trabajo" },
  { valor: "/OT/NUEVA", etiqueta: "Laboratorio › Registrar OT" },
  { valor: "/ORDENES-INTERNAS", etiqueta: "Laboratorio › Órdenes internas" },
  { valor: "/COTIZACIONES/POR-RESPONDER", etiqueta: "Laboratorio › Cotizaciones por responder" },
  { valor: "/MUESTRAS", etiqueta: "Laboratorio › Muestras recibidas" },
  { valor: "/ESPECIFICACIONES", etiqueta: "Laboratorio › Especificaciones técnicas (E.T.)" },
  { valor: "/RECEPCION", etiqueta: "Laboratorio › Bandeja de entrada del laboratorio" },
  { valor: "/CAPTURA-OT", etiqueta: "Laboratorio › Captura y revisión por OT" },
  { valor: "/INSTRUMENTOS", etiqueta: "Laboratorio › Datos de instrumentos" },
  { valor: "/PREPARACION-TRABAJO", etiqueta: "Laboratorio › Preparación del trabajo por aprobar" },
  { valor: "/INFORMES", etiqueta: "Laboratorio › Emitir informe" },
  { valor: "/INFORMES/POR-FIRMAR", etiqueta: "Laboratorio › Documentos por firmar" },
  { valor: "/CERTIFICADOS", etiqueta: "Laboratorio › Informes y certificados" },
  { valor: "/OFICIOS", etiqueta: "Laboratorio › Oficios conductores" },
  { valor: "/CUSTODIA", etiqueta: "Laboratorio › Cadena de custodia" },
  { valor: "/EQUIPOS", etiqueta: "Laboratorio › Equipos y calibración" },
  { valor: "/MANTENCION", etiqueta: "Laboratorio › Mantención y gestión de equipos" },
  { valor: "/CONSUMIBLES", etiqueta: "Laboratorio › Consumibles · kardex" },
  { valor: "/CONSUMIBLES/BODEGAS", etiqueta: "Laboratorio › Bodegas e inventario valorizado" },
  { valor: "/MUNICION", etiqueta: "Laboratorio › Munición de prueba" },
  { valor: "/QC", etiqueta: "Laboratorio › Control de calidad (QC)" },
  { valor: "/CALIDAD", etiqueta: "Laboratorio › Calidad: re-análisis, ISO 17025, POE y alícuotas" },
  { valor: "/NO-CONFORMIDADES", etiqueta: "Laboratorio › No conformidades" },
  { valor: "/APELACIONES", etiqueta: "Laboratorio › Apelaciones" },
  { valor: "/SPC", etiqueta: "Laboratorio › Control estadístico (SPC)" },
  { valor: "/METROLOGIA", etiqueta: "Metrología · LMT › Calibraciones" },
  { valor: "/METROLOGIA/NUEVA", etiqueta: "Metrología · LMT › Por calibrar" },
  { valor: "/METROLOGIA/CONFIG", etiqueta: "Metrología · LMT › Configuración LMT" },
  { valor: "/BPCH/REQUERIMIENTOS", etiqueta: "BPCH · Certificación › Requerimientos (OT sin cotización)" },
  { valor: "/BPCH/REINSPECCIONES", etiqueta: "BPCH · Certificación › Reinspecciones" },
  { valor: "/BPCH/CODIFICACION", etiqueta: "BPCH · Certificación › Codificación Única" },
  { valor: "/BPCH/PRODUCCION-NACIONAL", etiqueta: "BPCH · Certificación › Producción Nacional" },
  { valor: "/BPCH/PROTOTIPOS", etiqueta: "BPCH · Certificación › Prototipos" },
  { valor: "/BPCH/CLASIFICACIONES", etiqueta: "BPCH · Certificación › Clasificación de sustancias" },
  { valor: "/SAEC/OT", etiqueta: "BPCH · SAEC › Certificación de armas" },
  { valor: "/SAEC/CATALOGOS", etiqueta: "BPCH · SAEC › Catálogo de armas" },
  { valor: "/SAEC", etiqueta: "BPCH · SAEC › Evidencias" },
  { valor: "/SAEC/DONDE-ESTA", etiqueta: "BPCH · SAEC › ¿Dónde está la evidencia?" },
  { valor: "/SAEC/CASOS", etiqueta: "BPCH · SAEC › Casos" },
  { valor: "/SAEC/MUNICION", etiqueta: "BPCH · SAEC › Munición de prueba" },
  { valor: "/SAEC/ARMAS", etiqueta: "BPCH · SAEC › Armas" },
  { valor: "/SAEC/IBIS", etiqueta: "BPCH · SAEC › IBIS · armas importadas" },
  { valor: "/SAEC/VERIFICAR", etiqueta: "BPCH · SAEC › Verificar certificado" },
  { valor: "/ZONA-INFORMES", etiqueta: "Reportes y comunicación › Zona de informes" },
  { valor: "/REPORTES", etiqueta: "Reportes y comunicación › Reportes · exportar" },
  { valor: "/BI", etiqueta: "Reportes y comunicación › Análisis e inteligencia de negocio (Metabase)" },
  { valor: "/AGENDA", etiqueta: "Reportes y comunicación › Agenda de recursos y eventos" },
  { valor: "/DOCUMENTOS/GESTOR", etiqueta: "Reportes y comunicación › Gestor documental" },
  { valor: "/DOCUMENTOS", etiqueta: "Reportes y comunicación › Buscador de documentos emitidos" },
  { valor: "/AUDITORIA", etiqueta: "Reportes y comunicación › Auditoría (bitácora)" },
  { valor: "/MENSAJERIA/BANDEJA", etiqueta: "Reportes y comunicación › Mensajes internos" },
  { valor: "/MENSAJERIA", etiqueta: "Reportes y comunicación › Mensajería · correo" },
  { valor: "/MENSAJERIA/PLANTILLAS", etiqueta: "Reportes y comunicación › Plantillas de correo" },
  { valor: "/CATALOGO", etiqueta: "Tablas maestras › Índice del catálogo" },
  { valor: "/CATALOGO/GRAN-GRUPOS", etiqueta: "Tablas maestras › Grandes grupos" },
  { valor: "/CATALOGO/GRUPOS", etiqueta: "Tablas maestras › Grupos" },
  { valor: "/CATALOGO/SUBGRUPOS", etiqueta: "Tablas maestras › Subgrupos" },
  { valor: "/CATALOGO/FAMILIAS", etiqueta: "Tablas maestras › Familias · laboratorios" },
  { valor: "/CATALOGO/ELEMENTOS", etiqueta: "Tablas maestras › Elementos" },
  { valor: "/CATALOGO/ENSAYOS", etiqueta: "Tablas maestras › Ensayos · precios" },
  { valor: "/CATALOGO/METODOS", etiqueta: "Tablas maestras › Métodos" },
  { valor: "/CATALOGO/ANALITOS", etiqueta: "Tablas maestras › Analitos" },
  { valor: "/CATALOGO/ESPECIFICACIONES", etiqueta: "Tablas maestras › Especificaciones" },
  { valor: "/CATALOGO/PANELES", etiqueta: "Tablas maestras › Paneles de ensayo" },
  { valor: "/CATALOGO/FORMULAS", etiqueta: "Tablas maestras › Fórmulas de cálculo" },
  { valor: "/CATALOGO/PASOS", etiqueta: "Tablas maestras › Pasos por método" },
  { valor: "/CATALOGO/TARIFAS-HH", etiqueta: "Tablas maestras › Tarifas · horas hombre (HH)" },
  { valor: "/CATALOGO/PERFILES-HH", etiqueta: "Tablas maestras › Tarifas · perfiles HH" },
  { valor: "/CATALOGO/TARIFAS-HM", etiqueta: "Tablas maestras › Tarifas · horas máquina (HM)" },
  { valor: "/CATALOGO/SERVICIOS-PRIMARIOS", etiqueta: "Tablas maestras › Tarifas · servicios primarios" },
  { valor: "/PLANTILLAS", etiqueta: "Configuración del laboratorio › Plantillas de informe" },
  { valor: "/PLANTILLAS/FORMATO", etiqueta: "Configuración del laboratorio › Plantillas de documentos" },
  { valor: "/PLANTILLAS/VERSIONES", etiqueta: "Configuración del laboratorio › Versiones de plantillas" },
  { valor: "/QC/CEPAS", etiqueta: "Configuración del laboratorio › Cepas de referencia" },
  { valor: "/FORMATOS-INFORME", etiqueta: "Configuración del laboratorio › Formatos de informe" },
  { valor: "/TIPOS-MUESTRA", etiqueta: "Configuración del laboratorio › Tipos de muestra" },
  { valor: "/LIMITES", etiqueta: "Configuración del laboratorio › Límites (clásico)" },
  { valor: "/ADMIN/FIRMAS", etiqueta: "Administración › Matriz de firmas" },
  { valor: "/FLUJOS", etiqueta: "Administración › Diseñador de flujos" },
  { valor: "/ADMIN/NUMERACION", etiqueta: "Administración › Numeración de documentos" },
  { valor: "/ADMIN/INTEGRACION", etiqueta: "Administración › API e integración" },
  { valor: "/ADMIN/RESPALDOS", etiqueta: "Administración › Respaldos" },
  { valor: "/CONFIG-CORREO", etiqueta: "Administración › Correo saliente" },
  { valor: "/USUARIOS", etiqueta: "Administración › Usuarios (vista clásica)" },];
