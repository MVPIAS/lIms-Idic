/**
 * permisosRecurso.ts · permiso exigido por el BACKEND para cada verbo de cada
 * recurso CRUD (espejo de los @RequierePermisoCrud / @RequierePermiso de
 * apps/api). Los códigos NO siguen siempre el patrón `<recurso>.crear`
 * (p. ej. facturas → factura.emitir / factura.cobrar), por eso se declaran aquí
 * en vez de deducirlos del nombre.
 *
 * Lo usa CrudTable para ocultar Nuevo / Editar / Eliminar cuando el usuario no
 * tiene el permiso. Si un recurso no está en el mapa, los botones se muestran
 * (el backend sigue respondiendo 403 si no corresponde).
 *
 * Al añadir un controlador CRUD en la API, añadir aquí su fila.
 */

export interface PermisosCrud {
  ver?: string;
  crear?: string;
  editar?: string;
  eliminar?: string;
}

const todos = (ver: string, gestionar: string): PermisosCrud => ({
  ver,
  crear: gestionar,
  editar: gestionar,
  eliminar: gestionar,
});

const CATALOGO = todos("muestra.ver", "catalogo.gestionar");

export const PERMISOS_RECURSO: Record<string, PermisosCrud> = {
  // Comercial / facturación
  clientes: { ver: "cliente.ver", crear: "cliente.crear", editar: "cliente.editar", eliminar: "cliente.editar" },
  contactos: todos("cliente.ver", "cliente.editar"),
  proveedores: todos("compra.ver", "compra.gestionar"),
  "centros-costo": todos("factura.ver", "catalogo.gestionar"),
  "listas-precio": todos("cotizacion.ver", "catalogo.gestionar"),
  "lista-precio-items": todos("cotizacion.ver", "catalogo.gestionar"),
  facturas: { ver: "factura.ver", crear: "factura.emitir", editar: "factura.cobrar", eliminar: "factura.emitir" },
  pagos: todos("factura.ver", "factura.cobrar"),
  "notas-credito": todos("factura.ver", "factura.emitir"),
  "ordenes-compra": todos("compra.ver", "compra.gestionar"),
  viaticos: todos("factura.ver", "factura.emitir"),
  oportunidades: todos("cotizacion.ver", "cotizacion.crear"),
  "solicitud-costeo": todos("cotizacion.ver", "cotizacion.crear"),
  "ordenes-internas": { ver: "ot.ver", crear: "orden_interna.emitir", editar: "orden_interna.emitir", eliminar: "orden_interna.anular" },

  // Laboratorio (legacy)
  muestras: todos("muestra.ver", "muestra.crear"),
  metodos: todos("metodo.ver", "metodo.crear"),
  analitos: todos("metodo.ver", "catalogo.gestionar"),
  limites: todos("metodo.ver", "catalogo.gestionar"),
  "tipos-muestra": CATALOGO,
  "gran-grupos": CATALOGO,
  grupos: CATALOGO,
  plantillas: todos("plantilla.ver", "plantilla.gestionar"),
  certificados: { ver: "ot.ver", crear: "certificado.emitir", editar: "certificado.emitir", eliminar: "certificado.firmar" },
  resultados: { ver: "resultado.ver", crear: "resultado.crear", editar: "resultado.revisar", eliminar: "resultado.aprobar" },
  consumibles: todos("consumible.gestionar", "consumible.gestionar"),
  "formatos-informe": CATALOGO,

  // Catálogo v2
  "cat/gran-grupos": CATALOGO,
  "cat/grupos": CATALOGO,
  "cat/subgrupos": CATALOGO,
  "cat/familias": CATALOGO,
  "cat/elementos": CATALOGO,
  "cat/ensayos": CATALOGO,
  "cat/metodos": CATALOGO,
  "cat/analitos": CATALOGO,
  "cat/especificaciones": CATALOGO,
  "cat/paneles": CATALOGO,
  "pasos-metodo": CATALOGO,
  // Frente f5 · tarifas: sin borrado (se desactivan).
  "tarifas/hh": { ver: "tarifa.ver", crear: "catalogo.gestionar", editar: "catalogo.gestionar" },
  "tarifas/hh-perfiles": { ver: "tarifa.ver", crear: "catalogo.gestionar", editar: "catalogo.gestionar" },
  "tarifas/hm": { ver: "tarifa.ver", crear: "catalogo.gestionar", editar: "catalogo.gestionar" },
  "tarifas/servicios-primarios": { ver: "tarifa.ver", crear: "catalogo.gestionar", editar: "catalogo.gestionar" },
  parametros: { crear: "catalogo.gestionar", editar: "catalogo.gestionar", eliminar: "catalogo.gestionar" },

  // SAEC
  armas: { ver: "arma.ver", crear: "arma.crear", editar: "arma.editar", eliminar: "arma.eliminar" },

  // Sistema
  usuarios: todos("admin.usuarios", "admin.usuarios"),
  roles: todos("admin.usuarios", "admin.usuarios"),
  unidades: todos("admin.usuarios", "admin.usuarios"),
  permisos: todos("admin.usuarios", "admin.usuarios"),
  firmas: todos("firma.registrar", "firma.registrar"),
};

/** Permisos del recurso (sin query string ni barras sobrantes). */
export function permisosDe(recurso: string): PermisosCrud | undefined {
  const clave = recurso.split("?")[0].replace(/^\/+|\/+$/g, "");
  return PERMISOS_RECURSO[clave];
}
