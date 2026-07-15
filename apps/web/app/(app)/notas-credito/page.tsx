"use client";

import CrudTable, { renderRef } from "@/components/CrudTable";

const num = (data: any) => ({
  ...data,
  monto: data.monto === "" || data.monto == null ? undefined : Number(data.monto),
});

export default function NotasCreditoPage() {
  return (
    <CrudTable
      recurso="notas-credito"
      titulo="Notas de Crédito"
      subtitulo="Documentos que rebajan el saldo de una factura (devoluciones, correcciones, descuentos)."
      prepararCrear={num}
      columnas={[
        { campo: "numero", titulo: "Número", render: (v) => <span className="codigo">{v}</span> },
        { campo: "facturaId", titulo: "Factura", render: renderRef("factura") },
        { campo: "monto", titulo: "Monto", right: true },
        { campo: "motivo", titulo: "Motivo" },
      ]}
      campos={[
        { campo: "facturaId", label: "Factura", tipo: "ref", refRecurso: "facturas", requerido: true },
        { campo: "numero", label: "Número", requerido: true },
        { campo: "monto", label: "Monto", tipo: "number", requerido: true },
        { campo: "motivo", label: "Motivo" },
      ]}
    />
  );
}
