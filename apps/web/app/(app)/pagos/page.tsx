"use client";

import CrudTable, { renderRef } from "@/components/CrudTable";

const num = (data: any) => ({
  ...data,
  monto: data.monto === "" || data.monto == null ? undefined : Number(data.monto),
});

export default function PagosPage() {
  return (
    <CrudTable
      recurso="pagos"
      titulo="Pagos"
      subtitulo="Abonos recibidos contra facturas. Reducen el saldo pendiente."
      prepararCrear={num}
      columnas={[
        { campo: "facturaId", titulo: "Factura", render: renderRef("factura") },
        { campo: "monto", titulo: "Monto", right: true },
        { campo: "medio", titulo: "Medio" },
        { campo: "referencia", titulo: "Referencia", render: (v) => (v ? <span className="codigo">{v}</span> : "—") },
      ]}
      campos={[
        { campo: "facturaId", label: "Factura", tipo: "ref", refRecurso: "facturas", requerido: true },
        { campo: "monto", label: "Monto", tipo: "number", requerido: true },
        { campo: "medio", label: "Medio de pago" },
        { campo: "referencia", label: "Referencia" },
      ]}
    />
  );
}
