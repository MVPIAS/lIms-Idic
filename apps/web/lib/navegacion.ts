/**
 * navegacion.ts · mapa único del menú lateral (lo usan Sidebar y Topbar).
 *
 * Cada ítem declara el permiso que lo habilita (`perm`; con array basta UNO).
 * Si el usuario no lo tiene (y no es SUPERADMIN/ADMIN) el ítem no se muestra.
 * La seguridad real la impone el backend (PermisoGuard → 403).
 *
 * Rutas legacy duplicadas del catálogo (/metodos, /analitos, /gran-grupos,
 * /grupos) ya no aparecen: redirigen a su equivalente v2 (next.config.js).
 */
/**
 * Motor de flujos genérico: oculto salvo NEXT_PUBLIC_MOTOR_FLUJOS_VISIBLE=true.
 * Es la misma regla que lib/motorFlujos.ts (ver su comentario); se repite aquí
 * sin import porque este fichero se carga solo, sin dependencias, en
 * scripts/verificacion/alcance-por-laboratorio.js.
 */
const MOTOR_FLUJOS_VISIBLE = process.env.NEXT_PUBLIC_MOTOR_FLUJOS_VISIBLE === "true";

export type Perm = string | string[];
export interface ItemNav {
  href: string;
  label: string;
  icon: string;
  perm?: Perm;
  /**
   * Rama del organigrama a la que pertenece el módulo (con array basta UNA).
   * Si el usuario no trabaja en ella —ni la tiene bajo su mando— el ítem no se
   * muestra. El backend lo impone con @AmbitoUnidad.
   */
  ambito?: string | string[];
  /** palabras extra para el buscador del menú. */
  claves?: string;
}
export interface SeccionNav {
  id: string;
  title: string;
  icon: string;
  items: ItemNav[];
}

const ADMIN_ANY = ["admin.usuarios", "admin.estructura", "admin.roles", "admin.firmas"];

export const NAV: SeccionNav[] = [
  {
    id: "inicio",
    title: "Inicio",
    icon: "⌂",
    items: [
      { href: "/inicio", label: "Mi bandeja", icon: "📥", claves: "pendientes tareas inicio home" },
      { href: "/dashboard", label: "Panel de indicadores", icon: "📊", claves: "kpi resumen dashboard" },
      { href: "/perfil", label: "Mi perfil · contraseña y 2FA", icon: "🔐", claves: "contraseña clave seguridad cambiar" },
      { href: "/firmas", label: "Mi firma", icon: "🖋", claves: "imagen firma firmas registradas" },
    ],
  },
  {
    id: "comercial",
    title: "Comercial",
    icon: "💼",
    items: [
      { href: "/clientes", label: "Clientes", icon: "🏢", perm: "cliente.ver" },
      { href: "/contactos", label: "Contactos", icon: "👤", perm: "cliente.ver" },
      { href: "/crm", label: "Oportunidades (CRM)", icon: "🎯", perm: "cotizacion.ver", claves: "crm pipeline" },
      { href: "/cotizaciones", label: "Cotizaciones", icon: "💲", perm: "cotizacion.ver" },
      { href: "/cotizaciones/nueva", label: "Nueva cotización", icon: "＋", perm: "cotizacion.crear", claves: "costeo" },
      // Misma pantalla que «BPCH · Certificación › Internaciones» (puerta única): Comercial registra la resolución y la tasa.
      // En Comercial solo para quien trabaja en el Depto. Comercial; el BPCH la tiene en su sección.
      { href: "/bpch/internaciones", label: "Internaciones", icon: "🛃", perm: "bpch.internacion.ver", ambito: "DCO", claves: "aduana importacion sdbpch resolucion dgmn tasa" },
      { href: "/listas-precio", label: "Listas de precio", icon: "≣", perm: "cotizacion.ver" },
      { href: "/lista-precio-items", label: "Ítems de lista", icon: "🏷", perm: "cotizacion.ver" },
      { href: "/centros-costo", label: "Centros de costo", icon: "🏦", perm: "factura.ver" },
      { href: "/facturas", label: "Facturas", icon: "📄", perm: "factura.ver" },
      { href: "/pagos", label: "Pagos", icon: "💵", perm: "factura.ver" },
      { href: "/notas-credito", label: "Notas de crédito", icon: "🧾", perm: "factura.ver" },
      { href: "/proveedores", label: "Proveedores", icon: "🚚", perm: "compra.ver" },
      { href: "/ordenes-compra", label: "Órdenes de compra", icon: "🛒", perm: "compra.ver", claves: "oc abastecimiento" },
      { href: "/viaticos", label: "Viáticos", icon: "✈", perm: "factura.ver" },
    ],
  },
  {
    id: "laboratorio",
    title: "Laboratorio",
    icon: "🧪",
    items: [
      { href: "/ot", label: "Órdenes de trabajo", icon: "🗂", perm: "ot.ver", claves: "ot expediente" },
      { href: "/ot/nueva", label: "Registrar OT", icon: "＋", perm: "ot.crear" },
      { href: "/ordenes-internas", label: "Órdenes internas", icon: "🔀", perm: "ot.ver", claves: "derivacion muestreo otro laboratorio" },
      { href: "/muestras", label: "Muestras", icon: "🧫", perm: "muestra.ver" },
      { href: "/captura-ot", label: "Captura y revisión por OT", icon: "📈", perm: ["resultado.crear", "resultado.revisar", "resultado.aprobar"], claves: "revisar aprobar devolver especificación" },
      { href: "/informes", label: "Emitir informe", icon: "🖨", perm: "certificado.emitir" },
      { href: "/informes/por-firmar", label: "Documentos por firmar", icon: "✒", perm: "documento.firmar", claves: "firma firmar oficializar revisar informe" },
      { href: "/certificados", label: "Informes y certificados", icon: "📜", perm: "ot.ver", claves: "entrega anular reemitir" },
      { href: "/custodia", label: "Cadena de custodia", icon: "🔗", perm: "muestra.ver" },
      { href: "/equipos", label: "Equipos y calibración", icon: "⚙", perm: "equipo.ver" },
      { href: "/consumibles", label: "Consumibles · kardex", icon: "🧴", perm: "consumible.gestionar", claves: "stock reactivos lotes" },
      { href: "/qc", label: "Control de calidad (QC)", icon: "✔", perm: "resultado.ver" },
      { href: "/no-conformidades", label: "No conformidades", icon: "⚠", perm: "nc.ver", claves: "nc accion correctiva capa calidad reclamo" },
      { href: "/spc", label: "Control estadístico (SPC)", icon: "📉", perm: "resultado.ver" },
    ],
  },
  {
    id: "metrologia",
    title: "Metrología · LMT",
    icon: "⚖",
    items: [
      { href: "/metrologia", label: "Calibraciones", icon: "⚖", perm: "metrologia.ver", ambito: "SAM" },
      { href: "/metrologia/nueva", label: "Nueva calibración", icon: "＋", perm: "metrologia.crear", ambito: "SAM" },
      { href: "/metrologia/config", label: "Configuración LMT", icon: "🎛", perm: "metrologia.config", ambito: "SAM" },
    ],
  },
  {
    // Frente BPCH G1 · Internación, Reinspección y Codificación Única (procesos sobre la OT).
    // BPCH_CERT = rama BPCH sin la Delegación Nº 11; BPCH_ASIGNADO = lo mismo más
    // las unidades con trabajo asignado (la D11 ve «Internaciones» si inspecciona alguna).
    id: "bpch",
    title: "BPCH · Certificación",
    icon: "✹",
    items: [
      { href: "/bpch/internaciones", label: "Internaciones", icon: "🛃", perm: "bpch.internacion.ver", ambito: ["BPCH_ASIGNADO", "DCO"], claves: "resolucion dgmn tasa importacion" },
      { href: "/bpch/reinspecciones", label: "Reinspecciones", icon: "↻", perm: "bpch.reinspeccion.ver", ambito: "BPCH_ASIGNADO", claves: "traspaso vencimiento rechazo" },
      { href: "/bpch/codificacion", label: "Codificación Única", icon: "🗂", perm: "bpch.codificacion.ver", ambito: ["BPCH_CERT", "DCO"], claves: "cnc dgmn listado explosivos receso" },
      { href: "/bpch/produccion-nacional", label: "Producción Nacional", icon: "🏭", perm: "bpch.pn.ver", ambito: ["BPCH_CERT", "DCO"], claves: "raf fabricante o/c operativa programa inspecciones fiscalizacion" },
      { href: "/bpch/prototipos", label: "Prototipos", icon: "◇", perm: "bpch.prototipo.ver", ambito: "BPCH_ASIGNADO", claves: "aprobacion de tipo elemento nuevo" },
      { href: "/bpch/clasificaciones", label: "Clasificación de sustancias", icon: "⚛", perm: "bpch.clasificacion.ver", ambito: "BPCH_ASIGNADO", claves: "onu koenen tpt division explosiva" },
    ],
  },
  {
    id: "saec",
    title: "BPCH · SAEC",
    icon: "🛡",
    items: [
      { href: "/saec", label: "Evidencias", icon: "🧷", perm: "evidencia.ver", ambito: "D11" },
      { href: "/saec/armas", label: "Armas", icon: "🔫", perm: "arma.ver", ambito: "D11" },
      { href: "/saec/ibis", label: "IBIS · armas importadas", icon: "📥", perm: "ibis.ver", ambito: "D11" },
      { href: "/saec/verificar", label: "Verificar certificado", icon: "🔎" },
    ],
  },
  {
    id: "reportes",
    title: "Reportes y comunicación",
    icon: "📊",
    items: [
      { href: "/reportes", label: "Reportes · exportar", icon: "📊", perm: ["reporte.ver", "reporte.comercial.ver"], claves: "csv excel" },
      { href: "/documentos", label: "Buscador de documentos", icon: "🗄", perm: "ot.ver" },
      { href: "/auditoria", label: "Auditoría (bitácora)", icon: "🧾", perm: "audit.ver", claves: "audit log trazabilidad cambios quien" },
      { href: "/mensajeria", label: "Mensajería · correo", icon: "📧", perm: "cotizacion.ver" },
      { href: "/mensajeria/plantillas", label: "Plantillas de correo", icon: "✉", perm: "cotizacion.ver" },
    ],
  },
  {
    id: "maestras",
    title: "Tablas maestras",
    icon: "🗃",
    items: [
      { href: "/catalogo", label: "Índice del catálogo", icon: "🧭", perm: "catalogo.gestionar" },
      { href: "/catalogo/gran-grupos", label: "Grandes grupos", icon: "🗃", perm: "catalogo.gestionar" },
      { href: "/catalogo/grupos", label: "Grupos", icon: "📁", perm: "catalogo.gestionar" },
      { href: "/catalogo/subgrupos", label: "Subgrupos", icon: "🗂", perm: "catalogo.gestionar" },
      { href: "/catalogo/familias", label: "Familias · laboratorios", icon: "🏛", perm: "catalogo.gestionar" },
      { href: "/catalogo/elementos", label: "Elementos", icon: "🧱", perm: "catalogo.gestionar" },
      { href: "/catalogo/ensayos", label: "Ensayos · precios", icon: "🧪", perm: "catalogo.gestionar" },
      { href: "/catalogo/metodos", label: "Métodos", icon: "🔬", perm: "catalogo.gestionar" },
      { href: "/catalogo/analitos", label: "Analitos", icon: "⚗", perm: "catalogo.gestionar" },
      { href: "/catalogo/especificaciones", label: "Especificaciones", icon: "📐", perm: "catalogo.gestionar", claves: "limites minimo maximo" },
      { href: "/catalogo/paneles", label: "Paneles de ensayo", icon: "🧩", perm: "catalogo.gestionar", claves: "elemento metodo" },
      { href: "/catalogo/formulas", label: "Fórmulas de cálculo", icon: "𝑓", perm: "catalogo.gestionar" },
      { href: "/catalogo/pasos", label: "Pasos por método", icon: "🪜", perm: "catalogo.gestionar" },
    ],
  },
  {
    id: "configuracion",
    title: "Configuración del laboratorio",
    icon: "🛠",
    items: [
      { href: "/plantillas", label: "Plantillas de informe", icon: "📄", perm: "plantilla.ver" },
      // Formato de las plantillas sin pasar por «Emitir informe» (Gestión de Calidad: plantilla.gestionar).
      { href: "/plantillas/formato", label: "Plantillas de documentos", icon: "📐", perm: "plantilla.gestionar", claves: "formato informe columnas portada anexo numeracion" },
      { href: "/formatos-informe", label: "Formatos de informe", icon: "🧾", perm: "catalogo.gestionar", claves: "veredicto occ oi dgmn" },
      { href: "/tipos-muestra", label: "Tipos de muestra", icon: "🌡", perm: "muestra.ver" },
      { href: "/limites", label: "Límites (clásico)", icon: "📏", perm: "metodo.ver" },
      // Motor de flujos genérico: oculto salvo que se reactive (lib/motorFlujos.ts).
      ...(MOTOR_FLUJOS_VISIBLE ? [{ href: "/flujos", label: "Diseñador de flujos", icon: "⛓", perm: "flujo.ver" }] : []),
    ],
  },
  {
    id: "admin",
    title: "Administración",
    icon: "🔧",
    items: [
      { href: "/admin", label: "Panel de administración", icon: "🔧", perm: ADMIN_ANY },
      { href: "/admin/estructura", label: "Estructura (unidades)", icon: "🏛", perm: ["admin.estructura", "admin.usuarios"], claves: "organigrama departamentos laboratorios" },
      { href: "/admin/usuarios", label: "Usuarios", icon: "👥", perm: "admin.usuarios" },
      { href: "/admin/roles", label: "Roles y permisos", icon: "🔑", perm: ["admin.roles", "admin.usuarios"] },
      { href: "/admin/firmas", label: "Matriz de firmas", icon: "✒", perm: ["admin.firmas", "admin.usuarios"] },
      { href: "/catalogo/parametros", label: "Parámetros del sistema", icon: "🎛", perm: "catalogo.gestionar", claves: "listas combos" },
      { href: "/config-correo", label: "Correo saliente", icon: "✉", perm: "admin.usuarios", claves: "smtp" },
      { href: "/usuarios", label: "Usuarios (vista clásica)", icon: "👤", perm: "admin.usuarios" },
      { href: "/permisos", label: "Catálogo de permisos", icon: "📋", perm: "admin.usuarios" },
    ],
  },
];

/** Lo que el menú necesita de GET /me/alcance para decidir los ámbitos. */
export interface AlcanceMenu {
  ambitos?: Record<string, boolean>;
  permisosPorAmbito?: Record<string, string[]>;
}

/**
 * ¿El ítem cabe en el ámbito del usuario? Alcance por asignación: el permiso
 * del ítem tiene que valer DENTRO de la rama (`permisosPorAmbito`); no basta
 * con tenerlo por otro rol ni con ser «global» (SAEC solo admite el global de
 * Dirección, Subdirección, Superadministración y Lector/Auditor).
 * Mientras no llega /me/alcance no se oculta nada por este motivo (el backend
 * responde 403 igualmente). Es la misma regla que aplica @AmbitoUnidad.
 */
export function itemEnAmbito(i: ItemNav, alcance: AlcanceMenu | null | undefined): boolean {
  if (!i.ambito || !alcance?.ambitos) return true;
  const porAmbito = alcance.permisosPorAmbito;
  const perms = i.perm ? ([] as string[]).concat(i.perm) : [];
  return ([] as string[]).concat(i.ambito).some((c) => {
    if (alcance.ambitos?.[c] === false) return false;
    const validos = porAmbito?.[c];
    if (!validos || perms.length === 0) return true;
    return perms.some((p) => validos.includes(p));
  });
}

/** Busca el ítem de menú que mejor corresponde a una ruta (prefijo más largo). */
export function itemDeRuta(pathname: string): { seccion: SeccionNav; item: ItemNav } | null {
  let mejor: { seccion: SeccionNav; item: ItemNav } | null = null;
  for (const s of NAV) {
    for (const i of s.items) {
      if (pathname === i.href || pathname.startsWith(i.href + "/")) {
        if (!mejor || i.href.length > mejor.item.href.length) mejor = { seccion: s, item: i };
      }
    }
  }
  return mejor;
}

/** Normaliza texto para buscar sin tildes ni mayúsculas. */
export function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
