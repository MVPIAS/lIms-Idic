"use client";

import CrudTable, { activoBadge, codigoCell } from "../_components/CrudTable";

export default function AnalitosPage() {
  return (
    <CrudTable
      titulo="Analitos"
      subtitulo="Eje Análisis · nivel 3. Parámetro medible de un Método (unidad, fórmula, rangos)."
      endpoint="cat/analitos"
      columnas={[
        { key: "codigo", label: "Código", render: codigoCell },
        { key: "nombre", label: "Nombre" },
        { key: "metodo", label: "Método", render: (_v, row) => row.metodo?.nombre ?? "—" },
        { key: "unidad", label: "Unidad" },
        { key: "rangoNominal", label: "Nominal", num: true },
        { key: "activo", label: "Estado", render: activoBadge },
      ]}
      campos={[
        { name: "metodoId", label: "Método", tipo: "select", requerido: true, opcionesEndpoint: "cat/metodos?limit=500" },
        { name: "codigo", label: "Código", requerido: true },
        { name: "nombre", label: "Nombre", requerido: true },
        { name: "unidad", label: "Unidad" },
        { name: "formula", label: "Fórmula" },
        { name: "rangoMin", label: "Rango mín.", tipo: "number" },
        { name: "rangoNominal", label: "Rango nominal", tipo: "number" },
        { name: "rangoMax", label: "Rango máx.", tipo: "number" },
        { name: "activo", label: "Activo", tipo: "checkbox" },
      ]}
    />
  );
}
