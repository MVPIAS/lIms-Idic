"use client";

import CrudTable from "@/components/CrudTable";
import { monto } from "@/lib/format";

export default function FacturasPage() {
  return (
    <CrudTable
      recurso="facturas"
      titulo="Facturas"
      subtitulo="Se generan al cerrar cada OT (transición del flujo). Fusión con la facturación comercial."
      columnas={[
        { campo: "numero", titulo: "N° Factura", render: (v) => <span className="codigo">{v}</span> },
        { campo: "neto", titulo: "Neto", right: true, render: (v, row) => monto(v, row.moneda) },
        { campo: "ivaMonto", titulo: "IVA", right: true, render: (v, row) => monto(v, row.moneda) },
        { campo: "total", titulo: "Total", right: true, render: (v, row) => monto(v, row.moneda) },
        { campo: "estado", titulo: "Estado", render: (v) => <span className={`pill ${v === "pagada" ? "green" : v === "emitida" ? "amber" : "gray"}`}>{v ?? "—"}</span> },
      ]}
    />
  );
}
