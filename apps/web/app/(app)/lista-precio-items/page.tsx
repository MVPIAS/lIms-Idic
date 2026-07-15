"use client";

import CrudTable from "@/components/CrudTable";

const num = (data: any) => ({
  ...data,
  precio: data.precio === "" || data.precio == null ? undefined : Number(data.precio),
});

export default function ListaPrecioItemsPage() {
  return (
    <CrudTable
      recurso="lista-precio-items"
      titulo="Ítems de Lista de Precio"
      subtitulo="Líneas de tarifario: servicios, HH/HM, viáticos e insumos con su precio. Alimentan el costeo."
      prepararCrear={num}
      columnas={[
        { campo: "codigo", titulo: "Código", render: (v) => <span className="codigo">{v}</span> },
        { campo: "descripcion", titulo: "Descripción" },
        { campo: "tipo", titulo: "Tipo", render: (v) => (v ? <span className="tag">{v}</span> : "—") },
        { campo: "cc", titulo: "CC" },
        { campo: "precio", titulo: "Precio", right: true },
      ]}
      campos={[
        { campo: "listaPrecioId", label: "Lista de precio", tipo: "ref", refRecurso: "listas-precio", requerido: true },
        { campo: "codigo", label: "Código", requerido: true },
        { campo: "descripcion", label: "Descripción", requerido: true },
        { campo: "cc", label: "Centro de costo" },
        { campo: "tipo", label: "Tipo", tipo: "select", opciones: ["servicio", "HH", "HM", "viatico", "insumo"] },
        { campo: "precio", label: "Precio", tipo: "number", requerido: true },
      ]}
    />
  );
}
