"use client";

import CrudTable from "@/components/CrudTable";

const estadoBadge = (v: string) => (
  <span className={`pill ${v === "anulada" ? "red" : v === "recibida" ? "green" : "amber"}`}>{v ?? "—"}</span>
);

// NOTA: el create de ordenes-compra exige al menos una línea (array `lineas`),
// que este formulario genérico aún no captura. Alta completa pendiente de un
// formulario con líneas (patrón similar a cotizaciones/nueva). Aquí se listan/consultan.
export default function OrdenesCompraPage() {
  return (
    <CrudTable
      recurso="ordenes-compra"
      titulo="Órdenes de Compra"
      subtitulo="OC a proveedores. El alta con líneas se hace desde el formulario dedicado; aquí se consultan y cambian de estado."
      columnas={[
        { campo: "numero", titulo: "Número", render: (v) => <span className="codigo">{v}</span> },
        { campo: "proveedorId", titulo: "Proveedor (id)", render: (v) => (v ? <span className="tag">{String(v).slice(0, 8)}…</span> : "—") },
        { campo: "detalle", titulo: "Detalle" },
        { campo: "monto", titulo: "Monto", right: true },
        { campo: "estado", titulo: "Estado", render: estadoBadge },
      ]}
    />
  );
}
