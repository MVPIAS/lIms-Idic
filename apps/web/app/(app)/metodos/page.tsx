"use client";

import CrudTable from "@/components/CrudTable";

const estadoBadge = (v: string) => (
  <span className={`pill ${v === "vigente" ? "green" : v === "en_validacion" ? "amber" : "gray"}`}>{v ?? "—"}</span>
);

export default function MetodosPage() {
  return (
    <CrudTable
      recurso="metodos"
      titulo="Métodos / Catálogo de ensayos"
      subtitulo="Catálogo técnico: cada método define norma, área y versión. 136 métodos cargados en 5 laboratorios (LQC, SVM, SEO, LES, LQA)."
      columnas={[
        { campo: "codigo", titulo: "Código", render: (v) => <span className="codigo">{v}</span> },
        { campo: "nombre", titulo: "Método / Ensayo" },
        { campo: "norma", titulo: "Norma", render: (v) => (v ? <span className="tag">{v}</span> : "—") },
        { campo: "area", titulo: "Área / Lab" },
        { campo: "version", titulo: "Ver." },
        { campo: "estado", titulo: "Estado", render: estadoBadge },
      ]}
      campos={[
        { campo: "codigo", label: "Código", requerido: true },
        { campo: "nombre", label: "Nombre", requerido: true },
        { campo: "norma", label: "Norma" },
        { campo: "area", label: "Área / Laboratorio" },
        { campo: "version", label: "Versión" },
        { campo: "estado", label: "Estado", tipo: "select", opciones: ["vigente", "en_validacion", "obsoleto"] },
      ]}
    />
  );
}
