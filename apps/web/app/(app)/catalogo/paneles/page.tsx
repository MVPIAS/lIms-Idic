"use client";

import CrudTable, { activoBadge } from "../_components/CrudTable";

/** «código · nombre» de un objeto relacionado incluido en el listado. */
const etiqueta = (o: any) => (o ? [o.codigo, o.nombre].filter(Boolean).join(" · ") : "—");

/**
 * Paneles de ensayo (bisagra del catálogo v2, tabla `cat_panel`): qué MÉTODOS
 * (y con qué ensayo/precio) aplican a cada ELEMENTO (producto/matriz). Es lo que
 * el wizard de OT ofrece al elegir un elemento.
 *
 * Los selectores de elemento y método admiten un filtro previo (subgrupo /
 * ensayo) para no tener que recorrer listas de miles de registros.
 */
export default function PanelesPage() {
  return (
    <CrudTable
      titulo="Paneles de ensayo"
      subtitulo="Une el eje Producto con el eje Análisis: para cada Elemento, qué Métodos (y Ensayo) se le pueden aplicar. Es la lista que se ofrece al registrar una OT."
      endpoint="cat/paneles"
      columnas={[
        { key: "elemento", label: "Elemento", render: (_v, row) => etiqueta(row.elemento) },
        { key: "metodo", label: "Método", render: (_v, row) => etiqueta(row.metodo) },
        { key: "ensayo", label: "Ensayo", render: (_v, row) => etiqueta(row.ensayo) },
        { key: "inspecTipo", label: "Tipo inspección", render: (v) => (v ? <span className="tag">{v}</span> : "—") },
        { key: "orden", label: "Orden", num: true, editable: { tipo: "number" } },
        { key: "activo", label: "Estado", render: activoBadge },
      ]}
      campos={[
        {
          name: "subgrupoFiltro",
          label: "Filtrar elementos por subgrupo",
          tipo: "select",
          opcionesEndpoint: "cascada/subgrupos",
          opcionesMap: (r) => ({ value: String(r.id), label: [r.cntlroom, r.nombre].filter(Boolean).join(" · ") }),
        },
        {
          name: "elementoId",
          label: "Elemento",
          tipo: "select",
          requerido: true,
          dependeDe: "subgrupoFiltro",
          span: 2,
          opcionesEndpoint: (f) => (f.subgrupoFiltro ? `cascada/elementos?subgrupoId=${encodeURIComponent(f.subgrupoFiltro)}` : "cat/elementos?limit=100"),
        },
        { name: "ensayoId", label: "Ensayo (opcional)", tipo: "select", opcionesEndpoint: "cascada/ensayos" },
        {
          name: "metodoId",
          label: "Método",
          tipo: "select",
          requerido: true,
          dependeDe: "ensayoId",
          span: 2,
          opcionesEndpoint: (f) => (f.ensayoId ? `cascada/ensayos/${encodeURIComponent(f.ensayoId)}/metodos` : "cat/metodos?limit=100"),
        },
        {
          name: "inspecTipo",
          label: "Tipo de inspección",
          tipo: "select",
          opcionesEndpoint: "parametros?categoria=tipo_inspeccion&activo=true",
          opcionesMap: (r) => ({ value: String(r.codigo), label: r.etiqueta ?? r.codigo }),
        },
        { name: "orden", label: "Orden", tipo: "number" },
        { name: "activo", label: "Activo", tipo: "checkbox" },
      ]}
    />
  );
}
