"use client";

import CrudTable from "@/components/CrudTable";

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
        { campo: "facturaId", titulo: "Factura (id)", render: (v) => (v ? <span className="tag">{String(v).slice(0, 8)}…</span> : "—") },
        { campo: "monto", titulo: "Monto", right: true },
        { campo: "motivo", titulo: "Motivo" },
      ]}
      campos={[
        // facturaId es FK (uuid): por ahora se ingresa el id de la factura a mano.
        { campo: "facturaId", label: "Factura (id)", requerido: true },
        { campo: "numero", label: "Número", requerido: true },
        { campo: "monto", label: "Monto", tipo: "number", requerido: true },
        { campo: "motivo", label: "Motivo" },
      ]}
    />
  );
}
