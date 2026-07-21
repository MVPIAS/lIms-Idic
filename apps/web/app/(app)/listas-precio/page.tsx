"use client";

import CrudTable from "@/components/CrudTable";
import { fecha } from "@/lib/format";

export default function ListasPrecioPage() {
  return (
    <CrudTable
      recurso="listas-precio"
      titulo="Listas de Precio"
      subtitulo="Tarifario por método. Alimenta el costeo de las cotizaciones."
      columnas={[
        { campo: "codigo", titulo: "Código", render: (v) => <span className="codigo">{v}</span> },
        { campo: "nombre", titulo: "Nombre" },
        { campo: "moneda", titulo: "Moneda", render: (v) => <span className="tag">{v ?? "CLP"}</span> },
        { campo: "vigenteDesde", titulo: "Vigente desde", render: (v) => fecha(v) },
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
