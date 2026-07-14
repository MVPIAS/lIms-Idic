"use client";

import CrudTable from "@/components/CrudTable";

export default function PlantillasPage() {
  return (
    <CrudTable
      recurso="plantillas"
      titulo="Plantillas de informe"
      subtitulo="Repositorio de plantillas (REPID) que se rellenan automáticamente y se asignan a los flujos."
      columnas={[
        { campo: "repid", titulo: "REPID", render: (v) => <span className="codigo">{v}</span> },
        { campo: "nombre", titulo: "Plantilla" },
        { campo: "tipo", titulo: "Tipo", render: (v) => <span className={`pill ${v === "CERTIFICADO" ? "teal" : String(v).startsWith("I.") ? "blue" : "gray"}`}>{v}</span> },
        { campo: "emision", titulo: "Emisión" },
        { campo: "version", titulo: "Ver." },
      ]}
      campos={[
        { campo: "repid", label: "REPID", requerido: true },
        { campo: "nombre", label: "Nombre", requerido: true },
        { campo: "tipo", label: "Tipo", tipo: "select", requerido: true, opciones: ["CERTIFICADO", "I.ENSAYO", "I.TECNICO", "IVC", "PLANILLA", "BOLETIN", "OTRO"] },
        { campo: "emision", label: "Emisión", tipo: "select", opciones: ["conjunto", "individual"] },
        { campo: "version", label: "Versión" },
      ]}
    />
  );
}
