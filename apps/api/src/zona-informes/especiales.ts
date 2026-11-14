/**
 * Zona de informes · informes ESPECIALES: los que no son un listado con filtros
 * (catalogo.ts) sino un documento con formato propio y su pantalla. El catálogo
 * los muestra junto a los reportes fijos de su área y los abre en `ruta`.
 * Cada uno exige su propio permiso; la API del informe vuelve a validarlo y aplica
 * el alcance por laboratorio.
 */
export interface InformeEspecial {
  clave: string;
  titulo: string;
  area: string;
  descripcion: string;
  legado: string[];
  pedido: string;
  permiso: string;
  /** Pantalla del informe en la web. */
  ruta: string;
}

export const INFORMES_ESPECIALES: InformeEspecial[] = [
  {
    clave: "encuestas-trimestral",
    titulo: "Informe trimestral de encuestas de satisfacción",
    area: "Comercial y facturación",
    descripcion:
      "Anexos 01 a 06 de la instrucción DCO-PG01-P04-IT05 por formulario: encuestas contestadas, índice de satisfacción sobre el 85 %, " +
      "evaluación por ítem y por laboratorio o sucursal, observaciones y control de aplicación. En pantalla, PDF y Excel.",
    legado: [],
    pedido: "DCO-PG01-P04-IT05 «Seguimiento de clientes» · Anexos 01 a 06 y planilla «Análisis encuestas» del Depto. Comercial",
    permiso: "encuesta.ver",
    ruta: "/zona-informes/encuestas-trimestral",
  },
];
