"use client";

import CrudTable from "@/components/CrudTable";

export default function ListasPrecioPage() {
  return (
    <CrudTable
      recurso="listas-precio"
      titulo="Listas de Precio"
      subtitulo="Tarifario por método. Alimenta el costeo de las cotizaciones."
      columnas={[
        { campo: "codigo", titulo: "Código" },
        { campo: "nombre", titulo: "Nombre" },
        { campo: "moneda", titulo: "Moneda" },
        { campo: "vigenteDesde", titulo: "Vigente desde", render: (v) => (v ? String(v).slice(0, 10) : "—") },
      ]}
      campos={[
        { campo: "codigo", label: "Código", requerido: true },
        { campo: "nombre", label: "Nombre", requerido: true },
        { campo: "moneda", label: "Moneda", tipo: "select", opciones: ["CLP", "USD", "UF"] },
        { campo: "vigenteDesde", label: "Vigente desde (AAAA-MM-DD)" },
      ]}
    />
  );
}
