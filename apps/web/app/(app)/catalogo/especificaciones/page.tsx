"use client";

import CrudTable, { activoBadge } from "../_components/CrudTable";

const EVALUACION: Record<string, string> = {
  con_condicion: "Con condición",
  sin_condicion: "Sin condición",
  solo_resultado: "Solo resultado",
};

const ambitoBadge = (v: string) => {
  const map: Record<string, string> = { estandar: "gray", cliente: "blue", producto: "teal", muestra: "amber" };
  return <span className={`pill ${map[v] ?? "gray"}`}>{v ?? "—"}</span>;
};

export default function EspecificacionesPage() {
  return (
    <CrudTable
      titulo="Especificaciones"
      subtitulo="Eje Análisis · nivel 4. Límites/requisitos de un Analito por ámbito (estándar, cliente, producto o muestra). Mín, Nominal y Máx son opcionales; «Evaluación»: con condición (Cumple / No cumple), requisito sin condición o solo resultado."
      endpoint="cat/especificaciones"
      columnas={[
        { key: "analito", label: "Analito", render: (_v, row) => row.analito?.nombre ?? "—" },
        { key: "ambito", label: "Ámbito", render: ambitoBadge },
        { key: "limiteInf", label: "Lím. inf.", num: true },
        { key: "nominal", label: "Nominal", num: true },
        { key: "limiteSup", label: "Lím. sup.", num: true },
        { key: "unidad", label: "Unidad" },
        { key: "evaluacion", label: "Evaluación", render: (v) => EVALUACION[v ?? "con_condicion"] ?? v },
        { key: "activo", label: "Estado", render: activoBadge },
      ]}
      campos={[
        { name: "analitoId", label: "Analito", tipo: "select", requerido: true, opcionesEndpoint: "cat/analitos?limit=500" },
        { name: "ambito", label: "Ámbito", tipo: "select", requerido: true, opciones: ["estandar", "cliente", "producto", "muestra"] },
        { name: "unidad", label: "Unidad" },
        { name: "limiteInf", label: "Límite inferior (opcional)", tipo: "number" },
        { name: "nominal", label: "Nominal", tipo: "number" },
        { name: "limiteSup", label: "Límite superior (opcional)", tipo: "number" },
        { name: "evaluacion", label: "Evaluación", tipo: "select", opciones: ["con_condicion", "sin_condicion", "solo_resultado"] },
        { name: "requisitos", label: "Requisitos", tipo: "textarea", span: 3 },
        { name: "texto", label: "Texto", tipo: "textarea", span: 3 },
        { name: "activo", label: "Activo", tipo: "checkbox" },
      ]}
    />
  );
}
