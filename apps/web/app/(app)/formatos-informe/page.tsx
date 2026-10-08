"use client";

import CrudTable, { activoBadge, codigoCell } from "../catalogo/_components/CrudTable";

const VEREDICTOS = ["cumple", "no_cumple", "inspeccion"];
const ORGANISMOS = ["OCC", "OI"];
const DESTINOS = ["cliente", "DGMN"];

const VEREDICTO_PILL: Record<string, string> = { cumple: "green", no_cumple: "red", inspeccion: "blue" };

/**
 * Formatos de informe (tabla `formato_informe`): qué formato corresponde a cada
 * combinación veredicto × organismo (OCC/OI) × destino (cliente/DGMN). El
 * sistema lo usa para sugerir el formato al emitir el informe de una OT.
 */
export default function FormatosInformePage() {
  return (
    <CrudTable
      titulo="Formatos de informe"
      subtitulo="Define qué formato de informe se usa según el veredicto (cumple / no cumple / inspección), el organismo (OCC u OI) y el destino (cliente o DGMN). Al emitir un informe, el sistema sugiere el formato que coincide."
      migas={[{ label: "Configuración del laboratorio" }, { label: "Formatos de informe" }]}
      endpoint="formatos-informe"
      columnas={[
        { key: "codigo", label: "Código", render: codigoCell },
        { key: "descripcion", label: "Descripción", editable: true },
        { key: "veredicto", label: "Veredicto", render: (v) => (v ? <span className={`pill ${VEREDICTO_PILL[v] ?? "gray"}`}>{String(v).replace("_", " ")}</span> : "—") },
        { key: "organismo", label: "Organismo", render: (v) => (v ? <span className="tag">{v}</span> : "—") },
        { key: "destino", label: "Destino" },
        { key: "activo", label: "Estado", render: activoBadge },
      ]}
      campos={[
        { name: "codigo", label: "Código", requerido: true },
        { name: "descripcion", label: "Descripción", requerido: true, span: 2 },
        { name: "veredicto", label: "Veredicto", tipo: "select", opciones: VEREDICTOS },
        { name: "organismo", label: "Organismo", tipo: "select", opciones: ORGANISMOS },
        { name: "destino", label: "Destino", tipo: "select", opciones: DESTINOS },
        { name: "activo", label: "Activo", tipo: "checkbox" },
      ]}
    />
  );
}
