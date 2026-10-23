"use client";

import Link from "next/link";
import CrudTable from "@/components/CrudTable";
import { fecha } from "@/lib/format";

export default function ListasPrecioPage() {
  return (
    <CrudTable
      recurso="listas-precio"
      titulo="Listas de Precio"
      subtitulo="Tarifario de servicios con su estructura de costos. La cotización a un cliente particular toma el neto de la lista vigente."
      columnas={[
        {
          campo: "codigo",
          titulo: "Código",
          render: (v, row) => (
            <Link href={`/listas-precio/${row.id}` as any} className="codigo" style={{ textDecoration: "underline" }}>
              {v}
            </Link>
          ),
        },
        { campo: "nombre", titulo: "Nombre" },
        { campo: "moneda", titulo: "Moneda", render: (v) => <span className="tag">{v ?? "CLP"}</span> },
        { campo: "vigenteDesde", titulo: "Vigente desde", render: (v) => fecha(v) },
        { campo: "vigenteHasta", titulo: "Vigente hasta", render: (v) => (v ? fecha(v) : "—") },
        {
          campo: "id",
          titulo: "Servicios",
          render: (v, row) => (
            <Link href={`/listas-precio/${v}` as any} className="btn outline sm">
              Ver servicios y costos{Array.isArray(row.items) ? ` (${row.items.length})` : ""}
            </Link>
          ),
        },
      ]}
      campos={[
        { campo: "codigo", label: "Código", requerido: true },
        { campo: "nombre", label: "Nombre", requerido: true },
        { campo: "moneda", label: "Moneda", tipo: "select", opciones: ["CLP", "USD", "UF"] },
        { campo: "vigenteDesde", label: "Vigente desde", tipo: "date" },
      ]}
    />
  );
}
