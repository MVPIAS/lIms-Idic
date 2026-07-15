"use client";

import CrudTable, { renderRef } from "@/components/CrudTable";

/** La OT se identifica por su código, con el cliente como desempate. */
const etiquetaOt = (o: any) => [o.codigo, o.cliente?.razonSocial].filter(Boolean).join(" · ");

export default function MuestrasPage() {
  return (
    <CrudTable
      recurso="muestras"
      titulo="Muestras"
      subtitulo="Maestro de muestras. A cada muestra se le asignan 1..n ensayos."
      columnas={[
        { campo: "codigo", titulo: "Código", render: (v) => <span className="codigo">{v}</span> },
        { campo: "nombre", titulo: "Muestra" },
        { campo: "tipoMuestraId", titulo: "Tipo", render: renderRef("tipoMuestra") },
        { campo: "grupoId", titulo: "Grupo", render: renderRef("grupo") },
        { campo: "codigoBarras", titulo: "Cód. barras", render: (v) => (v ? <span className="codigo">{v}</span> : "—") },
        { campo: "ubicacion", titulo: "Ubicación" },
        { campo: "estado", titulo: "Estado", render: (v) => <span className={`pill ${v === "finalizada" ? "green" : v === "en_analisis" ? "amber" : "blue"}`}>{v ?? "—"}</span> },
      ]}
      campos={[
        { campo: "codigo", label: "Código", requerido: true },
        { campo: "nombre", label: "Nombre de la muestra" },
        { campo: "otId", label: "OT", tipo: "ref", refRecurso: "ot", refLabel: etiquetaOt },
        { campo: "clienteId", label: "Cliente", tipo: "ref", refRecurso: "clientes" },
        { campo: "tipoMuestraId", label: "Tipo de muestra", tipo: "ref", refRecurso: "tipos-muestra" },
        // Eje Producto: Gran Grupo → Grupo (el backend no filtra el grupo por gran grupo; se eligen por separado).
        { campo: "granGrupoId", label: "Gran Grupo", tipo: "ref", refRecurso: "gran-grupos" },
        { campo: "grupoId", label: "Grupo", tipo: "ref", refRecurso: "grupos" },
        { campo: "codigoBarras", label: "Código de barras" },
        { campo: "ubicacion", label: "Ubicación" },
        { campo: "estado", label: "Estado", tipo: "select", opciones: ["recibida", "en_analisis", "finalizada"] },
      ]}
    />
  );
}
