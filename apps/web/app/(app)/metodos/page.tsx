"use client";

import CrudTable from "@/components/CrudTable";

export default function MetodosPage() {
  return (
    <CrudTable
      recurso="metodos"
      titulo="Métodos / Catálogo de ensayos"
      subtitulo="Catálogo técnico: cada método define técnica, norma y fórmula de cálculo. 136 métodos cargados en 5 laboratorios."
      columnas={[
        { campo: "codigo", titulo: "Código" },
        { campo: "nombre", titulo: "Método / Ensayo" },
        { campo: "tecnica", titulo: "Técnica" },
        { campo: "norma", titulo: "Norma" },
        { campo: "unidad", titulo: "Unidad" },
      ]}
      campos={[
        { campo: "codigo", label: "Código", requerido: true },
        { campo: "nombre", label: "Nombre", requerido: true },
        { campo: "tecnica", label: "Técnica" },
        { campo: "norma", label: "Norma" },
        { campo: "unidad", label: "Unidad" },
      ]}
    />
  );
}
