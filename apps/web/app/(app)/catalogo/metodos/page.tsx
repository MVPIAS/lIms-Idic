"use client";

import CrudTable, { activoBadge, codigoCell } from "../_components/CrudTable";

export default function MetodosCatPage() {
  return (
    <CrudTable
      titulo="Métodos"
      subtitulo="Eje Análisis · nivel 2. Método analítico (norma, instrumento, versión); puede colgar de un Ensayo."
      endpoint="cat/metodos"
      columnas={[
        { key: "codigo", label: "Código", render: codigoCell },
        { key: "nombre", label: "Nombre", editable: true },
        { key: "norma", label: "Norma", render: (v) => (v ? <span className="tag">{v}</span> : "—") },
        { key: "instrumento", label: "Instrumento" },
        { key: "version", label: "Ver." },
        {
          key: "factorValor",
          label: "Factor",
          render: (v: any, row: any) => (v != null && row?.factorOperacion ? `${row.factorOperacion === "dividir" ? "÷" : "×"} ${String(Number(v)).replace(".", ",")}` : "—"),
        },
        { key: "equipoRequerido", label: "Exige equipo", render: (v: any) => (v ? <span className="pill blue">Sí</span> : "—") },
        { key: "activo", label: "Estado", render: activoBadge },
      ]}
      campos={[
        { name: "ensayoId", label: "Ensayo (opcional)", tipo: "select", opcionesEndpoint: "cat/ensayos?limit=500" },
        { name: "codigo", label: "Código", requerido: true },
        { name: "nombre", label: "Nombre", requerido: true },
        { name: "norma", label: "Norma" },
        { name: "instrumento", label: "Instrumento" },
        { name: "version", label: "Versión" },
        { name: "servgrp", label: "Serv. grupo" },
        // Factor por defecto de la fórmula: se copia a los ensayos de cada OT y la jefatura lo ajusta por OT.
        { name: "factorOperacion", label: "Factor de la fórmula · operación", tipo: "select", opciones: ["multiplicar", "dividir"] },
        { name: "factorValor", label: "Factor de la fórmula · valor", tipo: "number" },
        { name: "factorDescripcion", label: "Factor · qué representa (p. ej. dilución 1:10)" },
        // Contrato §4.4.2: al capturar hay que informar el equipo usado; uno con la calibración vencida se bloquea.
        { name: "equipoRequerido", label: "Exige informar el equipo al capturar", tipo: "checkbox" },
        { name: "activo", label: "Activo", tipo: "checkbox" },
      ]}
    />
  );
}
