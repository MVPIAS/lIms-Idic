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
        { key: "nombre", label: "Nombre" },
        { key: "norma", label: "Norma", render: (v) => (v ? <span className="tag">{v}</span> : "—") },
        { key: "instrumento", label: "Instrumento" },
        { key: "version", label: "Ver." },
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
        { name: "activo", label: "Activo", tipo: "checkbox" },
      ]}
    />
  );
}
