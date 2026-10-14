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
      { href: "/perfil", label: "Mi perfil · 2FA", icon: "🔐", claves: "contraseña seguridad" },
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
      { href: "/internaciones", label: "Internaciones", icon: "🛃", perm: ["cotizacion.ver", "ot.ver"], ambito: ["BPCH", "DCO"], claves: "aduana importacion sdbpch" },
      { href: "/listas-precio", label: "Listas de precio", icon: "≣", perm: "cotizacion.ver" },
      { href: "/lista-precio-items", label: "Ítems de lista", icon: "🏷", perm: "cotizacion.ver" },
      { href: "/centros-costo", label: "Centros de costo", icon: "🏦", perm: "factura.ver" },
      { href: "/facturas", label: "Facturas", icon: "📄", perm: "factura.ver" },
      { href: "/pagos", label: "Pagos", icon: "💵", perm: "factura.ver" },
      { href: "/notas-credito", label: "Notas de crédito", icon: "🧾", perm: "factura.ver" },
      { href: "/proveedores", label: "Proveedores", icon: "🚚", perm: "factura.ver" },
      { href: "/ordenes-compra", label: "Órdenes de compra", icon: "🛒", perm: "factura.ver", claves: "oc abastecimiento" },
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
      { href: "/ordenes-internas", label: "Órdenes internas", icon: "🔀", perm: "cotizacion.ver", claves: "derivacion muestreo" },
      { href: "/muestras", label: "Muestras", icon: "🧫", perm: "muestra.ver" },
      { href: "/captura", label: "Captura de resultados", icon: "✍", perm: "resultado.crear" },
      { href: "/captura-ot", label: "Captura y revisión por OT", icon: "📈", perm: ["resultado.crear", "resultado.revisar", "resultado.aprobar"], claves: "revisar aprobar devolver especificación" },
      { href: "/informes", label: "Emitir informe", icon: "🖨", perm: "certificado.emitir" },
      { href: "/certificados", label: "Certificados", icon: "📜", perm: "ot.ver" },
      { href: "/custodia", label: "Cadena de custodia", icon: "🔗", perm: "muestra.ver" },
      { href: "/equipos", label: "Equipos y calibración", icon: "⚙", perm: "equipo.ver" },
      { href: "/consumibles", label: "Consumibles · kardex", icon: "🧴", perm: "catalogo.gestionar", claves: "stock reactivos lotes" },
      { href: "/qc", label: "Control de calidad (QC)", icon: "✔", perm: "resultado.ver" },
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
      { href: "/formatos-informe", label: "Formatos de informe", icon: "🧾", perm: "catalogo.gestionar", claves: "veredicto occ oi dgmn" },
      { href: "/tipos-muestra", label: "Tipos de muestra", icon: "🌡", perm: "muestra.ver" },
      { href: "/limites", label: "Límites (clásico)", icon: "📏", perm: "metodo.ver" },
      { href: "/flujos", label: "Diseñador de flujos", icon: "⛓", perm: "flujo.ver" },
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
      { href: "/firmas", label: "Firmas registradas", icon: "🖋", perm: "firma.registrar" },
      { href: "/catalogo/parametros", label: "Parámetros del sistema", icon: "🎛", perm: "catalogo.gestionar", claves: "listas combos" },
      { href: "/config-correo", label: "Correo saliente", icon: "✉", perm: "admin.usuarios", claves: "smtp" },
      { href: "/usuarios", label: "Usuarios (vista clásica)", icon: "👤", perm: "admin.usuarios" },
      { href: "/permisos", label: "Catálogo de permisos", icon: "📋", perm: "admin.usuarios" },
    ],
  },
];

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
