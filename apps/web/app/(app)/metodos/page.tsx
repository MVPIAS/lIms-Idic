"use client";

import CrudTable from "@/components/CrudTable";

const estadoBadge = (v: string) => (
  <span className={`text-[11px] px-2 py-0.5 rounded-full ${v === "vigente" ? "bg-emerald-100 text-emerald-700" : v === "en_validacion" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>
    {v ?? "—"}
  </span>
);

export default function MetodosPage() {
  return (
    <CrudTable
      recurso="metodos"
      titulo="Métodos / Catálogo de ensayos"
      subtitulo="Catálogo técnico: cada método define norma, área y versión. 136 métodos cargados en 5 laboratorios (LQC, SVM, SEO, LES, LQA)."
      columnas={[
        { campo: "codigo", titulo: "Código" },
        { campo: "nombre", titulo: "Método / Ensayo" },
        { campo: "norma", titulo: "Norma" },
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
