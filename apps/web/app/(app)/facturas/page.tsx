"use client";

import CrudTable from "@/components/CrudTable";

const clp = (n: any) => "$ " + Number(n ?? 0).toLocaleString("es-CL");

export default function FacturasPage() {
  return (
    <CrudTable
      recurso="facturas"
      titulo="Facturas"
      subtitulo="Se generan al cerrar cada OT (transición del flujo). Fusión con la facturación comercial."
      columnas={[
        { campo: "numero", titulo: "N° Factura" },
        { campo: "neto", titulo: "Neto", right: true, render: (v) => clp(v) },
        { campo: "ivaMonto", titulo: "IVA", right: true, render: (v) => clp(v) },
        { campo: "total", titulo: "Total", right: true, render: (v) => clp(v) },
        { campo: "estado", titulo: "Estado", render: (v) => <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100">{v}</span> },
      ]}
    />
  );
}
